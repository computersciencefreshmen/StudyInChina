import { htmlToText } from '../../ingestion/src/rules'
import { assertSafeSourceUrl } from '../../ingestion/src/security'
import { event,source,sourceSchools } from './repository'
import type { MaintenanceEnv,SourceRow } from './types'
import { MaintenanceError } from './types'
import { canonical,digest,HASH,nowIso,record } from './util'
import { coalesceOperations,type SqlOperation } from './sql-plan'

type Link={url:string;category:string;label:string;priority:number}
type Frontier={version:1;sourceId:string;sourceUrl:string;rawSha256:string;depth:number;allowedHosts:string[];links:Link[];missed:Array<{href:string|null;label:string;reason:string}>}
export function parseDiscoveryFrontier(html:string,parent:SourceRow,url:URL,hosts:string[],rawSha256:string):Frontier {
  const links=new Map<string,Link>(),missed:Frontier['missed']=[]
  for(const anchor of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/giu)){
    const href=/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/iu.exec(anchor[1]),value=href?.[1]??href?.[2]??href?.[3]??null,label=htmlToText(anchor[2]).trim()
    if(value===null){missed.push({href:null,label,reason:'missing_href'});continue}
    if(value.length>4096){missed.push({href:value,label,reason:'url_length_limit'});continue}
    let target:URL
    try{target=assertSafeSourceUrl(new URL(value.replaceAll('&amp;','&'),url),hosts);target.hash=''}catch{missed.push({href:value,label,reason:'outside_approved_https_hosts'});continue}
    if([...target.searchParams.keys()].some(key=>/token|session|password|secret|authorization/iu.test(key))){missed.push({href:value,label,reason:'credential_parameter'});continue}
    const pagination=/\bnext\b|下一页|下页|后一页|›|»/iu.test(label)||/(?:page|pageno|pageindex)[=/]?\d+/iu.test(target.href),pdf=/\.pdf(?:$|[?#])/iu.test(target.href)
    if(target.href===url.href){missed.push({href:value,label,reason:'same_source'});continue}
    if(!pagination&&!pdf&&!/admission|program|programme|scholarship|undergraduate|postgraduate|master|doctoral|招生|专业|奖学金|本科|硕士|博士|留学/iu.test(label)){missed.push({href:value,label,reason:'not_an_admissions_frontier'});continue}
    const next={url:target.href,category:/scholarship|奖学金/iu.test(label)?'university_scholarship':'program_detail',label,priority:pagination?0:pdf?1:2},old=links.get(target.href)
    if(!old||next.priority<old.priority)links.set(target.href,next)
  }
  return{version:1,sourceId:parent.source_id,sourceUrl:url.href,rawSha256,depth:parent.discovery_depth,allowedHosts:hosts,links:[...links.values()].sort((a,b)=>a.priority-b.priority||a.url.localeCompare(b.url)),missed}
}
export async function discoverSourceLinks(env:MaintenanceEnv,parent:SourceRow,html:string,url:URL,hosts:string[],rawSha256:string){
  const frontier=parseDiscoveryFrontier(html,parent,url,hosts,rawSha256),text=canonical(frontier),sha256=await digest(text),key=`maintenance/frontiers/${sha256}.json`
  await env.SNAPSHOTS_BUCKET.put(key,text,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json'}})
  await event(env,'discovery_frontier',{sourceId:parent.source_id,manifestKey:key,manifestSha256:sha256,discovered:frontier.links.length,missed:frontier.missed.length,queuedSubset:frontier.depth<2?Math.min(5,frontier.links.length):0,continuationRequired:frontier.depth<2&&frontier.links.length>5,depthLimitReached:frontier.depth>=2&&frontier.links.length>0,catalogueComplete:false})
  if(frontier.depth<2&&frontier.links.length)await env.MAINTENANCE_QUEUE.send({version:1,jobId:sha256,discoveryManifestSha256:sha256,discoveryOffset:0})
}
async function saveLineage(env:MaintenanceEnv,child:string,parent:string,frontierSha256:string){
  const key=`maintenance/discovery-lineage/${child}.json`
  for(let attempt=0;attempt<4;attempt++){
    const object=await env.SNAPSHOTS_BUCKET.get(key),old=object?record(JSON.parse(await object.text())):null,parents=new Set(Array.isArray(old?.parents)?old.parents.filter((id):id is string=>typeof id==='string'&&HASH.test(id)):[])
    parents.add(parent)
    const saved=await env.SNAPSHOTS_BUCKET.put(key,canonical({version:1,sourceId:child,parents:[...parents].sort(),frontierSha256}),{onlyIf:object?.etag?{etagMatches:object.etag}:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json'}})
    if(saved!==null)return
  }
  throw new MaintenanceError('discovery_lineage_conflict')
}
/** Every admitted link is persisted first. Five-link continuations bound Free
 * query usage; checkpoints and full missed-link manifests retain unfinished work. */
export async function processDiscoveryFrontier(env:MaintenanceEnv,sha256:string,offset:number){
  if(!HASH.test(sha256)||!Number.isSafeInteger(offset)||offset<0)throw new MaintenanceError('discovery_checkpoint_invalid')
  const key=`maintenance/frontiers/${sha256}.json`,object=await env.SNAPSHOTS_BUCKET.get(key)
  if(!object||object.size!==undefined&&object.size>24*1024*1024)throw new MaintenanceError('discovery_frontier_unavailable')
  const text=await object.text()
  if(await digest(text)!==sha256)throw new MaintenanceError('discovery_frontier_checksum_mismatch')
  const frontier=JSON.parse(text)as Frontier,parent=await source(env,frontier.sourceId)
  if(!parent||frontier.depth>=2||parent.raw_sha256!==frontier.rawSha256){await event(env,'discovery_frontier_held',{manifestKey:key,reason:frontier.depth>=2?'depth_limit':'parent_snapshot_superseded',catalogueComplete:false});return}
  const checkpoint=`maintenance/frontier-checkpoints/${sha256}/${offset}.json`,previous=await env.SNAPSHOTS_BUCKET.get(checkpoint),next=Math.min(offset+5,frontier.links.length)
  if(!previous){
    const schools=await sourceSchools(env,parent.source_id),operations:SqlOperation[]=[],admitted:string[]=[]
    const total=await env.PIPELINE_DB.prepare('SELECT COUNT(*) count FROM maintenance_sources').first<{count:number}>()
    if((total?.count??20000)>=20000){await event(env,'discovery_frontier_held',{manifestKey:key,offset,reason:'source_registry_capacity',catalogueComplete:false});return}
    for(const link of frontier.links.slice(offset,next)){
      const url=assertSafeSourceUrl(link.url,frontier.allowedHosts),id=await digest(url.href)
      operations.push({sql:'INSERT OR IGNORE INTO maintenance_sources(source_id,url,allowed_hosts_json,category,categories_json,enabled,interval_hours,due_at,discovery_depth) VALUES(?,?,?,?,?,1,168,?,?)',values:[id,url.href,JSON.stringify(frontier.allowedHosts),link.category,JSON.stringify([link.category]),nowIso(),frontier.depth+1]})
      for(const school of schools)operations.push({sql:'INSERT OR IGNORE INTO maintenance_source_schools VALUES(?,?)',values:[id,school.university_id]})
      await saveLineage(env,id,parent.source_id,sha256);admitted.push(id)
    }
    const grouped=coalesceOperations(operations)
    if(grouped.length>32)throw new MaintenanceError('discovery_school_partition_required')
    if(grouped.length)await env.PIPELINE_DB.batch(grouped.map(op=>env.PIPELINE_DB.prepare(op.sql).bind(...op.values)))
    await env.SNAPSHOTS_BUCKET.put(checkpoint,canonical({version:1,manifestSha256:sha256,offset,next,admittedSourceIds:admitted,catalogueComplete:false}),{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json'}})
    await event(env,'discovery_frontier_batch',{manifestKey:key,offset,next,totalLinks:frontier.links.length,admitted:admitted.length,remaining:frontier.links.length-next,catalogueComplete:false})
  }
  if(next<frontier.links.length)await env.MAINTENANCE_QUEUE.send({version:1,jobId:sha256,discoveryManifestSha256:sha256,discoveryOffset:next})
}
