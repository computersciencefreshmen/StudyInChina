import assert from 'node:assert/strict'
import test from 'node:test'
import { buildProgramCoverage, concreteProgramKeys, refreshCloudProgramCoverage } from '../../../scripts/maintenance/program-coverage'
import { loadMaintenanceBundle, catalogSha256 } from '../../../scripts/maintenance/build-scope'
import { readMaintenanceScope } from '../../../scripts/maintenance/scope-registry'
import type { MaintenanceScope } from '../../../scripts/maintenance/contracts'
import type { DataBundle, Program, AdmissionCycle, Scholarship } from '../../../src/lib/data/types'
import { identityFingerprint } from '../../../src/lib/data/identity-acceptance'
import { fieldRecordScopeSha256, fieldValueSha256, type FieldVerification } from '../../../src/lib/data/field-verification'
import { readCoverageSnapshot, submitCoverageSnapshot, validateCoverageSnapshot } from '../src/coverage'
import { seed, refreshTargets, setControls, enqueueDue } from '../src/repository'
import { listSchoolProgress } from '../src/school-progress'
import { selectScheduledJobs } from '../src/scheduling'
import { digest, canonical } from '../src/util'
import { getTodayDate } from '../../../src/lib/data/freshness'
import { makeEnv, seedInput, TEST_SCOPE, TEST_CATALOG, TEST_GUARDS } from './fixture'

const today = '2026-11-11'
function fixture() {
  const original = loadMaintenanceBundle(process.cwd()), audit = { status: 'verified' as const, verifiedAt: today, reviewAfter: '2026-11-13', sourceIds: ['official'] }
  const university = { ...original.universities[0], ...audit }, city = { ...original.cities.find(city => city.id === university.cityId)!, ...audit }
  const names = ['Physics', 'Chemistry', 'Computer Science', 'Economics', 'Mathematics', 'Physics (English-taught)', 'Undergraduate Programs']
  const programs: Program[] = names.map((en, index) => ({ ...original.programs[0], ...audit, id: `test-program-${index}`, slug: `test-program-${index}`,
    universityId: university.id, name: { en }, verificationScope: 'facts' as const, durationMonths: 48,
    supplementaryDetails: { eligibility: [{ en: 'Applicants must hold a high-school diploma.' }] },
    teachingLanguages: ['English'], languageRequirements: [{ test: 'IELTS' as const, minimum: '6.5' }], applyUrl: 'https://example.edu/apply' }))
  const admissionCycles: AdmissionCycle[] = programs.map(program => ({ ...original.admissionCycles[0], ...audit, id: `cycle-${program.id}`, programId: program.id,
    academicYear: '2027-2028', closesOn: '2027-06-01', dateStatus: 'published' as const }))
  const bundle: DataBundle = { ...original, sources: [{ ...original.sources[0], id: 'official', official: true, url: 'https://example.edu/guide' }], cities: [city], universities: [university], programs, admissionCycles, scholarships: [] }
  const scope = { sha256: TEST_SCOPE, schools: [{ universityId: university.id }] } as unknown as MaintenanceScope
  return { bundle, scope }
}
test('counts five distinct specific programmes; bilingual language tracks and generic catalogues cannot inflate it', async () => {
  const { bundle, scope } = fixture(), before = JSON.stringify(bundle)
  const snapshot = await buildProgramCoverage(bundle, scope, today)
  assert.equal(snapshot.schools[0].rawProgramCount, 7)
  assert.equal(snapshot.schools[0].directoryProgramCount, 5)
  assert.equal(snapshot.schools[0].currentProgramCount, 5)
  assert.equal(snapshot.schools[0].gap, 0)
  assert.equal(snapshot.schools[0].coverageBand, 'five-plus')
  assert.deepEqual(concreteProgramKeys(bundle.programs[5]), concreteProgramKeys(bundle.programs[0]))
  assert.equal(JSON.stringify(bundle), before)
  assert.equal((await buildProgramCoverage(bundle, scope, '2026-11-14')).schools[0].currentProgramCount, 0)
})
test('a stale identity counts only after independently scoped programme leaves and an annual cycle are restored', async () => {
  const { bundle, scope } = fixture(); bundle.programs = [bundle.programs[0]]; bundle.admissionCycles = [bundle.admissionCycles[0]]
  const program = bundle.programs[0], cycle = bundle.admissionCycles[0]
  program.status = 'stale'; cycle.status = 'stale'
  const identity = { entityType: 'program' as const, recordId: program.id, identitySha256: identityFingerprint('program', program), sourceIds: ['official'],
    acceptedAt: `${today}T00:00:00.000Z`, reviewer: 'reviewer', receiptPath: 'quality/review.json', receiptSha256: '1'.repeat(64) }
  const fields = ['applyUrl', 'teachingLanguages', 'durationMonths', 'languageRequirements', 'supplementaryDetails.eligibility'].map(fieldPath => {
    const value = fieldPath === 'supplementaryDetails.eligibility' ? program.supplementaryDetails?.eligibility : (program as unknown as Record<string, unknown>)[fieldPath]
    return { entityType: 'program' as const, recordId: program.id, recordScopeSha256: fieldRecordScopeSha256('program', program), fieldPath, value, valueSha256: fieldValueSha256(value), factStatus: 'known' as const,
      sourceId: 'official', sourceUrl: bundle.sources[0].url, snapshotSha256: '1'.repeat(64), objectKey: 'raw/guide', locator: 'section:1', quote: 'Official details', verifiedAt: `${today}T00:00:00.000Z`, reviewAfter: '2026-11-13',
      review: { method: 'independent' as const, reviewerId: 'reviewer' }, receiptPath: 'quality/field.json', receiptSha256: '2'.repeat(64) }
  }) as FieldVerification[]
  fields.push({ ...fields[0], entityType: 'admissionCycle', recordId: cycle.id, recordScopeSha256: fieldRecordScopeSha256('admissionCycle', cycle), fieldPath: 'closesOn', value: cycle.closesOn,
    valueSha256: fieldValueSha256(cycle.closesOn) })
  assert.equal((await buildProgramCoverage(bundle, scope, today, [identity])).schools[0].currentProgramCount, 0)
  assert.equal((await buildProgramCoverage(bundle, scope, today, [identity], fields)).schools[0].currentProgramCount, 1)
  assert.equal((await buildProgramCoverage(bundle, scope, today, [identity], fields.slice(1))).schools[0].currentProgramCount, 0)
})
test('named language tracks require annual track conditions and still count one major', async () => {
  const { bundle, scope } = fixture(); bundle.programs = [bundle.programs[0]]; bundle.admissionCycles = [bundle.admissionCycles[0]]
  bundle.admissionCycles[0].teachingLanguage = 'English'
  // The legacy programme IELTS text cannot fill an explicitly scoped annual track.
  assert.equal((await buildProgramCoverage(bundle,scope,today)).schools[0].currentProgramCount,0)
  bundle.admissionCycles[0].languageRequirements = [{test:'IELTS',minimum:'6.5'}]
  assert.equal((await buildProgramCoverage(bundle,scope,today)).schools[0].currentProgramCount,0)
  bundle.admissionCycles[0].eligibility=[{en:'High-school diploma required.'}]
  assert.equal((await buildProgramCoverage(bundle,scope,today)).schools[0].currentProgramCount,0)
  bundle.admissionCycles[0].applyUrl='https://example.edu/english-track/apply'
  assert.equal((await buildProgramCoverage(bundle,scope,today)).schools[0].currentProgramCount,1)
  bundle.admissionCycles.push({...bundle.admissionCycles[0],id:'chinese-track',teachingLanguage:'Chinese',languageRequirements:[{test:'HSK',minimum:'5'}]})
  assert.equal((await buildProgramCoverage(bundle,scope,today)).schools[0].currentProgramCount,1)
})

function leaf(bundle: DataBundle, entityType: FieldVerification['entityType'], record: Program | AdmissionCycle | Scholarship, fieldPath: string, factStatus: FieldVerification['factStatus'] = 'known'): FieldVerification {
  let value:unknown=record
  for(const part of fieldPath.split('.'))value=(value as Record<string,unknown>)?.[part]
  return {entityType,recordId:record.id,recordScopeSha256:fieldRecordScopeSha256(entityType,record),fieldPath,value,valueSha256:fieldValueSha256(value),factStatus,
    sourceId:'official',sourceUrl:bundle.sources[0].url,snapshotSha256:'1'.repeat(64),objectKey:'raw/guide',locator:'section:1',quote:'Official conditions',
    verifiedAt:`${today}T00:00:00.000Z`,reviewAfter:'2026-11-13',review:{method:'independent',reviewerId:'reviewer'},receiptPath:'quality/review.json',receiptSha256:'2'.repeat(64)}
}
test('language and eligibility are independently mandatory; explicit official waiver is supported',async()=>{
  const {bundle,scope}=fixture();bundle.programs=[bundle.programs[0]];bundle.admissionCycles=[bundle.admissionCycles[0]]
  const program=bundle.programs[0]
  delete program.supplementaryDetails
  assert.equal((await buildProgramCoverage(bundle,scope,today)).schools[0].currentProgramCount,0,'IELTS alone is incomplete')
  program.supplementaryDetails={eligibility:[{en:'High-school diploma required'}]};program.languageRequirements=[]
  assert.equal((await buildProgramCoverage(bundle,scope,today)).schools[0].currentProgramCount,0,'eligibility alone is incomplete')
  const waiver=leaf(bundle,'program',program,'languageRequirements','not_applicable')
  assert.equal((await buildProgramCoverage(bundle,scope,today,[],[waiver])).schools[0].currentProgramCount,1)
  assert.equal((await buildProgramCoverage(bundle,scope,today,[],[{...waiver,factStatus:'officially_not_announced'}])).schools[0].currentProgramCount,0)
  bundle.admissionCycles[0].academicYear='unknown'
  assert.equal((await buildProgramCoverage(bundle,scope,today,[],[waiver])).schools[0].currentProgramCount,0)
})
test('partial requirements from two annual language tracks never combine into one complete scope',async()=>{
  const {bundle,scope}=fixture();bundle.programs=[bundle.programs[0]];bundle.admissionCycles=[bundle.admissionCycles[0]]
  const cycle=bundle.admissionCycles[0];cycle.teachingLanguage='English';cycle.applyUrl='https://example.edu/en/apply';cycle.languageRequirements=[{test:'IELTS',minimum:'6.5'}]
  bundle.admissionCycles.push({...cycle,id:'cn-scope',teachingLanguage:'Chinese',applyUrl:'https://example.edu/cn/apply',languageRequirements:null,eligibility:[{en:'High-school diploma'}]})
  assert.equal((await buildProgramCoverage(bundle,scope,today)).schools[0].currentProgramCount,0)
  cycle.eligibility=[{en:'High-school diploma'}]
  assert.equal((await buildProgramCoverage(bundle,scope,today)).schools[0].currentProgramCount,1)
})
test('a fully leaf-reverified stale scholarship is a complete opportunity; every missing, expired or unknown leaf blocks completeness',async()=>{
  const {bundle,scope}=fixture()
  const award:Scholarship={...loadMaintenanceBundle(process.cwd()).scholarships[0],id:'test-award',slug:'test-award',name:{en:'2027 Official Award'},sourceIds:['official'],status:'stale',verifiedAt:'2026-11-01',reviewAfter:'2026-11-03',
    universityIds:[bundle.universities[0].id],programIds:[],deadline:'2027-06-01',applicationUrl:'https://example.edu/award/apply',eligibility:[{en:'High-school diploma'}],
    coverage:{tuition:'full',accommodation:'none',insurance:false,stipendCnyPerMonth:0}}
  bundle.scholarships=[award]
  const identities=[{entityType:'scholarship' as const,recordId:award.id,identitySha256:identityFingerprint('scholarship',award),sourceIds:['official'],acceptedAt:`${today}T00:00:00.000Z`,reviewer:'reviewer',receiptPath:'quality/award.json',receiptSha256:'3'.repeat(64)}]
  const paths=['deadline','applicationUrl','eligibility','coverage.tuition','coverage.accommodation','coverage.insurance','coverage.stipendCnyPerMonth']
  const proofs=paths.map(path=>leaf(bundle,'scholarship',award,path))
  assert.equal((await buildProgramCoverage(bundle,scope,today,identities,proofs)).schools[0].currentScholarshipCount,1)
  for(let i=0;i<proofs.length;i++)assert.equal((await buildProgramCoverage(bundle,scope,today,identities,proofs.filter((_,n)=>n!==i))).schools[0].currentScholarshipCount,0,paths[i])
  assert.equal((await buildProgramCoverage(bundle,scope,today,identities,proofs.map(proof=>({...proof,reviewAfter:'2026-11-10'})))).schools[0].currentScholarshipCount,0)
  award.coverage.insurance='unknown'
  assert.equal((await buildProgramCoverage(bundle,scope,today,identities,paths.map(path=>leaf(bundle,'scholarship',award,path)))).schools[0].currentScholarshipCount,0)
  award.status='verified';award.reviewAfter='2026-11-13'
  assert.equal((await buildProgramCoverage(bundle,scope,today,identities)).schools[0].currentScholarshipCount,0,'whole-record freshness does not complete unknown funding')
})

async function cloudSnapshot(now: number) {
  const content = { format: 'studyinchina.school-program-coverage' as const, version: 1 as const, scopeRegistrySha256: TEST_SCOPE,
    inputCatalogSha256: TEST_CATALOG, evaluatedOn: getTodayDate(new Date(now)), schools: seedInput().schools.map(school => ({ universityId: school.universityId,
      rawProgramCount: 0, directoryProgramCount: 0, currentProgramCount: 0, minimumProgramCount: 5 as const, gap: 5, coverageBand: 'zero' as const,
      countedProgramIds: [], directoryScholarshipCount: 0, currentScholarshipCount: 0, reviewAfter: null as string|null })) }
  return { ...content, sha256: await digest(canonical(content)) }
}
test('coverage upload is hash/catalog/date/scope bound, metadata only, idempotent, and exposed by schools', async () => {
  const f = makeEnv(), now = Date.now()
  try {
    await seed(f.env, seedInput()); const snapshot = await cloudSnapshot(now)
    const rowsBefore = f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_record_targets').get()?.n
    await submitCoverageSnapshot(f.env, snapshot, now)
    assert.equal((await submitCoverageSnapshot(f.env, snapshot, now)).reused, true)
    assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_record_targets').get()?.n, rowsBefore)
    assert.equal((await readCoverageSnapshot(f.env, TEST_CATALOG, TEST_SCOPE, now))?.sha256, snapshot.sha256)
    assert.equal(await readCoverageSnapshot(f.env, TEST_CATALOG, TEST_SCOPE, now + 86400000), null)
    const progress = await listSchoolProgress(f.env, now)
    assert.equal(progress.coverageState, 'observed'); assert.equal(progress.programCoverageCounts?.bands.zero, 272)
    assert.equal(progress.schools[0].coverage?.gap, 5)
    await assert.rejects(submitCoverageSnapshot(f.env, { ...snapshot, inputCatalogSha256: 'd'.repeat(64) }, now), /coverage_snapshot_binding_invalid/u)
    await assert.rejects(validateCoverageSnapshot(snapshot, { scopeRegistrySha256: TEST_SCOPE, inputCatalogSha256: TEST_CATALOG, today: '2026-01-01', schoolIds: new Set(snapshot.schools.map(row => row.universityId)) }))
    await refreshTargets(f.env, { inputCatalogSha256: TEST_CATALOG, recordTargets: [], coverageSnapshot: snapshot })
    assert.equal((await readCoverageSnapshot(f.env, TEST_CATALOG, TEST_SCOPE, now))?.sha256, snapshot.sha256)
  } finally { f.db.sqlite.close() }
})
test('programme expansion and scholarship expansion rotate 2:1 and borrow empty lanes', () => {
  const jobs = Array.from({ length: 20 }, (_, i) => [{ id: `p${i}`, stage: 'extract', priority: 1 }, { id: `a${i}`, stage: 'award', priority: 1 }]).flat()
  const result = selectScheduledJobs(jobs, { limit: 3, firstRoundComplete: false, now: 0 })
  assert.equal(result.filter(job => job.stage === 'extract').length, 2)
  assert.equal(result.filter(job => job.stage === 'award').length, 1)
  assert.equal(selectScheduledJobs(jobs.filter(job => job.stage === 'award'), { limit: 8, firstRoundComplete: false, now: 0 }).length, 8)
})
test('zero, one, two-to-four, and five-plus schools run in that order; impending reviews override coverage', () => {
  const jobs = [8, 3, 1, 0].map(count => ({ stage: 'extract', priority: 1, coverage_count: count }))
  assert.deepEqual(selectScheduledJobs(jobs, { limit: 4, firstRoundComplete: false, now: Date.parse(`${today}T00:00:00Z`) }).map(job => job.coverage_count), [0, 1, 3, 8])
  const due = { ...jobs[0], review_after: today }
  assert.equal(selectScheduledJobs([...jobs, due], { limit: 1, firstRoundComplete: false, now: Date.parse(`${today}T00:00:00Z`) })[0], due)
})

test('cloud candidate reservoir retains award work even behind a large old programme backlog', async () => {
  const f = makeEnv(), now = Date.parse('2026-11-11T04:00:00Z'), iso = new Date(now - 60000).toISOString()
  try {
    const input=seedInput(); input.schools[0].sourceSeeds=Array.from({length:90},(_,i)=>({...input.schools[0].sourceSeeds[0],id:`source-${i}`,url:`https://test.edu.cn/catalog/${i}`}))
    await seed(f.env,input,now)
    await setControls(f.env,{expectedRevision:0,legacyGuardSha256:TEST_GUARDS,enabled:true,modelsEnabled:true,canaryUniversityIds:['uni-000']},now)
    f.db.sqlite.prepare('UPDATE maintenance_sources SET due_at=?').run(new Date(now+30*86400000).toISOString())
    for (const stage of ['extract','award']) for (let i=0;i<90;i++) f.db.sqlite.prepare("INSERT INTO maintenance_jobs(job_id,source_id,stage,status,priority,due_at,created_at,updated_at) VALUES(?,?,?,'queued',1,?,?,?)")
      .run(`${stage==='extract'?'a':'z'}-${i}`,await digest(`https://test.edu.cn/catalog/${i}`),stage,iso,iso,iso)
    const result=await enqueueDue(f.env,now); assert.equal(result.queued,8)
    const stages=f.messages.map(message=>f.db.sqlite.prepare('SELECT stage FROM maintenance_jobs WHERE job_id=?').get(message.jobId)?.stage)
    assert.ok(stages.includes('award')); assert.ok(stages.includes('extract'))
  } finally { f.db.sqlite.close() }
})
test('daily cloud refresh waits for historical scope, refreshes active scope, and skips quota/head/current states without uploading targets', async () => {
  const root=process.cwd(), scope=readMaintenanceScope(root), previousScope=readMaintenanceScope(root,scope.parentScopeSha256),
    catalog=await catalogSha256(loadMaintenanceBundle(root)), calls:string[]=[]
  const status={format:'studyinchina.cloud-maintenance-status',backend:{state:'ready'},enabled:true,
    control:{seed_complete:1,targets_complete:1,scope_sha256:previousScope.sha256,input_catalog_sha256:catalog},coverage:{} as Record<string,string>}
  const client={async json(path:string,_method?:'GET'|'POST',body?:unknown){calls.push(path);if(path==='/status')return structuredClone(status);assert.equal(path,'/coverage');assert.equal((body as {scopeRegistrySha256:string}).scopeRegistrySha256,scope.sha256);return{ok:true}}}
  assert.deepEqual(await refreshCloudProgramCoverage({root,client,today}),{refreshed:false,reason:'scope_upgrade_wait'});assert.deepEqual(calls,['/status'])
  status.control.scope_sha256=scope.sha256;calls.length=0
  const result=await refreshCloudProgramCoverage({root,client,today});assert.equal(result.refreshed,true);assert.deepEqual(calls,['/status','/coverage'])
  status.coverage={snapshotSha256:'1'.repeat(64),evaluatedOn:today,inputCatalogSha256:catalog,scopeRegistrySha256:scope.sha256}
  calls.length=0;assert.equal((await refreshCloudProgramCoverage({root,client,today})).reason,'coverage_current');assert.deepEqual(calls,['/status'])
  status.control.input_catalog_sha256='9'.repeat(64);assert.equal((await refreshCloudProgramCoverage({root,client,today})).reason,'head_wait')
  status.backend.state='quota_wait';assert.equal((await refreshCloudProgramCoverage({root:'does-not-exist',client,today})).reason,'quota_wait')
  status.backend.state='ready';status.control.targets_complete=0;assert.equal((await refreshCloudProgramCoverage({root:'does-not-exist',client,today})).reason,'targets_not_ready')
})
test('impending review advances a future source capture while keeping a 24-hour acquisition floor',async()=>{
  const now=Date.parse('2026-11-11T04:00:00Z')
  for(const hoursSinceSuccess of [48,1]){
    const f=makeEnv()
    try{
      await seed(f.env,seedInput(),now);await setControls(f.env,{expectedRevision:0,legacyGuardSha256:TEST_GUARDS,enabled:true,modelsEnabled:false,canaryUniversityIds:['uni-000']},now)
      const snapshot=await cloudSnapshot(now);snapshot.schools[0].reviewAfter='2026-11-12'
      const content={...snapshot} as Omit<typeof snapshot,'sha256'> & {sha256?:string};delete content.sha256;snapshot.sha256=await digest(canonical(content))
      await submitCoverageSnapshot(f.env,snapshot,now)
      f.db.sqlite.prepare('UPDATE maintenance_sources SET due_at=?,last_success_at=?').run(new Date(now+20*86400000).toISOString(),new Date(now-hoursSinceSuccess*3600000).toISOString())
      const tick=await enqueueDue(f.env,now);assert.equal(tick.queued,hoursSinceSuccess===48?1:0)
      if(hoursSinceSuccess===48)assert.equal(f.db.sqlite.prepare("SELECT priority FROM maintenance_jobs WHERE stage='capture'").get()?.priority,0)
    }finally{f.db.sqlite.close()}
  }
})
