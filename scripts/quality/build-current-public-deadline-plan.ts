import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { selectPublishedData } from '../../src/lib/data/publication'
import type { AdmissionCycle, DataBundle, Scholarship } from '../../src/lib/data/types'

// Read the canonical workspace, but write only the explicitly selected new plan.
const primary = process.argv[2]
const output = process.argv[3]
if (!primary || !output) throw new Error('usage: tsx build-current-public-deadline-plan.ts <read-only-primary-root> <new-output.json>')
const today = '2026-10-19'
const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')
const read = <T>(name: string): T => JSON.parse(readFileSync(path.join(primary, name), 'utf8')) as T
const unique = (values: string[]) => [...new Set(values)].sort()
const bytes = (name: string) => readFileSync(path.join(primary, name))
const files = { sources: 'sources', cities: 'cities', universities: 'universities', programs: 'programs', admissionCycles: 'admission-cycles', scholarships: 'scholarships' }
const inputHashes: Record<string, string> = {}
const raw = Object.fromEntries(Object.entries(files).map(([key, name]) => {
  const buffer = bytes('content/data/' + name + '.json')
  inputHashes[name + '.json'] = sha(buffer)
  return [key, JSON.parse(buffer.toString('utf8'))]
})) as DataBundle
const data = selectPublishedData(raw, today)
const sources = new Map(raw.sources.map(row => [row.id, row]))
const programs = new Map(data.programs.map(row => [row.id, row]))
const cycles = new Map(data.admissionCycles.map(row => [row.id, row]))
const scholarships = new Map(data.scholarships.map(row => [row.id, row]))
const summaryPath = 'quality/deadline-sweep-20261019/official-review-summary-v2.json'
const previous = read<{ dateCheckedRecordIds: string[]; unresolvedDateRecordIds: string[] }>(summaryPath)
const excludedIds = new Set([...previous.dateCheckedRecordIds, ...previous.unresolvedDateRecordIds])
assert.equal(excludedIds.size, 70, 'Expected the 70 unique assessed records from batches 001-004')
const manifestPath = 'quality/recovery-20261019/rapid-expansion/release-manifest-v1.json'
const preparationPath = 'quality/recovery-20261019/release-rapid-0cb2b83/preparation-receipt.json'
const manifest = read<{ programBatches: string[]; scholarshipBatches: string[] }>(manifestPath)
const preparation = read<{ sourceCommit: string; normalizedCatalogSha256: string; approvedEvidencePins: { path: string; sha256: string }[] }>(preparationPath)
type Evidence = { field: string; sourceId: string; quote: string; locator?: string }
type Capture = { sourceId: string; url: string; textPath: string; textSha256: string; retrievedAt: string; rawSha256: string }
type ApprovedBatch = { batchId: string; captures: Capture[]; entries: { program?: { id: string; universityId: string }; cycle?: AdmissionCycle; scholarship?: Scholarship; evidence: Evidence[] }[] }
const carryPrograms: { programId: string; cycleId: string; universityId: string; opensOn: string | null; closesOn: string | null; batchId: string; approvedBatchPath: string; approvedBatchSha256: string; dateEvidence: Evidence[]; captures: Capture[] }[] = []
const carryScholarships: { scholarshipId: string; deadline: string | null; batchId: string; approvedBatchPath: string; approvedBatchSha256: string; dateEvidence: Evidence[]; captures: Capture[] }[] = []
const captureHashCache = new Map<string, boolean>()
for (const batchPath of [...manifest.programBatches, ...manifest.scholarshipBatches]) {
  const batchBytes = bytes(batchPath)
  const pin = preparation.approvedEvidencePins.find(row => row.path === batchPath)
  assert.equal(sha(batchBytes), pin?.sha256, 'Approved evidence bytes must match the release preparation pin: ' + batchPath)
  const batch = JSON.parse(batchBytes.toString('utf8')) as ApprovedBatch
  for (const entry of batch.entries) {
    const dateEvidence = entry.evidence.filter(proof => /(?:^|\.)(?:opensOn|closesOn|dateStatus|deadline)$/u.test(proof.field))
    const relevantSources = new Set(dateEvidence.map(proof => proof.sourceId))
    const captures = batch.captures.filter(capture => relevantSources.has(capture.sourceId))
    for (const capture of captures) {
      if (!captureHashCache.has(capture.textPath)) captureHashCache.set(capture.textPath, sha(bytes(capture.textPath)) === capture.textSha256)
      assert.equal(captureHashCache.get(capture.textPath), true, 'Prior approved date capture hash mismatch')
      const text = bytes(capture.textPath).toString('utf8').normalize('NFKC').replace(/\s+/gu, ' ').trim()
      for (const proof of dateEvidence.filter(proof => proof.sourceId === capture.sourceId)) {
        assert.ok(text.includes(proof.quote.normalize('NFKC').replace(/\s+/gu, ' ').trim()), 'Date quote must remain in the pinned prior capture')
      }
    }
    const common = { batchId: batch.batchId, approvedBatchPath: batchPath, approvedBatchSha256: sha(batchBytes), dateEvidence, captures }
    if (entry.program && entry.cycle) {
      const current = cycles.get(entry.cycle.id)
      assert.ok(current && programs.has(entry.program.id), 'Approved program must still be public')
      assert.equal(current.opensOn, entry.cycle.opensOn)
      assert.equal(current.closesOn, entry.cycle.closesOn)
      assert.equal(current.dateStatus, entry.cycle.dateStatus)
      carryPrograms.push({ ...common, programId: entry.program.id, cycleId: entry.cycle.id, universityId: entry.program.universityId,
        opensOn: current.opensOn, closesOn: current.closesOn })
    } else if (entry.scholarship) {
      const current = scholarships.get(entry.scholarship.id)
      assert.ok(current, 'Approved scholarship must still be public')
      assert.equal(current.deadline, entry.scholarship.deadline)
      carryScholarships.push({ ...common, scholarshipId: current.id, deadline: current.deadline })
    }
  }
}
assert.equal(carryPrograms.length, 16)
assert.equal(carryScholarships.length, 7)
const carriedIds = new Set([...carryPrograms.map(row => row.cycleId), ...carryScholarships.map(row => row.scholarshipId)])
const newQueue = data.admissionCycles.filter(row => !excludedIds.has(row.id) && !carriedIds.has(row.id))
const publicSchoolIds = new Set(data.programs.map(row => row.universityId))
const urlBindings = (ids: string[]) => ids.flatMap(id => {
  const source = sources.get(id)
  if (!source) return []
  let reviewPriority = source.kind === 'admissions' || source.kind === 'scholarship' ? 3 : 0
  if (/2027|2026/u.test(source.title)) reviewPriority += 2
  if (/guide|brochure|prospectus|pre-university|foundation|spring|intake|admission|招生|预科/iu.test(source.title)) reviewPriority += 10
  if (/curriculum|培养|tuition|fees|学费|eligibility|入学资格|申请材料|pedagogy|philosoph/iu.test(source.title)) reviewPriority -= 10
  if (/portal|application system|online application|application route|login|报名系统|申请系统/iu.test(source.title)) reviewPriority -= 20
  if (/index|directory|catalogue|一览表/iu.test(source.title)) reviewPriority -= 3
  return [{ sourceId: id, url: source.url, kind: source.kind, title: source.title, official: source.official, reviewPriority }]
})
const schoolRows = data.universities.filter(row => publicSchoolIds.has(row.id)).map(school => {
  const schoolPrograms = data.programs.filter(row => row.universityId === school.id)
  const schoolCycles = data.admissionCycles.filter(row => programs.get(row.programId)?.universityId === school.id)
  const unassessed = newQueue.filter(row => programs.get(row.programId)?.universityId === school.id)
  const groups = new Map<string, { degreeLevel: string; academicYear: string; intake: string; opensOn: string | null; closesOn: string | null; dateStatus: string; dateGuideSources: ReturnType<typeof urlBindings>; allCycleSourceIds: string[]; allCycleSources: ReturnType<typeof urlBindings>; cycleIds: string[]; programIds: string[] }>()
  for (const row of unassessed) {
    const program = programs.get(row.programId)!
    const bindings = urlBindings(row.sourceIds)
    // A program-kind brochure may contain dates; an admissions-kind login portal
    // usually does not. Titles rank candidates, but never prove their scope.
    const ranked = [...bindings].sort((a, b) => b.reviewPriority - a.reviewPriority)
    const candidates = ranked.filter(source => source.reviewPriority > 0)
    const dateGuideSources = candidates.length ? candidates : ranked
    const key = JSON.stringify([program.degreeLevel, row.academicYear, row.intake, row.opensOn, row.closesOn, row.dateStatus, unique(dateGuideSources.map(source => source.url))])
    const group = groups.get(key) || { degreeLevel: program.degreeLevel, academicYear: row.academicYear, intake: row.intake,
      opensOn: row.opensOn, closesOn: row.closesOn, dateStatus: row.dateStatus, dateGuideSources,
      allCycleSourceIds: [], allCycleSources: [], cycleIds: [], programIds: [] }
    group.allCycleSourceIds.push(...row.sourceIds)
    group.allCycleSources.push(...bindings.filter(source => !group.allCycleSources.some(existing => existing.sourceId === source.sourceId)))
    group.cycleIds.push(row.id)
    group.programIds.push(program.id)
    groups.set(key, group)
  }
  return { universityId: school.id, universityName: school.name.zh || school.name.en,
    publicProgramCount: schoolPrograms.length, publicCycleCount: schoolCycles.length,
    priorBatchAssessedCycleIds: schoolCycles.filter(row => excludedIds.has(row.id)).map(row => row.id),
    priorBatchUnresolvedCycleIds: schoolCycles.filter(row => previous.unresolvedDateRecordIds.includes(row.id)).map(row => row.id),
    carriedApprovedCycleIds: schoolCycles.filter(row => carriedIds.has(row.id)).map(row => row.id),
    unassessedCycleIds: unassessed.map(row => row.id),
    dateGuideGroups: [...groups.values()].map(group => ({ ...group, allCycleSourceIds: unique(group.allCycleSourceIds), count: group.cycleIds.length })).sort((a, b) => b.count - a.count),
    distinctUnassessedDateGuideUrls: unique([...groups.values()].flatMap(group => group.dateGuideSources.map(source => source.url))) }
}).sort((a, b) => b.unassessedCycleIds.length - a.unassessedCycleIds.length)
assert.equal(schoolRows.length, 17)
assert.equal(schoolRows.reduce((sum, row) => sum + row.publicCycleCount, 0), data.admissionCycles.length)
assert.equal(schoolRows.reduce((sum, row) => sum + row.unassessedCycleIds.length, 0), newQueue.length)
const assigned = new Set(['uni-tianjin-university', 'uni-xiamen-university', 'uni-northwestern-polytechnical-university', 'uni-nanjing-university', 'uni-tsinghua-university', 'uni-tianjin-foreign-studies-university'])
const nextRecommendations = schoolRows.filter(school => !assigned.has(school.universityId) && school.unassessedCycleIds.length).map(school => ({
  universityId: school.universityId, unassessedCycles: school.unassessedCycleIds.length,
  guides: school.dateGuideGroups.map(group => ({ count: group.count, degreeLevel: group.degreeLevel, opensOn: group.opensOn, closesOn: group.closesOn,
    sources: group.dateGuideSources.map(source => ({ id: source.sourceId, url: source.url })), cycleIds: group.cycleIds })) }))
const plan = { schemaVersion: 1, generatedAt: new Date().toISOString(), today, inputRoot: path.resolve(primary),
  inputFileSha256: inputHashes, snapshotSha256: sha(JSON.stringify(inputHashes)),
  auditType: 'public-projection-date-recheck-planning-with-prior-approved-evidence', newOfficialWebsiteReads: 0,
  totals: { publicUniversityIdentities: data.universities.length, universitiesWithPublicPrograms: schoolRows.length,
    publicPrograms: data.programs.length, publicCycles: data.admissionCycles.length, publicScholarships: data.scholarships.length,
    previouslyAssessedRecordsExcluded: excludedIds.size,
    previouslyAssessedPublicCycles: data.admissionCycles.filter(row => excludedIds.has(row.id)).length,
    previouslyAssessedPublicScholarships: data.scholarships.filter(row => excludedIds.has(row.id)).length,
    carriedApprovedPrograms: carryPrograms.length, carriedApprovedScholarships: carryScholarships.length,
    unassessedPublicCyclesAfterBothExclusions: newQueue.length,
    distinctUnassessedDateGuideUrls: unique(schoolRows.flatMap(row => row.distinctUnassessedDateGuideUrls)).length },
  rules: [
    'All 70 prior batch IDs, including unknown and blocked outcomes, are excluded from new official reads; previous unresolved items remain visible separately.',
    'Prior approved evidence is carried forward from commit-pinned batches after local hash, quote and current structured-date matching. It is not a new official website read.',
    'Carried null scholarship deadlines remain unknown; do not copy doctoral admission deadlines into scholarship fields.',
    'The current public-program schools are 17; this does not claim that only 17 university identities are published.',
    'Groups by date, degree and source URL are candidate shared-guide checks. Titles and source kinds only rank candidates; all original cycle sources remain available. Official wording must establish scope before covering all bindings.',
    'Prior batches mostly checked narrow ICLT routes. Prioritise the shared degree guides that support hundreds of already public program dates.',
    'Avoid a whole-school completion claim until every public cycle for that school is covered; public coverage does not certify raw held programs.',
  ],
  previousBatches: { summaryPath, summarySha256: sha(bytes(summaryPath)), excludedRecordIds: [...excludedIds].sort(),
    unresolvedExcludedRecordIds: previous.unresolvedDateRecordIds },
  carriedForwardApprovedEvidence: { sourceCommit: preparation.sourceCommit, manifestPath, manifestSha256: sha(bytes(manifestPath)),
    preparationPath, preparationSha256: sha(bytes(preparationPath)), countsAsNewOfficialRead: false,
    programs: carryPrograms, scholarships: carryScholarships },
  activeAssignments: { batch005: 'Tianjin University degree guides, 244 public programs', batch006: 'Xiamen University self-funded degree guides, 335 public programs',
    batch007: 'Root: NWPU degree89, NJU bachelor49, Tsinghua public masters34, TJFSU1; exact record scope requires receipt' },
  nextRecommendations, universities: schoolRows }
writeFileSync(output, JSON.stringify(plan, null, 2) + '\n')
console.log(JSON.stringify({ ...plan.totals, schools: schoolRows.map(school => ({ name: school.universityName,
  publicCycles: school.publicCycleCount, previous: school.priorBatchAssessedCycleIds.length,
  carried: school.carriedApprovedCycleIds.length, remaining: school.unassessedCycleIds.length,
  guideUrls: school.distinctUnassessedDateGuideUrls.length })), nextRecommendations }, null, 2))
