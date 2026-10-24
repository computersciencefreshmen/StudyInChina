import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import type { D1Database, D1PreparedStatement, D1Result } from '../../publisher/src/types'
import type { Bucket, DurableStorage, MaintenanceEnv, MaintenanceMessage } from '../src/types'
import { ModelAdmission } from '../src/admission'

class Statement implements D1PreparedStatement {
  private values:unknown[]=[]
  constructor(private readonly db:DatabaseSync,private readonly sql:string){}
  bind(...values:unknown[]){this.values=values;return this}
  async first<T>():Promise<T|null>{return this.db.prepare(this.sql).get(...this.values as never[]) as T??null}
  async all<T>():Promise<D1Result<T>>{return{success:true,results:this.db.prepare(this.sql).all(...this.values as never[]) as T[]}}
  async run<T>():Promise<D1Result<T>>{return this.runSync()as D1Result<T>}
  runSync():D1Result{return{success:true,meta:{changes:Number(this.db.prepare(this.sql).run(...this.values as never[]).changes)}}}
}
export class TestD1 implements D1Database {
  readonly sqlite=new DatabaseSync(':memory:')
  constructor(){this.sqlite.exec(readFileSync(new URL('../../../infra/d1/pipeline/migrations/0019_catalog_maintenance.sql',import.meta.url),'utf8'))}
  prepare(sql:string){return new Statement(this.sqlite,sql)}
  async batch<T>(statements:D1PreparedStatement[]):Promise<D1Result<T>[]>{this.sqlite.exec('BEGIN IMMEDIATE');try{const result=statements.map(s=>(s as Statement).runSync()as D1Result<T>);this.sqlite.exec('COMMIT');return result}catch(error){this.sqlite.exec('ROLLBACK');throw error}}
}
export class MemoryBucket implements Bucket {
  readonly objects=new Map<string,Uint8Array>()
  private readonly versions=new Map<string,number>()
  async get(key:string){const value=this.objects.get(key);if(!value)return null;return{etag:String(this.versions.get(key)??1),size:value.length,text:async()=>new TextDecoder().decode(value),arrayBuffer:async()=>value.slice().buffer}}
  async put(key:string,value:string|ArrayBuffer|Uint8Array|ReadableStream<Uint8Array>,options?:{onlyIf?:{etagDoesNotMatch?:string;etagMatches?:string}}){if(options?.onlyIf?.etagDoesNotMatch==='*'&&this.objects.has(key)||options?.onlyIf?.etagMatches&&String(this.versions.get(key)??1)!==options.onlyIf.etagMatches)return null;const bytes=value instanceof ReadableStream?new Uint8Array(await new Response(value).arrayBuffer()):typeof value==='string'?new TextEncoder().encode(value):new Uint8Array(value);this.objects.set(key,bytes);this.versions.set(key,(this.versions.get(key)??0)+1);return{key}}
}
export class MemoryStorage implements DurableStorage {
  readonly values=new Map<string,unknown>();private tail=Promise.resolve()
  async get<T>(key:string):Promise<T|undefined>{return structuredClone(this.values.get(key))as T|undefined}
  async put<T>(key:string,value:T){this.values.set(key,structuredClone(value))}
  async delete(key:string){return this.values.delete(key)}
  async transaction<T>(body:(txn:DurableStorage)=>Promise<T>):Promise<T>{const previous=this.tail;let unlock=()=>{};this.tail=new Promise<void>(done=>{unlock=done});await previous;try{return await body(this)}finally{unlock()}}
}
export const TEST_SCOPE='a'.repeat(64),TEST_CATALOG='b'.repeat(64),TEST_GUARDS='c'.repeat(64)
export function seedInput(){return{scopeRegistrySha256:TEST_SCOPE,inputCatalogSha256:TEST_CATALOG,schools:Array.from({length:272},(_,index)=>({universityId:`uni-${String(index).padStart(3,'0')}`,name:{en:`University ${index}`},sourceSeeds:index===0?[{id:'official-test',url:'https://test.edu.cn/catalog',allowedHosts:['test.edu.cn'],sourceCategory:'undergraduate_catalog',enabled:true,registration:'catalogue_official'}]:[]})),legacyGuards:{artifactSha256:TEST_GUARDS,entries:[]}}}
export function makeEnv(fetcher:typeof fetch=async()=>{throw new Error('unexpected_network')}):{env:MaintenanceEnv;db:TestD1;bucket:MemoryBucket;storage:MemoryStorage;messages:MaintenanceMessage[]} {
  const db=new TestD1(),bucket=new MemoryBucket(),storage=new MemoryStorage(),messages:MaintenanceMessage[]=[]
  const env:MaintenanceEnv={PIPELINE_DB:db,SNAPSHOTS_BUCKET:bucket,MAINTENANCE_QUEUE:{async send(message){messages.push(message)}},MODEL_ADMISSION:null as never,MAINTENANCE_ADMIN_TOKEN:'test-only-maintenance-token-123456789',MINIMAX_SUBSCRIPTION_KEY:'test-only-subscription',MINIMAX_MODEL:'MiniMax-M3',MINIMAX_ANTHROPIC_BASE:'https://api.minimaxi.com/anthropic',MAINTENANCE_ENABLED:'true',SCOPE_REGISTRY_SHA256:TEST_SCOPE,MODEL_CONCURRENCY:'4'}
  const admission=new ModelAdmission({storage},env,fetcher)
  env.MODEL_ADMISSION={idFromName:name=>name,get:()=>({fetch:request=>admission.fetch(request)})}
  return{env,db,bucket,storage,messages}
}
export function quotaResponse(five=80,weekly=90){const now=Date.now(),hour=3600000;return Response.json({base_resp:{status_code:0},model_remains:[{model_name:'general',current_interval_remaining_percent:five,current_weekly_remaining_percent:weekly,start_time:now-hour,end_time:now+4*hour,weekly_start_time:now-24*hour,weekly_end_time:now+6*24*hour}]})}
