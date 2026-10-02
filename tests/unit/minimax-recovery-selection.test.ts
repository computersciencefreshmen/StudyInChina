import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assertRecoveryTaskNotRepeated,
  buildTaskSelection, copyVerifiedSourceEvidence, modelConfiguration,
  parseCheckpointMaxAgeHours, parseInvocationId, parseSelectionOptions, parseVerificationRunId,
  readTaskSelection, readValidatedSourceReceipt, recoveryReason,
  selectVerificationTasks, shouldReuseCheckpoint, validateSavedRunManifest,
  verificationRunId, type ApiConfig, type RecordResult, type SourceReceipt,
} from '../../scripts/ingestion/verify-catalog-minimax'

const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const inputSha256 = 'a'.repeat(64)
const baseRun = inputSha256.slice(0, 16)
const taskIds = ['programs:one', 'programs:two', 'universities:school']
const api: ApiConfig = { endpoint: 'https://api.minimax.cn/anthropic/v1/messages', key: 'test-only', model: 'MiniMax-M3', anthropic: true }
const now = Date.parse('2026-10-02T00:00:00Z')
const checkpoint: RecordResult = {
  taskId: taskIds[0], checkedAt: new Date(now - 30 * 3_600_000).toISOString(), inputSha256,
  ...modelConfiguration(api), status: 'review-required', sourceIds: ['official'], issues: [],
  verdicts: [{ path: 'tuitionCny', storedValue: null, status: 'unconfirmed', reason: 'Official evidence did not establish this field' }],
}
const source = { id: 'official', url: 'https://school.edu.cn/guide', official: true }
const text = 'Official 2027 degree admissions guide. Tuition is CNY 30000 per academic year. Applications close on December 15, 2026.'
const bytes = new TextEncoder().encode(text)
const receipt: SourceReceipt = {
  sourceId: source.id, url: source.url, finalUrl: source.url, checkedAt: new Date(now - 3_600_000).toISOString(),
  status: 'captured', text, sha256: hash(bytes), textSha256: hash(text), bytes: bytes.byteLength,
}
const temporaryDirectories: string[] = []

describe('Explicit admin verification invocation identity', () => {
  const first = '11111111-1111-4111-8111-111111111111'
  const second = '22222222-2222-4222-8222-222222222222'
  it('gives sample and full commands independent directories while preserving automatic resume', () => {
    const sample = verificationRunId(inputSha256, api, {}, null, first)
    const full = verificationRunId(inputSha256, api, {}, null, second)
    expect(sample).toMatch(/^a{16}-[a-f0-9]{12}$/)
    expect(full).not.toBe(sample)
    expect(sample).not.toBe(baseRun)
    expect(verificationRunId(inputSha256, api, {})).toBe(baseRun)
    expect(verificationRunId(inputSha256, api, {}, null, first)).toBe(sample)
    expect(verificationRunId(inputSha256, { ...api, thinking: 'adaptive' }, {}, null, first)).not.toBe(sample)
  })
  it('validates UUIDs without allowing explicit commands to replay qualified recovery', () => {
    expect(parseInvocationId([])).toBeNull()
    expect(parseInvocationId(['--invocation-id', first.toUpperCase(), '--audit-config'])).toBe(first)
    for (const args of [['--invocation-id'], ['--invocation-id', '../baseline'], ['--invocation-id', first, '--invocation-id', second], ['--invocation-id', first, '--recovery-from', baseRun], ['--invocation-id', first, '--report-only']]) {
      expect(() => parseInvocationId(args)).toThrow()
    }
  })
  it('binds a saved manifest to both the model and explicit invocation', () => {
    const runId = verificationRunId(inputSha256, api, {}, null, first)
    const manifest = { inputSha256, promptVersion: 'catalog-comparison-v1.2', maxSourceChars: 25000, ...modelConfiguration(api), invocationId: first, selection: null }
    expect(() => validateSavedRunManifest(runId, inputSha256, manifest, taskIds)).not.toThrow()
    expect(() => validateSavedRunManifest(runId, inputSha256, { ...manifest, invocationId: second }, taskIds)).toThrow('invocation')
    expect(() => validateSavedRunManifest(runId, inputSha256, { ...manifest, modelConfigSha256: 'b'.repeat(64) }, taskIds)).toThrow('model')
    expect(() => validateSavedRunManifest(baseRun, inputSha256, manifest, taskIds)).toThrow('invocation')
  })
  it('cannot satisfy a fresh command from a baseline or another command checkpoint', () => {
    const reuse = (value: RecordResult, invocationId: string | null) => shouldReuseCheckpoint(value, { taskId: taskIds[0] }, inputSha256, api, false, 168, false, now, invocationId)
    expect(reuse(checkpoint, first)).toBe(false)
    expect(reuse({ ...checkpoint, invocationId: first }, second)).toBe(false)
    expect(reuse({ ...checkpoint, invocationId: first }, null)).toBe(false)
    expect(reuse({ ...checkpoint, invocationId: first }, first)).toBe(true)
    expect(reuse(checkpoint, null)).toBe(true)
  })
})

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('These selection tests must never fetch') }))
})
afterEach(async () => {
  vi.unstubAllGlobals()
  for (const directory of temporaryDirectories.splice(0)) {
    // Resolve and constrain the recursive cleanup to this suite's explicit workspace scratch root.
    if (!resolve(directory).startsWith(resolve('.tmp') + sep)) throw new Error('Unsafe test cleanup path')
    await rm(directory, { recursive: true, force: true })
  }
})

async function fixture() {
  await mkdir(resolve('.tmp'), { recursive: true })
  const directory = await mkdtemp(join(resolve('.tmp'), 'minimax-recovery-selection-'))
  temporaryDirectories.push(directory)
  return directory
}

async function saveSource(directory: string, value = receipt) {
  await mkdir(join(directory, 'sources'), { recursive: true })
  await mkdir(join(directory, 'snapshots'), { recursive: true })
  await writeFile(join(directory, 'sources', `${hash(source.id)}.json`), JSON.stringify(value))
  await writeFile(join(directory, 'snapshots', `${receipt.sha256}.bin`), bytes)
}

describe('MiniMax exact frozen task selection', () => {
  it('canonicalizes a fixed queue subset and keeps it distinct from the baseline and model configuration', () => {
    const one = buildTaskSelection([taskIds[1], taskIds[0]], taskIds, baseRun)
    const reordered = buildTaskSelection([taskIds[0], taskIds[1]], taskIds, baseRun)
    expect(one).toEqual(reordered)
    expect(verificationRunId(inputSha256, api, {})).toBe(baseRun)
    const isolated = verificationRunId(inputSha256, api, {}, one)
    expect(isolated).toMatch(/^a{16}-[a-f0-9]{12}-r[a-f0-9]{12}$/)
    expect(isolated).not.toBe(baseRun)
    expect(verificationRunId(inputSha256, { ...api, thinking: 'adaptive' }, {}, one)).not.toBe(isolated)
    expect(buildTaskSelection([taskIds[0]], taskIds, isolated).selectorSha256).not.toBe(buildTaskSelection([taskIds[0]], taskIds, baseRun).selectorSha256)
    expect(parseVerificationRunId(isolated).selectorPrefix).toBe(one.selectorSha256.slice(0, 12))
  })

  it('rejects empty, duplicate, unknown, non-string and excessive task lists', () => {
    for (const value of [[], null, {}, [taskIds[0], taskIds[0]], ['programs:unknown'], [42], [''], ['x'.repeat(513)]]) expect(() => buildTaskSelection(value, taskIds)).toThrow()
    const excessive = Array.from({ length: 1001 }, (_, index) => `programs:${index}`)
    expect(() => buildTaskSelection(excessive, excessive)).toThrow('1000')
  })

  it('refuses oversized or malformed selector files before any model or source call', async () => {
    const directory = await fixture()
    const file = join(directory, 'ids.json')
    await writeFile(file, JSON.stringify([taskIds[0]]))
    expect((await readTaskSelection(file, taskIds)).taskIds).toEqual([taskIds[0]])
    await writeFile(file, '[')
    await expect(readTaskSelection(file, taskIds)).rejects.toThrow()
    await writeFile(file, ' '.repeat(256 * 1024 + 1))
    await expect(readTaskSelection(file, taskIds)).rejects.toThrow('256 KiB')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('processes an exact list in fixed queue order and never silently truncates its identity', () => {
    const tasks = taskIds.map(taskId => ({ taskId, collection: taskId.split(':')[0] }))
    const selection = buildTaskSelection([taskIds[1], taskIds[0]], taskIds)
    expect(selectVerificationTasks(tasks, selection).map(task => task.taskId)).toEqual(taskIds.slice(0, 2))
    expect(() => selectVerificationTasks(tasks, selection, '', 1)).toThrow('exceeds --limit')
    expect(() => selectVerificationTasks(tasks, selection, 'programs')).toThrow('collection')
    expect(selectVerificationTasks(tasks, null, 'programs', 1).map(task => task.taskId)).toEqual([taskIds[0]])
  })

  it('requires isolated recovery for retries and rejects conflicting or missing options', () => {
    expect(parseSelectionOptions(['--task-ids-file', 'ids.json', '--recovery-from', baseRun, '--retry-unconfirmed'])).toEqual({ taskIdsFile: 'ids.json', recoveryFrom: baseRun })
    for (const args of [
      ['--retry-unconfirmed'], ['--recovery-from', baseRun],
      ['--task-ids-file', 'ids.json', '--retry-unconfirmed'],
      ['--task-ids-file'], ['--task-ids-file', 'one.json', '--task-ids-file', 'two.json'],
      ['--task-ids-file', 'ids.json', '--collection', 'programs'],
      ['--task-ids-file', 'ids.json', '--report-only'],
      ['--task-ids-file', 'ids.json', '--recovery-from', '../outside', '--retry-unconfirmed'],
    ]) expect(() => parseSelectionOptions(args)).toThrow()
  })

  it('validates frozen manifest input, prompt, model and selector bindings for report-only', () => {
    const selection = buildTaskSelection([taskIds[0]], taskIds, baseRun)
    const runId = verificationRunId(inputSha256, api, {}, selection)
    const manifest = { inputSha256, promptVersion: 'catalog-comparison-v1.2', maxSourceChars: 25000, ...modelConfiguration(api), selection }
    expect(() => validateSavedRunManifest(runId, inputSha256, manifest, taskIds)).not.toThrow()
    expect(() => validateSavedRunManifest(runId, 'b'.repeat(64), manifest, taskIds)).toThrow('snapshot')
    expect(() => validateSavedRunManifest(runId, inputSha256, { ...manifest, promptVersion: 'wrong' }, taskIds)).toThrow('prompt')
    expect(() => validateSavedRunManifest(runId, inputSha256, { ...manifest, modelConfigSha256: 'b'.repeat(64) }, taskIds)).toThrow('model')
    expect(() => validateSavedRunManifest(runId, inputSha256, { ...manifest, selection: { ...selection, taskIds: [taskIds[1]] } }, taskIds)).toThrow('selection')
    expect(() => validateSavedRunManifest(baseRun, inputSha256, manifest, taskIds)).toThrow('base run')
    expect(() => parseVerificationRunId(`${baseRun}/../other`)).toThrow()
    expect(() => validateSavedRunManifest(baseRun, inputSha256, { ...manifest, selection: null, modelConfigSha256: undefined }, taskIds)).not.toThrow()
  })
})

describe('MiniMax bounded recovery and checkpoint retention', () => {
  it('blocks a stale overlapping selector before a model request but permits genuinely newly readable evidence', () => {
    expect(() => assertRecoveryTaskNotRepeated(undefined, [receipt])).not.toThrow()
    expect(() => assertRecoveryTaskNotRepeated({ ...checkpoint, sourceEvidence: [{ sourceId: source.id, sha256: receipt.sha256!, textSha256: receipt.textSha256! }] }, [receipt])).toThrow('already attempted')
    expect(() => assertRecoveryTaskNotRepeated({ ...checkpoint, issues: ['MiniMax HTTP 500'], sourceEvidence: [{ sourceId: source.id, sha256: receipt.sha256!, textSha256: receipt.textSha256! }] }, [receipt])).toThrow('already attempted')
    expect(() => assertRecoveryTaskNotRepeated({ ...checkpoint, sourceEvidence: [] }, [receipt])).not.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('extends only matching record reuse and refuses invalid retention arguments', () => {
    expect(parseCheckpointMaxAgeHours([])).toBe(24)
    expect(parseCheckpointMaxAgeHours(['--checkpoint-max-age-hours', '168'])).toBe(168)
    for (const value of ['0', '169', '1.5', '-1', 'NaN', 'Infinity', '1e2']) expect(() => parseCheckpointMaxAgeHours(['--checkpoint-max-age-hours', value])).toThrow()
    expect(() => parseCheckpointMaxAgeHours(['--checkpoint-max-age-hours'])).toThrow()
    expect(() => parseCheckpointMaxAgeHours(['--checkpoint-max-age-hours', '24', '--checkpoint-max-age-hours', '168'])).toThrow()
    expect(shouldReuseCheckpoint(checkpoint, { taskId: taskIds[0] }, inputSha256, api, false, 24, false, now)).toBe(false)
    expect(shouldReuseCheckpoint(checkpoint, { taskId: taskIds[0] }, inputSha256, api, false, 168, false, now)).toBe(true)
    expect(shouldReuseCheckpoint(checkpoint, { taskId: taskIds[1] }, inputSha256, api, false, 168, false, now)).toBe(false)
    expect(shouldReuseCheckpoint(checkpoint, { taskId: taskIds[0] }, 'b'.repeat(64), api, false, 168, false, now)).toBe(false)
    expect(shouldReuseCheckpoint(checkpoint, { taskId: taskIds[0] }, inputSha256, { ...api, model: 'MiniMax-M2.7' }, false, 168, false, now)).toBe(false)
  })

  it('does not repeatedly charge a fixed recovery list for unresolved or failed outcomes', () => {
    const failed = { ...checkpoint, issues: ['MiniMax HTTP 500'] }
    expect(shouldReuseCheckpoint(checkpoint, { taskId: taskIds[0] }, inputSha256, api, false, 1, true, now)).toBe(true)
    expect(shouldReuseCheckpoint(failed, { taskId: taskIds[0] }, inputSha256, api, false, 168, false, now)).toBe(false)
    expect(shouldReuseCheckpoint(failed, { taskId: taskIds[0] }, inputSha256, api, false, 1, true, now)).toBe(true)
    for (const issue of ['MiniMax quota exhausted', 'MiniMax quota unknown']) {
      expect(shouldReuseCheckpoint({ ...checkpoint, issues: [issue] }, { taskId: taskIds[0] }, inputSha256, api, false, 168, true, now)).toBe(false)
    }
  })

  it('allows a model defect with readable evidence but not absence, blocked sources or endless chained retries', () => {
    const omitted = { ...checkpoint, verdicts: [{ ...checkpoint.verdicts[0], reason: 'Missing or duplicate model verdict' }] }
    expect(recoveryReason(omitted, [receipt])).toBe('recoverable-model-verdict')
    expect(recoveryReason({ ...checkpoint, issues: ['MiniMax HTTP 500'] }, [receipt])).toBe('recoverable-model-error')
    expect(recoveryReason(checkpoint, [receipt])).toBeNull()
    expect(recoveryReason(omitted, [{ ...receipt, status: 'unconfirmed' }])).toBeNull()
    expect(recoveryReason(omitted, [receipt], true)).toBeNull()
    expect(recoveryReason({ ...checkpoint, issues: ['MiniMax quota exhausted'] }, [receipt])).toBeNull()
  })

  it('does not mistake quota, authentication or transport interruption for omitted model output', () => {
    const omitted = { ...checkpoint, verdicts: [{ ...checkpoint.verdicts[0], reason: 'Missing or duplicate model verdict' }] }
    for (const issue of ['MiniMax quota exhausted', 'MiniMax quota unknown', 'MiniMax HTTP 401', 'MiniMax HTTP 403', 'MiniMax HTTP 429', 'fetch failed', 'The operation was aborted due to timeout']) {
      expect(recoveryReason({ ...omitted, issues: [issue] }, [receipt])).toBeNull()
    }
    expect(recoveryReason({ ...omitted, issues: ['official: Official source HTTP 503'] }, [receipt])).toBe('recoverable-model-verdict')
    expect(recoveryReason({ ...omitted, issues: ['MiniMax HTTP 500'] }, [receipt])).toBe('recoverable-model-error')
  })

  it('qualifies newly readable registered evidence without replaying unchanged evidence or bypassing auth', () => {
    const blocked = { ...checkpoint, sourceEvidence: [], issues: ['No readable official evidence; no MiniMax call'] }
    expect(recoveryReason(blocked, [receipt], true)).toBe('newly-readable-official-evidence')
    expect(recoveryReason(blocked, [{ ...receipt, sourceId: 'unrelated' }], true)).toBeNull()
    expect(recoveryReason({ ...blocked, issues: ['MiniMax HTTP 403'] }, [receipt], true)).toBeNull()
    expect(recoveryReason({ ...blocked, sourceEvidence: [{ sourceId: source.id, sha256: receipt.sha256!, textSha256: receipt.textSha256! }] }, [receipt], true)).toBeNull()
  })

  it('does not charge another attempt merely because page text or markup changed', () => {
    const prior = { ...checkpoint, sourceEvidence: [{ sourceId: source.id, sha256: 'b'.repeat(64), textSha256: 'b'.repeat(64) }] }
    expect(recoveryReason(prior, [receipt], true)).toBeNull()
    expect(recoveryReason({ ...prior, sourceEvidence: [{ sourceId: source.id, sha256: receipt.sha256!, textSha256: receipt.textSha256! }] }, [receipt], true)).toBeNull()
    expect(recoveryReason({ ...prior, sourceEvidence: [{ sourceId: source.id, sha256: 'b'.repeat(64), textSha256: receipt.textSha256! }] }, [receipt], true)).toBeNull()
    expect(recoveryReason(prior, [{ ...receipt, sourceId: 'unrelated' }], true)).toBeNull()
    expect(recoveryReason({ ...prior, verdicts: [{ ...checkpoint.verdicts[0], status: 'supported' }] }, [receipt], true)).toBeNull()
  })
})

describe('MiniMax frozen source cache recovery', () => {
  it('copies only fresh original bytes and exact text without changing the baseline', async () => {
    const directory = await fixture()
    const baseline = join(directory, 'baseline')
    const isolated = join(directory, 'isolated')
    await saveSource(baseline)
    const original = await readFile(join(baseline, 'sources', `${hash(source.id)}.json`), 'utf8')
    expect(await copyVerifiedSourceEvidence(source, baseline, isolated, ['school.edu.cn'], now)).toBe(true)
    expect(await readFile(join(baseline, 'sources', `${hash(source.id)}.json`), 'utf8')).toBe(original)
    expect(await readValidatedSourceReceipt(source, isolated, ['school.edu.cn'], now)).toEqual(receipt)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('keeps source TTL at 24 hours even when record retention is seven days', async () => {
    const directory = await fixture()
    await saveSource(directory, { ...receipt, checkedAt: new Date(now - 25 * 3_600_000).toISOString() })
    expect(await readValidatedSourceReceipt(source, directory, ['school.edu.cn'], now)).toBeNull()
    expect(await readValidatedSourceReceipt(source, directory, ['school.edu.cn'], now, false)).not.toBeNull()
  })

  it('fails closed for tampered bytes/text, escaping hashes, source mismatch and unapproved redirect hosts', async () => {
    const directory = await fixture()
    await saveSource(directory)
    await writeFile(join(directory, 'snapshots', `${receipt.sha256}.bin`), 'tampered')
    expect(await readValidatedSourceReceipt(source, directory, ['school.edu.cn'], now)).toBeNull()
    for (const invalid of [
      { ...receipt, text: text + 'changed' }, { ...receipt, sha256: '../outside' },
      { ...receipt, sourceId: 'different' }, { ...receipt, url: 'https://other.edu.cn/guide' },
      { ...receipt, finalUrl: 'https://unregistered.example/guide' },
    ]) {
      await saveSource(directory, invalid)
      expect(await readValidatedSourceReceipt(source, directory, ['school.edu.cn'], now)).toBeNull()
    }
    await expect(copyVerifiedSourceEvidence(source, directory, join(directory, 'child'), ['school.edu.cn'], now)).rejects.toThrow('sibling')
    expect(fetch).not.toHaveBeenCalled()
  })
})
