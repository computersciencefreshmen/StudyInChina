#!/usr/bin/env node

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const DAY_MS = 24 * 60 * 60 * 1000
const REVIEW_HORIZONS = {
  weekly: 30,
  monthly: 90,
  semester: 210,
}
const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 }
const AUDIT_STATUSES = new Set(['draft', 'verified', 'stale', 'archived'])

function usage() {
  return `Usage: node scripts/data-health.mjs [options]

Builds an advisory content report from content/data/*.json.

Options:
  --data-dir <path>       Data directory (default: content/data)
  --link-report <path>    JSON report produced by check-links.mjs
  --mode <mode>           weekly, monthly, or semester (default: weekly)
  --today <YYYY-MM-DD>    Override today's UTC date for deterministic checks
  --json <path>           Write the complete JSON report
  --markdown <path>       Write the GitHub-friendly Markdown report
  --help                  Show this help
`
}

function parseArgs(argv) {
  const options = {
    dataDir: 'content/data',
    linkReportPath: null,
    mode: 'weekly',
    today: null,
    jsonPath: null,
    markdownPath: null,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    const nextValue = () => {
      index += 1
      if (index >= argv.length) {
        throw new Error(`${argument} requires a value`)
      }
      return argv[index]
    }

    switch (argument) {
      case '--data-dir':
        options.dataDir = nextValue()
        break
      case '--link-report':
        options.linkReportPath = nextValue()
        break
      case '--mode':
        options.mode = nextValue()
        break
      case '--today':
        options.today = nextValue()
        break
      case '--json':
        options.jsonPath = nextValue()
        break
      case '--markdown':
        options.markdownPath = nextValue()
        break
      case '--help':
      case '-h':
        process.stdout.write(usage())
        process.exit(0)
        break
      default:
        throw new Error(`Unknown argument: ${argument}\n\n${usage()}`)
    }
  }

  if (!Object.hasOwn(REVIEW_HORIZONS, options.mode)) {
    throw new Error(`--mode must be one of: ${Object.keys(REVIEW_HORIZONS).join(', ')}`)
  }

  return options
}

function parseIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null
  }

  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value
    ? null
    : parsed
}

function utcToday(override) {
  if (override) {
    const parsed = parseIsoDate(override)
    if (!parsed) {
      throw new Error('--today must be a real date in YYYY-MM-DD format')
    }
    return parsed
  }

  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

function daysFrom(today, date) {
  return Math.round((date.getTime() - today.getTime()) / DAY_MS)
}

async function loadJsonFiles(dataDirectory) {
  let entries
  try {
    entries = await readdir(dataDirectory, { withFileTypes: true })
  } catch (error) {
    throw new Error(`Cannot read data directory ${dataDirectory}: ${error.message}`)
  }

  const fileNames = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right))

  if (fileNames.length === 0) {
    throw new Error(`No JSON files found in ${dataDirectory}`)
  }

  return Promise.all(
    fileNames.map(async (fileName) => {
      const absolutePath = path.join(dataDirectory, fileName)
      let value
      try {
        value = JSON.parse(await readFile(absolutePath, 'utf8'))
      } catch (error) {
        throw new Error(`Cannot parse ${absolutePath}: ${error.message}`)
      }
      return { fileName, value }
    }),
  )
}

function recordContext(file, jsonPath, recordId) {
  return { file, path: jsonPath, recordId: recordId ?? null }
}

function auditLike(record) {
  return (
    Object.hasOwn(record, 'sourceIds') ||
    Object.hasOwn(record, 'verifiedAt') ||
    Object.hasOwn(record, 'reviewAfter') ||
    (typeof record.status === 'string' && AUDIT_STATUSES.has(record.status))
  )
}

function addIssue(issues, severity, kind, message, context, details = {}) {
  issues.push({ severity, kind, message, ...context, ...details })
}

function inspectAuditRecord(record, context, state) {
  const { issues, today, reviewHorizonDays, sourceReferences, statusCounts } = state
  const status = typeof record.status === 'string' ? record.status : null

  if (status && AUDIT_STATUSES.has(status)) {
    statusCounts[status] += 1
  }

  if (status === 'archived') {
    return
  }

  if (status === 'stale') {
    addIssue(
      issues,
      'error',
      'record-stale',
      'Record is explicitly marked stale and must not appear as current.',
      context,
    )
  }

  if (!Array.isArray(record.sourceIds) || record.sourceIds.length === 0) {
    addIssue(
      issues,
      status === 'verified' ? 'error' : 'warning',
      'missing-source',
      'Record has no official source IDs.',
      context,
    )
  } else {
    record.sourceIds.forEach((sourceId) => {
      if (typeof sourceId === 'string' && sourceId.length > 0) {
        sourceReferences.push({ sourceId, ...context })
      }
    })
  }

  const verifiedAt = record.verifiedAt == null ? null : parseIsoDate(record.verifiedAt)
  if (record.verifiedAt != null && !verifiedAt) {
    addIssue(
      issues,
      'error',
      'invalid-verified-date',
      `verifiedAt is not a valid YYYY-MM-DD date: ${String(record.verifiedAt)}`,
      context,
    )
  } else if (status === 'verified' && !verifiedAt) {
    addIssue(
      issues,
      'error',
      'missing-verified-date',
      'Verified record has no verifiedAt date.',
      context,
    )
  } else if (verifiedAt && daysFrom(today, verifiedAt) > 0) {
    addIssue(
      issues,
      'warning',
      'future-verification-date',
      `verifiedAt is ${daysFrom(today, verifiedAt)} day(s) in the future.`,
      context,
    )
  }

  const reviewAfter = record.reviewAfter == null ? null : parseIsoDate(record.reviewAfter)
  if (record.reviewAfter != null && !reviewAfter) {
    addIssue(
      issues,
      'error',
      'invalid-review-date',
      `reviewAfter is not a valid YYYY-MM-DD date: ${String(record.reviewAfter)}`,
      context,
    )
  } else if (status === 'verified' && !reviewAfter) {
    addIssue(
      issues,
      'error',
      'missing-review-date',
      'Verified record has no reviewAfter date.',
      context,
    )
  } else if (reviewAfter) {
    const remainingDays = daysFrom(today, reviewAfter)
    if (remainingDays < 0) {
      addIssue(
        issues,
        'error',
        'review-overdue',
        `Review was due ${Math.abs(remainingDays)} day(s) ago on ${record.reviewAfter}.`,
        context,
      )
    } else if (remainingDays <= reviewHorizonDays) {
      addIssue(
        issues,
        'info',
        'review-upcoming',
        `Review is due in ${remainingDays} day(s) on ${record.reviewAfter}.`,
        context,
      )
    }
  }

  if (verifiedAt && reviewAfter && reviewAfter < verifiedAt) {
    addIssue(
      issues,
      'warning',
      'review-before-verification',
      'reviewAfter is earlier than verifiedAt.',
      context,
    )
  }
}

function inspectDeadline(record, context, state) {
  const { issues, today } = state
  const isArchived = record.status === 'archived'
  const isHistorical = record.dateStatus === 'previous-cycle-reference'

  for (const field of ['closesOn', 'deadline']) {
    if (!Object.hasOwn(record, field)) {
      continue
    }

    const rawValue = record[field]
    if (rawValue == null) {
      if (field === 'closesOn' && record.dateStatus === 'published') {
        addIssue(
          issues,
          'error',
          'published-date-missing',
          'dateStatus is published but closesOn is null.',
          context,
        )
      }
      continue
    }

    const date = parseIsoDate(rawValue)
    if (!date) {
      addIssue(
        issues,
        'error',
        'invalid-deadline',
        `${field} is not a valid YYYY-MM-DD date: ${String(rawValue)}`,
        context,
      )
      continue
    }

    if (isArchived || isHistorical) {
      continue
    }

    const remainingDays = daysFrom(today, date)
    if (remainingDays < 0) {
      addIssue(
        issues,
        'warning',
        'deadline-past',
        `${field} passed ${Math.abs(remainingDays)} day(s) ago on ${rawValue}; review or archive the cycle.`,
        context,
      )
    } else if (remainingDays <= 14) {
      addIssue(
        issues,
        'warning',
        'deadline-within-14-days',
        `${field} is in ${remainingDays} day(s) on ${rawValue}.`,
        context,
      )
    } else if (remainingDays <= 45) {
      addIssue(
        issues,
        'info',
        'deadline-within-45-days',
        `${field} is in ${remainingDays} day(s) on ${rawValue}.`,
        context,
      )
    }
  }

  if (record.opensOn != null && record.closesOn != null) {
    const opensOn = parseIsoDate(record.opensOn)
    const closesOn = parseIsoDate(record.closesOn)
    if (opensOn && closesOn && opensOn > closesOn) {
      addIssue(
        issues,
        'error',
        'invalid-admission-window',
        `opensOn (${record.opensOn}) is after closesOn (${record.closesOn}).`,
        context,
      )
    }
  }
}

function inspectValue(value, fileName, jsonPath, inheritedRecordId, state) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      inspectValue(item, fileName, `${jsonPath}[${index}]`, inheritedRecordId, state)
    })
    return
  }

  if (!value || typeof value !== 'object') {
    return
  }

  const recordId = typeof value.id === 'string' ? value.id : inheritedRecordId
  const context = recordContext(fileName, jsonPath, recordId)

  if (typeof value.id === 'string' && value.id.length > 0) {
    state.allIds.add(value.id)
    state.recordCount += 1
  }

  if (auditLike(value)) {
    state.auditRecordCount += 1
    inspectAuditRecord(value, context, state)
  }

  inspectDeadline(value, context, state)

  for (const [key, item] of Object.entries(value)) {
    inspectValue(item, fileName, `${jsonPath}.${key}`, recordId, state)
  }
}

async function addLinkReportIssues(linkReportPath, issues) {
  if (!linkReportPath) {
    return { checked: 0, ok: 0, hard: 0, warning: 0 }
  }

  let report
  try {
    report = JSON.parse(await readFile(path.resolve(linkReportPath), 'utf8'))
  } catch (error) {
    addIssue(
      issues,
      'error',
      'link-report-unavailable',
      `Link report could not be read: ${error.message}`,
      recordContext('scripts/check-links.mjs', '$', null),
    )
    return { checked: 0, ok: 0, hard: 0, warning: 0 }
  }

  for (const result of report.results ?? []) {
    if (result.severity !== 'hard' && result.severity !== 'warning') {
      continue
    }

    const firstReference = result.references?.[0] ?? {}
    addIssue(
      issues,
      result.severity === 'hard' ? 'error' : 'warning',
      result.severity === 'hard' ? 'broken-link' : 'link-warning',
      result.reason ?? `HTTP ${result.status ?? 'unknown'}`,
      recordContext(firstReference.file ?? 'content/data', firstReference.path ?? '$', firstReference.recordId),
      { url: result.url, statusCode: result.status ?? null },
    )
  }

  return {
    checked: Number(report.summary?.checked ?? 0),
    ok: Number(report.summary?.ok ?? 0),
    hard: Number(report.summary?.hard ?? 0),
    warning: Number(report.summary?.warning ?? 0),
  }
}

function inlineCode(value) {
  return `\`${String(value).replaceAll('`', '\\`')}\``
}

function renderIssue(issue) {
  const identifier = issue.recordId ? `; record ${issue.recordId}` : ''
  const location = `${issue.file}:${issue.path}${identifier}`
  const url = issue.url ? ` — <${issue.url.replaceAll('>', '%3E')}>` : ''
  return `- **${issue.kind}** — ${issue.message}${url} — ${inlineCode(location)}`
}

function renderIssueSection(title, issues) {
  if (issues.length === 0) {
    return `## ${title}\n\n_None._\n`
  }

  const visible = issues.slice(0, 150)
  const lines = visible.map(renderIssue)
  if (issues.length > visible.length) {
    lines.push(
      `- _${issues.length - visible.length} more item(s) omitted from this issue body; see the JSON workflow artifact._`,
    )
  }

  return `## ${title}\n\n${lines.join('\n')}\n`
}

function renderMarkdown(report) {
  const errors = report.issues.filter((issue) => issue.severity === 'error')
  const warnings = report.issues.filter((issue) => issue.severity === 'warning')
  const information = report.issues.filter((issue) => issue.severity === 'info')

  return `<!-- studyinchina-data-health -->
# StudyInChina Data Health

> This report is advisory. Automation never changes or publishes admissions facts; every correction requires official-source verification and a reviewed pull request.

Generated: ${report.generatedAt}<br>
Review mode: **${report.mode}** (${report.reviewHorizonDays}-day review horizon)<br>
Data date: **${report.today}**

| JSON files | Records | Audited records | Links checked | Errors | Warnings | Upcoming |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| ${report.summary.documents} | ${report.summary.records} | ${report.summary.auditRecords} | ${report.summary.links.checked} | ${report.summary.errors} | ${report.summary.warnings} | ${report.summary.information} |

Status counts: ${Object.entries(report.summary.statuses)
    .map(([status, count]) => `${status} ${count}`)
    .join(' · ')}

${renderIssueSection('Action required', errors)}
${renderIssueSection('Manual checks', warnings)}
${renderIssueSection('Upcoming reviews and deadlines', information)}

Hard link failures are only confirmed 404/410 responses. A 403, 429, timeout, network error, or other inconclusive response remains a warning until a maintainer opens the official source manually.
`
}

async function writeOutput(filePath, contents) {
  const absolutePath = path.resolve(filePath)
  await mkdir(path.dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, contents, 'utf8')
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const today = utcToday(options.today)
  const dataDirectory = path.resolve(options.dataDir)
  const documents = await loadJsonFiles(dataDirectory)
  const issues = []
  const state = {
    issues,
    today,
    reviewHorizonDays: REVIEW_HORIZONS[options.mode],
    allIds: new Set(),
    sourceReferences: [],
    statusCounts: { draft: 0, verified: 0, stale: 0, archived: 0 },
    recordCount: 0,
    auditRecordCount: 0,
  }

  for (const document of documents) {
    inspectValue(document.value, document.fileName, '$', null, state)
  }

  for (const reference of state.sourceReferences) {
    if (!state.allIds.has(reference.sourceId)) {
      addIssue(
        issues,
        'error',
        'unknown-source-id',
        `sourceIds references an unknown ID: ${reference.sourceId}`,
        reference,
      )
    }
  }

  const linkSummary = await addLinkReportIssues(options.linkReportPath, issues)
  issues.sort((left, right) => {
    const severityDifference = SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]
    if (severityDifference !== 0) {
      return severityDifference
    }
    return `${left.kind}:${left.file}:${left.path}`.localeCompare(
      `${right.kind}:${right.file}:${right.path}`,
    )
  })

  const report = {
    generatedAt: new Date().toISOString(),
    today: today.toISOString().slice(0, 10),
    mode: options.mode,
    reviewHorizonDays: REVIEW_HORIZONS[options.mode],
    dataDirectory: path.relative(process.cwd(), dataDirectory).replaceAll('\\', '/'),
    summary: {
      documents: documents.length,
      records: state.recordCount,
      auditRecords: state.auditRecordCount,
      statuses: state.statusCounts,
      links: linkSummary,
      errors: issues.filter((issue) => issue.severity === 'error').length,
      warnings: issues.filter((issue) => issue.severity === 'warning').length,
      information: issues.filter((issue) => issue.severity === 'info').length,
    },
    issues,
  }

  const markdown = renderMarkdown(report)
  process.stdout.write(markdown)

  if (options.jsonPath) {
    await writeOutput(options.jsonPath, `${JSON.stringify(report, null, 2)}\n`)
  }
  if (options.markdownPath) {
    await writeOutput(options.markdownPath, markdown)
  }
}

main().catch((error) => {
  process.stderr.write(`Data health check failed: ${error.stack ?? error.message}\n`)
  process.exitCode = 2
})
