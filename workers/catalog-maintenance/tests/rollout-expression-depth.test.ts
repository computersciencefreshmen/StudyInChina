import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { convertV4MiniflareOptions, Miniflare } from 'miniflare'
import { dispositionFence } from '../src/reviewed-terminal-quarantine'
import { legacyModelDispositionFence } from '../src/legacy-model-guards'
import { runtimeDispositionFence, type RuntimeModelDisposition } from '../src/runtime-model-guards'
import { sqlAnd } from '../src/sql-and'

// Use the actual production template and builders; no private source rows,
// operator proof or model payload is included. EXPLAIN compiles, never inserts.
function guardSql(proofCount = 1) {
  const source = readFileSync(new URL('../src/rollout.ts', import.meta.url), 'utf8')
  const safetyFence = source.match(/const safetyFence=`([^`]+)`/)![1]
  const inspectedSource = source.match(/const inspectedSource=`([^`]+)`/)![1]
  const template = source.match(/env\.PIPELINE_DB\.prepare\(`(INSERT INTO maintenance_transaction_guards[^`]+)`\)\.bind\(\.\.\.guardBindings\)/)![1]
  const runtime = runtimeDispositionFence({ proofs: Array.from({ length: proofCount }, (_, index) => ({ proof: { operationId: `synthetic-proof-${index}`, subjects: [] }, detailsJson: '{}' })), attempts: [], jobs: [], state: 'verified' } as unknown as RuntimeModelDisposition)
  const reviewed = dispositionFence({ pinnedJobsJson: '[]', commit: { eventId: 'synthetic-event', detailsJson: '{}', scopeUpgrade: { objectKey: 'synthetic-receipt', sha256: 'a'.repeat(64) } } } as Parameters<typeof dispositionFence>[0], runtime.jobs)
  const legacy = legacyModelDispositionFence({ commit: { registrationEventId: 'synthetic-registration', registrationDetails: '{}', reconciliationEventId: 'synthetic-reconciliation', reconciliationDetails: '{}', lineage: { previous: 'b'.repeat(64), next: 'c'.repeat(64), key: 'synthetic-key', sha256: 'd'.repeat(64) } } } as Parameters<typeof legacyModelDispositionFence>[0], '2026-11-14T00:00:00.000Z', runtime.attempts)
  const fragments: Record<string, string> = { safetyFence, inspectedSource, 'reviewed.sql': reviewed.sql, 'modelReviewed.sql': legacy.sql, 'runtimeReviewed.sql': runtime.sql }
  const grouped = template.replace(/\$\{([^}]+)\}/g, (_, name: string) => fragments[name])
  assert.ok(!grouped.includes('${'))
  let ungrouped = grouped
  for (const part of [safetyFence, reviewed.sql, legacy.sql, runtime.sql]) {
    const needle = ` AND (${part}) AND `
    assert.equal(ungrouped.split(needle).length, 2)
    ungrouped = ungrouped.replace(needle, ` AND ${part} AND `)
  }
  assert.equal(grouped.length, ungrouped.length + 8)
  assert.equal((grouped.match(/\?/g) ?? []).length, 43 + 5 * proofCount)
  // Restore the former flat tuple conjunctions as a failing counterexample.
  // Keep leaf order/content identical; do not parse or simplify arbitrary SQL.
  const attemptFields = ['reservation_key','attempt_id','source_id','snapshot_sha256','pass','request_sha256','model','status','started_at','completed_at','output_key','output_sha256','usage_json','quota_json','error_code']
  const leaseFields = ['job_id','source_id','stage','status','attempt','created_at','updated_at','due_at','lease_token','lease_until','snapshot_sha256','snapshot_key','error_code','target_ids_json']
  const jobFields = [...leaseFields.slice(0, 4), 'priority', ...leaseFields.slice(4)]
  for (const [alias, fields, json] of [['j', leaseFields, 'q'], ['a', attemptFields, 'p'], ['a', jobFields, 'p']] as const) {
    const clauses = fields.map(field => `${alias}.${field} IS json_extract(${json}.value,'$.${field}')`)
    ungrouped = ungrouped.split(sqlAnd(clauses)).join(clauses.join(' AND '))
  }
  return { grouped, ungrouped }
}

test('native D1 compiles the grouped complete guard without dropping a predicate or binding', { timeout: 30000 }, async t => {
  const mf = new Miniflare(convertV4MiniflareOptions({ name: 'rollout-expression-depth-test', modules: true, script: 'export default { fetch() { throw Error("no outbound request permitted") } }', compatibilityDate: '2026-09-18', host: '127.0.0.1', port: 0, cf: false, telemetry: { enabled: false }, d1Databases: { DB: 'rollout-expression-depth-db' } }))
  try {
    await mf.ready
    const db = await mf.getD1Database('DB')
    for (const name of ['0019_catalog_maintenance.sql', '0021_maintenance_scope_upgrades.sql']) {
      const migration = readFileSync(new URL(`../../../infra/d1/pipeline/migrations/${name}`, import.meta.url), 'utf8')
      for (const statement of migration.replace(/^--.*$/gm, '').split(';').map(s => s.trim()).filter(Boolean)) await db.prepare(statement).run()
    }
    const { grouped, ungrouped } = guardSql(), params = Array(48).fill(null)
    let oldDepthExceeded = false
    try { await db.prepare(`EXPLAIN ${ungrouped}`).bind(...params).all() } catch (error) {
      assert.match(String(error), /Expression tree is too large.*maximum depth 100/i)
      oldDepthExceeded = true
    }
    t.diagnostic(oldDepthExceeded ? 'Local native D1 reproduced the production maximum-depth-100 failure.' : 'Local native D1 did not reproduce its production depth limit; remote EXPLAIN is the authoritative regression evidence.')
    const compiled = await db.prepare(`EXPLAIN ${grouped}`).bind(...params).all()
    assert.equal(compiled.success, true); assert.ok(compiled.results.length > 0)
    const maxIndexedProofs = guardSql(32).grouped
    assert.equal((maxIndexedProofs.match(/\?/g) ?? []).length, 203)
    // This isolates expression depth. 203 actual bindings exceed D1's separate
    // 100-parameter limit: MAX_PROOFS is NOT a rollout submission capacity.
    assert.equal((await db.prepare(`EXPLAIN ${maxIndexedProofs.replace(/\?/g, 'NULL')}`).all()).success, true)
    assert.equal((await db.prepare('SELECT COUNT(*) count FROM maintenance_transaction_guards').first<{ count: number }>())!.count, 0)
    assert.equal((await db.prepare('SELECT COUNT(*) count FROM maintenance_events').first<{ count: number }>())!.count, 0)
    assert.equal((await db.prepare('SELECT COUNT(*) count FROM maintenance_control').first<{ count: number }>())!.count, 0)
  } finally { await mf.dispose() }
})

test('balanced pure AND preserves all three-valued cases and lexical parameter order', async () => {
  const { DatabaseSync } = await import('node:sqlite'), db = new DatabaseSync(':memory:')
  try {
    for (const a of [0, 1, null]) for (const b of [0, 1, null]) for (const c of [0, 1, null]) {
      const values = [a, b, c], flat = db.prepare('SELECT ? AND ? AND ? value').get(...values)
      assert.deepEqual(db.prepare(`SELECT ${sqlAnd(['?', '?', '?'])} value`).get(...values), flat)
    }
    assert.equal(sqlAnd(['a=?1', 'b=?2', 'c=?3', 'd=?4', 'e=?5']).replace(/[()]/g, ''), 'a=?1 AND b=?2 AND c=?3 AND d=?4 AND e=?5')
    assert.throws(() => sqlAnd([]), /sql_and_requires_clause/)
  } finally { db.close() }
})
