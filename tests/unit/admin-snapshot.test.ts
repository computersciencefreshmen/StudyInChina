import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readVerificationRun } from '../../src/lib/admin/snapshot'

let directory: string
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'studyinchina-admin-'))
  await mkdir(join(directory, 'responses'))
})
afterAll(async () => {
  if (!resolve(directory).startsWith(resolve(join(tmpdir(), 'studyinchina-admin-')))) throw new Error('Refusing cleanup outside fixture directory')
  await rm(directory, { recursive: true, force: true })
})

describe('administrator bounded file projections', () => {
  it('reads usage and aggregates while excluding provider secrets, paths and source text', async () => {
    await writeFile(join(directory, 'status.json'), JSON.stringify({ status: 'running', pid: 0, selectedRecords: 20, completedRecords: 3, model: 'MiniMax-M3', updatedAt: '2026-09-30T10:00:00Z', fatal: 'credential private-secret' }))
    await writeFile(join(directory, 'manifest.json'), JSON.stringify({ key: 'private-secret', endpoint: 'https://private.test', selectedRecords: 20 }))
    await writeFile(join(directory, 'report.json'), JSON.stringify({ generatedAt: '2026-09-30T10:00:00Z', summary: { supportedCandidateFields: 10, contradictedCandidateFields: 2, unconfirmedFields: 8, modelErrorRecords: 1 }, results: [{ untrustedSourceText: 'private-secret' }] }))
    await writeFile(join(directory, 'responses', `${'a'.repeat(64)}.json`), JSON.stringify({ checkedAt: '2026-09-30T10:00:00Z', model: 'MiniMax-M3', output: { text: 'private-secret'.repeat(5_000) }, usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 30 } }))
    const value = await readVerificationRun(directory, 'a'.repeat(16))
    expect(value).toMatchObject({ completedRecords: 3, selectedRecords: 20, alive: false, summary: { supportedCandidateFields: 10 }, tokenUsage: { inputTokens: 130, outputTokens: 20, totalTokens: 150, requests: 1 } })
    expect(JSON.stringify(value)).not.toMatch(/private-secret|private\.test|untrustedSourceText/)
    expect(value.fatal).toBe('核验进程报告错误')
  })
})
