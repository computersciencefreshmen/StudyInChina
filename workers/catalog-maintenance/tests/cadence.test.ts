import assert from 'node:assert/strict'
import test from 'node:test'
import { captureCadence } from '../src/cadence'
import { captureSource } from '../src/capture'
import { seed,source } from '../src/repository'
import type { JobRow } from '../src/types'
import { digest } from '../src/util'
import { makeEnv,seedInput } from './fixture'

const now=Date.parse('2026-10-25T04:00:00.000Z'),catalog={category:'undergraduate_catalog',interval_hours:168}
test('capture cadence uses future calendar dates only and retains directory/profile maintenance intervals',()=>{
  assert.deepEqual(captureCadence(catalog,[{closesOn:'2026-10-28'}],now),{intervalHours:24,priority:0})
  assert.deepEqual(captureCadence(catalog,[{deadline:'2026-11-15'}],now),{intervalHours:72,priority:1})
  assert.deepEqual(captureCadence(catalog,[{deadline:'2027-03-01'}],now),{intervalHours:168,priority:1})
  assert.deepEqual(captureCadence(catalog,[{deadline:'2026-02-30',closesOn:'2026-10-24'}],now),{intervalHours:168,priority:1})
  assert.equal(captureCadence({...catalog,interval_hours:12},[{deadline:'2026-10-28'}],now).intervalHours,12)
  assert.deepEqual(captureCadence(catalog,[],now),{intervalHours:720,priority:10})
  assert.deepEqual(captureCadence({category:'contacts',interval_hours:2160},[],now),{intervalHours:2160,priority:10})
  assert.equal(captureCadence({...catalog,interval_hours:720},[{closesOn:null}],now).intervalHours,168)
})
test('successful real capture stores the chosen due date without changing canonical target values or review dates',async()=>{
  const originalClock=Date.now;Date.now=()=>now
  try{for(const item of [{fields:{closesOn:'2026-10-28'},hours:24},{fields:{closesOn:'2026-11-15'},hours:72},{fields:{closesOn:null},hours:168},{fields:null,hours:720}]){
    const f=makeEnv(),sourceId=await digest('https://test.edu.cn/catalog'),target={recordId:'cycle-one',entityType:'admission-cycle',universityId:'uni-000',sourceIds:[sourceId],recordScopeSha256:'d'.repeat(64),identity:{programId:'program-one'},year:'2026-2027',intake:'spring',fields:item.fields??{},reviewAfter:'2026-10-24'}
    try{await seed(f.env,{...seedInput(),recordTargets:item.fields?[target]:[]},now)
      const before=f.db.sqlite.prepare('SELECT target_json FROM maintenance_record_targets').get()?.target_json,row=await source(f.env,sourceId);assert.ok(row)
      const job={job_id:'capture-test',source_id:sourceId}as JobRow
      await captureSource(f.env,job,row,async input=>String(input).endsWith('/robots.txt')?new Response('',{status:404}):new Response('<p>Official international admissions catalogue</p>',{headers:{'content-type':'text/html'}}),async()=>{})
      const observed=await source(f.env,sourceId);assert.equal(Date.parse(observed!.due_at)-now,item.hours*3600000)
      assert.equal(f.db.sqlite.prepare('SELECT target_json FROM maintenance_record_targets').get()?.target_json,before)
      if(item.hours===24)assert.equal(f.db.sqlite.prepare("SELECT priority FROM maintenance_jobs WHERE stage='maintain'").get()?.priority,0)
    }finally{f.db.sqlite.close()}
  }}finally{Date.now=originalClock}
})
