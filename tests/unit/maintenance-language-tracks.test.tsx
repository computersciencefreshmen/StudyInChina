import { createHash, webcrypto } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { discoverAdmissionCycles, parseDiscoveredCycles } from '../../workers/catalog-maintenance/src/cycle-discovery'
import { parseFieldExtraction } from '../../workers/catalog-maintenance/src/field-updates'
import type { CapturedSnapshot } from '../../workers/catalog-maintenance/src/capture'
import type { JobRow, MaintenanceEnv, ModelRequest, SourceRow } from '../../workers/catalog-maintenance/src/types'
import { buildMaintenanceScope, catalogSha256, loadMaintenanceBundle } from '../../scripts/maintenance/build-scope'
import { importAdmissionCycleCandidates } from '../../scripts/maintenance/import-cycles'
import { exportContentSha256 } from '../../scripts/maintenance/contracts'
import type { MaintenanceRecordTarget } from '../../scripts/maintenance/field-contracts'
import { fieldRecordScopeSha256 } from '../../src/lib/data/field-verification'
import { selectPublishedData } from '../../src/lib/data/publication'
import { selectDiscoveryData } from '../../src/lib/data/discovery'
import { annualCycleIdentityKey } from '../../src/lib/data/cycle-scope'
import { parseProgramCatalogFilters, queryProgramCatalog } from '../../src/lib/program-catalog'
import { getProgramCycleDisplayDetails } from '../../src/lib/data/program-details'
import { selectAdmissionCycle } from '../../src/lib/data/admission'
import { AdmissionTrackCards } from '../../src/components/features/AdmissionTrackCards'
import { CatalogApiService, releaseFromBundle } from '../../src/lib/catalog-api/service'
import type { DataBundle } from '../../src/lib/data/types'

const day = '2026-10-24', capturedAt = `${day}T00:00:00.000Z`, hash = (value: string) => createHash('sha256').update(value).digest('hex')
let original: DataBundle
beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(`${day}T00:30:00.000Z`)); vi.stubGlobal('crypto', webcrypto); original = loadMaintenanceBundle(process.cwd()) })
afterAll(() => { vi.useRealTimers() })
async function fixture() {
  const selected = selectPublishedData(original, day).programs.find(program => program.degreeLevel === 'master' && program.name.en)!
  const bundle = structuredClone({ ...original, programs: [{ ...selected, teachingLanguages: ['English', 'Chinese'] }], admissionCycles: [], scholarships: [] })
  delete bundle.programs[0].details
  const program = bundle.programs[0], scope = await buildMaintenanceScope(original, { scopeId: 'language-tracks', createdAt: capturedAt })
  const school = scope.schools.find(school => school.universityId === program.universityId)!, url = `https://${school.officialHosts[0]}/tracks.txt`, sourceId = hash(url)
  const make = (teachingLanguage: 'English' | 'Chinese', applicationRound = 'Round 1') => {
    const requirement = teachingLanguage === 'English' ? { test: 'IELTS', minimum: '6.5' } : { test: 'HSK', minimum: '5' }
    const line = `${teachingLanguage} ${applicationRound}: Autumn 2028 admissions for Master ${program.name.en}. Application opens 2027-11-01; application deadline 2028-04-30. ${requirement.test} ${requirement.minimum}.`
    return { programId: program.id, academicYear: '2028-2029', intake: 'autumn' as const, teachingLanguage, applicationRound,
      programQuote: `Master ${program.name.en}.`, internationalQuote: 'International students', cycleScopeQuote: line,
      patches: [{ fieldPath: 'opensOn', value: '2027-11-01', factStatus: 'known', quote: line },
        { fieldPath: 'closesOn', value: '2028-04-30', factStatus: 'known', quote: line },
        { fieldPath: 'dateStatus', value: 'published', factStatus: 'known', quote: line },
        { fieldPath: 'languageRequirements', value: [requirement], factStatus: 'known', quote: line }] }
  }
  const english = make('English'), chinese = make('Chinese'), nextRound = make('English', 'Round 2')
  const text = `International students: Master ${program.name.en}.\n${[english, chinese, nextRound].map(cycle => cycle.cycleScopeQuote).join('\n')}`
  const objects = new Map<string, string>([['text.txt', text], ['raw.txt', text]])
  const snapshot: CapturedSnapshot = { version: 1, sourceId, sourceUrl: url, finalUrl: url, checkedAt: capturedAt, contentType: 'text/plain', rawSha256: hash(text), rawKey: 'raw.txt', textKey: 'text.txt', textSha256: hash(text), canonicalSha256: hash(text), parserCandidates: [] }
  const target: MaintenanceRecordTarget = { recordId: program.id, entityType: 'program', universityId: program.universityId, sourceIds: [sourceId], recordScopeSha256: fieldRecordScopeSha256('program', program), identity: { name: program.name, degreeLevel: program.degreeLevel, teachingLanguages: program.teachingLanguages }, year: null, intake: null, fields: {}, reviewAfter: day }
  const env = { SNAPSHOTS_BUCKET: { get: async (key: string) => objects.has(key) ? { text: async () => objects.get(key)! } : null, put: async (key: string, value: string) => { objects.set(key, value) } } } as unknown as MaintenanceEnv
  const row = { source_id: sourceId, url } as SourceRow, job = { job_id: 'track-test', source_id: sourceId, snapshot_sha256: snapshot.rawSha256 } as JobRow
  return { bundle, program, scope, text, objects, snapshot, target, env, row, job, english, chinese, nextRound }
}

describe('annual teaching-language and application-round isolation', () => {
  it('keeps the old identity key and proof hash for unscoped cycles; separates every language and round', () => {
    expect(annualCycleIdentityKey('p', '2027-2028', 'autumn')).toBe('p|2027-2028|autumn')
    const keys = ['English', 'Chinese'].flatMap(teachingLanguage => ['Round 1', 'Round 2'].map(applicationRound => annualCycleIdentityKey('p', '2027-2028', 'autumn', { teachingLanguage, applicationRound })))
    expect(new Set(keys).size).toBe(4)
  })
  it('holds ambiguous multilingual scopes and a Chinese condition incorrectly assigned to English', async () => {
    const f = await fixture(), missing = { ...f.english, teachingLanguage: undefined }
    expect(parseDiscoveredCycles({ cycles: [missing] }, f.text, [f.target], f.snapshot).size).toBe(0)
    const mixed = { ...f.english, patches: [...f.english.patches.slice(0, 3), f.chinese.patches[3]] }
    expect(parseDiscoveredCycles({ cycles: [mixed] }, f.text, [f.target], f.snapshot).size).toBe(0)
    const wholeDocumentQuote = { ...f.english, patches: f.english.patches.map(patch => ({ ...patch, quote: f.text })) }
    expect(parseDiscoveredCycles({ cycles: [wholeDocumentQuote] }, f.text, [f.target], f.snapshot).size).toBe(0)
  })
  it('suppresses global requirements when a single-language programme has several annual rounds', async () => {
    const f = await fixture(), program = { ...f.program, teachingLanguages: ['English'], supplementaryDetails: { eligibility: [{ en: 'Global condition from a different round' }] } }
    expect(getProgramCycleDisplayDetails(program, undefined, day)?.eligibility).toHaveLength(1)
    expect(getProgramCycleDisplayDetails(program, undefined, day, true)?.eligibility).toEqual([])
  })
  it('rejects maintenance output scoped to the wrong teaching language or round', async () => {
    const f = await fixture(), target = { ...f.target, entityType: 'admission-cycle' as const, recordId: 'cycle-en', year: '2028-2029', intake: 'autumn', identity: { ...f.target.identity, teachingLanguage: 'English', applicationRound: 'Round 1' } }
    const record = { recordId: target.recordId, year: target.year, intake: target.intake, teachingLanguage: 'English', applicationRound: 'Round 1', applicabilityQuote: f.english.programQuote, scopeQuote: f.english.cycleScopeQuote, patches: [f.english.patches[3]] }
    expect(parseFieldExtraction({ records: [record] }, f.text, [target]).size).toBe(1)
    expect(parseFieldExtraction({ records: [record, { ...record, patches: [f.chinese.patches[3]] }] }, f.text, [target]).size).toBe(0)
    expect(parseFieldExtraction({ records: [{ ...record, teachingLanguage: 'Chinese' }] }, f.text, [target]).size).toBe(0)
    expect(parseFieldExtraction({ records: [{ ...record, applicationRound: 'Round 2' }] }, f.text, [target]).size).toBe(0)
    expect(parseFieldExtraction({ records: [{ ...record, patches: [f.chinese.patches[3]] }] }, f.text, [target]).size).toBe(0)
  })
  it('extracts, independently reviews, imports and exposes three distinct tracks without changing the programme ID', async () => {
    const f = await fixture(), requests: ModelRequest[] = []
    const engine = await discoverAdmissionCycles(f.env, f.job, f.row, f.snapshot, [f.target], async (_env, request) => {
      requests.push(request); return { attemptId: request.pass, output: { cycles: [f.english, f.chinese, f.nextRound] }, artifactKey: `model/${request.pass}`, artifactSha256: hash(request.pass), reused: false }
    })
    expect(requests).toHaveLength(2); expect(engine.held).toEqual([]); expect(engine.proposals).toHaveLength(3)
    const content = { format: 'studyinchina.maintenance-candidate-export' as const, formatVersion: 1 as const, batchId: 'tracks', inputCatalogSha256: await catalogSha256(f.bundle), scopeRegistrySha256: f.scope.sha256, createdAt: capturedAt, proposals: engine.proposals }
    const result = await importAdmissionCycleCandidates({ bundle: f.bundle, scope: f.scope, batch: { ...content, sha256: await exportContentSha256(content) }, acceptedAt: `${day}T01:00:00.000Z`, identities: [], cycleReceiptPath: 'quality/tracks.json', fieldReceiptPath: 'quality/track-fields.json', readArtifact: async key => new TextEncoder().encode(f.objects.get(key)!) })
    expect(result.cycleReceipt.held).toEqual([]); expect(result.cycleReceipt.accepted).toHaveLength(3)
    expect(result.bundle.programs).toEqual(f.bundle.programs)
    const directory = selectDiscoveryData(result.bundle, day, [], result.entries), cycles = directory.admissionCycles
    expect(cycles).toHaveLength(3)
    expect(cycles.filter(cycle => cycle.teachingLanguage === 'English').every(cycle => cycle.languageRequirements?.[0].test === 'IELTS')).toBe(true)
    expect(cycles.find(cycle => cycle.teachingLanguage === 'Chinese')?.languageRequirements?.[0].test).toBe('HSK')
    expect(selectAdmissionCycle(cycles, f.program.id, day)).toBeUndefined()
    expect(selectAdmissionCycle(cycles, f.program.id, day, { teachingLanguage: 'Chinese', applicationRound: 'Round 1' })?.languageRequirements?.[0].test).toBe('HSK')
    const api = new CatalogApiService(directory, releaseFromBundle(directory, day), day)
    expect(api.getProgramCycles(f.program.slug)?.data.filter(cycle => cycle.teachingLanguage === 'English')).toHaveLength(2)
    expect(api.getProgram(f.program.slug)?.data.languageRequirements).toBeNull()
    const html = renderToStaticMarkup(<AdmissionTrackCards program={f.program} cycles={cycles} sources={directory.sources} locale="en" today={day} />)
    expect(html).toContain('Round 2'); expect(html).toContain('IELTS: 6.5'); expect(html).toContain('HSK: 5')
    const withUnreviewedSibling = cycles.map(cycle => ({ ...cycle, eligibility: [{ en: 'Unreviewed sibling MUST stay private' }] }))
    expect(renderToStaticMarkup(<AdmissionTrackCards program={f.program} cycles={withUnreviewedSibling} sources={directory.sources} locale="en" today={day} />)).not.toContain('Unreviewed sibling')
    const priced = structuredClone(directory)
    for (const cycle of priced.admissionCycles) {
      cycle.tuitionCny = cycle.teachingLanguage === 'Chinese' ? 10000 : 30000; cycle.tuitionPeriod = 'academic-year'; cycle.tuitionStatus = 'confirmed'
      const fresh = cycle as typeof cycle & { discovery: { currentFieldPaths: string[] } }; fresh.discovery.currentFieldPaths.push('tuitionCny', 'tuitionPeriod', 'tuitionStatus')
    }
    const pricedApi = new CatalogApiService(priced, releaseFromBundle(priced, day), day)
    expect(pricedApi.listPrograms({ language: 'English', tuitionMax: 20000 }).data).toHaveLength(0)
    expect(pricedApi.listPrograms({ language: 'Chinese', tuitionMax: 20000 }).data).toHaveLength(1)
    expect(queryProgramCatalog(priced, parseProgramCatalogFilters({ language: 'English', tuition: 'under-20000' }), day).total).toBe(0)
    expect(queryProgramCatalog(priced, parseProgramCatalogFilters({ language: 'Chinese', tuition: 'under-20000' }), day).total).toBe(1)
    const languageProof = result.entries.find(entry => entry.fieldPath === 'languageRequirements')!
    const wrongScope = structuredClone(result.bundle); wrongScope.admissionCycles.find(cycle => cycle.id === languageProof.recordId)!.teachingLanguage = 'Chinese'
    const projected = selectDiscoveryData(wrongScope, day, [], result.entries)
    expect(projected.admissionCycles.find(cycle => cycle.id === languageProof.recordId)?.languageRequirements).toBeUndefined()
  })
})
