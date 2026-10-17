import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { bundleSchema, programSchema, admissionCycleSchema, sourceSchema } from '../../src/lib/data/schema'
import { getTodayDate } from '../../src/lib/data/freshness'
import type { AdmissionCycle, DataBundle, Program, Source } from '../../src/lib/data/types'

export type FieldEvidence = { field: string; sourceId: string; quote: string; locator?: string; derivation?: string }
export type Capture = { sourceId: string; url: string; rawPath: string; rawSha256: string; textPath: string; textSha256: string; retrievedAt: string; httpStatus: number }
export type FullProgramEntry = { program: Program; cycle: AdmissionCycle; evidence: FieldEvidence[]; reviewedAt: string; reviewer: 'codex'; notes?: string }
export type FullProgramBatch = { schemaVersion: 1; batchId: string; allowOfficialReferenceTuition?: boolean; sources: Source[]; captures: Capture[]; entries: FullProgramEntry[] }
const digest = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex')
const normalized = (value: string) => value.normalize('NFKC').replace(/\s+/gu, ' ').trim()
const requiredFields = ['name', 'degreeLevel', 'teachingLanguages', 'durationMonths', 'applyUrl', 'languageRequirements', 'eligibility', 'applicationMaterials', 'closesOn', 'tuitionCny', 'tuitionPeriod', 'applicationFeeCny']

function localFile(root: string, name: string): Buffer {
  if (isAbsolute(name)) throw Error('evidence_path_absolute')
  const target = resolve(root, name), rel = relative(root, target)
  if (rel === '..' || rel.startsWith('..' + sep)) throw Error('evidence_path_outside_workspace')
  return readFileSync(target)
}

export function assessFullProgramBatch(root: string, batch: FullProgramBatch, catalog: DataBundle, today = getTodayDate()) {
  if (batch.schemaVersion !== 1 || !/^[a-z0-9-]{1,80}$/.test(batch.batchId) || !Array.isArray(batch.entries)) throw Error('batch_contract_invalid')
  const texts = new Map<string, string>(), failedSources = new Set<string>()
  const sources = new Map(catalog.sources.map(source => [source.id, source]))
  for (const source of batch.sources) sources.set(source.id, sourceSchema.parse(source))
  for (const capture of batch.captures) {
    try {
      const source = sources.get(capture.sourceId)
      if (!source?.official || source.url !== capture.url || capture.httpStatus !== 200 || !Number.isFinite(Date.parse(capture.retrievedAt))
        || Date.now() - Date.parse(capture.retrievedAt) > 24 * 60 * 60_000 || Date.parse(capture.retrievedAt) > Date.now() + 5000) throw Error('capture_invalid')
      const raw = localFile(root, capture.rawPath), text = localFile(root, capture.textPath)
      if (digest(raw) !== capture.rawSha256 || digest(text) !== capture.textSha256 || text.length === 0) throw Error('capture_hash_invalid')
      texts.set(source.id, normalized(text.toString('utf8')))
    } catch { failedSources.add(capture.sourceId) }
  }
  const universityIds = new Set(catalog.universities.filter(university => university.status === 'verified' && university.reviewAfter >= today && university.verifiedAt <= today).map(item => item.id))
  const seen = new Set<string>()
  const entries = batch.entries.map(entry => {
    const blockers: string[] = [], p = entry.program, cycle = entry.cycle
    if (!programSchema.safeParse(p).success || !admissionCycleSchema.safeParse(cycle).success) blockers.push('schema_invalid')
    if (seen.has(p.id)) blockers.push('duplicate_program_id'); seen.add(p.id)
    if (!universityIds.has(p.universityId)) blockers.push('parent_university_not_public')
    if (p.status !== 'verified' || p.verificationScope === 'identity' || p.verifiedAt > today || p.reviewAfter < today) blockers.push('program_not_current_fact_review')
    if (!p.teachingLanguages.length || p.durationMonths === null || !p.applyUrl || !p.languageRequirements.length) blockers.push('incomplete_program_admissions')
    if (!p.supplementaryDetails?.eligibility?.length && !p.details?.eligibility?.length) blockers.push('academic_eligibility_missing')
    if (!p.supplementaryDetails?.applicationMaterials?.length && !p.details?.applicationMaterials?.length) blockers.push('application_materials_missing')
    if (cycle.programId !== p.id || cycle.status !== 'verified' || cycle.verifiedAt > today || cycle.reviewAfter < today || cycle.factScope !== 'complete') blockers.push('cycle_not_current_complete')
    const permittedReference = batch.allowOfficialReferenceTuition === true && cycle.tuitionStatus === 'reference'
      && cycle.evidenceBasis === 'cycle-specific' && Boolean(cycle.notes)
      && entry.evidence.some(proof => /tuitionStatus$/u.test(proof.field)
        && recordSourceProof(proof, p, cycle, texts))
    if (cycle.tuitionCny === null || !cycle.tuitionPeriod || cycle.tuitionStatus !== 'confirmed' && !permittedReference || cycle.applicationFeeCny === null) blockers.push('incomplete_reviewed_fees')
    if (!['published', 'rolling'].includes(cycle.dateStatus) || cycle.closesOn !== null && cycle.closesOn < today) blockers.push('no_current_application_cycle')
    if (cycle.dateStatus === 'published' && cycle.closesOn === null) blockers.push('deadline_missing')
    if (entry.reviewer !== 'codex' || !Number.isFinite(Date.parse(entry.reviewedAt)) || Date.now() - Date.parse(entry.reviewedAt) > 24 * 60 * 60_000 || Date.parse(entry.reviewedAt) > Date.now() + 5000) blockers.push('independent_review_missing')
    const recordSources = new Set([...p.sourceIds, ...cycle.sourceIds])
    if ([...recordSources].some(id => failedSources.has(id) || !texts.has(id))) blockers.push('fresh_captured_source_missing')
    for (const field of [...requiredFields, ...(cycle.tuitionSchedule ? ['tuitionSchedule'] : [])]) {
      if (field === 'closesOn' && cycle.dateStatus === 'rolling') continue
      const proofs = entry.evidence.filter(item => {
        const key = item.field.replace(/^(program|cycle)\./u, '').replace(/^(supplementaryDetails|details)\./u, '').replace(/\[.*$/u, '')
        return key === field || key.startsWith(field + '.')
      })
      if (!proofs.length) { blockers.push('field_evidence_missing:' + field); continue }
      if (!proofs.some(proof => recordSources.has(proof.sourceId) && normalized(proof.quote).length > 0 && texts.get(proof.sourceId)?.includes(normalized(proof.quote)))) blockers.push('quote_not_in_official_capture:' + field)
    }
    return { ...entry, blockers: [...new Set(blockers)], ready: blockers.length === 0 }
  })
  return { batchId: batch.batchId, assessedAt: new Date().toISOString(), today, entries, ready: entries.filter(item => item.ready).length, held: entries.filter(item => !item.ready).length }
}

function recordSourceProof(proof: FieldEvidence, program: Program, cycle: AdmissionCycle, texts: Map<string, string>): boolean {
  return [...program.sourceIds, ...cycle.sourceIds].includes(proof.sourceId)
    && normalized(proof.quote).length > 0 && Boolean(texts.get(proof.sourceId)?.includes(normalized(proof.quote)))
}

export function applyFullProgramBatch(root: string, batch: FullProgramBatch, expectedCatalogSha256: string, today = getTodayDate()) {
  const read = (name: string) => JSON.parse(readFileSync(resolve(root, 'content/data/' + name + '.json'), 'utf8'))
  const catalog = bundleSchema.parse({ sources: read('sources'), cities: read('cities'), universities: read('universities'), programs: read('programs'), admissionCycles: read('admission-cycles'), scholarships: read('scholarships') })
  const originalSha = digest(JSON.stringify(catalog))
  if (originalSha !== expectedCatalogSha256) throw Error('canonical_catalog_changed')
  const assessment = assessFullProgramBatch(root, batch, catalog, today), approved = assessment.entries.filter(item => item.ready)
  if (!approved.length) return { assessment, appliedPrograms: 0, newPrograms: 0 }
  const programs = new Map(catalog.programs.map(item => [item.id, item])), cycles = new Map(catalog.admissionCycles.map(item => [item.id, item])), sources = new Map(catalog.sources.map(item => [item.id, item]))
  let newPrograms = 0
  for (const entry of approved) { if (!programs.has(entry.program.id)) newPrograms++; programs.set(entry.program.id, entry.program); cycles.set(entry.cycle.id, entry.cycle) }
  const needed = new Set(approved.flatMap(entry => [...entry.program.sourceIds, ...entry.cycle.sourceIds]))
  for (const source of batch.sources) if (needed.has(source.id)) sources.set(source.id, source)
  const next = bundleSchema.parse({ ...catalog, programs: [...programs.values()], admissionCycles: [...cycles.values()], sources: [...sources.values()] })
  const changes = { sources: next.sources, programs: next.programs, 'admission-cycles': next.admissionCycles }
  // All validation precedes writes. Preserve exact before/after rows in the receipt.
  const receipt = { batchId: batch.batchId, appliedAt: new Date().toISOString(), originalCatalogSha256: originalSha, nextCatalogSha256: digest(JSON.stringify(next)), assessment, appliedPrograms: approved.length, newPrograms,
    before: approved.map(entry => ({ program: catalog.programs.find(p => p.id === entry.program.id) ?? null, cycle: catalog.admissionCycles.find(c => c.id === entry.cycle.id) ?? null })), after: approved.map(entry => ({ program: entry.program, cycle: entry.cycle })) }
  const receiptPath = resolve(root, 'quality/program-expansion-20261013/applied-' + batch.batchId + '.json')
  mkdirSync(dirname(receiptPath), { recursive: true })
  for (const [name, values] of Object.entries(changes)) writeFileSync(resolve(root, 'content/data/' + name + '.json'), JSON.stringify(values, null, 2) + '\n')
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n')
  return { assessment, appliedPrograms: approved.length, newPrograms }
}

function main() {
 const root=process.cwd(), args=process.argv.slice(2), file=args[0]
 if (!file || args.some(arg=>arg.startsWith('--') && arg!=='--apply')) throw Error('usage: batch.json [--apply catalogSha256]')
 const batch=JSON.parse(readFileSync(resolve(root,file),'utf8')) as FullProgramBatch
 const read=(name:string)=>JSON.parse(readFileSync(resolve(root,'content/data/'+name+'.json'),'utf8'))
 const catalog=bundleSchema.parse({sources:read('sources'),cities:read('cities'),universities:read('universities'),programs:read('programs'),admissionCycles:read('admission-cycles'),scholarships:read('scholarships')})
 if(args.includes('--apply')) { const result=applyFullProgramBatch(root,batch,args[args.indexOf('--apply')+1]); console.log(JSON.stringify({appliedPrograms:result.appliedPrograms,newPrograms:result.newPrograms,held:result.assessment.held})) }
 else { const assessment=assessFullProgramBatch(root,batch,catalog); const output=resolve(root,'quality/program-expansion-20261013/assessment-'+batch.batchId+'.json');mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(assessment,null,2)+'\n');console.log(JSON.stringify({ready:assessment.ready,held:assessment.held,catalogSha256:digest(JSON.stringify(catalog)),assessment:output})) }
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) { try { main() } catch(error) { console.error(error instanceof Error?error.message:'full_program_batch_failed');process.exitCode=1 } }
