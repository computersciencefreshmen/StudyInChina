import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareMaintenanceCatalog } from '../../scripts/automation/prepare-maintenance-catalog'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) {
  const absolute = resolve(root)
  if (dirname(absolute) !== resolve(tmpdir()) || !basename(absolute).startsWith('maintenance-path-test-')) throw Error('Invalid cleanup target')
  rmSync(absolute, { recursive: true, force: true })
} })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'maintenance-path-test-')); roots.push(root)
  const data = join(root, 'content', 'data'); mkdirSync(data, { recursive: true }); writeFileSync(join(data, 'sentinel.txt'), 'unchanged')
  return { root, data }
}

describe('candidate writer cannot target canonical files in a dry run', () => {
  it.each(['.', 'nested/candidate', '..candidate'])('rejects canonical %s before reading an export or producing any file', async relative => {
    const f = fixture()
    await expect(prepareMaintenanceCatalog({ root: f.root, outputDirectory: resolve(f.data, relative), downloadDirectory: join(f.root, 'missing-export'),
      acceptedAt: '2026-10-24T02:00:00.000Z', apply: false })).rejects.toThrow('maintenance_output_inside_canonical_data')
    expect(readdirSync(f.data)).toEqual(['sentinel.txt'])
    expect(readFileSync(join(f.data, 'sentinel.txt'), 'utf8')).toBe('unchanged')
  })
  it('resolves a directory junction/symlink before producing candidate sidecars', async () => {
    const f = fixture(), alias = join(f.root, 'apparently-safe-output')
    symlinkSync(f.data, alias, 'junction')
    await expect(prepareMaintenanceCatalog({ root: f.root, outputDirectory: join(alias, 'new-candidate'), downloadDirectory: join(f.root, 'missing-export'),
      acceptedAt: '2026-10-24T02:00:00.000Z' })).rejects.toThrow('maintenance_output_inside_canonical_data')
    expect(readdirSync(f.data)).toEqual(['sentinel.txt'])
  })
})
