import { mkdtempSync, writeFileSync, rmSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createFileSnapshotCache } from '@/lib/data/file-snapshot'

const roots: string[] = []
afterEach(() => { roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })) })
function fixture() { const root = mkdtempSync(join(tmpdir(), 'study-cache-')); roots.push(root); return join(root, 'data.json') }

it('reuses a deeply immutable snapshot and invalidates on same-size atomic writes and missing-file creation', () => {
  const file = fixture(), receipt = file + '.receipt', cache = createFileSnapshotCache<{ nested: { value: string } }>()
  const load = vi.fn((depend: (path: string) => void) => {
    depend(file); depend(receipt)
    return { nested: { value: 'validated' } }
  })
  writeFileSync(file, 'one')
  const first = cache('one', load)
  expect(cache('one', load)).toBe(first)
  expect(Object.isFrozen(first.nested)).toBe(true)
  expect(() => { first.nested.value = 'tampered' }).toThrow()
  writeFileSync(file + '.next', 'two'); renameSync(file + '.next', file)
  expect(cache('one', load)).not.toBe(first)
  writeFileSync(receipt, 'receipt')
  cache('one', load)
  expect(load).toHaveBeenCalledTimes(3)
})

it('never retains failed initialization or serves an old generation after failure', () => {
  const file = fixture(), cache = createFileSnapshotCache<string>()
  writeFileSync(file, 'one')
  expect(cache('key', depend => { depend(file); return 'old' })).toBe('old')
  writeFileSync(file, 'changed')
  expect(() => cache('key', depend => { depend(file); throw Error('corrupt receipt') })).toThrow('corrupt receipt')
  expect(cache('key', depend => { depend(file); return 'recovered' })).toBe('recovered')
})

it('retries concurrent filesystem writes before publishing a generation', () => {
  const file = fixture(), cache = createFileSnapshotCache<number>(), load = vi.fn((depend: (path: string) => void) => {
    depend(file)
    if (load.mock.calls.length === 1) writeFileSync(file, 'new generation')
    return load.mock.calls.length
  })
  writeFileSync(file, 'old')
  expect(cache('key', load)).toBe(2)
  expect(cache('key', load)).toBe(2)
  expect(load).toHaveBeenCalledTimes(2)
})
