#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const P0_OBSERVATION_FORMAT = 'studyinchina.p0-reliability-observations'
export const P0_AUDIT_FORMAT = 'studyinchina.p0-reliability-audit'
export const P0_RELIABILITY_THRESHOLDS = Object.freeze({
  observationMaxAgeMinutes: 15,
  backupMaxAgeHours: 26,
  releaseMaxAgeHours: 48,
  schedulerMaxAgeMinutes: 90,
  dlqMaxBacklogCount: 0,
  outboxMaxAgeHours: 168,
})

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function source(value) {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (!/^[a-z0-9][a-z0-9:._/-]{1,199}$/iu.test(normalized)) return null
  return normalized
}

function timestamp(value) {
  if (typeof value !== 'string') return null
  const milliseconds = Date.parse(value)
  if (!Number.isFinite(milliseconds)) return null
  return { iso: new Date(milliseconds).toISOString(), milliseconds }
}

function rounded(value) {
  return Math.round(value * 1_000) / 1_000
}

function unobserved(id, detail, threshold, evidenceSource = null) {
  return {
    id,
    status: 'unobserved',
    source: evidenceSource,
    observedAt: null,
    value: null,
    threshold,
    detail,
  }
}

function ageCheck({
  id,
  section,
  field,
  nowMilliseconds,
  divisor,
  maximum,
  threshold,
}) {
  if (!isRecord(section)) {
    return unobserved(id, 'Required observation section is missing.', threshold)
  }
  const evidenceSource = source(section.source)
  if (!evidenceSource) {
    return unobserved(id, 'A bounded machine-readable observation source is required.', threshold)
  }
  const observed = timestamp(section[field])
  if (!observed || observed.milliseconds > nowMilliseconds) {
    return unobserved(
      id,
      'The required observation timestamp is missing, invalid, or in the future.',
      threshold,
      evidenceSource,
    )
  }
  const rawAge = (nowMilliseconds - observed.milliseconds) / divisor
  const age = rounded(rawAge)
  const passed = rawAge <= maximum
  return {
    id,
    status: passed ? 'pass' : 'fail',
    source: evidenceSource,
    observedAt: observed.iso,
    value: age,
    threshold,
    detail: passed
      ? 'Observed value is inside the reliability threshold.'
      : 'Observed value is older than the reliability threshold.',
  }
}

function dlqCheck(section) {
  const threshold = { operator: 'eq', value: P0_RELIABILITY_THRESHOLDS.dlqMaxBacklogCount, unit: 'messages' }
  if (!isRecord(section)) {
    return unobserved('dlq_backlog', 'Required DLQ observation is missing.', threshold)
  }
  const evidenceSource = source(section.source)
  if (!evidenceSource) {
    return unobserved(
      'dlq_backlog',
      'A bounded machine-readable observation source is required.',
      threshold,
    )
  }
  if (!Number.isSafeInteger(section.backlogCount) || section.backlogCount < 0) {
    return unobserved(
      'dlq_backlog',
      'DLQ backlogCount must be a non-negative safe integer.',
      threshold,
      evidenceSource,
    )
  }
  if (section.backlogCount === 0 && section.oldestMessageAt !== null) {
    return unobserved(
      'dlq_backlog',
      'An empty DLQ must explicitly report oldestMessageAt as null.',
      threshold,
      evidenceSource,
    )
  }
  const passed = section.backlogCount === 0
  return {
    id: 'dlq_backlog',
    status: passed ? 'pass' : 'fail',
    source: evidenceSource,
    observedAt: null,
    value: section.backlogCount,
    threshold,
    detail: passed
      ? 'No unhandled DLQ messages were observed.'
      : 'One or more unhandled DLQ messages were observed.',
  }
}

function outboxCheck(section, nowMilliseconds) {
  const threshold = {
    operator: 'lt',
    value: P0_RELIABILITY_THRESHOLDS.outboxMaxAgeHours,
    unit: 'hours',
  }
  if (!isRecord(section)) {
    return unobserved('outbox_backlog_age', 'Required outbox observation is missing.', threshold)
  }
  const evidenceSource = source(section.source)
  if (!evidenceSource) {
    return unobserved(
      'outbox_backlog_age',
      'A bounded machine-readable observation source is required.',
      threshold,
    )
  }
  if (!Number.isSafeInteger(section.backlogCount) || section.backlogCount < 0) {
    return unobserved(
      'outbox_backlog_age',
      'Outbox backlogCount must be a non-negative safe integer.',
      threshold,
      evidenceSource,
    )
  }
  if (section.backlogCount === 0) {
    if (section.oldestPendingAt !== null) {
      return unobserved(
        'outbox_backlog_age',
        'An empty outbox must explicitly report oldestPendingAt as null.',
        threshold,
        evidenceSource,
      )
    }
    return {
      id: 'outbox_backlog_age',
      status: 'pass',
      source: evidenceSource,
      observedAt: null,
      value: { backlogCount: 0, oldestAgeHours: null },
      threshold,
      detail: 'No pending outbox events were observed.',
    }
  }

  const oldest = timestamp(section.oldestPendingAt)
  if (!oldest || oldest.milliseconds > nowMilliseconds) {
    return unobserved(
      'outbox_backlog_age',
      'A non-empty outbox requires a valid, non-future oldestPendingAt.',
      threshold,
      evidenceSource,
    )
  }
  const rawAgeHours = (nowMilliseconds - oldest.milliseconds) / 3_600_000
  const ageHours = rounded(rawAgeHours)
  const passed = rawAgeHours < P0_RELIABILITY_THRESHOLDS.outboxMaxAgeHours
  return {
    id: 'outbox_backlog_age',
    status: passed ? 'pass' : 'fail',
    source: evidenceSource,
    observedAt: oldest.iso,
    value: { backlogCount: section.backlogCount, oldestAgeHours: ageHours },
    threshold,
    detail: passed
      ? 'The oldest pending outbox event is inside the reliability threshold.'
      : 'The oldest pending outbox event reached or exceeded the reliability threshold.',
  }
}

export function evaluateP0Reliability(observation, now = new Date()) {
  const evaluatedAt = new Date(now)
  if (Number.isNaN(evaluatedAt.getTime())) {
    throw new TypeError('Evaluation time must be a valid date.')
  }
  const nowMilliseconds = evaluatedAt.getTime()
  const input = isRecord(observation) ? observation : {}
  const contractValid = input.format === P0_OBSERVATION_FORMAT && input.formatVersion === 1
  const checks = [
    contractValid
      ? {
          id: 'input_contract',
          status: 'pass',
          source: 'observation-document',
          observedAt: null,
          value: { formatVersion: 1 },
          threshold: { operator: 'eq', value: 1, unit: 'format-version' },
          detail: 'Observation document uses the supported explicit contract.',
        }
      : unobserved(
          'input_contract',
          'Observation format or formatVersion is missing or unsupported.',
          { operator: 'eq', value: 1, unit: 'format-version' },
          'observation-document',
        ),
    ageCheck({
      id: 'observation_freshness',
      section: { source: 'observation-document', observedAt: input.observedAt },
      field: 'observedAt',
      nowMilliseconds,
      divisor: 60_000,
      maximum: P0_RELIABILITY_THRESHOLDS.observationMaxAgeMinutes,
      threshold: {
        operator: 'lte',
        value: P0_RELIABILITY_THRESHOLDS.observationMaxAgeMinutes,
        unit: 'minutes',
      },
    }),
    ageCheck({
      id: 'backup_age',
      section: input.backup,
      field: 'lastVerifiedAt',
      nowMilliseconds,
      divisor: 3_600_000,
      maximum: P0_RELIABILITY_THRESHOLDS.backupMaxAgeHours,
      threshold: {
        operator: 'lte',
        value: P0_RELIABILITY_THRESHOLDS.backupMaxAgeHours,
        unit: 'hours',
      },
    }),
    ageCheck({
      id: 'release_age',
      section: input.release,
      field: 'lastActivatedAt',
      nowMilliseconds,
      divisor: 3_600_000,
      maximum: P0_RELIABILITY_THRESHOLDS.releaseMaxAgeHours,
      threshold: {
        operator: 'lte',
        value: P0_RELIABILITY_THRESHOLDS.releaseMaxAgeHours,
        unit: 'hours',
      },
    }),
    ageCheck({
      id: 'scheduler_heartbeat_age',
      section: input.scheduler,
      field: 'lastHeartbeatAt',
      nowMilliseconds,
      divisor: 60_000,
      maximum: P0_RELIABILITY_THRESHOLDS.schedulerMaxAgeMinutes,
      threshold: {
        operator: 'lte',
        value: P0_RELIABILITY_THRESHOLDS.schedulerMaxAgeMinutes,
        unit: 'minutes',
      },
    }),
    dlqCheck(input.dlq),
    outboxCheck(input.outbox, nowMilliseconds),
  ]
  const summary = checks.reduce(
    (counts, check) => ({ ...counts, [check.status]: counts[check.status] + 1 }),
    { pass: 0, fail: 0, unobserved: 0 },
  )
  return {
    format: P0_AUDIT_FORMAT,
    formatVersion: 1,
    status: summary.fail === 0 && summary.unobserved === 0 ? 'pass' : 'fail',
    evaluatedAt: evaluatedAt.toISOString(),
    observation: {
      formatValid: input.format === P0_OBSERVATION_FORMAT,
      formatVersionValid: input.formatVersion === 1,
      observedAt: timestamp(input.observedAt)?.iso ?? null,
    },
    thresholds: P0_RELIABILITY_THRESHOLDS,
    summary,
    checks,
  }
}

export function parseArguments(args) {
  const options = { inputPath: null, outputPath: null }
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]
    if (flag !== '--input' && flag !== '--output') {
      throw new Error(`Unknown argument: ${flag}`)
    }
    const value = args[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a path`)
    const key = flag === '--input' ? 'inputPath' : 'outputPath'
    if (options[key]) throw new Error(`${flag} may be provided only once`)
    options[key] = value
    index += 1
  }
  if (!options.inputPath) throw new Error('--input is required')
  if (options.outputPath && resolve(options.outputPath) === resolve(options.inputPath)) {
    throw new Error('--output must not overwrite the observation input')
  }
  return options
}

function isMainModule() {
  const entry = process.argv[1]
  return Boolean(entry && pathToFileURL(resolve(entry)).href === import.meta.url)
}

async function main() {
  let options
  let report
  try {
    options = parseArguments(process.argv.slice(2))
    const observation = JSON.parse(await readFile(resolve(options.inputPath), 'utf8'))
    report = evaluateP0Reliability(observation)
  } catch {
    report = evaluateP0Reliability(undefined)
  }

  const serialized = `${JSON.stringify(report, null, 2)}\n`
  process.stdout.write(serialized)
  if (options?.outputPath) {
    await writeFile(resolve(options.outputPath), serialized, { encoding: 'utf8', flag: 'wx' })
  }
  if (report.status !== 'pass') process.exitCode = 1
}

if (isMainModule()) {
  main().catch(() => {
    process.stderr.write('P0 reliability audit could not emit a machine-readable report.\n')
    process.exitCode = 1
  })
}
