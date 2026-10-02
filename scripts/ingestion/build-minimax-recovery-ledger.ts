import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  buildClaims, buildRankingSources, parseVerificationRunId, readValidatedSourceReceipt,
  recoveryReason, validateSavedRunManifest, type RecordResult, type SourceReceipt,
  type Task, type Verdict,
} from './verify-catalog-minimax'

const COLLECTIONS = ['universities', 'programs', 'admission-cycles', 'scholarships', 'cities', 'sources'] as const
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
type Snapshot = Record<typeof COLLECTIONS[number], Task['record'][]>
type Manifest = Parameters<typeof validateSavedRunManifest>[2] & { totalRecords?: number; totalClaims?: number }
type ResponseReceipt = {
  checkedAt: string; model: string | null; modelConfigSha256?: string | null; requestSha256: string;
  output: { results: Array<{ taskId: string; verdicts: unknown }> }; file: string;
}
type Priority = 'deadline' | 'tuition' | 'application-fee' | 'language' | 'duration' | 'scholarship-eligibility' | 'other'
export type RecoveryHistoryOptions = {
  effectiveModelConfiguration?: { model: string | null; modelConfigSha256: string | null }
  ignoreRunId?: string
}

/** A full-field ledger is diagnostic. No network request, catalog write or publication is performed. */
export function fieldPriority(collection: string, path: string): Priority {
  if (/^(deadline|closesOn|opensOn|dateStatus)(\.|$)/.test(path)) return 'deadline'
  if (/^(tuitionCny|tuitionPeriod)(\.|$)/.test(path) || path === 'coverage.tuition') return 'tuition'
  if (/^applicationFeeCny(\.|$)/.test(path)) return 'application-fee'
  if (/^(teachingLanguages|languageRequirements)(\.|$)/.test(path)) return 'language'
  if (/^durationMonths(?:Max)?(\.|$)/.test(path)) return 'duration'
  if (collection === 'scholarships' && /^(eligibility|requirements|conditions)(\.|$)/.test(path)) return 'scholarship-eligibility'
  return 'other'
}

function matchingConfiguration(value: { model: string | null; modelConfigSha256?: string | null }, manifest: Manifest) {
  return value.model === (manifest.model ?? null) && (value.modelConfigSha256 === manifest.modelConfigSha256 ||
    (value.modelConfigSha256 === undefined && !Object.keys(manifest.requestedModelOptions || {}).length))
}

function checkpointMatches(result: RecordResult, task: Task, inputSha256: string, manifest: Manifest, now: number) {
  return result.taskId === task.taskId && result.inputSha256 === inputSha256 && matchingConfiguration(result, manifest) &&
    Number.isFinite(Date.parse(result.checkedAt)) && Date.parse(result.checkedAt) <= now &&
    Array.isArray(result.issues) && result.issues.every(issue => typeof issue === 'string') && Array.isArray(result.verdicts) &&
    result.verdicts.every(verdict => verdict && task.claims.some(claim => claim.path === verdict.path && JSON.stringify(claim.value) === JSON.stringify(verdict.storedValue)))
}

function modelResults(response: ResponseReceipt) {
  return (Array.isArray(response.output?.results) ? response.output.results : []).filter(item => item && typeof item === 'object' && typeof item.taskId === 'string')
}

function hasGenerationFailure(result: RecordResult) {
  return result.issues.some(issue => /^MiniMax |^Unexpected (?:token|end)|^Unterminated |^(?:Capture only|No readable official evidence); no MiniMax call/i.test(issue))
}

/** Do not label all missing checkpoint verdicts as model omissions when generation never returned. */
export function fieldRecoveryCategory(result: RecordResult | null, verdict: Verdict | undefined, response: ResponseReceipt | null, path: string) {
  if (!result) return 'not-attempted'
  if (result.issues.some(issue => issue === 'No readable official evidence; no MiniMax call')) return 'no-readable-evidence'
  if (result.issues.some(issue => /^MiniMax HTTP 500$/.test(issue))) return 'model-http-500'
  if (result.issues.some(issue => /^MiniMax HTTP 5\d\d$/.test(issue))) return 'model-http-5xx'
  if (result.issues.some(issue => /^MiniMax quota/.test(issue))) return 'quota-interrupted'
  if (result.issues.some(issue => /^Capture only; no MiniMax call$/.test(issue))) return 'capture-only'
  if (result.issues.some(issue => /^MiniMax |^Unexpected (?:token|end)|^Unterminated /i.test(issue))) return 'model-error'
  if (!verdict) return 'missing-checkpoint-verdict'
  if (verdict.status !== 'unconfirmed') return `${verdict.status}-candidate`
  if (verdict.reason === 'Missing or duplicate model verdict') {
    if (!response) return 'output-defect-without-linked-response'
    const records = modelResults(response).filter(item => item.taskId === result.taskId)
    if (records.length !== 1) return records.length ? 'duplicate-record-output' : 'omitted-record-output'
    const output = Array.isArray(records[0].verdicts) ? records[0].verdicts : []
    const count = output.filter(item => item && typeof item === 'object' && item.path === path).length
    return count > 1 ? 'duplicate-field-output' : count === 0 ? 'omitted-field-output' : 'invalid-output'
  }
  const categories: Record<string, string> = {
    'Official evidence did not establish this field': 'evidence-not-established',
    'Quote is missing or not a verbatim substring of the captured official source': 'invalid-exact-quote',
    'Numeric value is not present in its evidence quote': 'numeric-evidence-mismatch',
    'Date is not deterministically present in its evidence quote': 'date-evidence-mismatch',
    'Unknown/composite values require separate evidence': 'unknown-or-composite-value',
    'The proposed replacement is not present in the quote; missing evidence is not contradiction': 'replacement-not-in-quote',
    'Invalid verdict status': 'invalid-verdict-status',
    'Proposed value does not differ': 'unchanged-proposed-value',
    "Ranking evidence must use that ranking edition's validated source URL": 'wrong-ranking-source',
  }
  return categories[verdict.reason] || 'other-unconfirmed'
}

async function readLocalJson(directory: string, name: string, maximumBytes = 16 * 1024 * 1024) {
  const rootPath = await realpath(directory)
  const file = await realpath(join(directory, name))
  const inside = relative(rootPath, file)
  if (inside.startsWith('..') || isAbsolute(inside)) throw new Error('Ledger input escapes its run directory')
  if ((await stat(file)).size > maximumBytes) throw new Error('Ledger input exceeds its byte limit')
  const bytes = await readFile(file)
  if (bytes.byteLength > maximumBytes) throw new Error('Ledger input exceeds its byte limit')
  return JSON.parse(bytes.toString('utf8'))
}

/** Receipt filenames bind the ordered requested task IDs, even if the model omitted a record. */
export function linkResponseReceipts(tasks: Task[], results: Map<string, RecordResult>, receipts: ResponseReceipt[]) {
  const order = new Map(tasks.map((task, index) => [task.taskId, index]))
  const linked = new Map<string, ResponseReceipt>()
  for (const receipt of receipts) {
    const responseTime = Date.parse(receipt.checkedAt)
    const identifiedIds = [...new Set(modelResults(receipt).map(item => item.taskId))].filter(id => order.has(id)).sort((a, b) => order.get(a)! - order.get(b)!)
    // Exact returned identities can also bind a batch whose checkpoint write took longer.
    if (identifiedIds.length && `${hash(identifiedIds.join('|'))}.json` === receipt.file) {
      for (const id of identifiedIds) {
        const checkpoint = results.get(id)
        const elapsed = checkpoint ? Date.parse(checkpoint.checkedAt) - responseTime : -1
        if (checkpoint && !hasGenerationFailure(checkpoint) && elapsed >= 0 && elapsed <= 60_000 && checkpoint.model === receipt.model &&
          (checkpoint.modelConfigSha256 === receipt.modelConfigSha256 || checkpoint.modelConfigSha256 === undefined)) linked.set(id, receipt)
      }
    }
    // Checkpoints are written immediately after the atomic response receipt. Narrow the search,
    // then require an exact batch hash; timestamps alone never prove a model response.
    const peers = [...results.values()].filter(result => {
      const elapsed = Date.parse(result.checkedAt) - responseTime
      return !hasGenerationFailure(result) && elapsed >= 0 && elapsed <= 1_000 && result.model === receipt.model &&
        (result.modelConfigSha256 === receipt.modelConfigSha256 || result.modelConfigSha256 === undefined)
    }).sort((left, right) => order.get(left.taskId)! - order.get(right.taskId)!)
    if (peers.length > 16) continue
    let matchingIds: string[] | null = null
    const visit = (start: number, chosen: string[]) => {
      if (matchingIds) return
      if (chosen.length && `${hash(chosen.join('|'))}.json` === receipt.file) { matchingIds = [...chosen]; return }
      if (chosen.length >= 4) return
      for (let index = start; index < peers.length; index++) visit(index + 1, [...chosen, peers[index].taskId])
    }
    visit(0, [])
    if (matchingIds) for (const taskId of matchingIds as string[]) linked.set(taskId, receipt)
  }
  return linked
}

/** Changed selection membership must not charge again for a task already recovered on the same evidence.
 * Callers may supply the execution model identity while retaining the baseline's frozen manifest.
 * Excluding the caller's fixed run leaves its own checkpoint reuse to the verifier.
 */
export async function priorRecoveryAttempts(directory: string, runId: string, inputSha256: string, manifest: Manifest, tasks: Task[], now = Date.now(), options: RecoveryHistoryOptions = {}) {
  const verificationRoot = resolve(directory, '..')
  const runManifests = new Map<string, Manifest>()
  const knownIds = tasks.map(task => task.taskId)
  validateSavedRunManifest(runId, inputSha256, manifest, knownIds)
  if (options.ignoreRunId) parseVerificationRunId(options.ignoreRunId)
  for (const item of await readdir(verificationRoot, { withFileTypes: true })) {
    if (!item.isDirectory() || item.name === runId || !item.name.startsWith(inputSha256.slice(0, 16))) continue
    try {
      parseVerificationRunId(item.name)
      const prior = await readLocalJson(join(verificationRoot, item.name), 'manifest.json') as Manifest
      validateSavedRunManifest(item.name, inputSha256, prior, knownIds)
      // Keep ancestry across model changes: an adaptive recovery may descend from a disabled baseline.
      if (prior.selection?.recoveryFrom) runManifests.set(item.name, prior)
    } catch { /* Unrelated, malformed or incompatible runs do not establish prior recovery. */ }
  }
  const descendantRuns = new Set([runId])
  for (let changed = true; changed;) {
    changed = false
    for (const [name, prior] of runManifests) if (!descendantRuns.has(name) && descendantRuns.has(prior.selection!.recoveryFrom!)) { descendantRuns.add(name); changed = true }
  }
  const byTask = new Map<string, { runId: string; result: RecordResult }>()
  const taskMap = new Map(tasks.map(task => [task.taskId, task]))
  for (const name of descendantRuns) {
    if (name === runId || name === options.ignoreRunId) continue
    const prior = runManifests.get(name)!
    const executionIdentity = options.effectiveModelConfiguration
    if (executionIdentity
      ? prior.model !== executionIdentity.model || prior.modelConfigSha256 !== executionIdentity.modelConfigSha256
      : !matchingConfiguration({ model: prior.model ?? null, modelConfigSha256: prior.modelConfigSha256 }, manifest)) continue
    const priorDirectory = join(verificationRoot, name)
    for (const taskId of prior.selection!.taskIds) {
      const file = join('records', `${hash(taskId)}.json`)
      if (!existsSync(join(priorDirectory, file))) continue
      try {
        const result = await readLocalJson(priorDirectory, file, 2 * 1024 * 1024) as RecordResult
        const task = taskMap.get(taskId)!
        if (!checkpointMatches(result, task, inputSha256, prior, now)) continue
        // The quota gate stopped before a model attempt. A reset must resume the fixed selection.
        if (result.issues.some(issue => /^MiniMax quota(?: |$)/i.test(issue))) continue
        const existing = byTask.get(taskId)
        if (!existing || Date.parse(result.checkedAt) > Date.parse(existing.result.checkedAt)) byTask.set(taskId, { runId: name, result })
      } catch { /* Invalid checkpoints do not establish a completed recovery attempt. */ }
    }
  }
  return byTask
}

export async function buildRecoveryLedger(runId: string, projectRoot = process.cwd(), now = Date.now(), historyOptions: RecoveryHistoryOptions = {}) {
  parseVerificationRunId(runId)
  const directory = join(resolve(projectRoot), '.official-harvest/minimax-verification', runId)
  const readStartedAt = new Date(now).toISOString()
  const manifest = await readLocalJson(directory, 'manifest.json') as Manifest
  const data = await readLocalJson(directory, 'input-snapshot.json') as Snapshot
  const inputSha256 = hash(JSON.stringify({ data, promptVersion: manifest.promptVersion, sourceChars: manifest.maxSourceChars }))
  const sourceMap = new Map(data.sources.map(source => [source.id, source as Task['record'] & { url: string; official: boolean }]))
  const rankingIds = new Map<string, string[]>()
  for (const university of data.universities) {
    const sources = buildRankingSources(university)
    rankingIds.set(university.id, sources.map(source => source.id))
    for (const source of sources) sourceMap.set(source.id, source)
  }
  const tasks: Task[] = COLLECTIONS.flatMap(collection => data[collection].map(record => ({
    taskId: `${collection}:${record.id}`, collection, record, claims: buildClaims(record),
    sourceIds: collection === 'sources' ? [record.id] : [...new Set([...(record.sourceIds || []), ...(collection === 'universities' ? rankingIds.get(record.id) || [] : [])])],
  })))
  validateSavedRunManifest(runId, inputSha256, manifest, tasks.map(task => task.taskId))
  const totalFields = tasks.reduce((sum, task) => sum + task.claims.length, 0)
  if ((manifest.totalRecords !== undefined && manifest.totalRecords !== tasks.length) ||
    (manifest.totalClaims !== undefined && manifest.totalClaims !== totalFields)) throw new Error('Ledger scope does not match the frozen manifest')
  const results = new Map<string, RecordResult>()
  const rejectedCheckpoints: Array<{ taskId: string; reason: string }> = []
  const deferredAfterReadBoundaryTaskIds: string[] = []
  for (const task of tasks) {
    const file = join('records', `${hash(task.taskId)}.json`)
    if (!existsSync(join(directory, file))) continue
    try {
      const result = await readLocalJson(directory, file, 2 * 1024 * 1024) as RecordResult
      if (!checkpointMatches(result, task, inputSha256, manifest, Infinity)) throw new Error('Checkpoint input, model, timestamp or stored claim mismatch')
      if (Date.parse(result.checkedAt) > now) { deferredAfterReadBoundaryTaskIds.push(task.taskId); continue }
      results.set(task.taskId, result)
    } catch (error) { rejectedCheckpoints.push({ taskId: task.taskId, reason: error instanceof Error ? error.message : 'Invalid checkpoint' }) }
  }
  const responseReceipts: ResponseReceipt[] = []
  let rejectedResponseReceipts = 0
  let deferredAfterReadBoundaryResponseReceipts = 0
  for (const file of existsSync(join(directory, 'responses')) ? await readdir(join(directory, 'responses')) : []) {
    if (!/^[a-f0-9]{64}\.json$/.test(file)) continue
    try {
      const receipt = await readLocalJson(directory, join('responses', file), 2 * 1024 * 1024) as ResponseReceipt
      if (!matchingConfiguration(receipt, manifest) || !Number.isFinite(Date.parse(receipt.checkedAt)) ||
        !/^[a-f0-9]{64}$/.test(receipt.requestSha256) || !Array.isArray(receipt.output?.results) ||
        receipt.output.results.some(item => !item || typeof item !== 'object' || typeof item.taskId !== 'string')) throw new Error('Invalid model response receipt')
      if (Date.parse(receipt.checkedAt) > now) { deferredAfterReadBoundaryResponseReceipts++; continue }
      responseReceipts.push({ ...receipt, file })
    } catch { rejectedResponseReceipts++ }
  }
  const linkedResponses = linkResponseReceipts(tasks, results, responseReceipts)
  const previousRecovery = await priorRecoveryAttempts(directory, runId, inputSha256, manifest, tasks, now, historyOptions)
  const allowedHosts = [...new Set([...sourceMap.values()].filter(source => source.official).map(source => new URL(source.url).hostname))]
  const sourceStates = new Map<string, { receipt: SourceReceipt | null; reason: string; checkedAt: string | null; fresh: boolean; officialUrl: string | null }>()
  for (const id of new Set(tasks.flatMap(task => task.sourceIds))) {
    const source = sourceMap.get(id)
    const receipt = source ? await readValidatedSourceReceipt(source, directory, allowedHosts, now, false) : null
    let failure: Partial<SourceReceipt> | null = null
    if (!receipt && existsSync(join(directory, 'sources', `${hash(id)}.json`))) {
      try { failure = await readLocalJson(directory, join('sources', `${hash(id)}.json`), 512 * 1024) as SourceReceipt } catch { /* Invalid cache stays unresolved. */ }
    }
    sourceStates.set(id, { receipt, reason: receipt ? 'validated-readable-evidence' : failure?.reason || (source ? 'missing-or-invalid-evidence-receipt' : 'unregistered-source'),
      checkedAt: receipt?.checkedAt || failure?.checkedAt || null, fresh: Boolean(receipt && now - Date.parse(receipt.checkedAt) < 86_400_000), officialUrl: source?.url || null })
  }
  const records = tasks.map(task => {
    const result = results.get(task.taskId) || null
    const response = linkedResponses.get(task.taskId) || null
    const readable = task.sourceIds.flatMap(id => sourceStates.get(id)?.receipt ? [sourceStates.get(id)!.receipt!] : [])
    // Quota interruptions are resumed by the baseline, not output-defect recovery.
    const excludedIssue = result?.issues.some(issue => /^MiniMax quota|^MiniMax HTTP (?:400|401|403|404|429)$|^Capture only/.test(issue))
    let qualifiedRecoveryReason = result && !excludedIssue ? recoveryReason(result, readable, Boolean(manifest.selection?.recoveryFrom)) : null
    const previous = previousRecovery.get(task.taskId)
    if (previous) qualifiedRecoveryReason = qualifiedRecoveryReason ? recoveryReason(previous.result, readable, true) : null
    const priorEvidence = (previous?.result || result)?.sourceEvidence || []
    const changedExistingSourceEvidence = readable.flatMap(receipt => {
      const prior = priorEvidence.find(evidence => evidence.sourceId === receipt.sourceId)
      return prior && prior.textSha256 !== receipt.textSha256
        ? [{ sourceId: receipt.sourceId, priorTextSha256: prior.textSha256, currentTextSha256: receipt.textSha256! }] : []
    })
    const fields = task.claims.map(claim => {
      const matching = result?.verdicts.filter(verdict => verdict.path === claim.path) || []
      const verdict = matching.length === 1 ? matching[0] : undefined
      return { path: claim.path, storedValue: claim.value, priority: fieldPriority(task.collection, claim.path),
        status: verdict?.status || (result ? 'unconfirmed' : 'not-attempted'), category: fieldRecoveryCategory(result, verdict, response, claim.path),
        reason: verdict?.reason || (result ? 'Missing or duplicate checkpoint verdict' : 'No matching checkpoint for this frozen input'),
        ...(verdict?.sourceId ? { sourceId: verdict.sourceId } : {}), ...(verdict?.quote ? { quote: verdict.quote } : {}),
        ...(verdict?.status === 'contradicted' ? { proposedValue: verdict.proposedValue } : {}) }
    })
    const returned = response ? modelResults(response).filter(item => item.taskId === task.taskId) : []
    return { taskId: task.taskId, collection: task.collection, attempted: Boolean(result), checkedAt: result?.checkedAt || null,
      realModelResponse: Boolean(response), returnedRecordResults: returned.length,
      modelResponseFile: response?.file || null, modelResponseCheckedAt: response?.checkedAt || null,
      qualifiedRecoveryReason, previousRecoveryRun: previous?.runId || null,
      changedExistingSourceEvidenceNeedsReview: changedExistingSourceEvidence.length > 0, changedExistingSourceEvidence,
      priorityUnresolvedFields: fields.filter(field => field.priority !== 'other' && field.status !== 'supported').length,
      issues: result?.issues || [], sources: task.sourceIds.map(id => ({ sourceId: id, ...sourceStates.get(id), receipt: undefined })), fields }
  })
  const categories: Record<string, number> = {}
  const priorities = Object.fromEntries(['deadline', 'tuition', 'application-fee', 'language', 'duration', 'scholarship-eligibility', 'other'].map(priority => [priority, { total: 0, unresolved: 0, actionable: 0 }]))
  for (const record of records) for (const field of record.fields) {
    categories[field.category] = (categories[field.category] || 0) + 1
    const priority = priorities[field.priority] ||= { total: 0, unresolved: 0, actionable: 0 }
    priority.total++
    if (field.status !== 'supported') { priority.unresolved++; if (record.qualifiedRecoveryReason) priority.actionable++ }
  }
  const qualifiedRecovery = records.filter(record => record.qualifiedRecoveryReason).sort((a, b) => b.priorityUnresolvedFields - a.priorityUnresolvedFields || a.taskId.localeCompare(b.taskId)).map(record => ({ taskId: record.taskId, reason: record.qualifiedRecoveryReason!, priorityUnresolvedFields: record.priorityUnresolvedFields }))
  const missingScholarshipEligibilityRecords = data.scholarships.filter(record => !buildClaims(record).some(claim => /^(eligibility|requirements|conditions)(\.|$)/.test(claim.path))).map(record => `scholarships:${record.id}`)
  return { schemaVersion: 1, runId, inputSha256, readStartedAt, generatedAt: new Date().toISOString(),
    methodology: 'Read-only snapshot ledger. Attempts, parsed model responses and candidate support are separate. No publication approval. A live run can advance during reads; exact input/model/batch identities are required.',
    summary: { totalRecords: tasks.length, totalFields, attemptedRecords: results.size, notAttemptedRecords: tasks.length - results.size,
      realModelResponseRecords: records.filter(record => record.realModelResponse).length,
      identifiedModelResultRecords: records.filter(record => record.realModelResponse && record.returnedRecordResults === 1).length,
      parsedModelResponseReceipts: responseReceipts.length, rejectedResponseReceipts, rejectedCheckpoints: rejectedCheckpoints.length,
      deferredAfterReadBoundaryCheckpoints: deferredAfterReadBoundaryTaskIds.length, deferredAfterReadBoundaryResponseReceipts,
      previouslyAttemptedRecoveryRecords: previousRecovery.size,
      changedExistingSourceEvidenceNeedsReviewRecords: records.filter(record => record.changedExistingSourceEvidenceNeedsReview).length,
      noReadableEvidenceRecords: records.filter(record => record.issues.includes('No readable official evidence; no MiniMax call')).length,
      http500Records: records.filter(record => record.issues.includes('MiniMax HTTP 500')).length,
      omittedOrDuplicateOutputRecords: records.filter(record => record.fields.some(field => /^(omitted|duplicate)-/.test(field.category))).length,
      invalidQuoteRecords: records.filter(record => record.fields.some(field => field.category === 'invalid-exact-quote')).length,
      qualifiedRecoveryRecords: qualifiedRecovery.length, publicationApprovedRecords: 0, categories, priorities },
    qualifiedRecovery, rejectedCheckpoints, deferredAfterReadBoundaryTaskIds, missingScholarshipEligibilityRecords, records }
}

async function atomicWrite(file: string, value: string) {
  await mkdir(resolve(file, '..'), { recursive: true })
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporary, value, 'utf8')
  await rename(temporary, file)
}

export async function saveRecoveryLedger(runId: string, projectRoot = process.cwd(), historyOptions: RecoveryHistoryOptions = {}) {
  const ledger = await buildRecoveryLedger(runId, projectRoot, Date.now(), historyOptions)
  const directory = join(resolve(projectRoot), '.official-harvest/minimax-verification', runId)
  const selectorFiles: string[] = []
  for (let start = 0; start < ledger.qualifiedRecovery.length; start += 1_000) {
    const ids = ledger.qualifiedRecovery.slice(start, start + 1_000).map(item => item.taskId)
    // Content-addressed selectors keep a later live-ledger refresh from mutating an earlier selection.
    const name = `recovery-task-ids-${String(start / 1_000 + 1).padStart(3, '0')}-${hash(JSON.stringify(ids)).slice(0, 12)}.json`
    await atomicWrite(join(directory, name), `${JSON.stringify(ids, null, 2)}\n`)
    selectorFiles.push(name)
  }
  await atomicWrite(join(directory, 'recovery-ledger.json'), `${JSON.stringify({ ...ledger, selectorFiles }, null, 2)}\n`)
  const rows = Object.entries(ledger.summary.categories).sort((a, b) => b[1] - a[1]).map(([category, count]) => `| ${category} | ${count} |`).join('\n')
  const priorities = Object.entries(ledger.summary.priorities).map(([priority, counts]) => `| ${priority} | ${counts.total} | ${counts.unresolved} | ${counts.actionable} |`).join('\n')
  const commands = selectorFiles.map(name => `node --import tsx scripts/ingestion/verify-catalog-minimax.ts --use-ccswitch --all --task-ids-file .official-harvest/minimax-verification/${runId}/${name} --recovery-from ${runId} --retry-unconfirmed --batch-size 1 --concurrency 4 --quota-guard --checkpoint-max-age-hours 168`).join('\n\n')
  await atomicWrite(join(directory, 'recovery-ledger.md'), `# MiniMax frozen recovery ledger\n\nInput: \`${ledger.inputSha256}\`. Read started ${ledger.readStartedAt}; generated ${ledger.generatedAt}.\n\n${ledger.methodology}\n\n\`\`\`json\n${JSON.stringify({ ...ledger.summary, categories: undefined, priorities: undefined }, null, 2)}\n\`\`\`\n\n| Field category | Count |\n|---|---:|\n${rows}\n\n| Priority | All fields | Unresolved fields | Fields on qualified recovery records |\n|---|---:|---:|---:|\n${priorities}\n\n${ledger.missingScholarshipEligibilityRecords.length} scholarship records have no stored eligibility field. They are schema/content gaps, not silently added claims. The complete ${ledger.summary.totalFields} claim inventory preserves all existing fields; these absent fields require separate official evidence and review.\n\nExisting source text changed on ${ledger.summary.changedExistingSourceEvidenceNeedsReviewRecords} records. These changes require independent claim-relevant review: navigation, news and counters can change text hashes without improving factual evidence. A hash change alone never grants another recovery attempt.\n\nRecovery lists contain at most 1,000 exact task IDs per file and use one-record batches. Use only selectors listed in the current JSON ledger; old content-addressed files may remain for audit. Finish the baseline before launching recovery to avoid duplicate verifiers.\n\n${commands ? `Qualified recovery commands (not launched by this ledger):\n\n\`\`\`powershell\n${commands}\n\`\`\`\n\n` : ''}Validating quotes does not establish the same program, year, currency or billing period; candidate changes still require independent review. Missing evidence requires new official captures before useful model work.\n`)
  return { ...ledger.summary, runId, inputSha256: ledger.inputSha256, selectorFiles }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2)
  const at = args.indexOf('--run')
  if (args.length !== 2 || at !== 0 || !args[1]) { console.error('Usage: node --import tsx scripts/ingestion/build-minimax-recovery-ledger.ts --run <validated-run-id>'); process.exitCode = 1 }
  else saveRecoveryLedger(args[1]).then(summary => console.log(JSON.stringify(summary))).catch(error => {
    console.error(error instanceof Error ? error.message : 'Recovery ledger failed'); process.exitCode = 1
  })
}
