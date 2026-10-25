import { readBoundedBody } from '../../ingestion/src/body'
import { parseOfficialCatalogHtml } from '../../ingestion/src/catalog-parser'
import { isRobotsPathAllowed } from '../../ingestion/src/robots'
import { htmlToText, normalizeEvidenceText } from '../../ingestion/src/rules'
import { assertSafeSourceUrl, fetchWithValidatedRedirects } from '../../ingestion/src/security'
import type { SourceCategory } from '../../ingestion/src/types'
import { queueExtraction } from './repository'
import { discoverSourceLinks } from './discovery'
import { captureCadence } from './cadence'
import type { JobRow, MaintenanceEnv, SourceRow } from './types'
import { MaintenanceError } from './types'
import { after, canonical, digest, gateRequest, nowIso, record } from './util'

export type CapturedSnapshot = {
  version:1;sourceId:string;sourceUrl:string;finalUrl:string;checkedAt:string;contentType:string;
  rawSha256:string;rawKey:string;textKey:string|null;textSha256:string|null;canonicalSha256:string;
  parserCandidates:unknown[];textArtifact?:{objectKey:string;sha256:string;rawSnapshotSha256:string;parser:'poppler'|'tesseract'|'browser-dom'}
}
const pause=(ms:number)=>new Promise<void>(done=>setTimeout(done,ms))
export function decodeOfficialBody(bytes:ArrayBuffer,contentType:string):string {
  const prefix=new TextDecoder('utf-8').decode(bytes.slice(0,2048))
  const charset=/charset\s*=\s*["']?\s*([a-zA-Z0-9_-]+)/i.exec(contentType)?.[1]??/<meta\b[^>]*charset\s*=\s*["']?\s*([a-zA-Z0-9_-]+)/i.exec(prefix)?.[1]??'utf-8'
  return new TextDecoder(charset,{fatal:true}).decode(bytes)
}
export async function loadSnapshot(env:MaintenanceEnv,key:string):Promise<CapturedSnapshot> {
  if(!/^maintenance\/snapshots\/[a-f0-9]{64}\/[a-f0-9]{64}\.json$/.test(key))throw new MaintenanceError('snapshot_key_invalid')
  const object=await env.SNAPSHOTS_BUCKET.get(key)
  if(!object||object.size!==undefined&&object.size>2*1024*1024)throw new MaintenanceError('snapshot_unavailable')
  const snapshot=JSON.parse(await object.text())as CapturedSnapshot
  const derived=await env.PIPELINE_DB.prepare('SELECT * FROM maintenance_document_derivatives WHERE source_id=? AND raw_sha256=? AND snapshot_key=? AND raw_key=?').bind(snapshot.sourceId,snapshot.rawSha256,key,snapshot.rawKey).first<{text_key:string;text_sha256:string;parser:'poppler'|'tesseract'}>()
  if(derived){snapshot.textKey=derived.text_key;snapshot.textSha256=derived.text_sha256;snapshot.canonicalSha256=derived.text_sha256;snapshot.textArtifact={objectKey:derived.text_key,sha256:derived.text_sha256,rawSnapshotSha256:snapshot.rawSha256,parser:derived.parser}}
  return snapshot
}
export async function captureSource(env:MaintenanceEnv,job:JobRow,row:SourceRow,fetcher:typeof fetch=fetch,wait:typeof pause=pause):Promise<'captured'|'unchanged'|'rich-document'> {
  const hosts=JSON.parse(row.allowed_hosts_json) as string[],url=assertSafeSourceUrl(row.url,hosts)
  const gate=await gateRequest(env,'/fetch/acquire',{host:url.hostname})
  const permit=record(await gate.json())
  if(!gate.ok||!permit?.token)throw new MaintenanceError('fetch_capacity_unavailable',30)
  const token=permit.token,userAgent=env.USER_AGENT??'StudyInChinaDataBot/1.0 (+https://studyinchina.vercel.app/contact)'
  try {
    const now=Date.now(),cached=await env.PIPELINE_DB.prepare('SELECT status,body FROM maintenance_robots WHERE host=? AND expires_at>?').bind(url.hostname,nowIso(now)).first<{status:number;body:string|null}>()
    let robots=cached
    if(!robots) {
      const signal=AbortSignal.timeout(20000),robotsUrl=new URL('/robots.txt',url)
      const fetched=await fetchWithValidatedRedirects(fetcher,robotsUrl,{allowedHosts:[url.hostname]},{headers:{'user-agent':userAgent},signal},3,5000).catch(()=>{throw new MaintenanceError('robots_fetch_failed',3600)})
      const status=fetched.response.status
      const body=status===200?new TextDecoder().decode(await readBoundedBody(fetched.response,256*1024,signal)):null
      if(status!==200)await fetched.response.body?.cancel()
      robots={status,body}
      await env.PIPELINE_DB.prepare('INSERT INTO maintenance_robots VALUES(?,?,?,?) ON CONFLICT(host) DO UPDATE SET status=excluded.status,body=excluded.body,expires_at=excluded.expires_at').bind(url.hostname,status,body,after(24*3600000,now)).run()
      await wait(5000)
    }
    if(![200,404,410].includes(robots.status))throw new MaintenanceError(`robots_http_${robots.status}`)
    if(robots.body&&!isRobotsPathAllowed(robots.body,url,userAgent))throw new MaintenanceError('robots_disallowed')
    const signal=AbortSignal.timeout(20000)
    // A complete body is deliberately retained. An HTTP304 or link-health check
    // alone does not renew factual review dates or certify an old extraction.
    const fetched=await fetchWithValidatedRedirects(fetcher,url,{allowedHosts:[url.hostname]},{headers:{'user-agent':userAgent,accept:'text/html,application/pdf,text/plain;q=0.8'},signal},3,5000).catch(()=>{throw new MaintenanceError('source_fetch_failed',3600)})
    if(!fetched.response.ok){await fetched.response.body?.cancel();throw new MaintenanceError(`source_http_${fetched.response.status}`,[429,500,502,503,504].includes(fetched.response.status)?3600:null)}
    const contentType=fetched.response.headers.get('content-type')??'application/octet-stream'
    const bytes=await readBoundedBody(fetched.response,/^application\/pdf/i.test(contentType)?10*1024*1024:2*1024*1024,signal),rawSha256=await digest(bytes)
    const rawKey=`maintenance/snapshots/${row.source_id}/${rawSha256}.bin`,checkedAt=nowIso()
    await env.SNAPSHOTS_BUCKET.put(rawKey,bytes,{httpMetadata:{contentType}})
    const textSupported=/^(?:text\/(?:html|plain)|application\/xhtml\+xml)/i.test(contentType)
    let text:string|null=null,parserCandidates:unknown[]=[],html:string|null=null
    if(textSupported){html=decodeOfficialBody(bytes,contentType);text=normalizeEvidenceText(/html/i.test(contentType)?htmlToText(html):html);if(!text.trim())throw new MaintenanceError('empty_official_text')}
    if(html&&/html/i.test(contentType))parserCandidates=parseOfficialCatalogHtml(html,{sourceUrl:fetched.finalUrl,allowedHosts:hosts,sourceCategory:row.category as SourceCategory,expectedKind:'auto',maxCandidates:500})
    let textSha256=text===null?null:await digest(text),canonicalSha256=textSha256??rawSha256,textKey=text===null?null:`maintenance/text/${row.source_id}/${textSha256}.txt`
    if(textKey&&text!==null)await env.SNAPSHOTS_BUCKET.put(textKey,text,{httpMetadata:{contentType:'text/plain;charset=utf-8'}})
    const snapshot:CapturedSnapshot={version:1,sourceId:row.source_id,sourceUrl:row.url,finalUrl:fetched.finalUrl.href,checkedAt,contentType,rawSha256,rawKey,textKey,textSha256,canonicalSha256,parserCandidates}
    const key=`maintenance/snapshots/${row.source_id}/${rawSha256}.json`
    if(!textSupported){const derived=await env.PIPELINE_DB.prepare('SELECT * FROM maintenance_document_derivatives WHERE source_id=? AND raw_sha256=? AND raw_key=? AND snapshot_key=?').bind(row.source_id,rawSha256,rawKey,key).first<{text_key:string;text_sha256:string;parser:'poppler'|'tesseract'}>();if(derived){textKey=derived.text_key;textSha256=derived.text_sha256;canonicalSha256=derived.text_sha256;snapshot.textKey=textKey;snapshot.textSha256=textSha256;snapshot.canonicalSha256=canonicalSha256;snapshot.textArtifact={objectKey:textKey,sha256:textSha256,rawSnapshotSha256:rawSha256,parser:derived.parser}}}
    const hasExtractionText=textSupported||Boolean(snapshot.textArtifact)
    // Raw bytes may be identical on a later acquisition. The original metadata
    // remains immutable; the new observation records the actual later check.
    if(!await env.SNAPSHOTS_BUCKET.get(key))await env.SNAPSHOTS_BUCKET.put(key,canonical(snapshot),{httpMetadata:{contentType:'application/json'}})
    const unchanged=row.canonical_sha256===canonicalSha256
    const targetFields=(await env.PIPELINE_DB.prepare('SELECT t.fields_json FROM maintenance_record_targets t JOIN maintenance_target_sources x ON x.target_id=t.target_id WHERE x.source_id=? AND t.active=1').bind(row.source_id).all<{fields_json:string}>()).results??[]
    const cadence=captureCadence(row,targetFields.map(target=>JSON.parse(target.fields_json)as Record<string,unknown>),Date.parse(checkedAt))
    await env.PIPELINE_DB.batch([
      env.PIPELINE_DB.prepare('INSERT OR IGNORE INTO maintenance_observations VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind(await digest(`${job.job_id}:${rawSha256}`),job.job_id,row.source_id,checkedAt,fetched.finalUrl.href,fetched.response.status,rawSha256,canonicalSha256,key,contentType,hasExtractionText?(unchanged?'unchanged':'captured'):'rich_document_pending',parserCandidates.length),
      env.PIPELINE_DB.prepare('UPDATE maintenance_sources SET raw_sha256=?,canonical_sha256=?,snapshot_key=?,etag=?,last_attempt_at=?,last_success_at=?,failures=0,error_code=NULL,due_at=? WHERE source_id=?').bind(rawSha256,canonicalSha256,key,fetched.response.headers.get('etag'),checkedAt,checkedAt,after(cadence.intervalHours*3600000,Date.parse(checkedAt)),row.source_id),
      env.PIPELINE_DB.prepare('UPDATE maintenance_schools SET last_attempt_at=? WHERE university_id IN(SELECT university_id FROM maintenance_source_schools WHERE source_id=?)').bind(checkedAt,row.source_id),
    ])
    if(hasExtractionText)await queueExtraction(env,row,rawSha256,key)
    // A source with unchanged bytes may still have a pending extraction from a
    // previous disabled model lane; scheduler persists/requeues that exact job.
    if(html&&textSupported)await discoverSourceLinks(env,row,html,fetched.finalUrl,hosts,rawSha256)
    return !hasExtractionText?'rich-document':unchanged?'unchanged':'captured'
  } finally {await gateRequest(env,'/fetch/release',{token}).catch(()=>undefined)}
}
