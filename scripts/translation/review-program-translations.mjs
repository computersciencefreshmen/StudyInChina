import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { canonicalJson } from '../ingestion/program-catalog-feed.mjs'
import { TRANSLATION_FIELDS, TRANSLATION_LOCALES, translationKey, translationPath, validateTranslationRecord } from '../../src/lib/program-translation-contract.ts'
import { publicationPath, reviewBinding, translationConflict, translationScope, validatePublishedTranslation, REVIEW_MODEL, REVIEW_POLICY } from '../../src/lib/program-translation-review.ts'
import { readTranslationQuota, reviewTranslation } from './minimax-translation-provider.ts'

export const candidatePath = (source, locale) => `translations/candidates/v1/${locale}/${translationKey(source, locale)}.json`
const write = (path, data) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, canonicalJson(data) + '\n')
}
// An unreadable journal is a storage failure, never a fresh billing opportunity.
const read = path => existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null

function* reviewJobs(root, records) {
  for (const locale of TRANSLATION_LOCALES) {
    const indexed = new Set()
    for (const dir of ['translations/v1', 'translations/candidates/v1']) {
      const address = join(root, dir, locale)
      if (existsSync(address)) for (const name of readdirSync(address)) indexed.add(name)
    }
    if (!indexed.size) continue
    const seen = new Set()
    for (const field of TRANSLATION_FIELDS) for (const row of records) {
      const source = row.fields?.[field]
      if (row.status !== 'extracted' || !row.schoolId || !row.id || typeof source !== 'string' || !source.trim()
        || !indexed.has(translationKey(source, locale) + '.json')) continue
      const old = read(join(root, translationPath(source, locale)))
      if (old?.validation === 'quarantined' || old?.method === 'source') continue
      const candidate = validateTranslationRecord(read(join(root, candidatePath(source, locale))) ?? old, source, locale)
      if (!candidate || candidate.method !== 'minimax') continue
      const scope = translationScope(row, field), publicPath = join(root, publicationPath(source, locale, scope))
      // When the original is already in the requested language the literal is sufficient.
      if (publicPath === join(root, translationPath(source, locale)) && candidate.text === source) {
        yield { sourceCopy: { ...candidate, model: null, method: 'source' }, publicPath }
        continue
      }
      if (publicPath === join(root, translationPath(source, locale))) continue
      const binding = reviewBinding(source, candidate.text, locale, scope)
      if (seen.has(binding)) continue
      seen.add(binding)
      const publicRecord = validatePublishedTranslation(read(publicPath), source, locale, scope)
      if (publicRecord?.text === candidate.text) continue
      const journal = join(root, 'translations/review-reservations', REVIEW_POLICY, locale, binding + '.json')
      yield { source, candidate, binding, journal, publicPath, locale, scope }
    }
  }
}

export async function reviewTranslationBacklog({ root, records, maxCalls, concurrency, deadline, checkpoint,
  key = process.env.MINIMAX_SUBSCRIPTION_KEY, now = Date.now, quota = readTranslationQuota, review = reviewTranslation }) {
  if (!Number.isSafeInteger(maxCalls) || maxCalls < 1 || maxCalls > 240 || !Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 8 || !Number.isFinite(deadline))
    throw new Error('translation_batch_bounds_invalid')
  const stamp = () => new Date(now()).toISOString()
  const summary = { startedAt: stamp(), state: 'complete', modelCalls: 0, approved: 0, revise: 0, blocked: 0, unknown: 0, inputTokens: 0, outputTokens: 0 }
  const jobs = reviewJobs(root, records)
  for (;;) {
    if (summary.modelCalls >= maxCalls || now() + 95_000 >= deadline) { summary.state = 'review_checkpoint'; break }
    const waiting = []
    while (waiting.length < Math.min(concurrency, maxCalls - summary.modelCalls)) {
      const next = jobs.next()
      if (next.done) break
      const job = next.value
      if (job.sourceCopy) { write(job.publicPath, job.sourceCopy); continue }
      const prior = read(job.journal)
      if (prior && !(['admission_wait', 'rate_limited'].includes(prior.state) && Date.parse(prior.retryAt) <= now())) {
        if (prior.state === 'reserved' || prior.state === 'unknown') summary.unknown++
        continue
      }
      const conflict = translationConflict(job.source, job.candidate.text, job.locale)
      if (conflict) {
        write(job.journal, { binding: job.binding, state: 'REVISE', code: conflict, checkedAt: stamp() })
        summary.revise++; continue
      }
      if (job.source.length + job.candidate.text.length + JSON.stringify(job.scope).length > 24_000) {
        write(job.journal, { binding: job.binding, state: 'BLOCK', code: 'review_input_too_large', checkedAt: stamp() })
        summary.blocked++; continue
      }
      waiting.push(job)
    }
    if (!waiting.length) break
    if (!key) { summary.state = 'missing_subscription_key'; break }
    const capacity = await quota({ key, now: now() })
    summary.quota = capacity
    if (!capacity.allow) { summary.state = 'quota_wait'; break }
    const limit = capacity.remainingPercent > 40 ? 8 : capacity.remainingPercent > 20 ? 4 : capacity.remainingPercent > 10 ? 2 : 1
    const wave = waiting.slice(0, limit)
    for (const job of wave) write(job.journal, { state: 'reserved', binding: job.binding, policy: REVIEW_POLICY, requestedAt: stamp() })
    await checkpoint(root)
    const outcomes = await Promise.allSettled(wave.map(async job => {
      summary.modelCalls++
      let result
      try {
        result = await review({ key, locale: job.locale, source: job.source, text: job.candidate.text, scope: job.scope })
      } catch (error) {
        if (error?.code === 'translation_admission_wait' && error?.outcome === 'not_sent') {
          summary.modelCalls--; summary.state = 'provider_wait'
          write(job.journal, { state: 'admission_wait', binding: job.binding, checkedAt: stamp(), retryAt: error.retryAfter })
          return
        }
        const limited = error?.code === 'translation_rate_limited' && error?.outcome === 'rejected'
        const state = limited ? 'rate_limited' : error?.outcome === 'rejected' || error?.outcome === 'not_sent' ? 'failed' : 'unknown'
        if (state === 'unknown') summary.unknown++
        if (state === 'failed') summary.blocked++
        summary.state = 'provider_wait'
        summary.inputTokens += error?.usage?.inputTokens ?? 0; summary.outputTokens += error?.usage?.outputTokens ?? 0
        write(job.journal, { state, binding: job.binding, checkedAt: stamp(),
          ...(limited ? { retryAt: error.retryAfter || new Date(now() + 900_000).toISOString() } : {}) })
        return
      }
      summary.inputTokens += result.usage.inputTokens; summary.outputTokens += result.usage.outputTokens
      const checkedAt = stamp()
      const receipt = { policy: REVIEW_POLICY, model: result.model, binding: job.binding, verdict: result.verdict, checkedAt }
      if (result.verdict === 'PASS' && result.model === REVIEW_MODEL) {
        const approved = { ...job.candidate, review: receipt }
        if (!validatePublishedTranslation(approved, job.source, job.locale, job.scope)) throw new Error('translation_review_binding_invalid')
        write(job.publicPath, approved); summary.approved++
      } else if (result.verdict === 'REVISE') summary.revise++
      else summary.blocked++
      write(job.journal, { ...receipt, state: result.verdict, issue: result.issue, sourceQuote: result.sourceQuote, targetQuote: result.targetQuote })
    }))
    if (outcomes.some(item => item.status === 'rejected')) throw new Error('translation_review_storage_failed')
    await checkpoint(root)
    if (summary.state === 'provider_wait') break
    // A lower quota wave left unsent work; retain its place for the next tick.
    if (wave.length < waiting.length) { summary.state = 'review_checkpoint'; break }
  }
  write(join(root, 'translations/review-status.json'), summary)
  await checkpoint(root)
  return summary
}
