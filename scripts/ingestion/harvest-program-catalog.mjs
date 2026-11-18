import { execFileSync } from 'node:child_process'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { FEED_BRANCH, assertPublicState, canonicalJson, loadProgramFeed, mergeProgramRecords, sanitizeProgram, sha256, writeProgramFeed } from './program-catalog-feed.mjs'
import { providerEvidenceClient } from '../harvest/provider-evidence-client.mjs'
import { schoolCoverageTargets } from '../harvest/sicas-school-priority.mjs'
import { programWithdrawalReason } from '../../src/lib/program-publication-policy.mjs'
import { pushCatalogCheckpoint } from './push-catalog-checkpoint.mjs'

const runGit = (root, args) => {
  try { return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).trim() }
  catch { throw new Error('feed_git_operation_failed') }
}
export function assertFeedCheckout(root, git = runGit) {
  if (resolve(git(root, ['rev-parse', '--show-toplevel'])) !== resolve(root) || git(root, ['branch', '--show-current']) !== FEED_BRANCH) throw new Error('feed_checkout_invalid')
  const remote = git(root, ['remote', 'get-url', 'origin'])
  if (!/^https:\/\/github\.com\/computersciencefreshmen\/StudyInChina(?:\.git)?$/i.test(remote)) throw new Error('feed_remote_invalid')
  let config
  try { config = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8')) } catch { throw new Error('feed_preview_not_disabled') }
  if (config.git?.deploymentEnabled !== false) throw new Error('feed_preview_not_disabled')
}
export function checkpointFeed(root, revision, git = runGit) {
  assertFeedCheckout(root, git)
  const paths = ['manifest.json', 'indexes', 'details', 'state', 'receipts']
  const staged = git(root, ['diff', '--cached', '--name-only']).split('\n').filter(Boolean)
  if (staged.some(name => !paths.some(prefix => name === prefix || name.startsWith(prefix + '/')))) throw new Error('feed_unexpected_staged_file')
  git(root, ['add', '--all', '--', ...paths])
  if (!git(root, ['diff', '--cached', '--name-only'])) return { changed: false, pushed: false }
  git(root, ['-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com', 'commit', '-m', `Checkpoint program feed ${revision.slice(0, 12)}`])
  pushCatalogCheckpoint(args => git(root, args), 'harvest')
  return { changed: true, pushed: true }
}

export async function collectFeedCandidate({ feedDir, limit = 150, maxMinutes = 9, collector, git, environment = process.env, now = Date.now, evidenceClient, repairProgramId }) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 250 || !Number.isFinite(maxMinutes) || maxMinutes < 0.1 || maxMinutes > 10) throw new Error('feed_batch_bound_invalid')
  const root = resolve(feedDir)
  assertFeedCheckout(root, git)
  const loaded = loadProgramFeed(root)
  const collectorEnvironment = Object.fromEntries(['RUNNER_TEMP', 'SICAS_RAW_DIR'].filter(key => environment[key]).map(key => [key, environment[key]]))
  const coverage = evidenceClient ? await evidenceClient.coverage() : null
  const universities = coverage ? JSON.parse(readFileSync(new URL('../../content/data/universities.json', import.meta.url), 'utf8')) : []
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date(now()))
  const schoolTargets = schoolCoverageTargets(coverage, universities, loaded.records, today)
  const result = await collector({ sources: loaded.records, state: structuredClone(loaded.state), limit, deadlineAt: now() + maxMinutes * 60_000,
    environment: collectorEnvironment, archive: evidenceClient?.archive, schoolTargets, repairProgramId })
  if (!result || !Array.isArray(result.records) || result.records.length > limit || !Array.isArray(result.receipts) || result.receipts.length > limit * 4 + 20 || !result.state) throw new Error('feed_batch_result_invalid')
  const state = structuredClone(result.state)
  if (evidenceClient) state.scheduling = { coverageSha256: coverage?.sha256 ?? null, inputFeedRevision: loaded.manifest.revision,
    coverageCatalogSha256: coverage?.inputCatalogSha256 ?? null, coverageScopeSha256: coverage?.scopeRegistrySha256 ?? null,
    coverageEvaluatedOn: coverage?.evaluatedOn ?? null, deploymentSha: coverage ? environment.GITHUB_SHA ?? null : null,
    mappedProviderSchools: schoolTargets.size }
  assertPublicState(state)
  const records = result.records.map(record => sanitizeProgram(record, { requireFieldEvidence: true }))
  // Candidate artifacts contain only the public feed projection. Raw evidence
  // travels exclusively to the private bucket before this point.
  const receipts = result.receipts.map(({ provider, sourceUrl, finalUrl, method, status, bytes, fetchedAt, rawSha256, archiveSha256, errorCode }) =>
    Object.fromEntries(Object.entries({ provider, sourceUrl, finalUrl, method, status, bytes, fetchedAt, rawSha256, archiveSha256, errorCode }).filter(([, v]) => v !== undefined)))
  return { schemaVersion: 1, baseState: loaded.manifest.state.sha256, generatedAt: new Date(now()).toISOString(), records, state, receipts,
    attempted: Number(result.summary?.attempted) || 0, archiveUnavailable: result.summary?.archiveUnavailable === true, mappedProviderSchools: schoolTargets.size }
}

export function harvestMonitor(previous, candidate, grew, held, rejected) {
  const windowId = Math.floor(Date.parse(candidate.generatedAt) / 900000)
  const prior = previous ?? { windowId: -1, eligibleWindowsWithoutGrowth: 0, reason: null, grew: false }
  if (windowId < prior.windowId || !candidate.attempted) return prior
  if (grew || (prior.windowId === windowId && prior.grew)) return { windowId, eligibleWindowsWithoutGrowth: 0, reason: null, grew: true }
  const reason = candidate.archiveUnavailable ? 'archive_wait' : rejected ? 'validation_rejected' : held ? 'scope_review' : 'no_growth'
  return { windowId, eligibleWindowsWithoutGrowth: prior.eligibleWindowsWithoutGrowth + Number(windowId !== prior.windowId), reason, grew: false }
}

export function publishFeedCandidate(root, candidate, git = runGit) {
  assertFeedCheckout(root, git)
  const loaded = loadProgramFeed(root)
  if (candidate.schemaVersion !== 1 || !Array.isArray(candidate.records) || candidate.records.length > 250
    || !Array.isArray(candidate.receipts) || candidate.receipts.length > 1020 || !candidate.state) throw new Error('feed_candidate_invalid')
  const batchSha256 = sha256(canonicalJson(candidate))
  if (loaded.state.lastBatchSha256 === batchSha256) return { revision: loaded.manifest.revision, counts: loaded.manifest.counts, changed: false, pushed: false, reused: true,
    batchRecords: 0, rejectedRecords: 0, archiveUnavailable: candidate.archiveUnavailable, modelCalls: 0 }
  // Translation and quality publications can update the branch concurrently;
  // merge against that latest feed. Never overwrite another harvest cursor.
  if (loaded.manifest.state.sha256 !== candidate.baseState) throw new Error('feed_candidate_cursor_conflict')
  const merged = mergeProgramRecords(loaded.records, candidate.records)
  const state = { ...candidate.state, lastBatchSha256: batchSha256 }
  const publishedBefore = new Map(loaded.records.filter(row => row.status === 'extracted' && !programWithdrawalReason(row)).map(row => [row.id, row]))
  const visible = merged.records.filter(row => row.status === 'extracted' && !programWithdrawalReason(row))
  const restoredDegrees = visible.filter(row => publishedBefore.has(row.id) && !publishedBefore.get(row.id).fields.degree && row.fields.degree).length
  const grew = restoredDegrees > 0 || visible.some(row => !publishedBefore.has(row.id))
  state.monitor = harvestMonitor(loaded.state.monitor, candidate, grew, merged.held.length, merged.rejected.length)
  for (const rejected of merged.rejected) if (rejected.id && state.outcomes?.[rejected.id]) state.outcomes[rejected.id] = { ...state.outcomes[rejected.id], status: 'invalid', errorCode: rejected.errorCode }
  for (const held of merged.held) if (state.outcomes?.[held.id]) state.outcomes[held.id] = { ...state.outcomes[held.id], status: 'retry', errorCode: held.errorCode,
    nextAttemptAt: new Date(Date.parse(candidate.generatedAt) + 7 * 86400000).toISOString() }
  const manifest = writeProgramFeed(root, { records: merged.records, state, receipts: candidate.receipts, generatedAt: candidate.generatedAt, publicIndex: true })
  // Validate the exact serialized checkpoint before publishing it, including all content hashes.
  loadProgramFeed(root)
  const publication = checkpointFeed(root, manifest.revision, git)
  return { schemaVersion: 1, revision: manifest.revision, counts: manifest.counts, batchRecords: candidate.records.length,
    rejectedRecords: merged.rejected.length, heldRecords: merged.held.length, ...publication, archiveUnavailable: candidate.archiveUnavailable,
    mappedProviderSchools: candidate.mappedProviderSchools, restoredDegrees, modelCalls: 0 }
}

export async function harvestProgramCatalog(options) {
  return publishFeedCandidate(resolve(options.feedDir), await collectFeedCandidate(options), options.git)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2)
  const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
  if (!args.includes('--execute') || !option('--feed-dir')) throw new Error('Usage: node harvest-program-catalog.mjs --execute --feed-dir <data-branch-checkout> [--limit 150] [--max-minutes 9]')
  const publish = option('--publish-candidate'), stage = option('--stage-candidate')
  let result
  if (publish) {
    if (statSync(publish).size > 100 * 1024 * 1024) throw new Error('feed_candidate_too_large')
    result = publishFeedCandidate(resolve(option('--feed-dir')), JSON.parse(readFileSync(publish, 'utf8')))
  } else {
    const { collectSicasBatch } = await import('../harvest/sicas-collector.mjs')
    const options = { feedDir: option('--feed-dir'), limit: Number(option('--limit') || 150), maxMinutes: Number(option('--max-minutes') || 9),
      collector: collectSicasBatch, evidenceClient: providerEvidenceClient(process.env), repairProgramId: option('--repair-program-id') }
    if (stage) {
      const candidate = await collectFeedCandidate(options)
      writeFileSync(stage, JSON.stringify(candidate), { flag: 'wx' })
      console.log(JSON.stringify({ candidates: candidate.records.length, mappedProviderSchools: candidate.mappedProviderSchools }))
    } else result = await harvestProgramCatalog(options)
  }
  if (result) {
    console.log(JSON.stringify(result))
    if (result.archiveUnavailable) process.exitCode = 1
    if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, `Program catalog checkpoint: ${result.counts.capturedCount} captured / ${result.counts.programCount} source records; batch ${result.batchRecords}, rejected ${result.rejectedRecords}; pushed ${result.pushed}.\n`, { flag: 'a' })
  }
}
