#!/usr/bin/env node

'use strict'

const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')

const stagedBuilder = require('./apply-wave4-priority-promotions-2026-08-26.cjs')

const ROOT = path.resolve(__dirname, '../..')
const QUALITY_DIR = path.join(ROOT, 'quality/official-depth-wave-4-2026-08-26')
const DEFAULT_DATA_DIR = path.join(ROOT, 'content', 'data')
const LEDGER_PATH = path.join(QUALITY_DIR, 'priority-ledger.json')
const CLOSURE_PATH = path.join(QUALITY_DIR, 'priority-source-closure.json')
const RECEIPT_PATH = path.join(QUALITY_DIR, 'priority-r2-receipt-2026-08-26.json')
const STAGED_PATH = path.join(QUALITY_DIR, 'priority-staged-import.json')

const AUDIT_DATE = '2026-08-26'
const PROGRAM_REVIEW_AFTER = '2026-09-25'
const CYCLE_REVIEW_AFTER = '2026-09-02'
const APPLY_CONFIRMATION = 'APPLY_R2_VERIFIED_WAVE4'

const CURRENT_OR_STABLE_DECISION = 'promote_current_or_stable'
const SAFE_DURATION_STATUSES = new Set([
  'current_2026_page',
  'current_2026_live_page',
  'current_2027_cycle',
  'live_page',
  'live_undated_official_reference',
])
const SAFE_REQUIREMENT_STATUSES = new Set([
  'current_2026_page',
  'current_2026_live_page',
  'current_2027_cycle',
  'live_official_reference',
  'live_recurring_official_reference',
])
const SAFE_APPLY_STATUSES = new Set([
  'current_official_route',
  'live_official_route',
])

const EXPLICIT_TEACHING_LANGUAGE_ASSERTIONS = new Map([
  [
    'program-southwest-university-education-bachelor',
    { sourceId: 'swu-education-live', languages: ['Chinese'] },
  ],
])

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function clone(value) {
  return structuredClone(value)
}

function canonicalJson(value) {
  return JSON.stringify(value)
}

function unique(values) {
  return [...new Set(values)]
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function sameRecord(left, right) {
  return canonicalJson(left) === canonicalJson(right)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function isHttpsUrl(value) {
  if (typeof value !== 'string') return false
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

function slugToken(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function sourceKind(sourceId) {
  if (/scholarship|(?:^|-)csc(?:-|$)/i.test(sourceId)) return 'scholarship'
  if (/application|self-financed/i.test(sourceId)) return 'admissions'
  return 'program'
}

function sourceLanguage(locator) {
  return /[\u3400-\u9fff]/u.test(JSON.stringify(locator || {})) ? 'zh' : 'en'
}

function sourceFocus(sourceId, locator) {
  const focus = locator?.program
    || locator?.row
    || locator?.heading
    || locator?.sections?.[0]
  return typeof focus === 'string' && focus.trim() ? focus.trim() : sourceId
}

function flattenLedgerPrograms(ledger) {
  return ledger.universities.flatMap((university) => university.programs.map((program) => ({
    ...program,
    universityId: university.universityId,
  })))
}

function flattenLedgerSources(ledger) {
  return ledger.universities.flatMap((university) => university.sources.map((source) => ({
    ...source,
    universityId: university.universityId,
    universityName: university.name,
  })))
}

function assertStagedIntegrity(ledger, closure, receipt, staged) {
  const rebuilt = stagedBuilder.buildStagedImport(ledger, closure, receipt)
  assert(canonicalJson(rebuilt) === canonicalJson(staged), 'staged_import_does_not_match_verified_inputs')
  assert(staged.formalCatalogWrite === false, 'staged_import_must_not_claim_formal_write')
  assert(staged.generatedFromAuditDate === AUDIT_DATE, 'staged_import_audit_date_mismatch')
  assert(staged.summary.stagedCandidates === staged.candidates.length, 'staged_candidate_count_mismatch')
  assert(staged.summary.blockedCandidates === staged.blocked.length, 'blocked_candidate_count_mismatch')

  const candidateIds = staged.candidates.map((candidate) => candidate.programId)
  assert(new Set(candidateIds).size === candidateIds.length, 'duplicate_staged_candidate')
  const blockedIds = new Set(staged.blocked.map((candidate) => candidate.programId))
  assert(candidateIds.every((programId) => !blockedIds.has(programId)), 'blocked_candidate_leaked_into_staged')

  const packageByProgram = new Map(closure.packages.map((item) => [item.programId, item]))
  const receiptBySource = new Map(receipt.sources.map((source) => [source.sourceId, source]))
  for (const candidate of staged.candidates) {
    assert(candidate.candidateStatus === 'ready_for_pipeline_candidate', `candidate_not_ready:${candidate.programId}`)
    const sourceIds = candidate.sourceDependencies.map((source) => source.sourceId).sort()
    const expected = [...(packageByProgram.get(candidate.programId)?.sourceIds || [])].sort()
    assert(arraysEqual(sourceIds, expected), `candidate_source_closure_mismatch:${candidate.programId}`)
    for (const dependency of candidate.sourceDependencies) {
      const receiptSource = receiptBySource.get(dependency.sourceId)
      assert(stagedBuilder.sourceIsConfirmed(receiptSource), `candidate_source_not_confirmed:${candidate.programId}:${dependency.sourceId}`)
      assert(dependency.artifactSha256 === receiptSource.artifactSha256, `candidate_source_hash_mismatch:${candidate.programId}:${dependency.sourceId}`)
      assert(dependency.r2Uri === receiptSource.r2Uri, `candidate_source_uri_mismatch:${candidate.programId}:${dependency.sourceId}`)
    }
  }
}

function buildVerifiedSourceRecords(ledger, closure, receipt, staged) {
  const ledgerSources = new Map(flattenLedgerSources(ledger).map((source) => [source.id, source]))
  const closureSources = new Map(closure.sources.map((source) => [source.sourceId, source]))
  const receiptSources = new Map(receipt.sources.map((source) => [source.sourceId, source]))
  const usedSourceIds = unique(staged.candidates.flatMap((candidate) => (
    candidate.sourceDependencies.map((dependency) => dependency.sourceId)
  ))).sort()

  return usedSourceIds.map((sourceId) => {
    const ledgerSource = ledgerSources.get(sourceId)
    const closureSource = closureSources.get(sourceId)
    const receiptSource = receiptSources.get(sourceId)
    assert(ledgerSource && closureSource, `source_metadata_missing:${sourceId}`)
    assert(stagedBuilder.sourceIsConfirmed(receiptSource), `source_receipt_not_confirmed:${sourceId}`)
    assert(ledgerSource.url === closureSource.officialUrl, `source_url_disagreement:${sourceId}`)
    assert(receiptSource.officialUrl === closureSource.officialUrl, `receipt_url_disagreement:${sourceId}`)
    assert(receiptSource.checkedAt === AUDIT_DATE, `source_check_date_mismatch:${sourceId}`)
    assert(isHttpsUrl(closureSource.officialUrl), `source_not_https:${sourceId}`)

    return {
      id: sourceId,
      url: closureSource.officialUrl,
      title: `${ledgerSource.universityName} — ${sourceFocus(sourceId, ledgerSource.locator)}`,
      publisher: ledgerSource.universityName,
      kind: sourceKind(sourceId),
      language: sourceLanguage(ledgerSource.locator),
      official: true,
      accessedAt: AUDIT_DATE,
    }
  })
}

function deriveDuration(candidate) {
  const duration = candidate.facts.duration
  if (!duration || !SAFE_DURATION_STATUSES.has(duration.status)) return null
  if (Array.isArray(duration.variants)) return null
  if (duration.unit !== 'months' || !Number.isInteger(duration.value)) return null
  if (duration.value <= 0 || duration.value > 120) return null
  return { durationMonths: duration.value, durationMonthsMax: null }
}

function deriveApplyUrl(candidate) {
  const fact = candidate.facts.applyUrl
  if (!fact || !SAFE_APPLY_STATUSES.has(fact.status)) return null
  if (!isHttpsUrl(fact.value)) return null
  return fact.value
}

function addRequirement(output, test, minimum) {
  const normalized = String(minimum || '').trim()
  if (!normalized) return
  const key = `${test}:${normalized.toLowerCase()}`
  if (output.some((item) => `${item.test}:${item.minimum.toLowerCase()}` === key)) return
  output.push({ test, minimum: normalized })
}

function deriveLanguageRequirements(candidate) {
  const fact = candidate.facts.requirements
  if (!fact || !SAFE_REQUIREMENT_STATUSES.has(fact.status) || !Array.isArray(fact.value)) return []
  const requirements = []
  for (const rawValue of fact.value) {
    const value = String(rawValue).trim()
    const hsk = value.match(/\bHSK\s*(?:Level\s*)?(\d)(?:\s*(?:score\s*)?(\d+))?/i)
    if (hsk) addRequirement(requirements, 'HSK', `Level ${hsk[1]}${hsk[2] ? `, ${hsk[2]}` : ''}`)
    if (/\bHSKK\b/i.test(value)) addRequirement(requirements, 'other', value)

    const ielts = value.match(/\bIELTS\s*(\d+(?:\.\d+)?)([^/]*?)(?=\s+or\s+TOEFL|\/TOEFL|$)/i)
    if (ielts) addRequirement(requirements, 'IELTS', `${ielts[1]}${ielts[2] || ''}`.trim())
    const toefl = value.match(/\bTOEFL\s*(\d+)/i)
    if (toefl) addRequirement(requirements, 'TOEFL', toefl[1])
    const toeic = value.match(/\bTOEIC\s*(\d+)/i)
    if (toeic) addRequirement(requirements, 'other', `TOEIC ${toeic[1]}`)
    if (/major-specific English proof/i.test(value)) addRequirement(requirements, 'other', value)
    if (/entrance examination/i.test(value)) addRequirement(requirements, 'other', value)
  }
  return requirements
}

function deriveTeachingLanguages(candidate) {
  const assertion = EXPLICIT_TEACHING_LANGUAGE_ASSERTIONS.get(candidate.programId)
  const dependencies = new Set(candidate.sourceDependencies.map((dependency) => dependency.sourceId))
  if (assertion && dependencies.has(assertion.sourceId)) return assertion.languages

  const variants = candidate.facts.tuition?.variants
  if (!Array.isArray(variants)) return null
  const languages = unique(variants.map((variant) => variant.language).filter((value) => (
    typeof value === 'string' && value.trim()
  )))
  return languages.length ? languages : null
}

function sourceText(closureSource) {
  return JSON.stringify(closureSource?.locator || {}).toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function selectProgramSource(candidate, sourceRecordById, closureSourceById) {
  const nameToken = String(candidate.name).toLowerCase().replace(/[^a-z0-9]+/g, '')
  const eligible = candidate.sourceDependencies
    .map((dependency) => sourceRecordById.get(dependency.sourceId))
    .filter((source) => source?.kind === 'program')
  if (!eligible.length) return null
  return [...eligible].sort((left, right) => {
    const leftMatch = sourceText(closureSourceById.get(left.id)).includes(nameToken) ? 1 : 0
    const rightMatch = sourceText(closureSourceById.get(right.id)).includes(nameToken) ? 1 : 0
    return rightMatch - leftMatch || left.id.localeCompare(right.id)
  })[0]
}

function replaceById(items, id, replacement) {
  const index = items.findIndex((item) => item.id === id)
  assert(index >= 0, `record_missing:${id}`)
  items[index] = replacement
}

function mergeSourceIds(existing, additions) {
  return unique([...(existing || []), ...additions])
}

function hasVerifiedProgramFacts(program) {
  return (Number.isInteger(program.durationMonths) && program.durationMonths > 0)
    || (Array.isArray(program.teachingLanguages) && program.teachingLanguages.length > 0)
    || (Array.isArray(program.languageRequirements) && program.languageRequirements.length > 0)
}

function updateProgram(existing, candidate, ledgerProgram, sourceRecordById, closureSourceById, fieldCounts) {
  const dependencyIds = candidate.sourceDependencies.map((dependency) => dependency.sourceId)
  let next = { ...existing, sourceIds: mergeSourceIds(existing.sourceIds, dependencyIds) }
  if (ledgerProgram.decision !== CURRENT_OR_STABLE_DECISION) return next

  const duration = deriveDuration(candidate)
  if (duration && (existing.durationMonths !== duration.durationMonths
      || (existing.durationMonthsMax ?? null) !== duration.durationMonthsMax)) {
    next = { ...next, ...duration }
    fieldCounts.duration += 1
  }

  const applyUrl = deriveApplyUrl(candidate)
  if (applyUrl && existing.applyUrl !== applyUrl) {
    next.applyUrl = applyUrl
    fieldCounts.applyUrl += 1
  }

  const requirements = deriveLanguageRequirements(candidate)
  if (requirements.length && (!Array.isArray(existing.languageRequirements) || existing.languageRequirements.length === 0)) {
    next.languageRequirements = requirements
    fieldCounts.languageRequirements += 1
  }

  const teachingLanguages = deriveTeachingLanguages(candidate)
  if (teachingLanguages && !arraysEqual(existing.teachingLanguages || [], teachingLanguages)) {
    next.teachingLanguages = teachingLanguages
    fieldCounts.teachingLanguages += 1
  }

  const programSource = selectProgramSource(candidate, sourceRecordById, closureSourceById)
  if (programSource && existing.programUrl !== programSource.url) {
    next.programUrl = programSource.url
    fieldCounts.programUrl += 1
  }

  next.verifiedAt = AUDIT_DATE
  next.reviewAfter = PROGRAM_REVIEW_AFTER
  next.status = 'verified'
  next.verificationScope = existing.verificationScope === 'complete'
    ? 'complete'
    : (hasVerifiedProgramFacts(next) ? 'facts' : 'identity')

  assert(
    !(next.teachingLanguages || []).some((language) => /confirm|tbd|unknown|not[- ]announced/i.test(language)),
    `verified_program_has_placeholder_language:${candidate.programId}`,
  )
  return next
}

function normalizeTuitionPeriod(value) {
  if (value === 'academic_year' || value === 'year') return 'academic-year'
  if (value === 'semester' || value === 'program' || value === 'month' || value === 'other') return value
  return null
}

function scalarTuition(candidate) {
  const fact = candidate.facts.tuition || {}
  if (Array.isArray(fact.variants) || !Number.isFinite(fact.amountCny)) return null
  const period = normalizeTuitionPeriod(fact.period)
  if (!period) return null
  return { amount: fact.amountCny, period }
}

function scalarApplicationFee(candidate) {
  const value = candidate.facts.tuition?.applicationFeeCny
  return Number.isFinite(value) && value >= 0 ? value : null
}

function cycleFeeFactScope(tuition, applicationFee) {
  if (tuition && applicationFee !== null) return 'complete'
  if (tuition || applicationFee !== null) return 'partial'
  return 'dates-only'
}

function candidateCycleMode(candidate) {
  if (candidate.cycleProjection.cycleStatus === 'confirmed') return 'current'
  if (candidate.cycleProjection.cycleStatus === 'stale') return 'historical'
  if (candidate.cycleProjection.dateStatus === 'not-announced') return 'not-announced'
  return 'reference'
}

function findExistingCycle(cycles, candidate) {
  const candidates = cycles.filter((cycle) => cycle.programId === candidate.programId)
  const deadline = candidate.cycleProjection.deadline
  if (deadline) {
    const exact = candidates.find((cycle) => cycle.closesOn === deadline)
    if (exact) return exact
  }
  if (candidates.length === 1) return candidates[0]
  if (!candidates.length) return null
  return [...candidates].sort((left, right) => (
    right.academicYear.localeCompare(left.academicYear) || right.id.localeCompare(left.id)
  ))[0]
}

function academicYearFor(candidate, existing) {
  if (existing) return existing.academicYear
  const year = Number(String(candidate.cycleProjection.deadline || AUDIT_DATE).slice(0, 4))
  return `${year}-${year + 1}`
}

function intakeFor(candidate, existing) {
  if (existing) return existing.intake
  if (/spring/i.test(candidate.name) || candidate.facts.deadline?.status === 'historical_closed_spring_intake') return 'spring'
  return 'other'
}

function buildCycleId(candidate, academicYear, intake) {
  return `cycle-wave4-${slugToken(candidate.programId)}-${academicYear}-${intake}-evidence`
}

function cycleNotes(candidate, mode, existingNotes) {
  const marker = 'Official-source review 2026-08-26.'
  const existingEnglish = existingNotes?.en || ''
  if (existingEnglish.includes(marker)) return existingNotes

  const parts = [marker]
  if (mode === 'current') parts.push('The deadline shown here is current or upcoming as of the review date.')
  if (mode === 'historical') parts.push('Historical cycle only: the deadline has passed and no later deadline is inferred.')
  if (mode === 'reference') parts.push('Reference record only: no unambiguous current application window is asserted.')
  if (mode === 'not-announced') parts.push('The reviewed official source did not announce an exact application date.')

  const tuition = candidate.facts.tuition || {}
  if (typeof tuition.coverage === 'string') parts.push(`Funding note: ${tuition.coverage}.`)
  const requirements = candidate.facts.requirements?.value
  if (Array.isArray(requirements) && requirements.length) {
    parts.push(`Official route requirements: ${requirements.join('; ')}.`)
  }
  const addition = parts.join(' ')
  return {
    ...(existingNotes || {}),
    en: existingEnglish ? `${existingEnglish} ${addition}` : addition,
  }
}

function buildCycle(candidate, existing) {
  const mode = candidateCycleMode(candidate)
  const tuition = scalarTuition(candidate)
  const applicationFee = scalarApplicationFee(candidate)
  const sourceIds = mergeSourceIds(existing?.sourceIds, candidate.sourceDependencies.map((item) => item.sourceId))
  const academicYear = academicYearFor(candidate, existing)
  const intake = intakeFor(candidate, existing)
  const id = existing?.id || buildCycleId(candidate, academicYear, intake)
  const factScope = cycleFeeFactScope(tuition, applicationFee)

  if (mode === 'current') {
    assert(candidate.cycleProjection.deadline > AUDIT_DATE, `current_cycle_deadline_not_future:${candidate.programId}`)
    return {
      id,
      programId: candidate.programId,
      academicYear,
      intake,
      opensOn: null,
      closesOn: candidate.cycleProjection.deadline,
      dateStatus: 'published',
      tuitionCny: tuition?.amount ?? null,
      tuitionPeriod: tuition?.period ?? null,
      tuitionStatus: tuition
        ? (candidate.cycleProjection.tuitionStatus === 'confirmed' ? 'confirmed' : 'reference')
        : null,
      evidenceBasis: candidate.facts.deadline?.status === 'current_upcoming_by_recurring_rule'
        ? 'recurring-official-rule'
        : 'cycle-specific',
      factScope,
      applicationFeeCny: applicationFee,
      notes: cycleNotes(candidate, mode, existing?.notes),
      sourceIds,
      verifiedAt: AUDIT_DATE,
      reviewAfter: CYCLE_REVIEW_AFTER,
      status: 'verified',
    }
  }

  if (mode === 'not-announced') {
    return {
      id,
      programId: candidate.programId,
      academicYear,
      intake,
      opensOn: null,
      closesOn: null,
      dateStatus: 'not-announced',
      tuitionCny: tuition?.amount ?? null,
      tuitionPeriod: tuition?.period ?? null,
      tuitionStatus: tuition ? 'reference' : null,
      evidenceBasis: 'recurring-official-rule',
      factScope,
      applicationFeeCny: applicationFee,
      notes: cycleNotes(candidate, mode, existing?.notes),
      sourceIds,
      verifiedAt: AUDIT_DATE,
      reviewAfter: CYCLE_REVIEW_AFTER,
      status: 'verified',
    }
  }

  const exactHistoricalDeadline = mode === 'historical' ? candidate.cycleProjection.deadline : null
  const safelyExpiredExistingDeadline = existing?.closesOn && existing.closesOn <= AUDIT_DATE
    ? existing.closesOn
    : null
  return {
    id,
    programId: candidate.programId,
    academicYear,
    intake,
    opensOn: null,
    closesOn: exactHistoricalDeadline || safelyExpiredExistingDeadline,
    dateStatus: 'previous-cycle-reference',
    tuitionCny: tuition?.amount ?? null,
    tuitionPeriod: tuition?.period ?? null,
    tuitionStatus: tuition ? 'reference' : null,
    evidenceBasis: 'cycle-specific',
    factScope,
    applicationFeeCny: applicationFee,
    notes: cycleNotes(candidate, mode, existing?.notes),
    sourceIds,
    verifiedAt: AUDIT_DATE,
    reviewAfter: AUDIT_DATE,
    status: 'stale',
  }
}

function shouldCreateCycle(candidate) {
  const mode = candidateCycleMode(candidate)
  if (mode === 'current' || mode === 'historical') return true
  return scalarTuition(candidate) !== null
}

function assertCompatibilitySafety(input, output, staged, sourceRecords, changedProgramIds, changedCycleIds) {
  assert(output.programs.length === input.programs.length, 'compat_release_must_not_create_programs')
  const blockedIds = new Set(staged.blocked.map((item) => item.programId))
  assert([...changedProgramIds].every((programId) => !blockedIds.has(programId)), 'blocked_program_modified')
  const changedCycles = output.admissionCycles.filter((cycle) => changedCycleIds.has(cycle.id))
  assert(changedCycles.every((cycle) => !blockedIds.has(cycle.programId)), 'blocked_cycle_modified')
  const changedPrograms = output.programs.filter((program) => changedProgramIds.has(program.id))
  for (const program of changedPrograms) {
    if (program.verificationScope === 'facts') {
      assert(hasVerifiedProgramFacts(program), `facts_scope_without_verified_program_facts:${program.id}`)
    }
  }

  const readySourceIds = new Set(sourceRecords.map((source) => source.id))
  const blockedSourceIds = new Set(staged.blocked.flatMap((item) => item.blockingSourceIds))
  for (const sourceId of blockedSourceIds) {
    assert(!readySourceIds.has(sourceId), `quarantined_source_published:${sourceId}`)
  }

  const outputSourceIds = new Set(output.sources.map((source) => source.id))
  for (const candidate of staged.candidates) {
    for (const dependency of candidate.sourceDependencies) {
      assert(outputSourceIds.has(dependency.sourceId), `candidate_source_missing_from_catalog:${candidate.programId}:${dependency.sourceId}`)
    }
  }

  for (const cycle of changedCycles) {
    if (cycle.closesOn && cycle.closesOn <= AUDIT_DATE) {
      assert(cycle.status === 'stale', `expired_cycle_not_stale:${cycle.id}`)
      assert(cycle.dateStatus === 'previous-cycle-reference', `expired_cycle_not_reference:${cycle.id}`)
    }
    if (cycle.factScope === 'partial') {
      assert(
        cycle.tuitionCny !== null || cycle.applicationFeeCny !== null,
        `partial_cycle_without_fee_fact:${cycle.id}`,
      )
    }
  }

  const candidateByProgram = new Map(staged.candidates.map((candidate) => [candidate.programId, candidate]))
  for (const cycle of changedCycles) {
    const candidate = candidateByProgram.get(cycle.programId)
    if (Array.isArray(candidate?.facts.tuition?.variants)) {
      assert(cycle.tuitionCny === null, `variant_tuition_collapsed_to_scalar:${cycle.programId}`)
    }
  }
}

function applyCompatibilityRelease(input, ledger, closure, receipt, staged) {
  assertStagedIntegrity(ledger, closure, receipt, staged)
  const output = clone(input)
  const sourceRecords = buildVerifiedSourceRecords(ledger, closure, receipt, staged)
  const sourceRecordById = new Map(sourceRecords.map((source) => [source.id, source]))
  const closureSourceById = new Map(closure.sources.map((source) => [source.sourceId, source]))
  const ledgerProgramById = new Map(flattenLedgerPrograms(ledger).map((program) => [program.programId, program]))
  const changedProgramIds = new Set()
  const changedCycleIds = new Set()
  const fieldCounts = {
    duration: 0,
    applyUrl: 0,
    languageRequirements: 0,
    teachingLanguages: 0,
    programUrl: 0,
  }

  let sourcesAdded = 0
  let sourcesUpdated = 0
  for (const source of sourceRecords) {
    const existing = output.sources.find((item) => item.id === source.id)
    if (!existing) {
      output.sources.push(source)
      sourcesAdded += 1
    } else if (!sameRecord(existing, source)) {
      assert(existing.url === source.url, `existing_source_url_conflict:${source.id}`)
      replaceById(output.sources, source.id, source)
      sourcesUpdated += 1
    }
  }

  let programsUpdated = 0
  let cyclesAdded = 0
  let cyclesUpdated = 0
  let candidatesWithoutCycle = 0
  for (const candidate of staged.candidates) {
    const existingProgram = output.programs.find((program) => program.id === candidate.programId)
    const ledgerProgram = ledgerProgramById.get(candidate.programId)
    assert(existingProgram, `candidate_program_missing:${candidate.programId}`)
    assert(ledgerProgram, `ledger_program_missing:${candidate.programId}`)
    assert(existingProgram.universityId === candidate.universityId, `candidate_university_mismatch:${candidate.programId}`)

    const nextProgram = updateProgram(
      existingProgram,
      candidate,
      ledgerProgram,
      sourceRecordById,
      closureSourceById,
      fieldCounts,
    )
    if (!sameRecord(existingProgram, nextProgram)) {
      replaceById(output.programs, candidate.programId, nextProgram)
      programsUpdated += 1
      changedProgramIds.add(candidate.programId)
    }

    const existingCycle = findExistingCycle(output.admissionCycles, candidate)
    if (!existingCycle && !shouldCreateCycle(candidate)) {
      candidatesWithoutCycle += 1
      continue
    }
    const nextCycle = buildCycle(candidate, existingCycle)
    if (!existingCycle) {
      output.admissionCycles.push(nextCycle)
      cyclesAdded += 1
      changedCycleIds.add(nextCycle.id)
    } else if (!sameRecord(existingCycle, nextCycle)) {
      replaceById(output.admissionCycles, existingCycle.id, nextCycle)
      cyclesUpdated += 1
      changedCycleIds.add(existingCycle.id)
    }
  }

  assertCompatibilitySafety(input, output, staged, sourceRecords, changedProgramIds, changedCycleIds)
  return {
    output,
    summary: {
      stagedCandidates: staged.candidates.length,
      blockedCandidates: staged.blocked.length,
      verifiedSourceDependencies: sourceRecords.length,
      sourcesAdded,
      sourcesUpdated,
      programsUpdated,
      cyclesAdded,
      cyclesUpdated,
      candidatesWithoutCycle,
      fieldUpdates: fieldCounts,
      currentCyclesMaterialized: output.admissionCycles.filter((cycle) => (
        changedCycleIds.has(cycle.id) && cycle.status === 'verified' && cycle.dateStatus === 'published'
      )).length,
      notAnnouncedCyclesMaterialized: output.admissionCycles.filter((cycle) => (
        changedCycleIds.has(cycle.id) && cycle.status === 'verified' && cycle.dateStatus === 'not-announced'
      )).length,
      historicalOrReferenceCyclesMaterialized: output.admissionCycles.filter((cycle) => (
        changedCycleIds.has(cycle.id) && cycle.status === 'stale' && cycle.dateStatus === 'previous-cycle-reference'
      )).length,
      variantTuitionValuesPublished: output.admissionCycles.filter((cycle) => {
        const candidate = staged.candidates.find((item) => item.programId === cycle.programId)
        return changedCycleIds.has(cycle.id)
          && Array.isArray(candidate?.facts.tuition?.variants)
          && cycle.tuitionCny !== null
      }).length,
    },
  }
}

function loadCatalogData(dataDir) {
  return {
    sources: readJson(path.join(dataDir, 'sources.json')),
    programs: readJson(path.join(dataDir, 'programs.json')),
    admissionCycles: readJson(path.join(dataDir, 'admission-cycles.json')),
  }
}

function parseDataDir(argv) {
  const index = argv.indexOf('--data-dir')
  if (index < 0) return process.env.STUDYINCHINA_DATA_DIR
    ? path.resolve(process.env.STUDYINCHINA_DATA_DIR)
    : DEFAULT_DATA_DIR
  assert(argv[index + 1], 'missing_data_dir_argument')
  return path.resolve(argv[index + 1])
}

function assertWriteAuthorized(argv, dataDir) {
  assert(argv.includes('--apply-catalog'), 'formal_write_requires_apply_catalog_flag')
  assert(process.env.STUDYINCHINA_ALLOW_FORMAL_WAVE4_WRITE === APPLY_CONFIRMATION, 'formal_write_confirmation_missing')
  assert(path.resolve(dataDir) === path.resolve(DEFAULT_DATA_DIR), 'formal_write_must_target_content_data')
}

async function writeCompatibilityReleaseAtomically(dataDir, before, after) {
  const filePlans = [
    ['sources.json', before.sources, after.sources],
    ['programs.json', before.programs, after.programs],
    ['admission-cycles.json', before.admissionCycles, after.admissionCycles],
  ].map(([name, oldValue, newValue]) => ({
    name,
    target: path.join(dataDir, name),
    oldText: `${JSON.stringify(oldValue, null, 2)}\n`,
    newText: `${JSON.stringify(newValue, null, 2)}\n`,
  })).filter((plan) => plan.oldText !== plan.newText)

  if (!filePlans.length) return { filesChanged: 0 }
  const token = `wave4-${process.pid}-${Date.now()}`
  for (const plan of filePlans) {
    const current = await fsp.readFile(plan.target, 'utf8')
    assert(current === plan.oldText, `concurrent_data_change:${plan.name}`)
    plan.temp = `${plan.target}.${token}.tmp`
    plan.backup = `${plan.target}.${token}.bak`
    await fsp.writeFile(plan.temp, plan.newText, 'utf8')
  }

  const installed = []
  try {
    for (const plan of filePlans) {
      await fsp.rename(plan.target, plan.backup)
      installed.push(plan)
      await fsp.rename(plan.temp, plan.target)
    }
    for (const plan of installed) await fsp.rm(plan.backup, { force: true })
  } catch (error) {
    for (const plan of [...installed].reverse()) {
      await fsp.rm(plan.target, { force: true })
      if (fs.existsSync(plan.backup)) await fsp.rename(plan.backup, plan.target)
    }
    throw error
  } finally {
    for (const plan of filePlans) {
      if (plan.temp) await fsp.rm(plan.temp, { force: true })
      if (plan.backup) await fsp.rm(plan.backup, { force: true })
    }
  }
  return { filesChanged: filePlans.length }
}

async function main() {
  const ledger = readJson(LEDGER_PATH)
  const closure = readJson(CLOSURE_PATH)
  const receipt = readJson(RECEIPT_PATH)
  const staged = readJson(STAGED_PATH)
  const dataDir = parseDataDir(process.argv)
  const input = loadCatalogData(dataDir)
  const release = applyCompatibilityRelease(input, ledger, closure, receipt, staged)

  if (!process.argv.includes('--apply-catalog')) {
    console.log(JSON.stringify({ mode: 'dry-run', filesChanged: 0, ...release.summary }, null, 2))
    return
  }

  assertWriteAuthorized(process.argv, dataDir)
  const writeResult = await writeCompatibilityReleaseAtomically(dataDir, input, release.output)
  console.log(JSON.stringify({ mode: 'catalog-applied', ...writeResult, ...release.summary }, null, 2))
}

module.exports = {
  APPLY_CONFIRMATION,
  AUDIT_DATE,
  EXPLICIT_TEACHING_LANGUAGE_ASSERTIONS,
  applyCompatibilityRelease,
  assertStagedIntegrity,
  buildVerifiedSourceRecords,
  deriveApplyUrl,
  deriveDuration,
  deriveLanguageRequirements,
  deriveTeachingLanguages,
  scalarTuition,
  writeCompatibilityReleaseAtomically,
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
