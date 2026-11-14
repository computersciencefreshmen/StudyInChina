import { z } from 'zod'
import { citySchema, sourceSchema, universitySchema } from '../../../src/lib/data/schema'
import { identityAcceptanceLedgerSchema } from '../../../src/lib/data/identity-acceptance'
import { selectDiscoveryData } from '../../../src/lib/data/discovery'
import type { DataBundle, University } from '../../../src/lib/data/types'
import { readBoundedBody } from '../../ingestion/src/body'
import { assertSafeSourceUrl } from '../../ingestion/src/security'
import type { Control, MaintenanceEnv } from './types'
import { MaintenanceError } from './types'
import { canonical, digest, HASH, record } from './util'

const PREFIX='maintenance/source-candidates/', MAX=2*1024*1024
export const DIRECTORY_FILES=['universities.json','cities.json','sources.json','identity-acceptances.json'] as const
const sha=z.string().regex(/^[a-f0-9]{64}$/u)
const fileSchema=z.object({path:z.enum(DIRECTORY_FILES),objectKey:z.string(),sha256:sha,byteLength:z.number().int().positive().max(MAX)}).strict()
const manifestSchema=z.object({format:z.literal('studyinchina.source-candidate-directory'),version:z.literal(1),scopeSha256:sha,inputCatalogSha256:sha,
  sourceCommit:z.string().regex(/^[a-f0-9]{40}$/u),publicationBatchId:z.string(),acknowledgementSha256:sha,files:z.array(fileSchema).length(4)}).strict()
type Manifest=z.infer<typeof manifestSchema>
export type PublishedDirectory={batchId:string;acknowledgementSha256:string;acknowledgementJson:string;sourceCommit:string}
export type CandidateAuthority={publication:PublishedDirectory;manifestSha256:string;manifestKey:string;university:University;officialFamily:string;approvedHosts:string[];seedJson:string;schoolNameJson:string;anchorSourceId:string;anchorUrl:string}
const fail=(suffix:string):never=>{throw new MaintenanceError(`source_candidate_${suffix}`)}
async function objectText(env:MaintenanceEnv,key:string,max=MAX){
  const object=await env.SNAPSHOTS_BUCKET.get(key)
  if(!object||object.size!==undefined&&object.size>max)return fail('authority_artifact_unavailable')
  const text=await object.text();if(new TextEncoder().encode(text).length>max)return fail('authority_artifact_oversized');return text
}
export async function putCandidateImmutable(env:MaintenanceEnv,key:string,text:string){
  const old=await env.SNAPSHOTS_BUCKET.get(key)
  if(old){if(await objectText(env,key)!==text)fail('immutable_conflict');return}
  await env.SNAPSHOTS_BUCKET.put(key,text,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json'}})
  if(await objectText(env,key,MAX)!==text)fail('immutable_unconfirmed')
}
async function publication(env:MaintenanceEnv,cfg:Control):Promise<PublishedDirectory>{
  const rows=(await env.PIPELINE_DB.prepare("SELECT batch_id,acknowledgement_sha256,acknowledgement_json FROM maintenance_exports WHERE scope_sha256=? AND status='published' ORDER BY created_at DESC,batch_id DESC LIMIT 10").bind(cfg.scope_sha256).all<{batch_id:string;acknowledgement_sha256:string;acknowledgement_json:string}>()).results??[]
  for(const row of rows){
    let ack:Record<string,unknown>|null;try{ack=record(JSON.parse(row.acknowledgement_json))}catch{continue}
    if(ack?.batchId!==row.batch_id||ack.outcome!=='published'||ack.newInputCatalogSha256!==cfg.input_catalog_sha256||!Array.isArray(ack.acceptedProposalIds)||!ack.acceptedProposalIds.length
      ||!/^dpl_[A-Za-z0-9]{1,100}$/u.test(String(ack.deploymentId))||!HASH.test(String(ack.stableProofSha256))||!HASH.test(row.acknowledgement_sha256)
      ||!/^[a-f0-9]{40}$/u.test(String(ack.sourceCommit))||await digest(canonical(ack))!==row.acknowledgement_sha256)continue
    return{batchId:row.batch_id,acknowledgementSha256:row.acknowledgement_sha256,acknowledgementJson:row.acknowledgement_json,sourceCommit:String(ack.sourceCommit)}
  }
  return fail('current_published_directory_required')
}
export function officialHostFamily(host:string){
  host=host.toLowerCase().replace(/\.$/u,'').replace(/^www\./u,'')
  if(/\.(?:edu|ac)\.cn$/u.test(host))return host.split('.').slice(-3).join('.')
  return host
}
const shared=new Set(['csc.edu.cn','campuschina.org','studyinchina.edu.cn','studyinchina.org.cn','cucas.cn','cucas.edu.cn'])
function privateFamily(url:string){const parsed=new URL(url),host=parsed.hostname.toLowerCase();assertSafeSourceUrl(parsed,[host]);const family=officialHostFamily(host);if(['edu.cn','ac.cn','gov.cn','com.cn'].includes(family)||[...shared].some(s=>host===s||host.endsWith(`.${s}`)))return fail('shared_host_is_not_school_authority');return family}
async function directory(env:MaintenanceEnv,cfg:Control,pub:PublishedDirectory,fetcher:typeof fetch){
  // Include the actual published ACK: acceptance ledgers can change even when
  // the raw six-file catalogue hash does not. Never reuse another publication.
  const pointer=`${PREFIX}directory-cache/${cfg.scope_sha256}/${cfg.input_catalog_sha256}/${pub.acknowledgementSha256}.json`
  const old=await env.SNAPSHOTS_BUCKET.get(pointer)
  let manifest:Manifest,manifestText:string
  if(old){manifestText=await objectText(env,pointer,16384);try{manifest=manifestSchema.parse(JSON.parse(manifestText))}catch{return fail('directory_cache_invalid')}}
  else{
    const files:Manifest['files']=[]
    for(const path of DIRECTORY_FILES){
      const url=`https://raw.githubusercontent.com/computersciencefreshmen/StudyInChina/${pub.sourceCommit}/content/data/${path}`
      const signal=AbortSignal.timeout(15000)
      let response:Response;try{response=await fetcher(url,{redirect:'manual',signal,headers:{accept:'application/json'}})}catch{return fail('directory_fetch_unavailable')}
      if(response.status!==200||response.redirected||response.url&&response.url!==url){await response.body?.cancel().catch(()=>undefined);return fail('directory_fetch_unavailable')}
      let bytes:Uint8Array;try{bytes=new Uint8Array(await readBoundedBody(response,MAX,signal))}catch{return fail('directory_fetch_oversized_or_incomplete')}
      let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);JSON.parse(text)}catch{return fail('directory_file_invalid')}
      const sha256=await digest(bytes),objectKey=`${PREFIX}git-files/${sha256}.json`
      await putCandidateImmutable(env,objectKey,text)
      files.push({path,objectKey,sha256,byteLength:bytes.byteLength})
    }
    manifest=manifestSchema.parse({format:'studyinchina.source-candidate-directory',version:1,scopeSha256:cfg.scope_sha256,inputCatalogSha256:cfg.input_catalog_sha256,sourceCommit:pub.sourceCommit,publicationBatchId:pub.batchId,acknowledgementSha256:pub.acknowledgementSha256,files})
    manifestText=canonical(manifest);await putCandidateImmutable(env,pointer,manifestText)
  }
  if(manifest.scopeSha256!==cfg.scope_sha256||manifest.inputCatalogSha256!==cfg.input_catalog_sha256||manifest.sourceCommit!==pub.sourceCommit||manifest.publicationBatchId!==pub.batchId||manifest.acknowledgementSha256!==pub.acknowledgementSha256
    ||manifest.files.some((f,i)=>f.path!==DIRECTORY_FILES[i]||f.objectKey!==`${PREFIX}git-files/${f.sha256}.json`))return fail('directory_cache_binding_invalid')
  const values:Record<string,unknown>={}
  for(const file of manifest.files){const text=await objectText(env,file.objectKey);if(new TextEncoder().encode(text).length!==file.byteLength||await digest(text)!==file.sha256)return fail('directory_cache_checksum_invalid');try{values[file.path]=JSON.parse(text)}catch{return fail('directory_file_invalid')}}
  let bundle:DataBundle,entries:z.infer<typeof identityAcceptanceLedgerSchema>['entries']
  try{bundle={universities:z.array(universitySchema).max(1000).parse(values['universities.json']),cities:z.array(citySchema).max(1000).parse(values['cities.json']),sources:z.array(sourceSchema).max(10000).parse(values['sources.json']),programs:[],admissionCycles:[],scholarships:[]};entries=identityAcceptanceLedgerSchema.parse(values['identity-acceptances.json']).entries}catch{return fail('directory_file_invalid')}
  const manifestSha256=await digest(manifestText),manifestKey=`${PREFIX}directories/${manifestSha256}.json`
  await putCandidateImmutable(env,manifestKey,manifestText)
  return{bundle,entries,manifestSha256,manifestKey}
}
export async function readCandidateAuthority(env:MaintenanceEnv,cfg:Control,universityId:string,fetcher:typeof fetch=fetch,now=Date.now()):Promise<CandidateAuthority>{
  const pub=await publication(env,cfg),cached=await directory(env,cfg,pub,fetcher)
  const visible=selectDiscoveryData(cached.bundle,new Date(now+8*3600000).toISOString().slice(0,10),cached.entries)
  const university=visible.universities.find(u=>u.id===universityId);if(!university)return fail('accepted_directory_school_required')
  const family=privateFamily(university.officialUrl)
  const owners=cached.bundle.universities.filter(u=>{try{return privateFamily(u.officialUrl)===family}catch{return false}})
  if(owners.some(u=>u.id!==universityId))return fail('school_host_ownership_ambiguous')
  const school=await env.PIPELINE_DB.prepare('SELECT name_json,seed_json FROM maintenance_schools WHERE university_id=? AND scope_sha256=?').bind(universityId,cfg.scope_sha256).first<{name_json:string;seed_json:string}>()
  if(!school)return fail('seeded_school_required')
  let original:Record<string,unknown>|null;try{original=record(JSON.parse(school.seed_json))}catch{return fail('school_seed_invalid')}
  if(original?.universityId!==universityId||!Array.isArray(original.sourceSeeds))return fail('school_seed_invalid')
  const seeds=original.sourceSeeds.map(record).filter((s):s is Record<string,unknown>=>Boolean(s)),primary=new URL(university.officialUrl).href
  const anchor=seeds.find(s=>s.enabled===true&&s.registration==='catalogue_official'&&s.sourceCategory==='catalog_anchor'&&typeof s.url==='string'&&new URL(s.url).href===primary)
  if(!anchor)return fail('canonical_anchor_seed_mismatch')
  const anchorSource=await env.PIPELINE_DB.prepare('SELECT s.url FROM maintenance_sources s JOIN maintenance_source_schools x ON x.source_id=s.source_id WHERE s.source_id=? AND s.enabled=1 AND x.university_id=?').bind(await digest(String(anchor.url)),universityId).first<{url:string}>()
  if(anchorSource?.url!==anchor.url)return fail('canonical_anchor_seed_mismatch')
  const approvedHosts=[...new Set(seeds.flatMap(s=>{if(s.enabled!==true||s.registration!=='catalogue_official'||typeof s.url!=='string'||!Array.isArray(s.allowedHosts))return[];try{const url=new URL(s.url);if(privateFamily(url.href)!==family||!s.allowedHosts.some(host=>typeof host==='string'&&(url.hostname===host||url.hostname.endsWith(`.${host}`))))return[];assertSafeSourceUrl(url,[url.hostname]);return[url.hostname]}catch{return[]}}))].sort()
  if(!approvedHosts.length)return fail('school_host_authority_unavailable')
  return{publication:pub,manifestSha256:cached.manifestSha256,manifestKey:cached.manifestKey,university,officialFamily:family,approvedHosts,seedJson:school.seed_json,schoolNameJson:school.name_json,anchorSourceId:await digest(String(anchor.url)),anchorUrl:String(anchor.url)}
}
