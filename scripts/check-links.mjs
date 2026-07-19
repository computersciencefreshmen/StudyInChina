#!/usr/bin/env node

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_RETRIES = 2
const DEFAULT_CONCURRENCY = 6
const USER_AGENT = 'StudyInChina-DataHealth/1.0 (+https://github.com/computersciencefreshmen/StudyInChina)'

function usage() {
  return `Usage: node scripts/check-links.mjs [options]

Scans HTTP(S) values in content/data/*.json.

Options:
  --data-dir <path>       Data directory (default: content/data)
  --json <path>           Write the complete JSON report
  --markdown <path>       Write a Markdown report
  --timeout <ms>          Per-request timeout (default: ${DEFAULT_TIMEOUT_MS})
  --retries <count>       Retries for transient failures (default: ${DEFAULT_RETRIES})
  --concurrency <count>   Concurrent URLs (default: ${DEFAULT_CONCURRENCY})
  --fail-on-hard          Exit 1 when a GET confirms HTTP 404 or 410 (default)
  --no-fail-on-hard       Report hard failures without a non-zero exit
  --help                  Show this help
`
}

function positiveInteger(value, flag, { allowZero = false } = {}) {
  const parsed = Number.parseInt(value, 10)
  const minimum = allowZero ? 0 : 1
  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw new Error(`${flag} must be an integer greater than or equal to ${minimum}`)
  }
  return parsed
}

function parseArgs(argv) {
  const options = {
    dataDir: 'content/data',
    jsonPath: null,
    markdownPath: null,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    retries: DEFAULT_RETRIES,
    concurrency: DEFAULT_CONCURRENCY,
    failOnHard: true,
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
      case '--json':
        options.jsonPath = nextValue()
        break
      case '--markdown':
        options.markdownPath = nextValue()
        break
      case '--timeout':
        options.timeoutMs = positiveInteger(nextValue(), argument)
        break
      case '--retries':
        options.retries = positiveInteger(nextValue(), argument, { allowZero: true })
        break
      case '--concurrency':
        options.concurrency = positiveInteger(nextValue(), argument)
        break
      case '--fail-on-hard':
        options.failOnHard = true
        break
      case '--no-fail-on-hard':
        options.failOnHard = false
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

  return options
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

function asHttpUrl(value) {
  if (typeof value !== 'string') {
    return null
  }

  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null
  } catch {
    return null
  }
}

function collectUrlReferences(value, fileName, jsonPath = '$', inheritedRecordId = null, output = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      collectUrlReferences(item, fileName, `${jsonPath}[${index}]`, inheritedRecordId, output)
    })
    return output
  }

  if (value && typeof value === 'object') {
    const recordId = typeof value.id === 'string' ? value.id : inheritedRecordId
    for (const [key, item] of Object.entries(value)) {
      const itemPath = `${jsonPath}.${key}`
      const url = asHttpUrl(item)
      if (url) {
        output.push({ url, file: fileName, path: itemPath, recordId })
      } else {
        collectUrlReferences(item, fileName, itemPath, recordId, output)
      }
    }
  }

  return output
}

function groupUrlReferences(documents) {
  const grouped = new Map()

  for (const document of documents) {
    const references = collectUrlReferences(document.value, document.fileName)
    for (const reference of references) {
      const existing = grouped.get(reference.url) ?? []
      const referenceKey = `${reference.file}:${reference.path}:${reference.recordId ?? ''}`
      if (!existing.some((item) => `${item.file}:${item.path}:${item.recordId ?? ''}` === referenceKey)) {
        existing.push({
          file: reference.file,
          path: reference.path,
          recordId: reference.recordId,
        })
      }
      grouped.set(reference.url, existing)
    }
  }

  return [...grouped.entries()]
    .map(([url, references]) => ({ url, references }))
    .sort((left, right) => left.url.localeCompare(right.url))
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function shouldRetry(result) {
  return (
    result.kind === 'timeout' ||
    result.kind === 'network' ||
    result.status === 429 ||
    (typeof result.status === 'number' && result.status >= 500)
  )
}

async function requestOnce(url, method, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const startedAt = Date.now()

  try {
    const headers = {
      Accept: '*/*',
      'User-Agent': USER_AGENT,
    }
    if (method === 'GET') {
      headers.Range = 'bytes=0-1023'
    }

    const response = await fetch(url, {
      method,
      headers,
      redirect: 'follow',
      signal: controller.signal,
    })

    if (method === 'GET' && response.body) {
      const reader = response.body.getReader()
      await reader.read()
      await reader.cancel()
    }

    return {
      kind: 'response',
      status: response.status,
      finalUrl: response.url,
      redirected: response.redirected,
      durationMs: Date.now() - startedAt,
    }
  } catch (error) {
    const timedOut = error?.name === 'AbortError'
    return {
      kind: timedOut ? 'timeout' : 'network',
      status: null,
      finalUrl: null,
      redirected: false,
      durationMs: Date.now() - startedAt,
      error: timedOut ? `Timed out after ${timeoutMs} ms` : String(error?.message ?? error),
    }
  } finally {
    clearTimeout(timer)
  }
}

async function requestWithRetries(url, method, options) {
  const attempts = []

  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    const result = await requestOnce(url, method, options.timeoutMs)
    attempts.push({ method, attempt: attempt + 1, ...result })

    if (!shouldRetry(result) || attempt === options.retries) {
      return { result, attempts }
    }

    await delay(250 * 2 ** attempt)
  }

  throw new Error('Unreachable retry state')
}

function responseIsHealthy(result) {
  return (
    result.kind === 'response' &&
    typeof result.status === 'number' &&
    result.status >= 200 &&
    result.status < 400
  )
}

function describeWarning(result) {
  if (result.kind === 'timeout') {
    return result.error
  }
  if (result.kind === 'network') {
    return `Network error: ${result.error}`
  }
  if (result.status === 403) {
    return 'HTTP 403; the official site may block automated checks'
  }
  if (result.status === 429) {
    return 'HTTP 429; the official site rate-limited the check'
  }
  return `HTTP ${result.status}; verify manually`
}

async function checkUrl(target, options) {
  const startedAt = Date.now()
  const head = await requestWithRetries(target.url, 'HEAD', options)

  if (responseIsHealthy(head.result)) {
    return {
      ...target,
      severity: 'ok',
      method: 'HEAD',
      status: head.result.status,
      finalUrl: head.result.finalUrl,
      reason: null,
      durationMs: Date.now() - startedAt,
      attempts: head.attempts,
    }
  }

  // Many university sites reject or misimplement HEAD. Always confirm with a
  // ranged GET before classifying a link as broken.
  const get = await requestWithRetries(target.url, 'GET', options)
  const attempts = [...head.attempts, ...get.attempts]

  if (responseIsHealthy(get.result)) {
    return {
      ...target,
      severity: 'ok',
      method: 'GET',
      status: get.result.status,
      finalUrl: get.result.finalUrl,
      reason: null,
      durationMs: Date.now() - startedAt,
      attempts,
    }
  }

  const isHardFailure =
    get.result.kind === 'response' && (get.result.status === 404 || get.result.status === 410)

  return {
    ...target,
    severity: isHardFailure ? 'hard' : 'warning',
    method: 'GET',
    status: get.result.status,
    finalUrl: get.result.finalUrl,
    reason: isHardFailure
      ? `Confirmed HTTP ${get.result.status} after HEAD and ranged GET`
      : describeWarning(get.result),
    durationMs: Date.now() - startedAt,
    attempts,
  }
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length)
  let nextIndex = 0

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await mapper(items[index], index)
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, Math.max(items.length, 1)) },
    () => worker(),
  )
  await Promise.all(workers)
  return results
}

function markdownCell(value) {
  return String(value ?? '—')
    .replaceAll('|', '\\|')
    .replaceAll('\n', ' ')
}

function referenceLabel(references) {
  const visible = references.slice(0, 3).map((reference) => {
    const id = reference.recordId ? ` (${reference.recordId})` : ''
    return `${reference.file}:${reference.path}${id}`
  })
  if (references.length > visible.length) {
    visible.push(`+${references.length - visible.length} more`)
  }
  return visible.join('; ')
}

function renderResultTable(results) {
  if (results.length === 0) {
    return '_None._\n'
  }

  const rows = results.slice(0, 100).map((result) => {
    const safeUrl = result.url.replaceAll('>', '%3E')
    return `| <${safeUrl}> | ${markdownCell(result.status)} | ${markdownCell(result.reason)} | ${markdownCell(referenceLabel(result.references))} |`
  })

  if (results.length > 100) {
    rows.push(`\n_Only the first 100 of ${results.length} results are shown. See the JSON artifact for all results._`)
  }

  return [
    '| URL | Status | Result | Referenced by |',
    '| --- | ---: | --- | --- |',
    ...rows,
    '',
  ].join('\n')
}

function renderMarkdown(report) {
  const hard = report.results.filter((result) => result.severity === 'hard')
  const warnings = report.results.filter((result) => result.severity === 'warning')

  return `# Link health report

Generated: ${report.generatedAt}

| Checked | Healthy | Hard failures | Warnings |
| ---: | ---: | ---: | ---: |
| ${report.summary.checked} | ${report.summary.ok} | ${report.summary.hard} | ${report.summary.warning} |

## Hard failures (confirmed 404/410)

${renderResultTable(hard)}
## Warnings (manual retry required)

${renderResultTable(warnings)}
403, 429, timeout, network, and other inconclusive responses are warnings. They do not prove that an admissions fact is invalid.
`
}

async function writeOutput(filePath, contents) {
  const absolutePath = path.resolve(filePath)
  await mkdir(path.dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, contents, 'utf8')
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const dataDirectory = path.resolve(options.dataDir)
  const documents = await loadJsonFiles(dataDirectory)
  const targets = groupUrlReferences(documents)
  const results = await mapWithConcurrency(targets, options.concurrency, (target) =>
    checkUrl(target, options),
  )

  const report = {
    generatedAt: new Date().toISOString(),
    dataDirectory: path.relative(process.cwd(), dataDirectory).replaceAll('\\', '/'),
    configuration: {
      timeoutMs: options.timeoutMs,
      retries: options.retries,
      concurrency: options.concurrency,
    },
    summary: {
      checked: results.length,
      ok: results.filter((result) => result.severity === 'ok').length,
      hard: results.filter((result) => result.severity === 'hard').length,
      warning: results.filter((result) => result.severity === 'warning').length,
    },
    results,
  }

  const markdown = renderMarkdown(report)
  process.stdout.write(markdown)

  if (options.jsonPath) {
    await writeOutput(options.jsonPath, `${JSON.stringify(report, null, 2)}\n`)
  }
  if (options.markdownPath) {
    await writeOutput(options.markdownPath, markdown)
  }

  if (options.failOnHard && report.summary.hard > 0) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  process.stderr.write(`Link check failed: ${error.stack ?? error.message}\n`)
  process.exitCode = 2
})
