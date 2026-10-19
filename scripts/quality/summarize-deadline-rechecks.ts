import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { getTodayDate } from '../../src/lib/data/freshness'
import { selectPublishedData } from '../../src/lib/data/publication'
import type { DataBundle } from '../../src/lib/data/types'

type ObjectRow = Record<string, unknown>
type Outcome = 'unchanged' | 'corrected' | 'closed' | 'unknown' | 'blocked' | 'conflict'
type Binding = {
  id: string; collection: 'admissionCycles' | 'scholarships'; outcome: Outcome; universityId: string
  batchId: string; sourceReport: string; row: ObjectRow; context: ObjectRow
}
const AUDIT_DATE = '2026-10-19'
const FILE_NAMES = ['sources.json', 'cities.json', 'universities.json', 'programs.json', 'admission-cycles.json', 'scholarships.json']
const sha = (value: Buffer | string) => createHash('sha256').update(value).digest('hex')
const object = (value: unknown): ObjectRow => value && typeof value === 'object' && !Array.isArray(value) ? value as ObjectRow : {}
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : []
const string = (value: unknown): string => typeof value === 'string' ? value : ''
const has = (row: ObjectRow, key: string) => Object.prototype.hasOwnProperty.call(row, key)
const unique = (values: string[]) => [...new Set(values)].sort()
const tally = <T>(values: T[], key: (value: T) => string) => values.reduce<Record<string, number>>((out, value) => {
  const name = key(value); out[name] = (out[name] || 0) + 1; return out
}, {})
const outcomes = new Set<Outcome>(['unchanged', 'corrected', 'closed', 'unknown', 'blocked', 'conflict'])
const supported = new Set<Outcome>(['unchanged', 'corrected', 'closed'])

function localFile(root: string, relativeName: string): string {
  assert.ok(relativeName && !path.isAbsolute(relativeName), 'Expected a relative evidence path')
  const target = path.resolve(root, relativeName)
  const relative = path.relative(path.resolve(root), target)
  assert.ok(relative !== '..' && !relative.startsWith('..' + path.sep), 'Evidence path escapes its workspace')
  return target
}

export function assertCurrentAuditDay(today: string, actualToday = getTodayDate()): void {
  assert.equal(today, AUDIT_DATE, 'These immutable batch receipts belong to 2026-10-19')
  assert.equal(actualToday, today, 'Refuse an old-date summary on a new Asia/Shanghai calendar day')
}

/** Read only explicit record arrays; summary counts and completed-ID aliases are not records. */
export function normalizeReport(report: ObjectRow, sourceReport: string): Binding[] {
  const bindings: Binding[] = []
  const batchId = string(report.batchId)
  assert.ok(batchId, 'Missing batchId: ' + sourceReport)
  const walk = (value: unknown, inherited: ObjectRow): void => {
    if (Array.isArray(value)) { value.forEach(child => walk(child, inherited)); return }
    const node = object(value)
    const context = { ...inherited, ...node }
    const childKeys = ['schools', 'rows', 'groups', 'records', 'recordResults'].filter(key => Array.isArray(node[key]))
    // Some frozen receipts expose identical compatibility aliases. Validate
    // their complete contents before traversing a single copy; differing
    // arrays still produce duplicate-ID errors rather than hiding conflicts.
    const distinctChildKeys = childKeys.filter((key, index) => !childKeys.slice(0, index)
      .some(previous => JSON.stringify(node[previous]) === JSON.stringify(node[key])))
    // Batch 004 also names its selected record at school level; only its
    // explicit child binding is an assessed record, not that descriptive alias.
    if (typeof node.recordId === 'string' && (node.collection || node.type || node.recordKind || childKeys.length === 0)) {
      const kind = node.collection || node.type || node.recordKind
      const collection = kind === 'admissionCycles' || kind === 'admissionCycle' || kind === 'admission-cycle' ? 'admissionCycles'
        : kind === 'scholarships' || kind === 'scholarship' ? 'scholarships' : null
      assert.ok(collection, 'Unknown collection for ' + node.recordId)
      const outcome = string(node.result || node.outcome || inherited.result || inherited.outcome) as Outcome
      assert.ok(outcomes.has(outcome), 'Unknown result for ' + node.recordId)
      assert.ok(string(context.universityId), 'Missing university context for ' + node.recordId)
      bindings.push({ id: node.recordId, collection, outcome, universityId: string(context.universityId),
        batchId, sourceReport, row: node, context })
      return
    }
    for (const key of distinctChildKeys) walk(node[key], context)
  }
  walk(report, {})
  assert.ok(bindings.length, 'No assessed record bindings in ' + sourceReport)
  return bindings
}

export function assertDistinctBindings(bindings: Binding[]): void {
  const seen = new Map<string, Binding>()
  for (const row of bindings) {
    const previous = seen.get(row.id)
    assert.ok(!previous, `Duplicate assessed record ${row.id}: ${previous?.sourceReport} / ${row.sourceReport}`)
    seen.set(row.id, row)
  }
}

function assertStoredDate(row: ObjectRow, canonical: string | null, id: string): void {
  assert.ok(has(row, 'storedDeadline'), 'Missing stored deadline binding: ' + id)
  assert.equal(row.storedDeadline, canonical, 'Stored deadline differs from current canonical row: ' + id)
}

function option(name: string, fallback: string): string {
  const index = process.argv.indexOf('--' + name)
  if (index === -1) return fallback
  const value = process.argv[index + 1]
  assert.ok(value && !value.startsWith('--'), 'Missing --' + name)
  return value
}

export function buildSummary(primaryRoot: string, reportsDirectory: string, today = getTodayDate(), throughBatch = 8) {
  assert.ok(Number.isInteger(throughBatch) && throughBatch >= 8 && throughBatch <= 999, 'Expected --through-batch in 8..999')
  assertCurrentAuditDay(today)
  const primary = path.resolve(primaryRoot), reportsRoot = path.resolve(reportsDirectory)
  const read = (relative: string): unknown => JSON.parse(readFileSync(localFile(primary, relative), 'utf8'))
  const hashes = Object.fromEntries(FILE_NAMES.map(name => [name, sha(readFileSync(localFile(primary, 'content/data/' + name)))]))
  const snapshotSha256 = sha(JSON.stringify(hashes))
  const raw = { sources: read('content/data/sources.json'), cities: read('content/data/cities.json'),
    universities: read('content/data/universities.json'), programs: read('content/data/programs.json'),
    admissionCycles: read('content/data/admission-cycles.json'), scholarships: read('content/data/scholarships.json') } as DataBundle
  const published = selectPublishedData(raw, today)
  const cycles = new Map(raw.admissionCycles.map(row => [row.id, row]))
  const programs = new Map(raw.programs.map(row => [row.id, row]))
  const awards = new Map(raw.scholarships.map(row => [row.id, row]))
  const publishedCycles = new Set(published.admissionCycles.map(row => row.id))
  const publishedAwards = new Set(published.scholarships.map(row => row.id))
  const schoolIds = new Set(raw.universities.map(row => row.id))
  const all: Binding[] = []
  const reportPins: { report: string; reportSha256: string; batchId: string; snapshotValidation: string;
    recordsAssessed: number; universitiesWithScopedChecks: number; recordOutcomes: Record<string, number>; publicCyclesAssessed: number }[] = []
  const precisionIssues: unknown[] = []
  const originalReports: ObjectRow[] = []
  for (let number = 1; number <= throughBatch; number++) {
    const relative = `official-batch-${String(number).padStart(3, '0')}/report.json`
    const bytes = readFileSync(localFile(reportsRoot, relative))
    const report = object(JSON.parse(bytes.toString('utf8')))
    assert.equal(report.auditDate || report.today, today, 'Report belongs to another date: ' + relative)
    assert.equal(report.snapshotSha256 || report.inputSnapshotSha256, snapshotSha256, 'Snapshot fingerprint differs: ' + relative)
    const reportHashes = object(report.inputFileSha256)
    if (Object.keys(reportHashes).length) for (const name of FILE_NAMES) assert.equal(reportHashes[name], hashes[name], 'Input file changed: ' + relative + '/' + name)
    const sourceReport = 'quality/deadline-sweep-20261019/' + relative
    const bindings = normalizeReport(report, sourceReport)
    all.push(...bindings)
    reportPins.push({ report: sourceReport, reportSha256: sha(bytes), batchId: string(report.batchId),
      snapshotValidation: Object.keys(reportHashes).length ? 'six-explicit-file-hashes-and-fingerprint' : 'same-six-file-fingerprint',
      recordsAssessed: bindings.length, universitiesWithScopedChecks: new Set(bindings.map(row => row.universityId)).size,
      recordOutcomes: tally(bindings, row => row.outcome), publicCyclesAssessed: bindings.filter(row => publishedCycles.has(row.id)).length })
    precisionIssues.push(...array(report.precisionIssues).map(issue => ({ sourceReport, ...object(issue) })))
    originalReports.push(report)
  }
  assertDistinctBindings(all)
  // A later report may pin earlier reports; validate those pins, too.
  for (const report of originalReports) for (const value of array(report.priorReportPins)) {
    const pin = object(value)
    const matched = reportPins.find(candidate => candidate.report.endsWith('/' + string(pin.batch) + '/report.json'))
    assert.equal(matched?.reportSha256, pin.reportSha256, 'An earlier report was changed after a later report pinned it')
  }
  const checks = { storedDeadlinesMatched: 0, cycleParentsMatched: 0, scholarshipUniversityMappingsMatched: 0,
    storedOpeningsMatched: 0, completeCanonicalRowHashesMatched: 0, publicationFlagsMatched: 0 }
  for (const binding of all) {
    const row = binding.row
    assert.ok(schoolIds.has(binding.universityId), 'University does not exist: ' + binding.id)
    const canonical = binding.collection === 'admissionCycles' ? cycles.get(binding.id) : awards.get(binding.id)
    assert.ok(canonical, 'Record does not exist: ' + binding.id)
    const deadline = 'closesOn' in canonical ? canonical.closesOn : canonical.deadline
    assertStoredDate(row, deadline, binding.id); checks.storedDeadlinesMatched++
    if ('programId' in canonical) {
      const program = programs.get(canonical.programId)
      assert.ok(program)
      assert.equal(program.universityId, binding.universityId, 'Cycle university differs: ' + binding.id)
      if (has(row, 'programId')) assert.equal(row.programId, canonical.programId, 'Cycle parent differs: ' + binding.id)
      if (has(row, 'storedOpensOn')) { assert.equal(row.storedOpensOn, canonical.opensOn, 'Stored opening differs: ' + binding.id); checks.storedOpeningsMatched++ }
      for (const key of ['academicYear', 'intake'] as const) if (has(row, key)) assert.equal(row[key], canonical[key])
      if (has(row, 'degreeLevel')) assert.equal(row.degreeLevel, program.degreeLevel)
      if (has(row, 'canonicalCycleSha256')) { assert.equal(row.canonicalCycleSha256, sha(JSON.stringify(canonical))); checks.completeCanonicalRowHashesMatched++ }
      if (has(row, 'canonicalProgramSha256')) { assert.equal(row.canonicalProgramSha256, sha(JSON.stringify(program))); checks.completeCanonicalRowHashesMatched++ }
      checks.cycleParentsMatched++
    } else {
      const universityIds = new Set([...canonical.universityIds, ...canonical.programIds.flatMap(id => programs.get(id)?.universityId || [])])
      assert.ok(universityIds.has(binding.universityId), 'Scholarship school attribution differs: ' + binding.id)
      if (has(row, 'canonicalScholarshipSha256')) { assert.equal(row.canonicalScholarshipSha256, sha(JSON.stringify(canonical))); checks.completeCanonicalRowHashesMatched++ }
      checks.scholarshipUniversityMappingsMatched++
    }
    for (const key of ['publicationBefore', 'publishedBefore', 'publishedInInputSnapshot']) if (has(row, key)) {
      assert.equal(row[key], binding.collection === 'admissionCycles' ? publishedCycles.has(binding.id) : publishedAwards.has(binding.id)); checks.publicationFlagsMatched++
    }
    if (binding.outcome === 'unchanged') {
      assert.ok(deadline, 'An unchanged explicit deadline must not be null: ' + binding.id)
      assert.equal(row.officialDeadline ?? binding.context.officialDeadline, deadline, 'Unchanged result lacks a matching official date: ' + binding.id)
    }
    if ('opensOn' in canonical && (row.openingDateAssessed === true || typeof row.officialOpensOn === 'string')) {
      assert.ok('opensOn' in canonical)
      assert.equal(row.officialOpensOn, canonical.opensOn, 'Assessed official opening differs: ' + binding.id)
    }
  }
  const planFile = localFile(reportsRoot, 'current-public-deadline-plan-v1.json')
  const planBytes = readFileSync(planFile), plan = object(JSON.parse(planBytes.toString('utf8')))
  assert.equal(plan.today, today)
  assert.equal(plan.snapshotSha256, snapshotSha256)
  for (const name of FILE_NAMES) assert.equal(object(plan.inputFileSha256)[name], hashes[name])
  const carry = object(plan.carriedForwardApprovedEvidence)
  const manifestPath = string(carry.manifestPath), preparationPath = string(carry.preparationPath)
  const manifestBytes = readFileSync(localFile(primary, manifestPath)), preparationBytes = readFileSync(localFile(primary, preparationPath))
  assert.equal(sha(manifestBytes), carry.manifestSha256)
  assert.equal(sha(preparationBytes), carry.preparationSha256)
  const preparation = object(JSON.parse(preparationBytes.toString('utf8')))
  assert.equal(preparation.sourceCommit, carry.sourceCommit)
  const approvedPins = new Map(array(preparation.approvedEvidencePins).map(value => {
    const pin = object(value); return [string(pin.path), string(pin.sha256)]
  }))
  const batchCache = new Map<string, ObjectRow>()
  const carriedCycles: string[] = [], carriedAwards: string[] = []
  for (const [kind, values] of [['programs', array(carry.programs)], ['scholarships', array(carry.scholarships)]] as const) {
    for (const value of values) {
      const entry = object(value), batchPath = string(entry.approvedBatchPath)
      if (!batchCache.has(batchPath)) {
        const bytes = readFileSync(localFile(primary, batchPath))
        assert.equal(sha(bytes), approvedPins.get(batchPath), 'Approved batch differs from release pin')
        assert.equal(sha(bytes), entry.approvedBatchSha256)
        batchCache.set(batchPath, object(JSON.parse(bytes.toString('utf8'))))
      }
      const batch = batchCache.get(batchPath)!
      assert.equal(batch.batchId, entry.batchId)
      const id = string(kind === 'programs' ? entry.cycleId : entry.scholarshipId)
      const approved = array(batch.entries).map(object).find(row => string(object(kind === 'programs' ? row.cycle : row.scholarship).id) === id)
      assert.ok(approved, 'Carried record absent from approved batch: ' + id)
      if (kind === 'programs') {
        const canonical = cycles.get(id), approvedCycle = object(approved.cycle), approvedProgram = object(approved.program)
        assert.ok(canonical && publishedCycles.has(id))
        assert.equal(canonical.programId, entry.programId)
        assert.equal(approvedCycle.programId, canonical.programId)
        assert.equal(approvedProgram.id, canonical.programId)
        assert.equal(programs.get(canonical.programId)?.universityId, approvedProgram.universityId)
        for (const key of ['opensOn', 'closesOn', 'dateStatus'] as const) assert.equal(canonical[key], approvedCycle[key])
        assert.equal(canonical.opensOn, entry.opensOn); assert.equal(canonical.closesOn, entry.closesOn)
        carriedCycles.push(id)
      } else {
        const canonical = awards.get(id), approvedAward = object(approved.scholarship)
        assert.ok(canonical && publishedAwards.has(id))
        assert.equal(canonical.deadline, approvedAward.deadline); assert.equal(canonical.deadline, entry.deadline)
        carriedAwards.push(id)
      }
      for (const value of array(entry.captures)) {
        const capture = object(value)
        assert.equal(sha(readFileSync(localFile(primary, string(capture.textPath)))), capture.textSha256)
        assert.equal(sha(readFileSync(localFile(primary, string(capture.rawPath)))), capture.rawSha256)
      }
    }
  }
  assert.equal(unique(carriedCycles).length, 16)
  assert.equal(unique(carriedAwards).length, 7)
  const byId = new Map(all.map(row => [row.id, row]))
  const carriedCycleSet = new Set(carriedCycles)
  const dateSupportedPublicCycleIds = published.admissionCycles.filter(row => supported.has(byId.get(row.id)?.outcome as Outcome) || carriedCycleSet.has(row.id)).map(row => row.id)
  const conflictedPublicCycleIds = published.admissionCycles.filter(row => byId.get(row.id)?.outcome === 'conflict').map(row => row.id)
  const unassessedPublicCycleIds = published.admissionCycles.filter(row => !byId.has(row.id) && !carriedCycleSet.has(row.id)).map(row => row.id)
  const otherUnresolvedPublicCycleIds = published.admissionCycles.filter(row => ['unknown', 'blocked'].includes(byId.get(row.id)?.outcome || '')).map(row => row.id)
  const bySchool = published.universities.filter(school => published.programs.some(program => program.universityId === school.id)).map(school => {
    const records = published.admissionCycles.filter(cycle => programs.get(cycle.programId)?.universityId === school.id)
    return { universityId: school.id, publicCycles: records.length,
      dateSupported: records.filter(row => dateSupportedPublicCycleIds.includes(row.id)).length,
      conflicts: records.filter(row => conflictedPublicCycleIds.includes(row.id)).map(row => row.id),
      unassessed: records.filter(row => unassessedPublicCycleIds.includes(row.id)).map(row => row.id) }
  })
  const normalized = all.map(row => ({ recordId: row.id, collection: row.collection, universityId: row.universityId,
    batchId: row.batchId, outcome: row.outcome, storedDeadline: row.row.storedDeadline }))
  const recordOutcomes = tally(all, row => row.outcome)
  assert.deepEqual(reportPins.slice(0, 8).map(row => row.recordsAssessed), [22, 18, 20, 10, 244, 335, 173, 12])
  const baseline = all.filter(row => reportPins.slice(0, 8).some(report => report.batchId === row.batchId))
  assert.equal(baseline.length, 834)
  assert.deepEqual(tally(baseline, row => row.outcome), { blocked: 8, unknown: 6, unchanged: 819, conflict: 1 })
  assert.equal(reportPins.length, throughBatch)
  assert.equal(dateSupportedPublicCycleIds.length, 782); assert.equal(conflictedPublicCycleIds.length, 1)
  assert.equal(unassessedPublicCycleIds.length, 0); assert.equal(otherUnresolvedPublicCycleIds.length, 0)
  const nullDeadlineAwards = published.scholarships.filter(row => row.deadline === null).map(row => row.id)
  const explicitDeadlineAwards = published.scholarships.filter(row => row.deadline !== null).map(row => row.id)
  // Re-read the six canonical files at the end: a concurrent writer invalidates this summary.
  for (const name of FILE_NAMES) assert.equal(sha(readFileSync(localFile(primary, 'content/data/' + name))), hashes[name])
  return {
    schemaVersion: 1, observedAt: new Date().toISOString(), today, timeZone: 'Asia/Shanghai',
    snapshotSha256, inputFileSha256: hashes, scope: 'Scoped date and route checks from immutable official batches; other facts and whole-school catalogue completeness are not certified.',
    universitiesWithScopedDateChecks: new Set(all.map(row => row.universityId)).size,
    recordsAssessed: all.length, recordOutcomes, canonicalWrites: 0, dateChangesApplied: 0,
    wholeSchoolCataloguesCompleted: 0, sourceReports: reportPins,
    validation: { sixFilesStableBeforeAndAfter: true, distinctRecordIds: true, schoolRevisitsAllowed: true,
      normalizedRecordBindingsSha256: sha(JSON.stringify(normalized)), ...checks },
    publicCycleCoverage: { publicPrograms: published.programs.length, publicCycles: published.admissionCycles.length,
      dateSupported: dateSupportedPublicCycleIds.length, officialSourceConflicts: conflictedPublicCycleIds.length,
      unassessed: unassessedPublicCycleIds.length, otherUnresolved: otherUnresolvedPublicCycleIds.length,
      newlyReadBatchCycleIdsSupported: dateSupportedPublicCycleIds.filter(id => !carriedCycleSet.has(id)).length,
      reusedApprovedCycleEvidence: carriedCycles.length, conflictedCycleIds: conflictedPublicCycleIds,
      unassessedCycleIds: unassessedPublicCycleIds, byUniversity: bySchool },
    publicScholarshipEvidenceCoverage: { publicScholarships: published.scholarships.length,
      priorApprovedEvidenceCovered: carriedAwards.length, specificDeadlinePublished: explicitDeadlineAwards.length,
      specificDeadlineUnknown: nullDeadlineAwards.length, unknownDeadlineIds: nullDeadlineAwards,
      explicitDeadlineIds: explicitDeadlineAwards,
      qualification: 'All seven have approved evidence. Null deadlines remain unknown; an admission deadline is not assigned as a separate award cutoff.' },
    carriedForwardApprovedEvidence: { countsAsNewWebsiteReads: false, sourceCommit: carry.sourceCommit,
      plan: 'quality/deadline-sweep-20261019/current-public-deadline-plan-v1.json', planSha256: sha(planBytes),
      manifestPath, manifestSha256: sha(manifestBytes), preparationPath, preparationSha256: sha(preparationBytes),
      approvedBatchPinsValidated: batchCache.size },
    carriedApprovedCycleIds: unique(carriedCycles), carriedApprovedScholarshipIds: unique(carriedAwards),
    dateCheckedRecordIds: all.filter(row => supported.has(row.outcome)).map(row => row.id),
    unresolvedDateRecordIds: all.filter(row => !supported.has(row.outcome)).map(row => row.id),
    conflictDetails: all.filter(row => row.outcome === 'conflict').map(row => ({ sourceReport: row.sourceReport,
      universityId: row.universityId, ...row.row })), precisionIssues,
    limitations: [
      'This summary makes no new website reads. It validates and aggregates the exact pinned source reports.',
      '782 public cycle date bindings are supported; one official source conflict remains. Do not claim all 783 dates are verified.',
      'The 16 carried program and seven carried scholarship approvals are prior evidence, not new date rechecks.',
      'Date-only checks do not renew verifiedAt/reviewAfter, certify other facts, or certify complete school catalogues.',
      'Specific cutoff times, before-date boundaries, self-funded scope and contextual year caveats remain in the pinned source reports.',
      'The summary is specific to 2026-10-19 and refuses generation on another China calendar date.',
    ],
  }
}

function selfTest(): void {
  const report = { batchId: 'test', schools: [{ universityId: 'u', recordResults: [
    { collection: 'admissionCycles', recordId: 'a', result: 'unchanged', storedDeadline: '2027-01-01' },
    { collection: 'admissionCycles', recordId: 'b', result: 'unknown', storedDeadline: null },
  ] }] }
  const rows = normalizeReport(report, 'one.json')
  assert.equal(rows.length, 2)
  assert.equal(rows[0].universityId, 'u')
  assert.doesNotThrow(() => assertDistinctBindings(rows), 'Two routes at the same school are legitimate')
  assert.throws(() => assertDistinctBindings([...rows, rows[0]]), /Duplicate assessed record/)
  const alternate = normalizeReport({ batchId: 'two', rows: [{ universityId: 'u', records: [
    { type: 'scholarship', recordId: 's', outcome: 'blocked', storedDeadline: null },
  ] }] }, 'two.json')
  assert.equal(alternate[0].collection, 'scholarships')
  assert.equal(alternate[0].outcome, 'blocked')
  const awardContext = normalizeReport({ batchId: 'award', groups: [{ universityId: 'u', records: [
    { recordKind: 'scholarship', recordId: 'award-1', result: 'unchanged', storedDeadline: '2026-10-31', officialOpensOn: '2026-03-01' },
  ] }] }, 'award.json')
  assert.equal(awardContext[0].collection, 'scholarships')
  assert.equal(awardContext[0].row.officialOpensOn, '2026-03-01', 'Scholarship opening context is not a nonexistent canonical opening field')
  const aliased = { batchId: 'aliases', schools: report.schools, groups: report.schools }
  assert.equal(normalizeReport(aliased, 'aliases.json').length, 2, 'Identical frozen aliases are read once')
  const differing = normalizeReport({ ...aliased, groups: [{ ...report.schools[0], recordResults: [
    { ...report.schools[0].recordResults[0], result: 'blocked' },
  ] }] }, 'differing.json')
  assert.throws(() => assertDistinctBindings(differing), /Duplicate assessed record/, 'Different aliases must not silently hide conflicting bindings')
  assert.equal(normalizeReport({ batchId: 'alias', schools: [{ ...report.schools[0], recordId: 'a' }] }, 'alias.json').length, 2,
    'A descriptive school recordId must not duplicate its child binding')
  assert.throws(() => normalizeReport({ batchId: 'bad', records: [{ recordId: 'x', type: 'nonsense' }] }, 'bad.json'), /Unknown collection/)
  assert.throws(() => assertStoredDate({ storedDeadline: '2027-01-02' }, '2027-01-01', 'a'), /differs/)
  assert.throws(() => assertStoredDate({}, null, 'a'), /Missing stored deadline/)
  assert.doesNotThrow(() => assertCurrentAuditDay(AUDIT_DATE, AUDIT_DATE))
  assert.throws(() => assertCurrentAuditDay(AUDIT_DATE, '2026-10-20'), /new Asia\/Shanghai/)
  assert.throws(() => localFile(process.cwd(), '../outside.json'), /escapes/)
  console.log('17 normalization, duplicate, stale-date, stored-date and evidence-path assertions passed.')
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.includes('--self-test')) selfTest()
  else {
    const output = path.resolve(option('output', 'quality/deadline-sweep-20261019/official-review-summary-v3.json'))
    assert.ok(!existsSync(output), 'Immutable summary output already exists; choose a new version path')
    const summary = buildSummary(option('primary-root', process.cwd()), option('reports-dir', 'quality/deadline-sweep-20261019'), option('today', getTodayDate()), Number(option('through-batch', '8')))
    writeFileSync(output, JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' })
    console.log(JSON.stringify({ output, recordsAssessed: summary.recordsAssessed, recordOutcomes: summary.recordOutcomes,
      publicCycles: summary.publicCycleCoverage, publicScholarships: summary.publicScholarshipEvidenceCoverage }, null, 2))
  }
}
