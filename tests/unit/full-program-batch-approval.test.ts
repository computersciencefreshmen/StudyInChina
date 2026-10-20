import { createHash } from 'node:crypto'
import { renameSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyFullProgramBatch, assessFullProgramBatch, type FullProgramBatch } from '../../scripts/quality/approve-full-program-batch'
import * as snapshotWriter from '../../scripts/automation/apply-catalog-snapshot'
import { bundleSchema } from '../../src/lib/data/schema'
import type { AdmissionCycle, DataBundle, Program, Source } from '../../src/lib/data/types'

const today = '2026-10-14'
const now = new Date('2026-10-14T01:30:00.000Z')
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const roots: string[] = []
const collections = ['sources', 'cities', 'universities', 'programs', 'admission-cycles', 'scholarships'] as const
const visibleText = [
  'Synthetic Robotics: Master degree for international applicants.',
  'Teaching language: English. Duration: 24 months.',
  'Apply at https://apply.synthetic.edu/2027.',
  'English requirement: IELTS 6.5.',
  'Eligibility: a bachelor degree is required.',
  'Application materials: passport and academic transcript.',
  'Applications close on 2027-05-31.',
  'Tuition: 30000 RMB per academic year. Application fee: 500 RMB.',
  'Published tuition is an official reference only; the final amount follows the admission notice.',
  'Variable tuition: first year 150000 RMB; second and third years 30000 RMB each.',
  'Official duration: 16 weeks. Another official route lasts 2 semesters.',
  '学制：1学期或2学期。',
].join('\n')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now)
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Synthetic approval fixtures must remain offline') }))
})
afterEach(async () => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) {
    if (!resolve(root).startsWith(resolve('.tmp') + sep)) throw new Error('Unsafe full-program fixture cleanup')
    await rm(root, { recursive: true, force: true })
  }
})

async function fixture() {
  await mkdir(resolve('.tmp'), { recursive: true })
  const root = await mkdtemp(join(resolve('.tmp'), 'full-program-approval-'))
  roots.push(root)
  await mkdir(join(root, 'content/data'), { recursive: true })
  const source: Source = { id: 'program-source', url: 'https://synthetic.edu/2027/robotics', title: 'Synthetic admissions fixture', publisher: 'Synthetic University', kind: 'program', language: 'en', official: true, accessedAt: today }
  const audit = { sourceIds: [source.id], verifiedAt: today, reviewAfter: '2026-11-13', status: 'verified' as const }
  const program: Program = { ...audit, id: 'synthetic-robotics', slug: 'synthetic-robotics', universityId: 'synthetic-university', name: { en: 'Synthetic Robotics' }, degreeLevel: 'master', discipline: 'engineering', teachingLanguages: ['English'], durationMonths: 24, programUrl: source.url, applyUrl: 'https://apply.synthetic.edu/2027', languageRequirements: [{ test: 'IELTS', minimum: '6.5' }], verificationScope: 'complete', supplementaryDetails: { eligibility: [{ en: 'A bachelor degree is required.' }], applicationMaterials: [{ en: 'Passport and academic transcript.' }] } }
  const cycle: AdmissionCycle = { ...audit, id: 'synthetic-robotics-2027', programId: program.id, academicYear: '2027-2028', intake: 'autumn', opensOn: '2026-09-30', closesOn: '2027-05-31', dateStatus: 'published', tuitionCny: 30000, tuitionPeriod: 'academic-year', tuitionStatus: 'confirmed', evidenceBasis: 'cycle-specific', factScope: 'complete', applicationFeeCny: 500 }
  const catalog: DataBundle = bundleSchema.parse({
    sources: [source],
    cities: [{ ...audit, id: 'synthetic-city', slug: 'synthetic-city', name: { en: 'Synthetic City' }, province: null, region: null, coordinates: null, overview: null, climate: null, foodHighlights: [], sights: [] }],
    universities: [{ ...audit, id: program.universityId, slug: 'synthetic-university', name: { en: 'Synthetic University' }, cityId: 'synthetic-city', region: null, officialUrl: 'https://synthetic.edu/', admissionsUrl: null, summary: null, featured: false }],
    programs: [], admissionCycles: [], scholarships: [],
  })
  const files = { sources: catalog.sources, cities: catalog.cities, universities: catalog.universities, programs: catalog.programs, 'admission-cycles': catalog.admissionCycles, scholarships: catalog.scholarships }
  for (const [name, values] of Object.entries(files)) await writeFile(join(root, 'content/data', name + '.json'), JSON.stringify(values, null, 2) + '\n')
  const raw = '<html><body><pre>' + visibleText + '</pre></body></html>'
  await writeFile(join(root, 'official.html'), raw)
  await writeFile(join(root, 'official.txt'), visibleText)
  const batch: FullProgramBatch = {
    schemaVersion: 1, batchId: 'synthetic-full-admissions', sources: [source],
    captures: [{ sourceId: source.id, url: source.url, rawPath: 'official.html', rawSha256: sha(raw), textPath: 'official.txt', textSha256: sha(visibleText), retrievedAt: new Date(now.getTime() - 60_000).toISOString(), httpStatus: 200 }],
    entries: [{ program, cycle, reviewer: 'codex', reviewedAt: now.toISOString(), evidence: [
      { field: 'program.name.en', sourceId: source.id, quote: 'Synthetic Robotics' },
      { field: 'program.degreeLevel', sourceId: source.id, quote: 'Master degree' },
      { field: 'program.teachingLanguages[0]', sourceId: source.id, quote: 'Teaching language: English.' },
      { field: 'program.durationMonths', sourceId: source.id, quote: 'Duration: 24 months.' },
      { field: 'program.applyUrl', sourceId: source.id, quote: 'https://apply.synthetic.edu/2027' },
      { field: 'program.languageRequirements[0].minimum', sourceId: source.id, quote: 'English requirement: IELTS 6.5.' },
      { field: 'program.supplementaryDetails.eligibility[0].en', sourceId: source.id, quote: 'Eligibility: a bachelor degree is required.' },
      { field: 'program.supplementaryDetails.applicationMaterials[0].en', sourceId: source.id, quote: 'Application materials: passport and academic transcript.' },
      { field: 'cycle.closesOn', sourceId: source.id, quote: 'Applications close on 2027-05-31.' },
      { field: 'cycle.tuitionCny', sourceId: source.id, quote: 'Tuition: 30000 RMB' },
      { field: 'cycle.tuitionPeriod', sourceId: source.id, quote: 'per academic year' },
      { field: 'cycle.applicationFeeCny', sourceId: source.id, quote: 'Application fee: 500 RMB.' },
    ] }],
  }
  const catalogSha = sha(JSON.stringify(catalog))
  const assess = () => assessFullProgramBatch(root, batch, catalog, today)
  const snapshot = async () => Promise.all(collections.map(name => readFile(join(root, 'content/data', name + '.json'), 'utf8')))
  return { root, batch, catalog, catalogSha, program, cycle, source, assess, snapshot }
}

function referenceTuition(batch: FullProgramBatch) {
  const entry = batch.entries[0]
  entry.cycle.tuitionStatus = 'reference'
  entry.cycle.notes = { en: 'Official reference tuition; the final amount follows the admission notice.' }
  entry.evidence.push({ field: 'cycle.tuitionStatus', sourceId: entry.cycle.sourceIds[0], quote: 'Published tuition is an official reference only; the final amount follows the admission notice.' })
}

describe('full admissions approval from immutable official captures', () => {
  it.each(['16 weeks', '2 semesters'])('accepts exact official duration %s without manufacturing months', async value => {
    const { program, batch, source, assess } = await fixture()
    program.durationMonths = null
    program.durationText = { en: value }
    batch.entries[0].evidence = batch.entries[0].evidence.filter(proof => proof.field !== 'program.durationMonths')
    batch.entries[0].evidence.push({ field: 'program.durationText.en', sourceId: source.id, quote: value })
    expect(assess()).toMatchObject({ ready: 1, held: 0 })
    expect(program.durationMonths).toBeNull()
  })

  it('holds textual duration without its own captured field proof', async () => {
    const { program, assess } = await fixture()
    program.durationMonths = null
    program.durationText = { en: '16 weeks' }
    expect(assess().entries[0].blockers).toContain('field_evidence_missing:durationText')
    expect(assess().ready).toBe(0)
  })

  it('accepts Chinese-only duration with a matching Chinese source quote', async () => {
    const { program, batch, source, assess } = await fixture()
    program.durationMonths = null
    program.durationText = { zh: '2学期' }
    batch.entries[0].evidence = batch.entries[0].evidence.filter(proof => proof.field !== 'program.durationMonths')
    batch.entries[0].evidence.push({ field: 'program.durationText.zh', sourceId: source.id, quote: '学制：1学期或2学期。' })
    expect(assess()).toMatchObject({ ready: 1, held: 0 })
  })

  it('rejects an invented duration even when another duration quote is genuine', async () => {
    const { program, batch, source, assess } = await fixture()
    program.durationMonths = null
    program.durationText = { en: '4 months' }
    batch.entries[0].evidence.push({ field: 'program.durationText.en', sourceId: source.id, quote: '16 weeks' })
    expect(assess().entries[0].blockers).toContain('duration_text_not_in_official_evidence:en')
    expect(assess().ready).toBe(0)
  })

  it('still requires duration when both numeric months and official wording are absent', async () => {
    const { program, assess } = await fixture()
    program.durationMonths = null
    expect(assess().entries[0].blockers).toContain('incomplete_program_admissions')
    expect(assess().ready).toBe(0)
  })

  it('does not let a duration text proof replace numeric duration evidence', async () => {
    const { program, batch, source, assess } = await fixture()
    program.durationText = { en: '2 semesters' }
    batch.entries[0].evidence = batch.entries[0].evidence.filter(proof => proof.field !== 'program.durationMonths')
    batch.entries[0].evidence.push({ field: 'program.durationText.en', sourceId: source.id, quote: '2 semesters' })
    expect(assess().entries[0].blockers).toContain('field_evidence_missing:durationMonths')
  })

  it('applies a complete independently reviewed entry and records exact before/after rows', async () => {
    const { root, batch, catalogSha, program, cycle, snapshot } = await fixture()
    const before = await snapshot()
    const result = applyFullProgramBatch(root, batch, catalogSha, today)
    expect(result).toMatchObject({ appliedPrograms: 1, newPrograms: 1, assessment: { ready: 1, held: 0 } })
    expect(JSON.parse(await readFile(join(root, 'content/data/programs.json'), 'utf8'))).toEqual([program])
    expect(JSON.parse(await readFile(join(root, 'content/data/admission-cycles.json'), 'utf8'))).toEqual([cycle])
    const after = await snapshot()
    for (const index of [0, 1, 2, 5]) expect(after[index]).toBe(before[index])
    const receipt = JSON.parse(await readFile(join(root, 'quality/program-expansion-20261013/applied-' + batch.batchId + '.json'), 'utf8'))
    expect(receipt).toMatchObject({ status: 'local-snapshot-applied-awaiting-publication', originalCatalogSha256: catalogSha, appliedPrograms: 1, newPrograms: 1, before: [{ program: null, cycle: null }], after: [{ program, cycle }], snapshot: { filesReplaced: 6, atomicity: 'per-file-only' } })
    expect(receipt.baselineFileSha256.programs).toBe(sha(before[3]))
    expect(fetch).not.toHaveBeenCalled()
  })

  it('keeps the existing partial-eligibility selection while reserving only approved rows', async () => {
    const { root, batch, catalogSha, program, cycle } = await fixture()
    const held = structuredClone(batch.entries[0])
    held.program.id = 'held-program'; held.program.slug = 'held-program'
    held.cycle.id = 'held-cycle'; held.cycle.programId = held.program.id; held.reviewedAt = ''
    batch.entries.push(held)
    expect(applyFullProgramBatch(root, batch, catalogSha, today)).toMatchObject({ appliedPrograms: 1, assessment: { ready: 1, held: 1 } })
    expect(JSON.parse(await readFile(join(root, 'content/data/programs.json'), 'utf8'))).toEqual([program])
    expect(JSON.parse(await readFile(join(root, 'content/data/admission-cycles.json'), 'utf8'))).toEqual([cycle])
    const receipt = JSON.parse(await readFile(join(root, 'quality/program-expansion-20261013/applied-' + batch.batchId + '.json'), 'utf8'))
    expect(receipt.before).toHaveLength(1); expect(receipt.after).toHaveLength(1)
  })

  it('rolls back a real mid-snapshot rename failure and permanently rejects replay of the failed batch', async () => {
    const { root, batch, catalogSha, snapshot } = await fixture(), before = await snapshot()
    const original = snapshotWriter.applyCatalogSnapshotFiles
    let failedAttempts = 0
    const waitForRetry = vi.fn()
    const injected = vi.spyOn(snapshotWriter, 'applyCatalogSnapshotFiles').mockImplementation((baseline, next) => original(baseline, next, {
      platform: 'win32', waitForRetry, replaceFile: (source, target) => {
        if (source.endsWith('.snapshot-tmp') && target.endsWith('admission-cycles.json')) { failedAttempts++; throw Object.assign(Error('synthetic-cycle-sharing-lock'), { code: 'EPERM' }) }
        renameSync(source, target)
      },
    }))
    expect(() => applyFullProgramBatch(root, batch, catalogSha, today)).toThrow('synthetic-cycle-sharing-lock; external_changes_preserved=none; rollback_failures=none')
    injected.mockRestore()
    expect(failedAttempts).toBe(5); expect(waitForRetry.mock.calls).toEqual([[25], [50], [100], [150]])
    expect(await snapshot()).toEqual(before)
    const receiptPath = join(root, 'quality/program-expansion-20261013/applied-' + batch.batchId + '.json')
    const receiptBytes = await readFile(receiptPath), receipt = JSON.parse(receiptBytes.toString('utf8'))
    expect(receipt).toMatchObject({ status: 'snapshot-failed-reconciliation-required', originalCatalogSha256: catalogSha, before: [{ program: null, cycle: null }] })
    expect(receipt).not.toHaveProperty('appliedAt')
    expect(() => applyFullProgramBatch(root, batch, catalogSha, today)).toThrow('batch_already_applied')
    expect(await readFile(receiptPath)).toEqual(receiptBytes)
    expect(await snapshot()).toEqual(before)
  })

  it('rejects an applied batch with the latest catalogue hash without changing data or its receipt', async () => {
    const { root, batch, catalogSha, catalog, snapshot } = await fixture()
    expect(applyFullProgramBatch(root, batch, catalogSha, today)).toMatchObject({ appliedPrograms: 1, newPrograms: 1 })
    const programPath = join(root, 'content/data/programs.json')
    const latestPrograms = JSON.parse(await readFile(programPath, 'utf8')) as Program[]
    latestPrograms[0].name.en = 'Synthetic Robotics — later approved name'
    await writeFile(programPath, JSON.stringify(latestPrograms, null, 2) + '\n')
    const current = await snapshot()
    const currentCatalog = bundleSchema.parse({ ...catalog, sources: JSON.parse(current[0]), programs: JSON.parse(current[3]), admissionCycles: JSON.parse(current[4]) })
    const currentSha = sha(JSON.stringify(currentCatalog))
    expect(currentSha).not.toBe(catalogSha)
    const protectedPaths = ['sources', 'programs', 'admission-cycles'].map(name => join(root, 'content/data', name + '.json'))
    protectedPaths.push(join(root, 'quality/program-expansion-20261013/applied-' + batch.batchId + '.json'))
    const before = await Promise.all(protectedPaths.map(path => readFile(path)))

    expect(() => applyFullProgramBatch(root, batch, currentSha, today)).toThrow('batch_already_applied')

    expect(await Promise.all(protectedPaths.map(path => readFile(path)))).toEqual(before)
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['raw', 'text'] as const)('holds changed %s bytes even if every quote and record remains plausible', async kind => {
    const { root, batch, catalogSha, snapshot } = await fixture()
    await writeFile(join(root, kind === 'raw' ? 'official.html' : 'official.txt'), visibleText + '\nChanged after independent review.')
    const before = await snapshot()
    const result = applyFullProgramBatch(root, batch, catalogSha, today)
    expect(result).toMatchObject({ appliedPrograms: 0, newPrograms: 0, assessment: { held: 1, ready: 0 } })
    expect(result.assessment.entries[0].blockers).toContain('fresh_captured_source_missing')
    expect(await snapshot()).toEqual(before)
    await expect(readFile(join(root, 'quality/program-expansion-20261013/applied-' + batch.batchId + '.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('holds missing application materials even when a matching materials quote is still supplied', async () => {
    const { program, assess } = await fixture()
    delete program.supplementaryDetails!.applicationMaterials
    expect(assess().entries[0].blockers).toContain('application_materials_missing')
    expect(assess().ready).toBe(0)
  })

  it('holds an unsupported quote without treating a valid hash as factual support', async () => {
    const { batch, assess } = await fixture()
    batch.entries[0].evidence.find(proof => proof.field === 'cycle.applicationFeeCny')!.quote = 'Application fee is waived for all international students.'
    expect(assess().entries[0].blockers).toContain('quote_not_in_official_capture:applicationFeeCny')
    expect(assess().ready).toBe(0)
  })

  it('rejects evidence from an official source that is not bound to the program or cycle', async () => {
    const { batch, source, assess } = await fixture()
    batch.sources.push({ ...source, id: 'unrelated-source' })
    batch.captures.push({ ...batch.captures[0], sourceId: 'unrelated-source' })
    batch.entries[0].evidence.find(proof => proof.field === 'program.durationMonths')!.sourceId = 'unrelated-source'
    expect(assess().entries[0].blockers).toContain('quote_not_in_official_capture:durationMonths')
  })

  it('keeps official reference tuition private until the batch has explicit authorization', async () => {
    const { batch, assess } = await fixture()
    referenceTuition(batch)
    expect(assess().entries[0].blockers).toContain('incomplete_reviewed_fees')
    batch.allowOfficialReferenceTuition = true
    expect(assess()).toMatchObject({ ready: 1, held: 0 })
  })

  it.each(['notes', 'cycle-specific scope', 'status proof', 'record-bound status proof', 'verbatim status proof'] as const)('does not let reference authorization replace %s', async missing => {
    const { batch, source, assess } = await fixture()
    referenceTuition(batch)
    batch.allowOfficialReferenceTuition = true
    if (missing === 'notes') delete batch.entries[0].cycle.notes
    if (missing === 'cycle-specific scope') batch.entries[0].cycle.evidenceBasis = 'recurring-official-rule'
    if (missing === 'status proof') batch.entries[0].evidence = batch.entries[0].evidence.filter(proof => proof.field !== 'cycle.tuitionStatus')
    if (missing === 'record-bound status proof') {
      batch.sources.push({ ...source, id: 'unrelated-source' })
      batch.captures.push({ ...batch.captures[0], sourceId: 'unrelated-source' })
      batch.entries[0].evidence.find(proof => proof.field === 'cycle.tuitionStatus')!.sourceId = 'unrelated-source'
    }
    if (missing === 'verbatim status proof') batch.entries[0].evidence.find(proof => proof.field === 'cycle.tuitionStatus')!.quote = 'This is definitely the final confirmed tuition.'
    expect(assess().entries[0].blockers).toContain('incomplete_reviewed_fees')
    expect(assess().ready).toBe(0)
  })

  it('requires the staged tuition schedule to retain its own official evidence', async () => {
    const { cycle, batch, source, assess } = await fixture()
    cycle.tuitionCny = 150000
    cycle.tuitionSchedule = { en: 'First year 150000 RMB; second and third years 30000 RMB each.' }
    batch.entries[0].evidence.find(proof => proof.field === 'cycle.tuitionCny')!.quote = 'first year 150000 RMB'
    expect(assess().entries[0].blockers).toContain('field_evidence_missing:tuitionSchedule')
    batch.entries[0].evidence.push({ field: 'cycle.tuitionSchedule.en', sourceId: source.id, quote: 'Variable tuition: first year 150000 RMB; second and third years 30000 RMB each.' })
    expect(assess()).toMatchObject({ ready: 1, held: 0 })
  })

  it.each(['stale capture', 'future capture', 'stale review', 'future review'] as const)('holds %s instead of renewing evidence from its record status', async invalid => {
    const { batch, assess } = await fixture()
    const date = invalid.startsWith('stale') ? new Date(now.getTime() - 25 * 60 * 60_000) : new Date(now.getTime() + 60_000)
    if (invalid.endsWith('capture')) batch.captures[0].retrievedAt = date.toISOString()
    else batch.entries[0].reviewedAt = date.toISOString()
    expect(assess().entries[0].blockers).toContain(invalid.endsWith('capture') ? 'fresh_captured_source_missing' : 'independent_review_missing')
    expect(assess().ready).toBe(0)
  })

  it('holds an application cycle whose published deadline has passed', async () => {
    const { cycle, assess } = await fixture()
    cycle.closesOn = '2026-10-13'
    expect(assess().entries[0].blockers).toContain('no_current_application_cycle')
  })

  it('holds identity-only programs and unpublished parent universities', async () => {
    const { program, catalog, assess } = await fixture()
    program.verificationScope = 'identity'
    catalog.universities[0].status = 'draft'
    expect(assess().entries[0].blockers).toEqual(expect.arrayContaining(['program_not_current_fact_review', 'parent_university_not_public']))
    expect(assess().ready).toBe(0)
  })

  it('rejects canonical changes before writing any collection or approval receipt', async () => {
    const { root, batch, catalogSha, catalog, snapshot } = await fixture()
    catalog.universities[0].name.en = 'Changed by another reviewer'
    await writeFile(join(root, 'content/data/universities.json'), JSON.stringify(catalog.universities, null, 2) + '\n')
    const before = await snapshot()
    expect(() => applyFullProgramBatch(root, batch, catalogSha, today)).toThrow('canonical_catalog_changed')
    expect(await snapshot()).toEqual(before)
    await expect(readFile(join(root, 'quality/program-expansion-20261013/applied-' + batch.batchId + '.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(fetch).not.toHaveBeenCalled()
  })
})
