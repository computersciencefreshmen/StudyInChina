import assert from 'node:assert/strict'
import test from 'node:test'
import { namesBelongToPartition, programPartitionInput, programPartitionRowHints } from '../src/program-partitions'
import { canonical, digest } from '../src/util'

const text = 'International students: bachelor catalogue.\n1 Accounting\n2 Biology\n'
const start = text.indexOf('1 Accounting'), end = text.indexOf('2 Biology')
async function scope(change: Record<string, unknown> = {}) {
  const content = { kind: 'program-identity-partition-v1', fullTextSha256: await digest(text), page: 1,
    rowNumbers: [1], contextRanges: [{ start: 0, end: start }], targetRanges: [{ start, end }], ...change }
  return JSON.stringify({ ...content, sha256: await digest(canonical(content)) })
}
test('partition sends exact saved context and selected rows while retaining full-document evidence', async () => {
  const input = await programPartitionInput(text, await digest(text), await scope())
  assert.equal(input.targetText, text.slice(start, end))
  assert.equal(input.text, `${text.slice(0, start)}\n${text.slice(start, end)}`)
  assert.equal(namesBelongToPartition({ en: 'Accounting' }, input.targetText), true)
  assert.equal(namesBelongToPartition({ en: 'Biology' }, input.targetText), false)
  assert.equal(text.includes('2 Biology'), true)
})
test('corrupt pins, ranges, overlapping context and duplicate rows fail before any model admission', async () => {
  const hash = await digest(text)
  await assert.rejects(programPartitionInput(text + 'changed', hash, await scope()), /checksum_mismatch/)
  await assert.rejects(programPartitionInput(text, hash, await scope({ targetRanges: [{ start: 43, end: 999 }] })), /range_invalid/)
  await assert.rejects(programPartitionInput(text, hash, await scope({ contextRanges: [{ start: 0, end: 50 }] })), /range_invalid/)
  await assert.rejects(programPartitionInput(text, hash, await scope({ rowNumbers: [1, 1] })), /range_invalid/)
  const invalid = JSON.parse(await scope()); invalid.sha256 = '0'.repeat(64)
  await assert.rejects(programPartitionInput(text, hash, JSON.stringify(invalid)), /checksum_mismatch/)
})
test('absence of an explicit partition retains the complete original source without truncation', async () => {
  const full = 'x'.repeat(50001)
  const input = await programPartitionInput(full, await digest(full), null)
  assert.equal(input.text.length, 50001)
  assert.equal(input.metadata, null)
  assert.equal(namesBelongToPartition({ en: 'unpartitioned' }, null), true)
})
test('numbered row hints copy only readable cells within the explicitly targeted row numbers', () => {
  const rows = '1 比较教育学 英文/English 博士/Ph.D. 学术学位 2 比较教育学 中文/Chinese 硕士/Master 3 高等教育学 English 博士/Ph.D.'
  assert.deepEqual(programPartitionRowHints(rows, [1, 2]), [
    { kind: 'numbered-program-row', name: '比较教育学', degreeLevel: 'doctorate', rowNumber: 1 },
    { kind: 'numbered-program-row', name: '比较教育学', degreeLevel: 'master', rowNumber: 2 },
  ])
  assert.deepEqual(programPartitionRowHints(null, [1]), [])
})
