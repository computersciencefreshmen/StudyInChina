import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { after, test } from 'node:test'
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { generateAudit } from './audit-catalog-deadlines'

const input = path.resolve(process.env.CATALOG_DEADLINE_TEST_INPUT || 'content/data')
const day = '2026-10-19'
const names = ['catalog-deadlines.json', 'catalog-deadlines.md', 'official-recheck-progress.json']
const root = mkdtempSync(path.join(tmpdir(), 'studyinchina-deadline-preservation-'))
const bundle = path.join(root, 'complete')
const proofs: Record<string, unknown> = { input, auditDate: day, checks: [] }
const results = proofs.checks as unknown[]
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const snapshot = (directory: string) => Object.fromEntries(names.filter(name => existsSync(path.join(directory, name))).map(name => {
  const target = path.join(directory, name), bytes = readFileSync(target)
  return [name, { sha256: sha(bytes), mtimeMs: statSync(target).mtimeMs, bytes: bytes.length }]
}))
const markOld = (directory: string) => names.filter(name => existsSync(path.join(directory, name))).forEach(name =>
  utimesSync(path.join(directory, name), new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z')))
function run(directory = bundle, today = day, size = 20, source = input): string {
  const log = console.log, lines: string[] = []
  console.log = value => { lines.push(String(value)) }
  try { generateAudit(source, directory, today, size) } finally { console.log = log }
  return lines.join('\n')
}

test('same current catalogue reuses all bytes and old mtimes, including updated progress', () => {
  run()
  const progressPath = path.join(bundle, names[2])
  const progress = JSON.parse(readFileSync(progressPath, 'utf8'))
  progress.batches[0].state = 'partial-official-date-review'
  progress.batches[0].receipts.push({ path: 'test-approved-source.json', sha256: 'preserve-real-progress' })
  writeFileSync(progressPath, JSON.stringify(progress, null, 2) + '\n')
  markOld(bundle)
  const before = snapshot(bundle)
  assert.match(run(), /reused immutable audit/)
  assert.deepEqual(snapshot(bundle), before)
  results.push({ check: 'identical-rerun-preserves-edited-progress-json-markdown-and-mtimes', passed: true, before, after: snapshot(bundle) })
})

test('new day and changed batch capacity refuse without touching the original bundle', () => {
  const before = snapshot(bundle)
  assert.throws(() => run(bundle, '2026-10-20'), /unique --output-dir/)
  assert.deepEqual(snapshot(bundle), before)
  assert.throws(() => run(bundle, day, 21), /unique --output-dir/)
  assert.deepEqual(snapshot(bundle), before)
  results.push({ check: 'changed-day-and-options-refuse-with-identical-hashes-and-mtimes', passed: true })
})

test('a changed source snapshot refuses at the same input path without touching the bundle', () => {
  const copiedInput = path.join(root, 'input-copy'), output = path.join(root, 'changed-input')
  mkdirSync(copiedInput)
  for (const name of ['sources', 'cities', 'universities', 'programs', 'admission-cycles', 'scholarships']) {
    copyFileSync(path.join(input, name + '.json'), path.join(copiedInput, name + '.json'))
  }
  run(output, day, 20, copiedInput)
  markOld(output)
  const before = snapshot(output)
  appendFileSync(path.join(copiedInput, 'sources.json'), '\n')
  assert.throws(() => run(output, day, 20, copiedInput), /unique --output-dir/)
  assert.deepEqual(snapshot(output), before)
  results.push({ check: 'changed-canonical-bytes-at-same-input-path-refuse-without-output-writes', passed: true })
})

test('all three incomplete bundle combinations refuse without creating missing files', () => {
  for (let missing = 0; missing < names.length; missing++) {
    const output = path.join(root, 'partial-' + missing)
    mkdirSync(output)
    for (const name of names.filter((_, index) => index !== missing)) copyFileSync(path.join(bundle, name), path.join(output, name))
    markOld(output)
    const before = snapshot(output), fileNames = readdirSync(output).sort()
    assert.throws(() => run(output), /Partial immutable audit bundle; use a unique --output-dir/)
    assert.deepEqual(snapshot(output), before)
    assert.deepEqual(readdirSync(output).sort(), fileNames)
  }
  results.push({ check: 'partial-json-markdown-progress-bundles-refuse-without-reconstruction', passed: true })
})

test('existing pinned production audit is reused without touching any of its three files', () => {
  const target = process.env.CATALOG_DEADLINE_EXISTING_BUNDLE
  if (!target) return
  const before = snapshot(target)
  assert.equal(Object.keys(before).length, 3)
  assert.match(run(target), /reused immutable audit/)
  assert.deepEqual(snapshot(target), before)
  results.push({ check: 'existing-pinned-audit-json-markdown-and-progress-reused-byte-for-byte', passed: true, before, after: snapshot(target) })
})

after(() => {
  const receipt = process.env.CATALOG_DEADLINE_PRESERVATION_RECEIPT
  if (receipt) writeFileSync(receipt, JSON.stringify({ ...proofs, completedAt: new Date().toISOString() }, null, 2) + '\n', { flag: 'wx' })
  // Delete only this test's freshly allocated, explicitly verified temp root.
  assert.equal(path.dirname(root), path.resolve(tmpdir()))
  assert.ok(path.basename(root).startsWith('studyinchina-deadline-preservation-'))
  rmSync(root, { recursive: true, force: true })
})
