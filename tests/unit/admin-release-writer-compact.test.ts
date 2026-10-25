import { describe,expect,it } from 'vitest'
import { deploymentMachineRequestSchema,type DeploymentRegistry,type DeploymentWriterCommand,type DeploymentWriterState } from '../../src/lib/admin/deployment-release-contract'
import { ADMIN_RELEASE_WRITER_OBJECT,readReleaseWriter,releaseDigest,reserveDeploymentWriter,updateDeploymentWriter } from '../../workers/catalog-api/src/admin-release-writer'
import type { CatalogApiEnv,R2Bucket } from '../../workers/catalog-api/src/types'

class Bucket implements R2Bucket{
  readonly objects=new Map<string,{text:string;etag:string}>();version=0;rejectState=false;loseCompleted=false
  async get(key:string){const value=this.objects.get(key);return value?{body:null,size:new TextEncoder().encode(value.text).length,etag:value.etag,text:async()=>value.text}:null}
  async put(key:string,text:string,options:Parameters<NonNullable<R2Bucket['put']>>[2]){
    if(key===ADMIN_RELEASE_WRITER_OBJECT&&this.rejectState)return null
    if(key.startsWith('admin-releases/archives/')&&key.endsWith('/completed.json')&&this.loseCompleted)throw new Error('lost completed receipt write')
    const old=this.objects.get(key)
    if(options.onlyIf instanceof Headers?options.onlyIf.get('If-None-Match')==='*'&&Boolean(old):old?.etag!==options.onlyIf.etagMatches)return null
    const etag=String(++this.version);this.objects.set(key,{text,etag});return{etag}
  }
  seed(key:string,value:unknown){this.objects.set(key,{text:JSON.stringify(value),etag:String(++this.version)})}
}
const now=Date.parse('2026-10-25T05:00:00.000Z'),project='prj_AgYJcsuat4kmLiinlvcBbZsYY3cg'
async function fixture(count=20){
  const bucket=new Bucket(),versions=Array.from({length:count},(_,index)=>({id:`dpl_version${String(index).padStart(5,'0')}`,projectId:project,ready:true as const,deploymentUrl:`https://studyinchina-version-${index}.vercel.app/`,createdAt:new Date(now-86400000+index*1000).toISOString(),registeredAt:new Date(now-3600000+index*1000).toISOString(),commitSha:'a'.repeat(40),proofSha256:'b'.repeat(64)}))
  const registry:DeploymentRegistry={version:1,revision:635,observedAt:new Date(now-1000).toISOString(),projectId:project,alias:'studyinchina.vercel.app',currentId:versions[0].id,versions}
  const state:DeploymentWriterState={version:1,registry,command:null,recentCommands:[]};bucket.seed(ADMIN_RELEASE_WRITER_OBJECT,state)
  for(const version of versions)bucket.seed(`admin-releases/versions/${version.id}.json`,version)
  const env:CatalogApiEnv={RELEASES_BUCKET:bucket,CATALOG_DB:{prepare(){throw new Error('unexpected D1 query')}},ADMIN_RELEASE_CONTROL_ENABLED:'true'}
  const request={action:'compact-registry' as const,expectedCurrentId:registry.currentId,expectedRevision:registry.revision,expectedRegistrySha256:await releaseDigest(JSON.stringify(registry))}
  return{bucket,env,registry,state,request}
}
describe('server controlled release registry compaction',()=>{
  it('archives exactly the oldest noncurrent index entry, preserves every version receipt and records completed only after CAS',async()=>{
    const f=await fixture(),original=new Map(f.bucket.objects),result=await updateDeploymentWriter(f.env,f.request,now)
    expect(result).toMatchObject({compacted:true,archivedVersionId:f.registry.versions[1].id})
    const current=(await readReleaseWriter(f.env))!.state.registry;expect(current.versions).toHaveLength(19);expect(current.currentId).toBe(f.registry.currentId);expect(current.revision).toBe(636);expect(current.observedAt).toBe(f.registry.observedAt)
    for(const version of f.registry.versions)expect(f.bucket.objects.get(`admin-releases/versions/${version.id}.json`)).toEqual(original.get(`admin-releases/versions/${version.id}.json`))
    const archive=[...f.bucket.objects.entries()].filter(([key])=>key.startsWith('admin-releases/archives/'))
    expect(archive).toHaveLength(2);expect(JSON.parse(archive.find(([key])=>key.endsWith('/proposed.json'))![1].text).status).toBe('proposed');expect(JSON.parse(archive.find(([key])=>key.endsWith('/completed.json'))![1].text).status).toBe('completed')
    await expect(reserveDeploymentWriter(f.env,{commandId:'22222222-2222-4222-8222-222222222222',kind:'deployment',targetId:f.registry.versions[1].id,expectedCurrentId:current.currentId,expectedRevision:current.revision,expectedRegistrySha256:await releaseDigest(JSON.stringify(current)),reason:'do not widen rollback history'},'deployment-rollback',now)).rejects.toThrow('release_not_available')
    await expect(updateDeploymentWriter(f.env,f.request,now+1000)).rejects.toThrow('release_conflict');expect((await readReleaseWriter(f.env))!.state.registry.versions).toHaveLength(19)
  })
  it('requires exact current/revision/hash, full capacity, fixed scope and enabled control',async()=>{
    const f=await fixture()
    for(const change of [{expectedCurrentId:f.registry.versions[2].id},{expectedRevision:634},{expectedRegistrySha256:'c'.repeat(64)}])await expect(updateDeploymentWriter(f.env,{...f.request,...change},now)).rejects.toThrow('release_conflict')
    const notFull=await fixture(19);await expect(updateDeploymentWriter(notFull.env,notFull.request,now)).rejects.toThrow('release_compaction_not_required')
    f.env.ADMIN_RELEASE_CONTROL_ENABLED='false';await expect(updateDeploymentWriter(f.env,f.request,now)).rejects.toThrow('release_control_disabled')
    expect(deploymentMachineRequestSchema.safeParse({...f.request,targetId:f.registry.versions[1].id}).success).toBe(false)
    f.env.ADMIN_RELEASE_CONTROL_ENABLED='true';f.state.registry.alias='other.vercel.app';f.bucket.seed(ADMIN_RELEASE_WRITER_OBJECT,f.state);await expect(updateDeploymentWriter(f.env,f.request,now)).rejects.toThrow('release_conflict')
  })
  it.each(['pending','claimed','uncertain']as const)('does not compact around a %s writer command',async status=>{
    const f=await fixture(),command:DeploymentWriterCommand={commandId:'11111111-1111-4111-8111-111111111111',action:'deployment-promotion',targetId:f.registry.versions[2].id,expectedCurrentId:f.registry.currentId,expectedRevision:635,expectedRegistrySha256:f.request.expectedRegistrySha256,reason:'existing writer request',requestedAt:new Date(now).toISOString(),updatedAt:new Date(now).toISOString(),status,result:null}
    f.state.command=command;f.bucket.seed(ADMIN_RELEASE_WRITER_OBJECT,f.state);await expect(updateDeploymentWriter(f.env,f.request,now)).rejects.toThrow('release_writer_busy')
    f.state.command=null;f.state.recentCommands=[command];f.bucket.seed(ADMIN_RELEASE_WRITER_OBJECT,f.state);await expect(updateDeploymentWriter(f.env,f.request,now)).rejects.toThrow('release_writer_busy')
  })
  it('fails closed on missing/corrupt original immutable receipt without writing an archive',async()=>{
    const f=await fixture();f.bucket.seed(`admin-releases/versions/${f.registry.versions[1].id}.json`,{changed:true})
    await expect(updateDeploymentWriter(f.env,f.request,now)).rejects.toThrow('release_receipt_conflict');expect([...f.bucket.objects.keys()].some(key=>key.includes('/archives/'))).toBe(false);expect((await readReleaseWriter(f.env))!.state.registry.versions).toHaveLength(20)
  })
  it('leaves a proposed receipt uncompleted when the state ETag CAS loses',async()=>{
    const f=await fixture();f.bucket.rejectState=true
    await expect(updateDeploymentWriter(f.env,f.request,now)).rejects.toThrow('release_conflict');expect([...f.bucket.objects.keys()].filter(key=>key.includes('/archives/'))).toEqual([expect.stringMatching(/\/proposed\.json$/u)]);expect((await readReleaseWriter(f.env))!.state.registry.versions).toHaveLength(20)
  })
  it('a lost completion receipt is reconciled by the committed 19-entry GET and cannot drop another entry',async()=>{
    const f=await fixture();f.bucket.loseCompleted=true
    await expect(updateDeploymentWriter(f.env,f.request,now)).rejects.toThrow('lost completed receipt write');expect((await readReleaseWriter(f.env))!.state.registry.versions).toHaveLength(19)
    await expect(updateDeploymentWriter(f.env,f.request,now+1000)).rejects.toThrow('release_conflict');expect((await readReleaseWriter(f.env))!.state.registry.versions).toHaveLength(19)
    const current=(await readReleaseWriter(f.env))!.state.registry
    await expect(updateDeploymentWriter(f.env,{action:'sync-registry',registry:{...current,observedAt:new Date(now).toISOString(),versions:current.versions.filter((_,index)=>index!==1)}},now)).rejects.toThrow('release_registration_missing')
  })
})
