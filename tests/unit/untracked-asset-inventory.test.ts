import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assembleUntrackedInventory,
  classifyUntrackedPath,
  createUntrackedInventoryEntry,
  parseInventoryArgs,
} from '../../scripts/quality/inventory-untracked-assets'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

describe('untracked asset inventory', () => {
  it.each([
    ['quality/raw/school-page.pdf', 'raw_evidence', 'private_r2_raw_evidence'],
    ['quality/minimax-harvest/completed/result.json', 'structured_candidate', 'quarantine_candidate'],
    ['scripts/ingestion/new-adapter.ts', 'source_code', 'code_test_review'],
    ['tests/unit/new-adapter.test.ts', 'test', 'code_test_review'],
    ['infra/d1/catalog/migrations/0010_release.sql', 'database_migration', 'code_test_review'],
    ['.tmp-second-wave-coverage.json', 'temporary', 'temp_ignore'],
  ])('classifies %s without mutating it', (filePath, contentClass, suggestedStatus) => {
    expect(classifyUntrackedPath(filePath)).toMatchObject({ contentClass, suggestedStatus })
  })

  it('computes the byte size and SHA-256 of a regular file', async () => {
    const root = mkdtempSync(join(tmpdir(), 'studyinchina-untracked-'))
    temporaryDirectories.push(root)
    mkdirSync(join(root, 'quality', 'raw'), { recursive: true })
    const contents = Buffer.from('official source snapshot\n', 'utf8')
    writeFileSync(join(root, 'quality', 'raw', 'page.html'), contents)

    const entry = await createUntrackedInventoryEntry(root, 'quality/raw/page.html')

    expect(entry.byteSize).toBe(contents.byteLength)
    expect(entry.sha256).toBe(createHash('sha256').update(contents).digest('hex'))
    expect(entry.suggestedStatus).toBe('private_r2_raw_evidence')
  })

  it('assembles deterministic totals for review and archival queues', () => {
    const report = assembleUntrackedInventory('C:/repo', [
      {
        path: 'raw/page.pdf',
        extension: '.pdf',
        byteSize: 10,
        sha256: 'a'.repeat(64),
        contentClass: 'raw_evidence',
        suggestedStatus: 'private_r2_raw_evidence',
        classificationReason: 'raw',
      },
      {
        path: 'scripts/new.ts',
        extension: '.ts',
        byteSize: 5,
        sha256: 'b'.repeat(64),
        contentClass: 'source_code',
        suggestedStatus: 'code_test_review',
        classificationReason: 'code',
      },
    ], '2026-08-05T00:00:00.000Z')

    expect(report.summary).toEqual({
      totalFiles: 2,
      totalBytes: 15,
      byContentClass: { raw_evidence: 1, source_code: 1 },
      bySuggestedStatus: { private_r2_raw_evidence: 1, code_test_review: 1 },
    })
  })

  it('requires an explicit JSON output path', () => {
    expect(() => parseInventoryArgs([])).toThrow('--output is required')
    expect(() => parseInventoryArgs(['--output', 'report.txt'])).toThrow('.json extension')
    expect(parseInventoryArgs(['--repo', 'fixture', '--output', 'audit.json'])).toEqual({
      repositoryPath: 'fixture',
      outputPath: 'audit.json',
    })
  })
})
