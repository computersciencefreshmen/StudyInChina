import assert from 'node:assert/strict'
import test from 'node:test'
import { captureSource } from '../src/capture'
import { seed,source } from '../src/repository'
import { MaintenanceError,type JobRow } from '../src/types'
import { digest } from '../src/util'
import { makeEnv,seedInput } from './fixture'

async function fixture(attempt=1){
  const f=makeEnv();await seed(f.env,seedInput())
  const id=await digest('https://test.edu.cn/catalog'),row=await source(f.env,id);assert.ok(row)
  f.db.sqlite.prepare('INSERT INTO maintenance_robots VALUES(?,?,?,?)').run('test.edu.cn',404,null,'2099-01-01T00:00:00.000Z')
  return{...f,row,job:{job_id:'capture-test',source_id:id,attempt}as JobRow}
}
function failure(code:string,retryAfter:number|null){return(error:unknown)=>error instanceof MaintenanceError&&error.code===code&&error.retryAfter===retryAfter}

test('only identified capture transport failures receive the bounded attempt backoff and sanitized stage',async()=>{
  for(const[attempt,retry]of [[1,60],[2,300],[3,900],[4,900]]){
    const f=await fixture(attempt)
    try{
      await assert.rejects(captureSource(f.env,f.job,f.row,async()=>{throw new TypeError('fetch failed',{cause:{code:'ECONNRESET',private:'must-never-be-retained'}})},async()=>{}),failure('source_fetch_failed',retry))
      assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_observations').get()?.n,0)
      assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_model_attempts').get()?.n,0)
      assert.equal(f.messages.length,0)
    }finally{f.db.sqlite.close()}
  }
})
test('a stream transport interruption is source_read_failed, not an undifferentiated execution failure',async()=>{
  const f=await fixture(2)
  try{
    const body=new ReadableStream<Uint8Array>({start(controller){controller.error(new TypeError('terminated'))}})
    await assert.rejects(captureSource(f.env,f.job,f.row,async()=>new Response(body,{headers:{'content-type':'text/plain'}}),async()=>{}),failure('source_read_failed',300))
    assert.equal([...f.bucket.objects.keys()].some(key=>key.startsWith('maintenance/snapshots/')),false)
  }finally{f.db.sqlite.close()}
})
test('the documented workerd connection-loss exception remains a typed transient at the fetch boundary',async()=>{
  const f=await fixture()
  try{await assert.rejects(captureSource(f.env,f.job,f.row,async()=>{throw new Error('Network connection lost.')},async()=>{}),failure('source_fetch_failed',60))}finally{f.db.sqlite.close()}
})
test('arbitrary JavaScript errors, unsafe redirects and permanent body failures do not gain transport retry permission',async()=>{
  for(const kind of ['javascript','typeerror','redirect','oversize','empty','stream-bug']){
    const f=await fixture()
    try{
      const fetcher:typeof fetch=async()=>{
        if(kind==='javascript')throw new Error('application-secret-is-not-a-network-code')
        if(kind==='typeerror')throw new TypeError('Cannot read properties of undefined')
        if(kind==='redirect')return new Response(null,{status:302,headers:{location:'https://foreign.example/private'}})
        if(kind==='oversize')return new Response('x',{headers:{'content-type':'text/plain','content-length':String(3*1024*1024)}})
        if(kind==='empty')return new Response('')
        return new Response(new ReadableStream({start(controller){controller.error(new Error('stream-programming-bug'))}}))
      }
      await assert.rejects(captureSource(f.env,f.job,f.row,fetcher,async()=>{}),(error:unknown)=>{
        if(error instanceof MaintenanceError)return error.retryAfter===null&&!['source_fetch_failed','source_read_failed'].includes(error.code)
        return error instanceof Error
      })
      assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM maintenance_observations').get()?.n,0)
    }finally{f.db.sqlite.close()}
  }
})
test('existing HTTP/robots codes and permanent robots exclusion remain explicit',async()=>{
  for(const status of [404,429,503]){
    const f=await fixture()
    try{await assert.rejects(captureSource(f.env,f.job,f.row,async()=>new Response(null,{status}),async()=>{}),failure(`source_http_${status}`,status===404?null:3600))}finally{f.db.sqlite.close()}
  }
  const f=await fixture()
  try{
    f.db.sqlite.prepare('UPDATE maintenance_robots SET status=200,body=?').run('User-agent: *\nDisallow: /')
    await assert.rejects(captureSource(f.env,f.job,f.row,async()=>{throw Error('must-not-fetch')},async()=>{}),failure('robots_disallowed',null))
  }finally{f.db.sqlite.close()}
})
test('storage failures after receiving a valid body are never classified as retryable network failures',async()=>{
  const f=await fixture()
  try{
    f.bucket.put=async()=>{throw new TypeError('fetch failed')}
    await assert.rejects(captureSource(f.env,f.job,f.row,async()=>new Response('Official international admissions',{headers:{'content-type':'text/plain'}}),async()=>{}),error=>error instanceof TypeError)
  }finally{f.db.sqlite.close()}
})
