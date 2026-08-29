#!/usr/bin/env node

'use strict'

const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const QUALITY_DIR = path.join(ROOT, 'quality/official-depth-wave-4-2026-08-26')
const LEDGER_PATH = path.join(QUALITY_DIR, 'priority-ledger.json')
const CLOSURE_PATH = path.join(QUALITY_DIR, 'priority-source-closure.json')
const RECEIPT_PATH = path.join(QUALITY_DIR, 'priority-r2-receipt-2026-08-26.json')
const DEFAULT_OUTPUT = path.join(QUALITY_DIR, 'priority-staged-import.json')
const AUDIT_DATE = '2026-08-26'

const SAFE_DECISIONS = new Set([
  'promote_current_or_stable',
  'promote_historical_cycle_only',
])

const REFERENCE_TUITION_STATUSES = new Set([
  'live_undated_official_reference',
  'live_recurring_official_reference',
  'historical_cycle',
  'historical_only',
  'historical_2026_cycle',
  'historical_reference_subject_to_final_price',
])

const CONFIRMED_TUITION_STATUSES = new Set([
  'current_2026_page',
  'current_2026_live_page',
  'current_2027_cycle',
  'live_page',
])

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function flattenPrograms(ledger) {
  return ledger.universities.flatMap((university) => university.programs.map((program) => ({
    ...program,
    universityId: university.universityId,
  })))
}

function isHistoricalFactStatus(status) {
  return /^historical(?:_|$)/.test(String(status)) || status === 'previous_cycle_reference'
}

function hasNumericOrCoverage(tuition) {
  return Number.isFinite(tuition?.amountCny)
    || (Array.isArray(tuition?.variants) && tuition.variants.some((item) => Number.isFinite(item.amountCny)))
    || typeof tuition?.coverage === 'string'
}

function deriveAcademicYear(tuitionStatus, deadline) {
  if (String(tuitionStatus).includes('2027')) return 2027
  if (String(tuitionStatus).includes('2026') || String(deadline?.value || '').startsWith('2026-')) return 2026
  return null
}

function deriveTuitionStatus(program) {
  const tuition = program.facts.tuition || { status: 'unknown' }
  if (!hasNumericOrCoverage(tuition)) {
    if (String(tuition.status).startsWith('officially_not_announced')) return 'officially_not_announced'
    return 'unknown'
  }
  if (program.decision === 'promote_historical_cycle_only') return 'reference'
  if (REFERENCE_TUITION_STATUSES.has(tuition.status) || isHistoricalFactStatus(tuition.status)) return 'reference'
  if (CONFIRMED_TUITION_STATUSES.has(tuition.status)) return 'confirmed'
  return 'reference'
}

function deriveApplicationProjection(program) {
  const deadline = program.facts.deadline || { value: null, status: 'unknown' }
  const deadlineValue = typeof deadline.value === 'string' ? deadline.value : null
  const parsed = deadlineValue && /^\d{4}-\d{2}-\d{2}$/.test(deadlineValue)
    ? Date.parse(`${deadlineValue}T23:59:59Z`)
    : Number.NaN
  const historicalByDecision = program.decision === 'promote_historical_cycle_only'
  const historicalByStatus = isHistoricalFactStatus(deadline.status) || deadline.status === 'historical_closed_spring_intake'
  const closedByDate = Number.isFinite(parsed) && parsed < Date.parse(`${AUDIT_DATE}T00:00:00Z`)

  if (historicalByDecision || historicalByStatus || closedByDate) {
    return {
      applicationState: 'historical_closed',
      cycleStatus: 'stale',
      dateStatus: 'previous-cycle-reference',
      eligibleForCurrentConfirmedMetric: false,
      eligibleForDatedOrRollingMetric: false,
      eligibleForActiveUpcomingMetric: false,
    }
  }
  if (Number.isFinite(parsed)) {
    return {
      applicationState: 'upcoming',
      cycleStatus: 'confirmed',
      dateStatus: 'announced',
      eligibleForCurrentConfirmedMetric: true,
      eligibleForDatedOrRollingMetric: true,
      eligibleForActiveUpcomingMetric: true,
    }
  }
  return {
    applicationState: 'not_announced',
    cycleStatus: 'reference',
    dateStatus: deadline.status === 'officially_not_announced' ? 'not-announced' : 'undated-reference',
    eligibleForCurrentConfirmedMetric: false,
    eligibleForDatedOrRollingMetric: false,
    eligibleForActiveUpcomingMetric: false,
  }
}

function sourceIsConfirmed(source) {
  return source
    && source.status === 'confirmed'
    && source.fullReadbackVerified === true
    && /^[a-f0-9]{64}$/.test(source.artifactSha256 || '')
    && Number.isInteger(source.byteLength)
    && source.byteLength > 0
    && typeof source.r2Key === 'string'
    && source.r2Key.includes(source.artifactSha256)
    && source.r2Uri === `r2://studyinchina-source-snapshots/${source.r2Key}`
}

function buildStagedImport(ledger, closure, receipt) {
  if (ledger.auditAsOf !== AUDIT_DATE || closure.checkedAt !== AUDIT_DATE || receipt.checkedAt !== AUDIT_DATE) {
    throw new Error('audit_date_mismatch')
  }
  if (receipt.sanitized !== true || receipt.bucket !== 'studyinchina-source-snapshots') {
    throw new Error('receipt_not_sanitized_or_wrong_bucket')
  }

  const ledgerPrograms = new Map(flattenPrograms(ledger).map((program) => [program.programId, program]))
  const receiptSources = new Map(receipt.sources.map((source) => [source.sourceId, source]))
  const receiptPackages = new Map(receipt.packages.map((item) => [item.programId, item]))
  const candidates = []
  const blocked = []

  for (const packageDependency of [...closure.packages].sort((a, b) => a.programId.localeCompare(b.programId))) {
    const program = ledgerPrograms.get(packageDependency.programId)
    if (!program || !SAFE_DECISIONS.has(program.decision)) throw new Error(`unsafe_or_missing_program:${packageDependency.programId}`)
    const receiptPackage = receiptPackages.get(program.programId)
    const blockingSourceIds = packageDependency.sourceIds.filter((sourceId) => !sourceIsConfirmed(receiptSources.get(sourceId)))
    if (!receiptPackage || receiptPackage.status !== 'ready_for_staged_import' || blockingSourceIds.length) {
      blocked.push({ programId: program.programId, blockingSourceIds })
      continue
    }

    const application = deriveApplicationProjection(program)
    const tuitionStatus = deriveTuitionStatus(program)
    const tuitionAcademicYear = deriveAcademicYear(program.facts.tuition?.status, program.facts.deadline)
    if (application.cycleStatus === 'stale' && tuitionStatus === 'confirmed'
      && isHistoricalFactStatus(program.facts.tuition?.status)) {
      throw new Error(`historical_tuition_confirmed:${program.programId}`)
    }

    candidates.push({
      programId: program.programId,
      universityId: program.universityId,
      name: program.name,
      degreeLevel: program.degreeLevel,
      candidateStatus: 'ready_for_pipeline_candidate',
      sourceDependencies: packageDependency.sourceIds.map((sourceId) => ({
        sourceId,
        artifactSha256: receiptSources.get(sourceId).artifactSha256,
        r2Uri: receiptSources.get(sourceId).r2Uri,
      })),
      facts: program.facts,
      cycleProjection: {
        ...application,
        deadline: program.facts.deadline?.value ?? null,
        tuitionStatus,
        tuitionAcademicYear,
      },
      conflicts: program.conflicts,
      unknowns: program.unknowns,
    })
  }

  const historical = candidates.filter((candidate) => candidate.cycleProjection.cycleStatus === 'stale')
  return {
    schemaVersion: 'studyinchina.wave4-priority-staged-import.v1',
    generatedFromAuditDate: AUDIT_DATE,
    formalCatalogWrite: false,
    summary: {
      closurePackages: closure.packages.length,
      stagedCandidates: candidates.length,
      blockedCandidates: blocked.length,
      historicalStaleCandidates: historical.length,
      currentConfirmedMetricEligible: candidates.filter((item) => item.cycleProjection.eligibleForCurrentConfirmedMetric).length,
      datedOrRollingMetricEligible: candidates.filter((item) => item.cycleProjection.eligibleForDatedOrRollingMetric).length,
      activeUpcomingMetricEligible: candidates.filter((item) => item.cycleProjection.eligibleForActiveUpcomingMetric).length,
      referenceTuitionCandidates: candidates.filter((item) => item.cycleProjection.tuitionStatus === 'reference').length,
      confirmedTuitionCandidates: candidates.filter((item) => item.cycleProjection.tuitionStatus === 'confirmed').length,
    },
    candidates,
    blocked,
  }
}

function assertSafeOutput(outputPath) {
  const resolved = path.resolve(outputPath)
  const contentData = path.join(ROOT, 'content', 'data')
  const relativeToContent = path.relative(contentData, resolved)
  const isContentData = relativeToContent === '' || (!relativeToContent.startsWith('..') && !path.isAbsolute(relativeToContent))
  if (isContentData && process.env.STUDYINCHINA_ALLOW_FORMAL_WAVE4_WRITE !== 'I_UNDERSTAND') {
    throw new Error('formal_content_data_write_refused')
  }
  return resolved
}

function parseOutputArg(argv) {
  const index = argv.indexOf('--output')
  return index >= 0 ? argv[index + 1] : DEFAULT_OUTPUT
}

async function main() {
  const ledger = readJson(LEDGER_PATH)
  const closure = readJson(CLOSURE_PATH)
  const receipt = readJson(RECEIPT_PATH)
  const staged = buildStagedImport(ledger, closure, receipt)
  const outputPath = assertSafeOutput(parseOutputArg(process.argv))
  if (!process.argv.includes('--apply')) {
    console.log(JSON.stringify({ mode: 'dry-run', output: path.relative(ROOT, outputPath), ...staged.summary }))
    return
  }
  await fsp.mkdir(path.dirname(outputPath), { recursive: true })
  const serialized = `${JSON.stringify(staged, null, 2)}\n`
  const existing = fs.existsSync(outputPath) ? await fsp.readFile(outputPath, 'utf8') : null
  if (existing !== serialized) await fsp.writeFile(outputPath, serialized, 'utf8')
  console.log(JSON.stringify({ mode: 'staged-only', changed: existing !== serialized, output: path.relative(ROOT, outputPath), ...staged.summary }))
}

module.exports = {
  AUDIT_DATE,
  CONFIRMED_TUITION_STATUSES,
  REFERENCE_TUITION_STATUSES,
  assertSafeOutput,
  buildStagedImport,
  deriveApplicationProjection,
  deriveTuitionStatus,
  sourceIsConfirmed,
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
