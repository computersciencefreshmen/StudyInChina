import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildRecoveryLedger, fieldPriority, fieldRecoveryCategory, linkResponseReceipts, priorRecoveryAttempts, saveRecoveryLedger } from '../../scripts/ingestion/build-minimax-recovery-ledger'
import { buildClaims, buildTaskSelection, modelConfiguration, verificationRunId, type RecordResult, type Task } from '../../scripts/ingestion/verify-catalog-minimax'

const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const model = modelConfiguration({ endpoint: 'https://api.minimax.cn/anthropic/v1/messages', key: 'test-only', model: 'MiniMax-M3', anthropic: true })
const now = Date.parse('2026-10-02T00:00:00Z')
const timestamp = new Date(now - 1_000).toISOString()
const temporaryDirectories: string[] = []

afterEach(async () => {
  vi.unstubAllGlobals()
  for (const directory of temporaryDirectories.splice(0)) {
    if (!resolve(directory).startsWith(resolve('.tmp') + sep)) throw new Error('Unsafe ledger test cleanup path')
    await rm(directory, { recursive: true, force: true })
  }
})

const task: Task = { taskId: 'programs:first', collection: 'programs', record: { id: 'first', durationMonths: 24 }, sourceIds: [], claims: [{ path: 'durationMonths', value: 24 }] }
const checkpoint: RecordResult = { taskId: task.taskId, inputSha256: 'a'.repeat(64), checkedAt: timestamp, ...model, status: 'review-required', sourceIds: [], issues: [],
  verdicts: [{ path: 'durationMonths', storedValue: 24, status: 'unconfirmed', reason: 'Missing or duplicate model verdict' }] }

async function fixture() {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('The ledger must never fetch') }))
  await mkdir(resolve('.tmp'), { recursive: true })
  const root = await mkdtemp(join(resolve('.tmp'), 'minimax-ledger-'))
  temporaryDirectories.push(root)
  const source = { id: 'official', official: true, url: 'https://school.edu.cn/guide' }
  const data = { universities: [], programs: [{ id: 'first', sourceIds: [source.id], durationMonths: 24 }, { id: 'never', durationMonths: null }], 'admission-cycles': [], scholarships: [{ id: 'scholarship', deadline: null }], cities: [], sources: [source] }
  const inputSha256 = hash(JSON.stringify({ data, promptVersion: 'catalog-comparison-v1.2', sourceChars: 25000 }))
  const runId = inputSha256.slice(0, 16)
  const directory = join(root, '.official-harvest/minimax-verification', runId)
  await mkdir(join(directory, 'records'), { recursive: true })
  await mkdir(join(directory, 'sources'), { recursive: true })
  await mkdir(join(directory, 'snapshots'), { recursive: true })
  await mkdir(join(directory, 'responses'), { recursive: true })
  await writeFile(join(directory, 'input-snapshot.json'), JSON.stringify(data))
  const totalClaims = Object.values(data).flat().reduce((total, record) => total + buildClaims(record).length, 0)
  await writeFile(join(directory, 'manifest.json'), JSON.stringify({ inputSha256, promptVersion: 'catalog-comparison-v1.2', maxSourceChars: 25000, ...model, totalClaims, totalRecords: 4 }))
  await writeFile(join(directory, 'records', `${hash(task.taskId)}.json`), JSON.stringify({ ...checkpoint, inputSha256, sourceIds: [source.id] }))
  const text = 'Official admissions information. This degree course is taught in English and takes two academic years to complete.'
  const bytes = new TextEncoder().encode(text)
  await writeFile(join(directory, 'sources', `${hash(source.id)}.json`), JSON.stringify({ sourceId: source.id, url: source.url, finalUrl: source.url, status: 'captured', checkedAt: timestamp, text, sha256: hash(bytes), textSha256: hash(text), bytes: bytes.byteLength }))
  await writeFile(join(directory, 'snapshots', `${hash(bytes)}.bin`), bytes)
  const response = { checkedAt: new Date(now - 1_010).toISOString(), ...model, requestSha256: 'b'.repeat(64), output: { results: [{ taskId: task.taskId, verdicts: [] }] } }
  await writeFile(join(directory, 'responses', `${hash(task.taskId)}.json`), JSON.stringify(response))
  return { root, directory, runId, inputSha256, data, source, bytes }
}

describe('MiniMax field recovery ledger', () => {
  it('prioritizes exact applicant decision fields and preserves the other field queue', () => {
    expect(fieldPriority('admission-cycles', 'closesOn')).toBe('deadline')
    expect(fieldPriority('admission-cycles', 'tuitionPeriod')).toBe('tuition')
    expect(fieldPriority('admission-cycles', 'applicationFeeCny')).toBe('application-fee')
    expect(fieldPriority('programs', 'languageRequirements.0.minimum')).toBe('language')
    expect(fieldPriority('programs', 'durationMonthsMax')).toBe('duration')
    expect(fieldPriority('scholarships', 'eligibility.0.en')).toBe('scholarship-eligibility')
    expect(fieldPriority('universities', 'rankings.0.rank')).toBe('other')
  })

  it('does not confuse skipped generation and HTTP 500 with omitted model output', () => {
    expect(fieldRecoveryCategory(null, undefined, null, 'durationMonths')).toBe('not-attempted')
    expect(fieldRecoveryCategory({ ...checkpoint, issues: ['No readable official evidence; no MiniMax call'] }, checkpoint.verdicts[0], null, 'durationMonths')).toBe('no-readable-evidence')
    expect(fieldRecoveryCategory({ ...checkpoint, issues: ['MiniMax HTTP 500'] }, checkpoint.verdicts[0], null, 'durationMonths')).toBe('model-http-500')
    expect(fieldRecoveryCategory({ ...checkpoint, issues: ['MiniMax quota unknown'] }, checkpoint.verdicts[0], null, 'durationMonths')).toBe('quota-interrupted')
    expect(fieldRecoveryCategory(checkpoint, checkpoint.verdicts[0], null, 'durationMonths')).toBe('output-defect-without-linked-response')
  })

  it('links a real batch receipt even when the model entirely omitted one record and distinguishes duplicates', () => {
    const second = { ...task, taskId: 'programs:second' }
    const receipt = { file: `${hash(`${task.taskId}|${second.taskId}`)}.json`, checkedAt: new Date(now - 1_010).toISOString(), ...model, requestSha256: 'b'.repeat(64), output: { results: [{ taskId: task.taskId, verdicts: [{ path: 'durationMonths' }, { path: 'durationMonths' }] }] } }
    const results = new Map([[task.taskId, checkpoint], [second.taskId, { ...checkpoint, taskId: second.taskId }]])
    const linked = linkResponseReceipts([task, second], results, [receipt])
    expect(linked.size).toBe(2)
    expect(fieldRecoveryCategory(checkpoint, checkpoint.verdicts[0], receipt, 'durationMonths')).toBe('duplicate-field-output')
    const omitted = results.get(second.taskId)!
    expect(fieldRecoveryCategory(omitted, omitted.verdicts[0], receipt, 'durationMonths')).toBe('omitted-record-output')
    expect(linkResponseReceipts([task, second], results, [{ ...receipt, file: `${'c'.repeat(64)}.json` }]).size).toBe(0)
    expect(linkResponseReceipts([task, second], results, [{ ...receipt, checkedAt: new Date(now - 60_000).toISOString() }]).size).toBe(0)
  })

  it('inventories every frozen claim, requires independently validated evidence and writes exact qualified IDs without network calls', async () => {
    const { root, runId, directory, data } = await fixture()
    const ledger = await buildRecoveryLedger(runId, root, now)
    expect(ledger.summary.totalRecords).toBe(4)
    expect(ledger.summary.totalFields).toBe(Object.values(data).flat().reduce((total, record) => total + buildClaims(record).length, 0))
    expect(ledger.summary.attemptedRecords).toBe(1)
    expect(ledger.summary.notAttemptedRecords).toBe(3)
    expect(ledger.summary.realModelResponseRecords).toBe(1)
    expect(ledger.summary.categories['omitted-field-output']).toBe(1)
    expect(ledger.qualifiedRecovery.map(item => item.taskId)).toEqual([task.taskId])
    expect(ledger.missingScholarshipEligibilityRecords).toEqual(['scholarships:scholarship'])
    expect(ledger.summary.publicationApprovedRecords).toBe(0)
    const saved = await saveRecoveryLedger(runId, root)
    expect(JSON.parse(await readFile(join(directory, saved.selectorFiles[0]), 'utf8'))).toEqual([task.taskId])
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects cross-snapshot checkpoints and a tampered frozen input, and blocks recovery when snapshot bytes change', async () => {
    const { root, runId, directory, inputSha256, bytes } = await fixture()
    await writeFile(join(directory, 'records', `${hash(task.taskId)}.json`), JSON.stringify({ ...checkpoint, inputSha256: 'f'.repeat(64) }))
    const rejected = await buildRecoveryLedger(runId, root, now)
    expect(rejected.summary.attemptedRecords).toBe(0)
    expect(rejected.rejectedCheckpoints).toHaveLength(1)
    await writeFile(join(directory, 'records', `${hash(task.taskId)}.json`), JSON.stringify({ ...checkpoint, inputSha256, sourceIds: ['official'] }))
    await writeFile(join(directory, 'snapshots', `${hash(bytes)}.bin`), 'tampered')
    expect((await buildRecoveryLedger(runId, root, now)).qualifiedRecovery).toEqual([])
    const data = JSON.parse(await readFile(join(directory, 'input-snapshot.json'), 'utf8'))
    data.programs[0].durationMonths = 36
    await writeFile(join(directory, 'input-snapshot.json'), JSON.stringify(data))
    await expect(buildRecoveryLedger(runId, root, now)).rejects.toThrow('snapshot')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects malformed raw response entries instead of crashing or claiming a real return', async () => {
    const { root, runId, directory } = await fixture()
    const file = join(directory, 'responses', `${hash(task.taskId)}.json`)
    const receipt = JSON.parse(await readFile(file, 'utf8'))
    receipt.output.results.push(null)
    await writeFile(file, JSON.stringify(receipt))
    const ledger = await buildRecoveryLedger(runId, root, now)
    expect(ledger.summary.rejectedResponseReceipts).toBe(1)
    expect(ledger.summary.realModelResponseRecords).toBe(0)
    expect(ledger.summary.categories['output-defect-without-linked-response']).toBe(1)
  })

  it('defers valid checkpoints and responses written after the bounded read starts without calling them corrupt', async () => {
    const { root, runId, directory, inputSha256 } = await fixture()
    await writeFile(join(directory, 'records', `${hash(task.taskId)}.json`), JSON.stringify({ ...checkpoint, inputSha256, checkedAt: new Date(now + 10).toISOString() }))
    const responseFile = join(directory, 'responses', `${hash(task.taskId)}.json`)
    const response = JSON.parse(await readFile(responseFile, 'utf8'))
    await writeFile(responseFile, JSON.stringify({ ...response, checkedAt: new Date(now + 5).toISOString() }))
    const ledger = await buildRecoveryLedger(runId, root, now)
    expect(ledger.summary.attemptedRecords).toBe(0)
    expect(ledger.summary.rejectedCheckpoints).toBe(0)
    expect(ledger.summary.rejectedResponseReceipts).toBe(0)
    expect(ledger.summary.deferredAfterReadBoundaryCheckpoints).toBe(1)
    expect(ledger.summary.deferredAfterReadBoundaryResponseReceipts).toBe(1)
    expect(ledger.deferredAfterReadBoundaryTaskIds).toEqual([task.taskId])
  })

  it('excludes an already attempted recovery when membership or existing text changes, and permits previously blocked evidence', async () => {
    const { root, runId, directory, inputSha256, source } = await fixture()
    const ids = ['programs:first', 'programs:never', 'scholarships:scholarship', 'sources:official']
    const selection = buildTaskSelection([task.taskId, 'programs:never'], ids, runId)
    const api = { endpoint: 'https://api.minimax.cn/anthropic/v1/messages', key: 'test-only', model: 'MiniMax-M3', anthropic: true }
    const priorRunId = verificationRunId(inputSha256, api, {}, selection)
    const priorDirectory = join(resolve(directory, '..'), priorRunId)
    await mkdir(join(priorDirectory, 'records'), { recursive: true })
    const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'))
    await writeFile(join(priorDirectory, 'manifest.json'), JSON.stringify({ ...manifest, selection }))
    const evidence = JSON.parse(await readFile(join(directory, 'sources', `${hash(source.id)}.json`), 'utf8'))
    await writeFile(join(priorDirectory, 'records', `${hash(task.taskId)}.json`), JSON.stringify({ ...checkpoint, inputSha256, checkedAt: new Date(now - 500).toISOString(), sourceIds: [source.id],
      sourceEvidence: [{ sourceId: source.id, sha256: evidence.sha256, textSha256: evidence.textSha256 }] }))
    const ledger = await buildRecoveryLedger(runId, root, now)
    expect(ledger.summary.previouslyAttemptedRecoveryRecords).toBe(1)
    expect(ledger.records.find(record => record.taskId === task.taskId)?.previousRecoveryRun).toBe(priorRunId)
    expect(ledger.qualifiedRecovery).toEqual([])
    const priorFile = join(priorDirectory, 'records', `${hash(task.taskId)}.json`)
    const priorCheckpoint = JSON.parse(await readFile(priorFile, 'utf8'))
    await writeFile(priorFile, JSON.stringify({ ...priorCheckpoint, issues: ['MiniMax quota exhausted'] }))
    const interrupted = await buildRecoveryLedger(runId, root, now)
    expect(interrupted.summary.previouslyAttemptedRecoveryRecords).toBe(0)
    expect(interrupted.qualifiedRecovery.map(item => item.taskId)).toEqual([task.taskId])
    // An actual HTTP 500 attempt is bounded even though no successful response returned.
    await writeFile(priorFile, JSON.stringify({ ...priorCheckpoint, issues: ['MiniMax HTTP 500'] }))
    expect((await buildRecoveryLedger(runId, root, now)).qualifiedRecovery).toEqual([])
    await writeFile(priorFile, JSON.stringify(priorCheckpoint))
    const text = evidence.text + ' New intake applicants require IELTS 6.5 or equivalent.'
    const bytes = new TextEncoder().encode(text)
    await writeFile(join(directory, 'sources', `${hash(source.id)}.json`), JSON.stringify({ ...evidence, text, checkedAt: new Date(now - 250).toISOString(), sha256: hash(bytes), textSha256: hash(text), bytes: bytes.byteLength }))
    await writeFile(join(directory, 'snapshots', `${hash(bytes)}.bin`), bytes)
    const changed = await buildRecoveryLedger(runId, root, now)
    expect(changed.qualifiedRecovery).toEqual([])
    expect(changed.summary.changedExistingSourceEvidenceNeedsReviewRecords).toBe(1)
    expect(changed.records.find(record => record.taskId === task.taskId)?.changedExistingSourceEvidenceNeedsReview).toBe(true)
    await writeFile(priorFile, JSON.stringify({ ...priorCheckpoint, sourceEvidence: [], issues: ['official: robots_HTTP_403'] }))
    const restored = await buildRecoveryLedger(runId, root, now)
    expect(restored.qualifiedRecovery.map(item => [item.taskId, item.reason])).toEqual([[task.taskId, 'newly-readable-official-evidence']])
    expect(fetch).not.toHaveBeenCalled()
  })

  it('guards sibling selection overlap using the effective adaptive model identity while leaving the disabled baseline intact', async () => {
    const { root, runId, directory, inputSha256, data, source } = await fixture()
    const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'))
    const tasks: Task[] = Object.entries(data).flatMap(([collection, records]) => records.map((record: Task['record']) => ({ taskId: `${collection}:${record.id}`, collection, record, claims: buildClaims(record), sourceIds: record.sourceIds || [] })))
    const api = { endpoint: 'https://api.minimax.cn/anthropic/v1/messages', key: 'test-only', model: 'MiniMax-M3', anthropic: true, thinking: 'adaptive' as const }
    const adaptive = modelConfiguration(api)
    const knownIds = tasks.map(item => item.taskId)
    const previousSelection = buildTaskSelection([task.taskId, 'programs:never'], knownIds, runId)
    const ownSelection = buildTaskSelection([task.taskId], knownIds, runId)
    const previousRunId = verificationRunId(inputSha256, api, { thinking: 'adaptive' }, previousSelection)
    const ownRunId = verificationRunId(inputSha256, api, { thinking: 'adaptive' }, ownSelection)
    const evidence = JSON.parse(await readFile(join(directory, 'sources', `${hash(source.id)}.json`), 'utf8'))
    const result = { ...checkpoint, inputSha256, ...adaptive, sourceIds: [source.id],
      sourceEvidence: [{ sourceId: source.id, sha256: evidence.sha256, textSha256: evidence.textSha256 }] }
    for (const [name, selection] of [[previousRunId, previousSelection], [ownRunId, ownSelection]] as const) {
      const saved = join(resolve(directory, '..'), name)
      await mkdir(join(saved, 'records'), { recursive: true })
      await writeFile(join(saved, 'manifest.json'), JSON.stringify({ ...manifest, ...adaptive, selection, requestedModelOptions: { thinking: 'adaptive' } }))
      await writeFile(join(saved, 'records', `${hash(task.taskId)}.json`), JSON.stringify(result))
    }
    expect((await priorRecoveryAttempts(directory, runId, inputSha256, manifest, tasks, now)).size).toBe(0)
    const overlap = await priorRecoveryAttempts(directory, runId, inputSha256, manifest, tasks, now, { effectiveModelConfiguration: adaptive, ignoreRunId: ownRunId })
    expect(overlap.get(task.taskId)?.runId).toBe(previousRunId)
    expect(overlap.get(task.taskId)?.result.thinking).toBe('adaptive')
    expect(manifest.thinking).toBe('disabled')
    const adaptiveLedger = await buildRecoveryLedger(runId, root, now, { effectiveModelConfiguration: adaptive, ignoreRunId: ownRunId })
    expect(adaptiveLedger.summary.previouslyAttemptedRecoveryRecords).toBe(1)
    expect(adaptiveLedger.qualifiedRecovery).toEqual([])
    const priorFile = join(resolve(directory, '..'), previousRunId, 'records', `${hash(task.taskId)}.json`)
    await writeFile(priorFile, JSON.stringify({ ...result, issues: ['MiniMax quota unknown'] }))
    expect((await priorRecoveryAttempts(directory, runId, inputSha256, manifest, tasks, now, { effectiveModelConfiguration: adaptive, ignoreRunId: ownRunId })).size).toBe(0)
    expect(fetch).not.toHaveBeenCalled()
  })
})
