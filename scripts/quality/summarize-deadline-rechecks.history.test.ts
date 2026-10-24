import assert from 'node:assert/strict'
import test from 'node:test'
import { assertCurrentAuditDay, assertHistoricalSnapshotContext } from './summarize-deadline-rechecks'

const names = ['sources.json', 'cities.json', 'universities.json', 'programs.json', 'admission-cycles.json', 'scholarships.json']
const hashes = Object.fromEntries(names.map(name => [name, 'a'.repeat(64)]))
const publicIds = { sources: ['s'], cities: ['c'], universities: ['u'], programs: ['p'], admissionCycles: ['a'], scholarships: ['w'] }
const inventory = () => ({ today: '2026-10-20', generatedAt: '2026-10-20T00:00:00Z', snapshotSha256: 'snapshot', inputFileSha256: { ...hashes } })
const context = () => ({ auditDate: '2026-10-19', evaluatedForDate: '2026-10-20', snapshotSha256: 'snapshot', inputFileSha256: { ...hashes }, auditedPublicIds: structuredClone(publicIds), currentPublicIds: structuredClone(publicIds) })
const check = (i = inventory(), c = context()) => assertHistoricalSnapshotContext(i, c, '2026-10-20')

test('explicit historical aggregation accepts identical inputs and all six current public ID sets', () => assert.doesNotThrow(() => check()))
test('default audit-day guard still refuses an old audit on a new day', () => assert.throws(() => assertCurrentAuditDay('2026-10-19', '2026-10-20')))
test('rejects stale inventory day', () => assert.throws(() => check({ ...inventory(), today: '2026-10-19' })))
test('rejects an old generation time even if inventory day was changed', () => assert.throws(() => check({ ...inventory(), generatedAt: '2026-10-19T00:00:00Z' })))
test('rejects changed snapshot fingerprint', () => assert.throws(() => check({ ...inventory(), snapshotSha256: 'changed' })))
test('rejects any changed canonical input hash', () => { const i = inventory(); i.inputFileSha256['programs.json'] = 'b'.repeat(64); assert.throws(() => check(i)) })
test('rejects a date projection change even when counts are equal', () => { const c = context(); c.currentPublicIds.programs = ['different-program']; assert.throws(() => check(inventory(), c)) })
test('rejects missing public collections and a falsely labelled evaluation date', () => { const c = context(); delete (c.currentPublicIds as Partial<typeof publicIds>).sources; assert.throws(() => check(inventory(), c)); assert.throws(() => check(inventory(), { ...context(), evaluatedForDate: '2026-10-19' })) })
