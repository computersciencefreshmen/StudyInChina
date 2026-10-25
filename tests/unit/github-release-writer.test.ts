import { createHash } from 'node:crypto'
import { mkdtemp,rm,writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe,expect,it,vi } from 'vitest'
import { assignGithubAlias,createVercelAliasClients,currentGithubAliasTarget,githubAliasMutationStatus,type GithubWriterClients,type PromotionOperation,type AliasAttemptReceipt } from '../../scripts/operations/github-release-writer'
import { deploymentWriterCommandSchema } from '../../src/lib/admin/deployment-release-contract'

const project='prj_AgYJcsuat4kmLiinlvcBbZsYY3cg',owner='team_o5qghzfTOk24QwoYANzJ8hNH',alias='studyinchina.vercel.app',time='2026-10-25T00:00:00.000Z'
function fixture(){
  const previous={id:'dpl_previous123',projectId:project,ownerId:owner,readyState:'READY',target:'production',url:'studyinchina-previous.vercel.app',createdAt:Date.parse(time),commitSha:'a'.repeat(40)},target={...previous,id:'dpl_target12345',url:'studyinchina-target.vercel.app',commitSha:'b'.repeat(40)}
  const registry:PromotionOperation['registry']={version:1,revision:1,observedAt:time,projectId:project,alias,currentId:previous.id,versions:[previous,target].map(value=>({id:value.id,projectId:project,ready:true,deploymentUrl:`https://${value.url}/`,createdAt:time,registeredAt:time,commitSha:value.commitSha,proofSha256:'c'.repeat(64)}))}
  const hash=createHash('sha256').update(JSON.stringify(registry)).digest('hex'),command=deploymentWriterCommandSchema.parse({commandId:'11111111-1111-4111-8111-111111111111',action:'deployment-promotion',status:'claimed',targetId:target.id,expectedCurrentId:previous.id,expectedRevision:1,expectedRegistrySha256:hash,reason:'tested guarded promotion',requestedAt:time,updatedAt:time,result:null}),operation={command,registry,target,previous}
  const clients:GithubWriterClients={writer:vi.fn(async()=>({controlEnabled:true,registrySha256:hash,state:{version:1,registry,command,recentCommands:[]}})),metadata:vi.fn(async id=>id===target.id?target:previous),alias:vi.fn(async()=>({projectId:project,deploymentId:previous.id})),assignAlias:vi.fn(async()=>({outcome:'accepted' as const,httpStatus:200,oldDeploymentId:previous.id}))}
  const receipts:AliasAttemptReceipt[]=[],hooks={beforeSend:vi.fn(async()=>{}),saveResult:vi.fn(async(receipt:AliasAttemptReceipt)=>{receipts.push(receipt)})}
  return{operation,clients,hooks,receipts}
}
describe('fixed-project REST alias transport',()=>{
  it('reads the fixed alias then qualifies its immutable deployment without using account/user APIs',async()=>{
    const f=fixture(),calls:string[]=[],fetcher=vi.fn(async(input:RequestInfo|URL)=>{const url=new URL(String(input));calls.push(url.href);expect(url.searchParams.get('teamId')).toBe(owner);return Response.json(url.pathname.startsWith('/v4/aliases/')?{alias,projectId:project,deploymentId:f.operation.previous.id}:f.operation.previous)})
    expect(await currentGithubAliasTarget(createVercelAliasClients('unit-token',fetcher))).toBe(f.operation.previous.url)
    expect(calls.map(value=>new URL(value).pathname)).toEqual([`/v4/aliases/${alias}`,`/v13/deployments/${f.operation.previous.id}`]);expect(calls.join(' ')).not.toMatch(/\/user|\/account/)
    await expect(currentGithubAliasTarget({...f.clients,metadata:async()=>({...f.operation.previous,ownerId:'team_wrong'})})).rejects.toThrow('release_ownership_invalid')
  })
  it('posts only the fixed alias body and team to the selected deployment, with no redirects or retries',async()=>{
    const fetcher=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{const url=new URL(String(input));expect(url.pathname).toBe('/v2/deployments/dpl_target12345/aliases');expect(url.searchParams.get('teamId')).toBe(owner);expect(init?.method).toBe('POST');expect(init?.redirect).toBe('error');expect(JSON.parse(String(init?.body))).toEqual({alias});return Response.json({alias,uid:'alias_uid',oldDeploymentId:'dpl_previous123'})})
    expect(await createVercelAliasClients('unit-token',fetcher).assignAlias('dpl_target12345')).toMatchObject({outcome:'accepted',httpStatus:200});expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it.each([403,409,500])('does not confuse HTTP %s rejection/unknown with assignment success',async status=>{
    const fetcher=vi.fn(async()=>new Response('provider failure',{status})),result=await createVercelAliasClients('unit-token',fetcher).assignAlias('dpl_target12345')
    expect(result.outcome).toBe(status===500?'unknown':'rejected');expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('treats timeouts, malformed success and explicit error payloads as unknown without retry',async()=>{
    for(const response of [async()=>{throw new Error('lost response')},async()=>new Response('not json'),async()=>Response.json({alias,uid:'uid',error:{code:'partial_error'}})]){
      const fetcher=vi.fn(response);expect((await createVercelAliasClients('unit-token',fetcher).assignAlias('dpl_target12345')).outcome).toBe('unknown');expect(fetcher).toHaveBeenCalledTimes(1)
    }
  })
})
describe('common writer guarded REST assignment',()=>{
  it('checks fresh target ownership and claim immediately before durable send reservation and POST',async()=>{
    const f=fixture();await assignGithubAlias(f.clients,f.operation,'promote',f.hooks)
    expect(f.clients.metadata).toHaveBeenCalledWith(f.operation.target.id);expect(f.hooks.beforeSend).toHaveBeenCalledTimes(1);expect(f.receipts[0]).toMatchObject({outcome:'accepted',readbackRequired:true,targetId:f.operation.target.id})
    expect(vi.mocked(f.hooks.beforeSend).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(f.clients.assignAlias!).mock.invocationCallOrder[0])
    expect(vi.mocked(f.clients.alias).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(f.hooks.beforeSend).mock.invocationCallOrder[0])
  })
  it('does not POST after a lost claim, wrong owner or failed immutable send marker',async()=>{
    for(const mode of ['claim','owner','marker']){const f=fixture();if(mode==='claim')f.clients.writer=async()=>({controlEnabled:false});if(mode==='owner')f.clients.metadata=async()=>({...f.operation.target,projectId:'prj_wrong'});if(mode==='marker')f.hooks.beforeSend=vi.fn(async()=>{throw new Error('EEXIST')});await expect(assignGithubAlias(f.clients,f.operation,'promote',f.hooks)).rejects.toThrow();expect(f.clients.assignAlias).not.toHaveBeenCalled()}
  })
  it('marks a provider old-target race as unknown, and compensates only the operation previous target',async()=>{
    const raced=fixture();raced.clients.assignAlias=async()=>({outcome:'accepted',httpStatus:200,oldDeploymentId:'dpl_unexpected123'});await expect(assignGithubAlias(raced.clients,raced.operation,'promote',raced.hooks)).rejects.toThrow('release_alias_mutation_unknown');expect(raced.receipts[0].outcome).toBe('unknown')
    const f=fixture();f.clients.alias=async()=>({projectId:project,deploymentId:f.operation.target.id});f.clients.assignAlias=vi.fn(async()=>({outcome:'accepted' as const,httpStatus:200,oldDeploymentId:f.operation.target.id}));await assignGithubAlias(f.clients,f.operation,'compensate',f.hooks);expect(f.clients.assignAlias).toHaveBeenCalledWith(f.operation.previous.id)
  })
  it('keeps crashed or unknown sends pending even when an immediate alias read still shows previous',async()=>{
    const directory=await mkdtemp(join(tmpdir(),'studyinchina-alias-marker-'))
    try{const f=fixture(),attempt={commandId:f.operation.command.commandId,targetId:f.operation.target.id};await writeFile(join(directory,'alias-attempt-promote.json'),JSON.stringify(attempt));expect(await githubAliasMutationStatus(directory)).toBe('pending')
      f.clients.assignAlias=async()=>({outcome:'unknown',httpStatus:null});await expect(assignGithubAlias(f.clients,f.operation,'promote',{beforeSend:async()=>{},saveResult:async receipt=>{await writeFile(join(directory,'alias-result-promote.json'),JSON.stringify(receipt))}})).rejects.toThrow('release_alias_mutation_unknown')
      expect(await f.clients.alias()).toMatchObject({deploymentId:f.operation.previous.id});expect(await githubAliasMutationStatus(directory)).toBe('pending')
      await writeFile(join(directory,'alias-result-promote.json'),JSON.stringify({...attempt,mode:'promote',outcome:'rejected'}));expect(await githubAliasMutationStatus(directory)).toBe('safe')
    }finally{await rm(directory,{recursive:true,force:true})}
  })
})
