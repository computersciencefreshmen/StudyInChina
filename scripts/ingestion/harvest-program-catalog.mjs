import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { FEED_BRANCH, loadProgramFeed, mergeProgramRecords, writeProgramFeed } from './program-catalog-feed.mjs'

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
  // No force push or automatic retry: a competing writer must be reconciled before another batch starts.
  git(root, ['push', 'origin', `HEAD:refs/heads/${FEED_BRANCH}`])
  return { changed: true, pushed: true }
}

export async function harvestProgramCatalog({ feedDir, limit = 150, maxMinutes = 9, collector, git, environment = process.env, now = Date.now }) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 250 || !Number.isFinite(maxMinutes) || maxMinutes < 0.1 || maxMinutes > 10) throw new Error('feed_batch_bound_invalid')
  const root = resolve(feedDir)
  assertFeedCheckout(root, git)
  const loaded = loadProgramFeed(root)
  const collectorEnvironment = Object.fromEntries(['RUNNER_TEMP', 'SICAS_RAW_DIR', 'MINIMAX_SUBSCRIPTION_KEY'].filter(key => environment[key]).map(key => [key, environment[key]]))
  const result = await collector({ sources: loaded.records, state: structuredClone(loaded.state), limit, deadlineAt: now() + maxMinutes * 60_000, environment: collectorEnvironment })
  if (!result || !Array.isArray(result.records) || result.records.length > limit || !Array.isArray(result.receipts) || result.receipts.length > limit * 4 + 20 || !result.state) throw new Error('feed_batch_result_invalid')
  const merged = mergeProgramRecords(loaded.records, result.records)
  const state = structuredClone(result.state)
  for (const rejected of merged.rejected) if (rejected.id && state.outcomes?.[rejected.id]) state.outcomes[rejected.id] = { ...state.outcomes[rejected.id], status: 'invalid', errorCode: rejected.errorCode }
  const manifest = writeProgramFeed(root, { records: merged.records, state, receipts: result.receipts, generatedAt: new Date(now()).toISOString() })
  // Validate the exact serialized checkpoint before publishing it, including all content hashes.
  loadProgramFeed(root)
  const publication = checkpointFeed(root, manifest.revision, git)
  return { schemaVersion: 1, revision: manifest.revision, counts: manifest.counts, batchRecords: result.records.length,
    rejectedRecords: merged.rejected.length, ...publication, modelCalls: Number(result.summary?.modelCalls || 0) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2)
  const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
  if (!args.includes('--execute') || !option('--feed-dir')) throw new Error('Usage: node harvest-program-catalog.mjs --execute --feed-dir <data-branch-checkout> [--limit 150] [--max-minutes 9]')
  const { collectSicasBatch } = await import('../harvest/sicas-collector.mjs')
  const result = await harvestProgramCatalog({ feedDir: option('--feed-dir'), limit: Number(option('--limit') || 150), maxMinutes: Number(option('--max-minutes') || 9), collector: collectSicasBatch })
  const output = JSON.stringify(result)
  console.log(output)
  if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, `Program catalog checkpoint: ${result.counts.capturedCount} captured / ${result.counts.programCount} source records; batch ${result.batchRecords}, rejected ${result.rejectedRecords}; pushed ${result.pushed}.\n`, { flag: 'a' })
}
