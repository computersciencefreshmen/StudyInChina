import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { canonicalJson } from '../ingestion/program-catalog-feed.mjs'
import { TRANSLATION_FIELDS, TRANSLATION_LOCALES, programTranslationSource, translationKey, translationPath, validateTranslationRecord } from '../../src/lib/program-translation-contract.ts'
import { publicationPath, reviewBinding, translationConflict, translationScope, validatePublishedTranslation, REVIEW_MODEL, REVIEW_POLICY } from '../../src/lib/program-translation-review.ts'
import { readTranslationQuota, reviewTranslation } from './minimax-translation-provider.ts'
import { CANARY_REVIEW_CONTRACT, SAMPLES, manualCanaryRetryContext } from './translation-canary-contract.mjs'
import { isUnchangedTranslation, needsEnglishTranslation, originalAlreadyInLocale } from './translation-work-eligibility.mjs'

export const candidatePath = (source, locale) => `translations/candidates/v1/${locale}/${translationKey(source, locale)}.json`
const write = (path, data) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, canonicalJson(data) + '\n')
}
// An unreadable journal is a storage failure, never a fresh billing opportunity.
const read = path => existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null
const reviewLocales = ['zh', 'en', ...TRANSLATION_LOCALES.filter(locale => locale !== 'zh' && locale !== 'en')]
const providerCodes = new Set(['subscription_key_invalid', 'translation_review_input_invalid', 'translation_aborted_before_send',
  'translation_prior_outcome_protected', 'translation_admission_wait', 'translation_timeout_or_aborted', 'translation_transport_unknown',
  'translation_redirect_rejected', 'translation_rate_limited', 'translation_response_unreadable', 'translation_response_json_invalid',
  'translation_response_invalid', 'translation_review_response_invalid', 'translation_review_envelope_invalid', 'translation_model_mismatch',
  'translation_output_truncated', 'translation_review_stop_invalid', 'translation_usage_invalid', 'translation_review_content_invalid',
  'translation_review_json_invalid', 'translation_review_schema_invalid', 'translation_review_pass_invalid', 'translation_review_issue_invalid',
  'translation_review_quote_invalid'])
const isolatedOutputFailures = new Set(['translation_review_json_invalid', 'translation_review_schema_invalid',
  'translation_review_pass_invalid', 'translation_review_issue_invalid', 'translation_review_quote_invalid'])
const providerDiagnostic = error => {
  // Persist only known codes and bounded counts; never a provider body or error message.
  const suppliedCode = typeof error?.code === 'string' ? error.code : ''
  const code = providerCodes.has(suppliedCode) || /^translation_http_[45]\d{2}$/.test(suppliedCode)
    ? suppliedCode : 'translation_review_provider_error'
  const outcome = ['not_sent', 'unknown', 'rejected'].includes(error?.outcome) ? error.outcome : 'unknown'
  const usage = error?.usage
  const knownUsage = Number.isSafeInteger(usage?.inputTokens) && usage.inputTokens >= 0 && usage.inputTokens <= 1_000_000
    && Number.isSafeInteger(usage?.outputTokens) && usage.outputTokens >= 0 && usage.outputTokens <= 32_768
  return { code, outcome, ...(knownUsage ? { usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens } } : {}) }
}
const writeReview = (job, value) => write(job.journal, { ...value, ...(job.canaryRetry ? { canaryRetry: job.canaryRetry } : {}) })
function legacyCanaryRetry(job, prior, root, context) {
  if (!context || prior?.state !== 'failed' || Object.keys(prior).sort().join(',') !== 'binding,checkedAt,state'
    || prior.binding !== job.binding || !Number.isFinite(Date.parse(prior.checkedAt))) return null
  const sample = SAMPLES.find(row => row.id === job.scope.program && row.schoolId === job.scope.school
    && row.field === job.scope.field && (row.field === 'title' ? 'en' : 'zh') === job.locale && row.sourceHash === job.candidate.sourceHash)
  if (!sample) return null
  return { ...job, journal: join(root, 'translations/review-retries', CANARY_REVIEW_CONTRACT, job.locale, job.binding + '.json'),
    canaryRetry: { ...context, legacyBinding: job.binding, legacyJournalSha256: createHash('sha256').update(readFileSync(job.journal)).digest('hex') } }
}

function* reviewJobs(root, records, locales, fields, summary) {
  for (const locale of locales) {
    const indexed = new Set()
    for (const dir of ['translations/v1', 'translations/candidates/v1']) {
      const address = join(root, dir, locale)
      if (existsSync(address)) for (const name of readdirSync(address)) indexed.add(name)
    }
    if (!indexed.size) continue
    const seen = new Set()
    for (const field of fields) for (const row of records) {
      const source = programTranslationSource(row, field, locale)
      if (row.status !== 'extracted' || !row.schoolId || !row.id || typeof source !== 'string' || !source.trim()
        || !indexed.has(translationKey(source, locale) + '.json')) continue
      const old = read(join(root, translationPath(source, locale)))
      if (old?.validation === 'quarantined' || old?.method === 'source') continue
      const candidate = validateTranslationRecord(read(join(root, candidatePath(source, locale))) ?? old, source, locale)
      if (!candidate || candidate.method !== 'minimax') continue
      if (isUnchangedTranslation(source, candidate.text, locale)) { summary.skippedCopy++; continue }
      const alreadyInLocale = originalAlreadyInLocale(source, locale)
      if (locale === 'en' ? !needsEnglishTranslation(source) : alreadyInLocale) {
        if (alreadyInLocale) summary.skippedSameLanguage++
        else summary.skippedUnprovenEnglish++
        continue
      }
      const scope = translationScope(row, field), publicPath = join(root, publicationPath(source, locale, scope))
      if (publicPath === join(root, translationPath(source, locale))) continue
      const binding = reviewBinding(source, candidate.text, locale, scope)
      if (seen.has(binding)) continue
      seen.add(binding)
      const publicRecord = validatePublishedTranslation(read(publicPath), source, locale, scope)
      if (publicRecord?.text === candidate.text) continue
      const journal = join(root, 'translations/review-reservations', REVIEW_POLICY, locale, binding + '.json')
      yield { source, candidate, binding, journal, publicPath, locale, scope,
        referenceTitle: field === 'title' ? row.referenceEnglishTitle : null }
    }
  }
}

export async function reviewTranslationBacklog({ root, records, maxCalls, concurrency, deadline, checkpoint,
  key = process.env.MINIMAX_SUBSCRIPTION_KEY, now = Date.now, quota = readTranslationQuota, review = reviewTranslation,
  locales = reviewLocales, fields = TRANSLATION_FIELDS, writeStatus = true, retryLegacyFailedCanary = false, environment = process.env }) {
  if (!Number.isSafeInteger(maxCalls) || maxCalls < 1 || maxCalls > 240 || !Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 8 || !Number.isFinite(deadline))
    throw new Error('translation_batch_bounds_invalid')
  const stamp = () => new Date(now()).toISOString()
  const retryContext = retryLegacyFailedCanary ? manualCanaryRetryContext(environment) : null
  const summary = { startedAt: stamp(), state: 'complete', modelCalls: 0, approved: 0, revise: 0, blocked: 0, unknown: 0,
    skippedCopy: 0, skippedSameLanguage: 0, skippedUnprovenEnglish: 0, inputTokens: 0, outputTokens: 0 }
  const jobs = reviewJobs(root, records, locales, fields, summary)
  for (;;) {
    if (summary.modelCalls >= maxCalls || now() + 95_000 >= deadline) { summary.state = 'review_checkpoint'; break }
    const waiting = []
    while (waiting.length < Math.min(concurrency, maxCalls - summary.modelCalls)) {
      const next = jobs.next()
      if (next.done) break
      let job = next.value
      let prior = read(job.journal)
      const retry = legacyCanaryRetry(job, prior, root, retryContext)
      if (retry) {
        job = retry; prior = read(job.journal)
        if (existsSync(job.journal) && (!prior || typeof prior !== 'object')) throw new Error('translation_canary_retry_journal_invalid')
      }
      // A versioned canary retry permits one send only. A documented no-send
      // admission wait may resume; received/rate-limited/unknown outcomes may not.
      const resumable = job.canaryRetry
        ? prior?.outcome === 'not_sent' && prior?.code === 'translation_admission_wait'
          && prior?.canaryRetry?.contract === CANARY_REVIEW_CONTRACT
          && prior.canaryRetry.legacyJournalSha256 === job.canaryRetry.legacyJournalSha256 ? ['admission_wait'] : []
        : ['admission_wait', 'rate_limited']
      if (prior && !(resumable.includes(prior.state) && Date.parse(prior.retryAt) <= now())) {
        if (prior.state === 'reserved' || prior.state === 'unknown') summary.unknown++
        continue
      }
      const conflict = job.referenceTitle && job.candidate.text.trim() !== job.referenceTitle
        ? 'official_title_mismatch' : translationConflict(job.source, job.candidate.text, job.locale, job.scope.field)
      if (conflict) {
        writeReview(job, { binding: job.binding, state: 'REVISE', code: conflict, checkedAt: stamp() })
        summary.revise++; continue
      }
      if (job.source.length + job.candidate.text.length + JSON.stringify(job.scope).length > 24_000) {
        writeReview(job, { binding: job.binding, state: 'BLOCK', code: 'review_input_too_large', checkedAt: stamp() })
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
    for (const job of wave) writeReview(job, { state: 'reserved', binding: job.binding, policy: REVIEW_POLICY, requestedAt: stamp() })
    await checkpoint(root)
    const outcomes = await Promise.allSettled(wave.map(async job => {
      summary.modelCalls++
      let result
      try {
        result = await review({ key, locale: job.locale, source: job.source, text: job.candidate.text, scope: job.scope })
      } catch (error) {
        const diagnostic = providerDiagnostic(error)
        summary.lastProviderError = diagnostic
        if (error?.code === 'translation_admission_wait' && error?.outcome === 'not_sent') {
          summary.modelCalls--; summary.state = 'provider_wait'
          summary.admissionWait = { reason: error.admissionReason ?? 'admission_response_unrecognized', retryAt: error.retryAfter }
          writeReview(job, { state: 'admission_wait', binding: job.binding, checkedAt: stamp(), ...summary.admissionWait, ...diagnostic })
          return
        }
        const limited = error?.code === 'translation_rate_limited' && error?.outcome === 'rejected'
        const state = limited ? 'rate_limited' : error?.outcome === 'rejected' || error?.outcome === 'not_sent' ? 'failed' : 'unknown'
        if (state === 'unknown') summary.unknown++
        if (state === 'failed') summary.blocked++
        // A fully received, accounted-for output failure holds this candidate
        // permanently. It does not block the next independent review or permit
        // a replay. Protocol/model, unknown, rate and admission failures stop.
        const isolated = state === 'failed' && diagnostic.outcome === 'rejected' && diagnostic.usage
          && isolatedOutputFailures.has(diagnostic.code)
        if (!isolated) summary.state = 'provider_wait'
        summary.inputTokens += diagnostic.usage?.inputTokens ?? 0; summary.outputTokens += diagnostic.usage?.outputTokens ?? 0
        writeReview(job, { state, binding: job.binding, checkedAt: stamp(), ...diagnostic,
          ...(limited ? { retryAt: error.retryAfter || new Date(now() + 900_000).toISOString() } : {}) })
        return
      }
      summary.inputTokens += result.usage.inputTokens; summary.outputTokens += result.usage.outputTokens
      const checkedAt = stamp()
      const receipt = { policy: REVIEW_POLICY, model: result.model, binding: job.binding, verdict: result.verdict, checkedAt,
        ...(job.canaryRetry ? { requestContract: CANARY_REVIEW_CONTRACT } : {}) }
      if (result.verdict === 'PASS' && result.model === REVIEW_MODEL) {
        const approved = { ...job.candidate, review: receipt }
        if (!validatePublishedTranslation(approved, job.source, job.locale, job.scope)) throw new Error('translation_review_binding_invalid')
        write(job.publicPath, approved); summary.approved++
      } else if (result.verdict === 'REVISE') summary.revise++
      else summary.blocked++
      writeReview(job, { ...receipt, state: result.verdict, issue: result.issue, sourceQuote: result.sourceQuote, targetQuote: result.targetQuote })
    }))
    if (outcomes.some(item => item.status === 'rejected')) throw new Error('translation_review_storage_failed')
    await checkpoint(root)
    if (summary.state === 'provider_wait') break
    // A lower quota wave left unsent work; retain its place for the next tick.
    if (wave.length < waiting.length) { summary.state = 'review_checkpoint'; break }
  }
  if (writeStatus) write(join(root, 'translations/review-status.json'), summary)
  await checkpoint(root)
  return summary
}
