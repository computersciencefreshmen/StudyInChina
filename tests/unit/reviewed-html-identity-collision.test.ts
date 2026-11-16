import {createHash,webcrypto} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {beforeAll,describe,expect,it,vi} from 'vitest'
import {loadMaintenanceBundle,buildMaintenanceScope,catalogSha256} from '../../scripts/maintenance/build-scope'
import {canonicalProgramIdentityKey,importIdentityCandidates,type IdentityBindings} from '../../scripts/maintenance/import-identities'
import {exportContentSha256,proposalContentSha256,type MaintenanceProposal,type ProgramIdentityFields} from '../../scripts/maintenance/contracts'
import {reviewedHtmlProgramAliasProfiles} from '../../src/lib/data/reviewed-html-program-alias'

const acceptedAt='2026-11-16T08:00:00.000Z',checkedAt='2026-11-15T08:00:00.000Z'
const hash=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex')
const profile=reviewedHtmlProgramAliasProfiles[0],baseline=loadMaintenanceBundle(process.cwd())
const baseBindings=JSON.parse(readFileSync(join(process.cwd(),'content/data/identity-bindings.json'),'utf8'))as IdentityBindings
beforeAll(()=>vi.stubGlobal('crypto',webcrypto))

/** Synthetic TEST_ONLY approval/evidence isolates the importing boundary. It
 * never writes canonical facts or replaces the separate actual5-artifact run. */
async function run(options:{degree?:'master'|'bachelor';url?:string;universityId?:string;mapped?:'exact'|'bound'|'explicit';badEvidence?:boolean;unreviewedNeighbour?:boolean}={}){
 const universityId=options.universityId??profile.universityId,degreeLevel=options.degree??'master',url=options.url??profile.sourceUrl
 const name=options.unreviewedNeighbour?{en:'TEST_ONLY Independently Distinct Programme',zh:'测试专用未审邻居专业'}:degreeLevel==='bachelor'?{en:'TEST_ONLY Bachelor Computing',zh:'测试专用本科计算'}:{en:'Master’s Program in Tourism Management',zh:'旅游管理专业硕士研究生'}
 const text=`TEST_ONLY official fixture. International students may apply. ${degreeLevel}. ${name.en}. ${name.zh}.`
 const bytes=new TextEncoder().encode(text),snapshotSha256=hash(bytes),objectKey='TEST_ONLY/closed-html-collision.txt'
 const evidence={sourceId:'TEST_ONLY-closed-html-source',url,snapshotSha256,objectKey,locator:'text:1',quote:text}
 const fields:ProgramIdentityFields={name,degreeLevel,programType:'degree',programUrl:url,internationalAdmissionsEvidence:evidence}
 const bundle=structuredClone(baseline),bindings=structuredClone(baseBindings)
 let existingId:string|undefined
 if(options.mapped){
  const original=bundle.programs.find(p=>p.id===profile.recordId)!
  const existing={...original,id:'program-test-only-existing-neighbour',slug:'test-only-existing-neighbour',name,degreeLevel,programUrl:url}
  bundle.programs.push(existing);existingId=existing.id
  if(options.mapped==='bound')bindings.entries.push({canonicalKey:canonicalProgramIdentityKey(universityId,fields),recordId:existing.id,aliases:[]})
 }
 const proposal:MaintenanceProposal={id:'TEST_ONLY-closed-html-collision',universityId,entityType:'program',recordId:options.mapped==='explicit'?existingId!:null,operation:'create',status:'ready',warnings:[],fields,
  source:{id:evidence.sourceId,url,snapshotSha256,objectKey,locator:evidence.locator,quote:text,checkedAt,contentType:'text/plain'},
  fieldEvidence:['name.en','name.zh','degreeLevel'].map(fieldPath=>({...evidence,fieldPath})),scope:{year:null,intake:null}}
 proposal.review={decision:'approved',reviewerId:'TEST_ONLY-reviewer',method:'human',reviewedAt:checkedAt,candidateSha256:await proposalContentSha256(proposal),snapshotSha256,checks:{internationalScope:true,concreteProgram:true,evidenceLocated:true}}
 const scope=await buildMaintenanceScope(bundle,{scopeId:'TEST_ONLY-CLOSED-HTML-COLLISION',createdAt:checkedAt}),content={format:'studyinchina.maintenance-candidate-export'as const,formatVersion:1 as const,batchId:'TEST_ONLY-CLOSED-HTML-COLLISION',inputCatalogSha256:await catalogSha256(bundle),scopeRegistrySha256:scope.sha256,createdAt:checkedAt,proposals:[proposal]}
 const before=JSON.stringify(bundle),bindingBefore=JSON.stringify(bindings)
 const result=await importIdentityCandidates({bundle,scope,batch:{...content,sha256:await exportContentSha256(content)},acceptedAt,receiptPath:'TEST_ONLY/receipt.json',bindings,
  readArtifact:async key=>{if(key!==objectKey)throw Error('unexpected fixture artifact');return options.badEvidence?new TextEncoder().encode('tampered'):bytes}})
 expect(JSON.stringify(bundle)).toBe(before);expect(JSON.stringify(bindings)).toBe(bindingBefore)
 return{result,existingId,bundle}
}

describe('closed reviewed HTML page identity collision boundary',()=>{
 it('holds the actual GZNU qualification-word spelling as an unmapped identity and creates no new facts or bindings',async()=>{
  const{result,bundle}=await run()
  expect(result.receipt.accepted).toEqual([])
  expect(result.receipt.held).toEqual([{proposalId:'TEST_ONLY-closed-html-collision',reason:'reviewed_html_alias_same_source_identity_requires_review'}])
  expect(result.bundle).toEqual(bundle);expect(result.bindings).toEqual(baseBindings);expect(result.acceptances.entries).toEqual([])
 })
 it('also requires independent review for an apparently valid but unreviewed new neighbour on that exact closed page',async()=>{
  expect((await run({unreviewedNeighbour:true})).result.receipt.held[0].reason).toBe('reviewed_html_alias_same_source_identity_requires_review')
 })
 for(const mapped of ['exact','bound','explicit']as const)it(`preserves existing ${mapped} mapping and its ID before the new-page guard`,async()=>{
  const{result,existingId,bundle}=await run({mapped})
  expect(result.receipt.held).toEqual([]);expect(result.receipt.accepted).toHaveLength(1)
  expect(result.receipt.accepted[0]).toMatchObject({recordId:existingId,action:'identity_accepted'})
  expect(result.bundle.programs).toHaveLength(bundle.programs.length)
 })
 it('does not extend the closed master identity rule to another degree with its own TEST_ONLY literal degree evidence',async()=>{
  const{result}=await run({degree:'bachelor'});expect(result.receipt.held).toEqual([]);expect(result.receipt.accepted[0].action).toBe('created')
 })
 it('does not hold a different registered-school page merely because the school and degree match',async()=>{
  const{result}=await run({url:'https://sie.gznu.edu.cn/TEST_ONLY-other-programme.htm'});expect(result.receipt.held).toEqual([]);expect(result.receipt.accepted[0].action).toBe('created')
 })
 it('retains the original foreign-school ownership rejection rather than replacing it with this rule',async()=>{
  const other=baseline.universities.find(u=>u.id!==profile.universityId&&u.id!==reviewedHtmlProgramAliasProfiles[1].universityId)!
  const{result}=await run({universityId:other.id});expect(result.receipt.held[0].reason).toBe('source_outside_registered_school_hosts')
 })
 it('still rejects tampered official originals before applying any identity scheduling decision',async()=>{
  expect((await run({badEvidence:true})).result.receipt.held[0].reason).toBe('source_snapshot_checksum_mismatch')
 })
})
