import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { makeEnv } from './fixture'

test('target/source/latest-observation lookups use bounded indexes after the additive migration',()=>{
  const f=makeEnv()
  try{
    const sql=readFileSync(new URL('../../../infra/d1/pipeline/migrations/0022_maintenance_lookup_indexes.sql',import.meta.url),'utf8')
    f.db.sqlite.exec(sql);f.db.sqlite.exec(sql)
    for(const [query,index,values] of [
      ['SELECT target_json FROM maintenance_record_targets WHERE active=1 AND record_id IN(?,?)','maintenance_target_record_lookup',['a','b']],
      ['SELECT target_id FROM maintenance_target_sources WHERE source_id=?','maintenance_target_source_lookup',['a']],
      ['SELECT checked_at FROM maintenance_observations WHERE source_id=? ORDER BY checked_at DESC LIMIT 1','maintenance_observation_latest',['a']],
    ] as const){
      const plan=f.db.sqlite.prepare(`EXPLAIN QUERY PLAN ${query}`).all(...values).map(row=>String(row.detail)).join('\n')
      assert.ok(plan.includes(index),plan)
      assert.doesNotMatch(plan,/SCAN maintenance_record_targets|SCAN maintenance_target_sources|SCAN maintenance_observations/)
    }
    assert.deepEqual(f.db.sqlite.prepare('PRAGMA foreign_key_check').all(),[])
  }finally{f.db.sqlite.close()}
})
