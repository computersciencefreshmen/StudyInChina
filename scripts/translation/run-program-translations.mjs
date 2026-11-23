import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { canonicalJson, loadProgramFeed } from '../ingestion/program-catalog-feed.mjs'
import { assertFeedCheckout } from '../ingestion/harvest-program-catalog.mjs'
import { TRANSLATION_FIELDS, TRANSLATION_LOCALES, TRANSLATION_VERSION, translationKey, translationPath,
  programTranslationSource, protectTranslationText, restoreTranslationText, validateTranslationRecord } from '../../src/lib/program-translation-contract.ts'
import { readTranslationQuota, translateMaskedBatch } from './minimax-translation-provider.ts'
import { pushCatalogCheckpoint } from '../ingestion/push-catalog-checkpoint.mjs'
import { reviewTranslationBacklog, candidatePath } from './review-program-translations.mjs'
import { needsEnglishTitle, publicOfficialTitles } from './official-title-records.ts'
import { programWithdrawalReason } from '../../src/lib/program-publication-policy.mjs'
import { needsEnglishTranslation, originalAlreadyInLocale } from './translation-work-eligibility.mjs'

const hash = text => createHash('sha256').update(text).digest('hex')
const read = path => { try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return null } }
const save = (path, value) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, canonicalJson(value) + '\n') }
const reservationPath = unit => `translations/reservations/${TRANSLATION_VERSION}/${unit.locale}/${unit.key}.json`
const RETRY_POLICY = 'item-v2'
const ITEM_FAILURE_CODES = new Set([
  'translation_validation_or_provider_rejected', 'translation_validation_rejected', 'translation_response_item_missing',
  'translation_placeholder_mismatch', 'translation_fact_missing_or_changed', 'translation_added_critical_content',
  'translation_target_script_mismatch', 'translation_output_invalid', 'translation_output_truncated',
  'translation_empty_text', 'translation_invalid_text', 'translation_output_json_invalid', 'translation_items_invalid',
])
const failureCode = error => /^[a-z0-9_]{1,100}$/.test(error?.code || '') ? error.code
  : /^translation_[a-z0-9_]{1,88}$/.test(error?.message || '') ? error.message : 'translation_validation_or_provider_rejected'
const journalPolicy = unit => ({ retryPolicy: RETRY_POLICY, policyAttempts: unit.policyAttempts, attempts: unit.attempts })

/** Preserve every byte of the source at chunk boundaries, including whitespace. */
export function splitTranslationSource(source, maximum = 6000) {
  const pieces = source.split(/(?<=[。！？])|(?<=[.!?])(?=\s)|(?<=\n)/u)
  if (pieces.join('') !== source) return [source]
  const ranges = []; let cursor = 0
  for (const span of protectTranslationText(source).spans) {
    const start = source.indexOf(span, cursor)
    if (start < 0) throw new Error('translation_source_span_invalid')
    ranges.push([start, start + span.length]); cursor = start + span.length
  }
  const safeBoundary = offset => !ranges.some(([start, end]) => offset > start && offset < end)
  const result = []; let current = '', offset = 0
  for (const piece of pieces) {
    if (current && current.length + piece.length > maximum && safeBoundary(offset)) { result.push(current); current = '' }
    current += piece; offset += piece.length
  }
  if (current) result.push(current)
  return result.length ? result : [source]
}

export function buildTranslationUnits(records, locales = TRANSLATION_LOCALES, fields = TRANSLATION_FIELDS) {
  const units = new Map(), groups = new Map()
  for (const row of records) if (row.status === 'extracted') {
    const group = groups.get(row.schoolId) || []; group.push(row); groups.set(row.schoolId, group)
  }
  const ordered = [], schools = [...groups.values()].sort((a, b) => a.length - b.length)
  for (let offset = 0; ; offset++) {
    let found = false
    for (const school of schools) if (school[offset]) { ordered.push(school[offset]); found = true }
    if (!found) break
  }
  const add = (source, locale, field, schoolId, children) => {
    const key = translationKey(source, locale)
    if (!units.has(key)) units.set(key, { key, source, locale, field, schoolId, ...(children ? { children } : {}) })
    return key
  }
  // Finish useful English/Chinese coverage first, then other supported languages.
  for (const phase of [['zh', 'en'], TRANSLATION_LOCALES.filter(locale => locale !== 'zh' && locale !== 'en')]) {
    for (const field of fields) for (const row of ordered) {
      for (const locale of phase.filter(locale => locales.includes(locale))) {
        const source = programTranslationSource(row, field, locale)
        if (typeof source !== 'string' || !source.trim() || (locale === 'en' && !needsEnglishTranslation(source))) continue
        const chunks = splitTranslationSource(source)
        const children = chunks.length > 1 ? chunks.map(chunk => add(chunk, locale, field, row.schoolId)) : null
        add(source, locale, field, row.schoolId, children)
      }
    }
  }
  return [...units.values()]
}

export function checkpointTranslations(root) {
  assertFeedCheckout(root)
  const git = args => {
    try { return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 120_000,
      stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).trim() }
    catch { throw new Error('translation_checkpoint_failed') }
  }
  if (git(['diff', '--cached', '--name-only']).split('\n').filter(Boolean).some(path => !path.startsWith('translations/'))) throw new Error('translation_unexpected_staged_file')
  git(['add', '--all', '--', 'translations'])
  if (!git(['diff', '--cached', '--name-only'])) return false
  git(['-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com', 'commit', '-m', 'Checkpoint cached program translations'])
  pushCatalogCheckpoint(git, 'translation')
  return true
}

export async function runProgramTranslations({ feedDir, records, maxCalls = 120, concurrency = 8, maxMinutes = 8,
  environment = process.env, now = Date.now, quota = readTranslationQuota, translate = translateMaskedBatch,
  checkpoint = checkpointTranslations, factPolicy = 'literal-v2', locales = TRANSLATION_LOCALES, fields = TRANSLATION_FIELDS, writeStatus = true } = {}) {
  if (!Number.isSafeInteger(maxCalls) || maxCalls < 1 || maxCalls > 240 || !Number.isSafeInteger(concurrency)
    || concurrency < 1 || concurrency > 8 || !Number.isFinite(maxMinutes) || maxMinutes < 0.1 || maxMinutes > 12) throw new Error('translation_batch_bounds_invalid')
  const root = resolve(feedDir), startedAt = new Date(now()).toISOString(), deadlineAt = now() + maxMinutes * 60_000
  if (!records) { assertFeedCheckout(root); records = loadProgramFeed(root).records }
  const units = buildTranslationUnits(records, locales, fields), completed = new Map(), queued = [], rejectedAssemblies = new Set()
  const summary = { schemaVersion: 1, version: TRANSLATION_VERSION, startedAt, updatedAt: startedAt, state: 'running',
    modelCalls: 0, inputTokens: 0, outputTokens: 0, published: 0, preparedCandidates: 0, reused: 0, copiedSource: 0,
    pendingUniqueUnits: 0, blockedUnknownUnits: 0, failedUnits: 0, completedByLocale: Object.fromEntries(TRANSLATION_LOCALES.map(locale => [locale, 0])), quota: null, lastProviderError: null }
  const entry = unit => resolve(root, translationPath(unit.source, unit.locale))
  const record = (unit, text, method, model) => ({ schemaVersion: 1, version: TRANSLATION_VERSION, key: unit.key,
    sourceHash: hash(unit.source), targetLocale: unit.locale, text, method, model, translatedAt: new Date(now()).toISOString(), validation: 'passed',
    ...(method === 'minimax' && factPolicy && { factPolicy }) })
  const accept = (unit, value, fresh = true) => {
    const checked = validateTranslationRecord(value, unit.source, unit.locale)
    if (!checked) throw new Error('translation_validation_rejected')
    if (fresh) {
      const path = checked.method === 'source' ? entry(unit) : resolve(root, candidatePath(unit.source, unit.locale))
      if (existsSync(path)) {
        const prior = validateTranslationRecord(read(path), unit.source, unit.locale)
        if (!prior) throw new Error('translation_existing_entry_invalid')
        completed.set(unit.key, prior); return
      }
      save(path, checked)
      if (checked.method === 'source') summary.published++
      else summary.preparedCandidates++
    } else summary.reused++
    completed.set(unit.key, checked); summary.completedByLocale[unit.locale]++
  }
  const aggregate = () => {
    for (const unit of units) if (unit.children && !completed.has(unit.key) && !rejectedAssemblies.has(unit.key) && unit.children.every(key => completed.has(key))) {
      const children = unit.children.map(key => completed.get(key))
      let result
      try {
        result = record(unit, children.map(child => child.text).join(''), children.every(child => child.method === 'source') ? 'source' : 'minimax',
          children.some(child => child.method === 'minimax') ? 'MiniMax-M3' : null)
        if (!validateTranslationRecord(result, unit.source, unit.locale)) throw new Error('translation_validation_rejected')
      } catch { rejectedAssemblies.add(unit.key); summary.failedUnits++; continue }
      // Assembly validation can fail independently; storage failures must stop
      // further billable work just as they do for individual completed items.
      accept(unit, result)
    }
  }
  for (const unit of units) {
    if (!unit.children && unit.locale === 'en' && originalAlreadyInLocale(unit.source, 'en') && !needsEnglishTranslation(unit.source)) {
      // Keep known English chunks verbatim even if an old model edit exists.
      completed.set(unit.key, record(unit, unit.source, 'source', null))
      summary.completedByLocale.en++
      summary.copiedSource++
      continue
    }
    const legacy = read(entry(unit))
    if (legacy?.validation === 'quarantined') { summary.failedUnits++; continue }
    const prior = validateTranslationRecord(legacy, unit.source, unit.locale)
      || validateTranslationRecord(read(resolve(root, candidatePath(unit.source, unit.locale))), unit.source, unit.locale)
    if (prior) { accept(unit, prior, false); continue }
    if (unit.children) continue
    if (unit.locale !== 'en' && originalAlreadyInLocale(unit.source, unit.locale)) { accept(unit, record(unit, unit.source, 'source', null)); summary.copiedSource++; continue }
    const protection = protectTranslationText(unit.source, factPolicy || undefined)
    // All-critical clauses stay verbatim; there is no useful model work to buy.
    if (!protection.text.replace(/__SC_\d{6}__/g, '').replace(/[^\p{L}]/gu, '')) { accept(unit, record(unit, unit.source, 'source', null)); summary.copiedSource++; continue }
    const reservation = read(resolve(root, reservationPath(unit)))
    if (reservation && ['reserved', 'unknown'].includes(reservation.state)) { summary.blockedUnknownUnits++; continue }
    if (reservation?.state === 'admission_wait' && Date.parse(reservation.retryAt) > now()) continue
    if (reservation?.state === 'failed') {
      // Upgrade only known output-quality failures. A legacy reservation or
      // unknown transport outcome is never converted into permission to replay.
      const attempts = reservation.retryPolicy === RETRY_POLICY ? reservation.policyAttempts : 0
      if (!ITEM_FAILURE_CODES.has(reservation.code) || !Number.isSafeInteger(attempts) || attempts < 0 || attempts >= 2
        || !Number.isFinite(Date.parse(reservation.retryAt)) || Date.parse(reservation.retryAt) > now()) { summary.failedUnits++; continue }
    }
    if (protection.text.length > 24_000) { summary.failedUnits++; continue }
    queued.push({ ...unit, protection, attempts: (reservation?.attempts || 0) + 1,
      policyAttempts: reservation?.retryPolicy === RETRY_POLICY ? reservation.policyAttempts + 1 : 1,
      isolated: reservation?.state === 'failed' })
  }
  aggregate()
  const pending = () => units.filter(unit => !completed.has(unit.key)).length
  const flush = () => {
    summary.pendingUniqueUnits = pending()
    summary.updatedAt = new Date(now()).toISOString()
    if (writeStatus) save(resolve(root, 'translations/status.json'), summary)
    return checkpoint(root)
  }
  flush()
  const perLocale = new Map(TRANSLATION_LOCALES.map(locale => [locale, []]))
  for (const unit of queued) {
    const local = perLocale.get(unit.locale), last = local.at(-1)
    if (last && !last.isolated && !unit.isolated && last.locale === unit.locale && last.units.length < 6 && last.characters + unit.protection.text.length <= 12_000) {
      last.units.push(unit); last.characters += unit.protection.text.length
    } else local.push({ locale: unit.locale, units: [unit], characters: unit.protection.text.length, isolated: unit.isolated })
  }
  const batches = []
  for (const phase of [['zh', 'en'], TRANSLATION_LOCALES.filter(locale => locale !== 'zh' && locale !== 'en')]) {
    const length = Math.max(...phase.map(locale => perLocale.get(locale).length))
    for (let i = 0; i < length; i++) for (const locale of phase) if (perLocale.get(locale)[i]) batches.push(perLocale.get(locale)[i])
  }
  if (batches.length && !environment.MINIMAX_SUBSCRIPTION_KEY) { summary.state = 'missing_subscription_key'; flush(); return summary }
  let cursor = 0, stop = false
  while (cursor < batches.length && summary.modelCalls < maxCalls && now() + 95_000 < deadlineAt && !stop) {
    const currentQuota = await quota({ key: environment.MINIMAX_SUBSCRIPTION_KEY, now: now() })
    summary.quota = currentQuota
    if (!currentQuota.allow) { summary.state = 'quota_wait'; break }
    const quotaCapacity = currentQuota.remainingPercent > 40 ? 8 : currentQuota.remainingPercent > 20 ? 4 : currentQuota.remainingPercent > 10 ? 2 : 1
    const primaryPhase = ['zh', 'en'].includes(batches[cursor].locale)
    const wave = batches.slice(cursor, cursor + Math.min(concurrency, quotaCapacity, maxCalls - summary.modelCalls))
      .filter(batch => ['zh', 'en'].includes(batch.locale) === primaryPhase)
    cursor += wave.length
    // Persist and PUSH the intent before any billable request. A killed runner
    // leaves reserved outcomes quarantined instead of charging for a replay.
    for (const batch of wave) for (const unit of batch.units) save(resolve(root, reservationPath(unit)), {
      schemaVersion: 1, key: unit.key, locale: unit.locale, state: 'reserved', ...journalPolicy(unit),
      requestedAt: new Date(now()).toISOString(), runId: String(environment.GITHUB_RUN_ID || 'manual'),
      requestHash: hash(canonicalJson({ locale: batch.locale, items: batch.units.map(row => ({ key: row.key, text: row.protection.text })) })) })
    flush()
    const outcomes = await Promise.allSettled(wave.map(async batch => {
      summary.modelCalls++
      const failUnit = (unit, code, unknown = false, retryAt = null) => {
        // Filesystem failures propagate; they must never rewrite a previously
        // completed unit as failed or become permission for another model call.
        if (completed.has(unit.key)) return
        save(resolve(root, reservationPath(unit)), { schemaVersion: 1, key: unit.key, locale: unit.locale,
          state: unknown ? 'unknown' : 'failed', ...journalPolicy(unit), code,
          completedAt: new Date(now()).toISOString(), retryAt: retryAt || new Date(now() + 15 * 60_000).toISOString() })
        if (unknown) summary.blockedUnknownUnits++
        else summary.failedUnits++
      }
      let response
      try {
        response = await translate({ key: environment.MINIMAX_SUBSCRIPTION_KEY, locale: batch.locale,
          items: batch.units.map(unit => ({ key: unit.key, text: unit.protection.text })), signal: AbortSignal.timeout(90_000) })
      } catch (error) {
        if (error?.code === 'translation_admission_wait' && error?.outcome === 'not_sent') {
          summary.modelCalls--
          summary.admissionWait = { reason: error.admissionReason ?? 'admission_response_unrecognized', retryAt: error.retryAfter }
          for (const unit of batch.units) save(resolve(root, reservationPath(unit)), { schemaVersion: 1, key: unit.key, locale: unit.locale,
            ...journalPolicy(unit), state: 'admission_wait', policyAttempts: Math.max(0, unit.policyAttempts - 1),
            attempts: Math.max(0, unit.attempts - 1), ...summary.admissionWait, code: error.code })
          summary.state = 'provider_wait'; summary.lastProviderError = error.code; stop = true
          return
        }
        // A provider can report charged usage even when its generated JSON is
        // unusable. Preserve measured usage, without inventing unknown usage or
        // counting it twice when our later fact validation rejected the text.
        if (Number.isSafeInteger(error?.usage?.inputTokens) && error.usage.inputTokens >= 0
          && Number.isSafeInteger(error?.usage?.outputTokens) && error.usage.outputTokens >= 0) {
          summary.inputTokens += error.usage.inputTokens; summary.outputTokens += error.usage.outputTokens
        }
        const unknown = error?.outcome === 'unknown' || error?.name === 'TimeoutError' || error?.name === 'AbortError'
        const code = failureCode(error)
        summary.lastProviderError = code
        for (const unit of batch.units) failUnit(unit, code, unknown, error?.retryAfter)
        if (code.includes('quota') || code.includes('rate_limit') || code.includes('unauthorized') || code.includes('configuration')
          || /http_(?:400|401|403|404|529)$/.test(code) || code.includes('model_mismatch')
          || code === 'translation_response_invalid' || code === 'translation_usage_invalid') { summary.state = 'provider_wait'; stop = true }
        return
      }
      // Account one response once, then validate/persist every item separately.
      // A bad neighbour cannot erase a good translation or charge for it again.
      summary.inputTokens += response.usage.inputTokens; summary.outputTokens += response.usage.outputTokens
      for (const unit of batch.units) {
        const rejected = response.rejectedItems?.find(item => item.key === unit.key)
        if (rejected) { failUnit(unit, failureCode(rejected)); continue }
        let result
        try {
          const output = response.items.find(item => item.key === unit.key)
          if (!output) throw new Error('translation_response_item_missing')
          result = record(unit, restoreTranslationText(output.text, unit.protection), 'minimax', response.model)
          if (!validateTranslationRecord(result, unit.source, unit.locale)) throw new Error('translation_validation_rejected')
        } catch (error) { failUnit(unit, failureCode(error)); continue }
        // Storage is outside the validation catch: an I/O error stops the run,
        // without relabelling a successfully saved neighbour as invalid output.
        accept(unit, result)
        save(resolve(root, reservationPath(unit)), { schemaVersion: 1, key: unit.key, locale: unit.locale,
          state: 'completed', ...journalPolicy(unit), completedAt: new Date(now()).toISOString() })
      }
    }))
    aggregate(); flush()
    if (outcomes.some(outcome => outcome.status === 'rejected')) throw new Error('translation_storage_failed')
  }
  if (summary.state === 'running') summary.state = pending() ? 'checkpoint_complete' : 'complete'
  aggregate(); flush()
  return summary
}

export async function runTranslationCheckpoint({ root, records, titleRecords, maxCalls, maxMinutes, concurrency,
  now = Date.now, generateBatch = runProgramTranslations, reviewBatch = reviewTranslationBacklog, checkpoint = checkpointTranslations }) {
  const deadline = now() + maxMinutes * 60_000
  const minutesLeft = () => (deadline - now()) / 60_000
  const titleOptions = { root, feedDir: root, records: titleRecords, fields: ['title'], locales: ['en'], concurrency,
    writeStatus: false, deadline, checkpoint, now }
  const titleReview = await reviewBatch({ ...titleOptions, maxCalls: Math.max(1, Math.floor(maxCalls / 8)) })
  const mayContinue = state => ['complete', 'review_checkpoint', 'checkpoint_complete'].includes(state)
  const titleGeneration = mayContinue(titleReview.state) && maxCalls > titleReview.modelCalls && minutesLeft() > 1.6
    ? await generateBatch({ ...titleOptions, maxCalls: 1, maxMinutes: minutesLeft() }) : null
  const titleCalls = titleReview.modelCalls + (titleGeneration?.modelCalls || 0)
  const fields = TRANSLATION_FIELDS.filter(field => field !== 'title')
  const canProcessDetails = maxCalls > titleCalls && mayContinue(titleReview.state) && (!titleGeneration || mayContinue(titleGeneration.state))
  // Give new source text a bounded share while retaining time and calls to independently review it.
  const generate = canProcessDetails && minutesLeft() > 1.6
    ? await generateBatch({ feedDir: root, records, fields, concurrency, writeStatus: false, checkpoint, now,
      maxCalls: Math.min(maxCalls - titleCalls, Math.max(1, Math.floor(maxCalls / 4))), maxMinutes: Math.min(4, minutesLeft()) }) : null
  const available = maxCalls - titleCalls - (generate?.modelCalls || 0)
  const detailReview = canProcessDetails && available > 0 && (!generate || mayContinue(generate.state))
    ? await reviewBatch({ root, records, fields, maxCalls: available, deadline, concurrency, checkpoint, now }) : null
  const review = { ...titleReview, state: detailReview?.state ?? generate?.state ?? titleGeneration?.state ?? titleReview.state }
  for (const metric of ['modelCalls', 'approved', 'revise', 'blocked', 'unknown', 'skippedCopy', 'skippedSameLanguage', 'skippedUnprovenEnglish', 'inputTokens', 'outputTokens']) {
    review[metric] = (review[metric] || 0) + (detailReview?.[metric] || 0)
  }
  const state = review.state === 'complete' && generate?.state === 'checkpoint_complete' ? generate.state : review.state
  return { ...generate, state, review, englishTitles: { review: titleReview, generation: titleGeneration },
    startedAt: review.startedAt, updatedAt: new Date(now()).toISOString(),
    published: (generate?.published || 0) + review.approved,
    modelCalls: (generate?.modelCalls || 0) + (titleGeneration?.modelCalls || 0) + review.modelCalls,
    inputTokens: (generate?.inputTokens || 0) + (titleGeneration?.inputTokens || 0) + review.inputTokens,
    outputTokens: (generate?.outputTokens || 0) + (titleGeneration?.outputTokens || 0) + review.outputTokens }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1] }
  if (!args.includes('--execute') || !option('--feed-dir')) throw new Error('translation_execute_and_feed_dir_required')
  const root = resolve(option('--feed-dir')), maxCalls = Number(option('--max-calls') || 120)
  const maxMinutes = Number(option('--max-minutes') || 8), concurrency = Number(option('--concurrency') || 8)
  if (!Number.isFinite(maxMinutes) || maxMinutes < 0.1 || maxMinutes > 12 || !Number.isSafeInteger(maxCalls)
    || maxCalls < 1 || maxCalls > 240 || !Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 8)
    throw new Error('translation_batch_bounds_invalid')
  assertFeedCheckout(root)
  const records = loadProgramFeed(root).records.filter(row => row.status === 'extracted' && !programWithdrawalReason(row))
  const titleRecords = [...publicOfficialTitles().filter(row => !row.hasEnglishTitle),
    ...records.filter(row => needsEnglishTitle(row.name))]
  const result = await runTranslationCheckpoint({ root, records, titleRecords, maxCalls, maxMinutes, concurrency })
  save(resolve(root, 'translations/status.json'), result)
  checkpointTranslations(root)
  console.log(JSON.stringify(result))
  const { review } = result
  if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY,
    `Translation checkpoint: ${review.approved} reviews approved, ${review.skippedCopy} copies, ${review.skippedSameLanguage} same-language edits and ${review.skippedUnprovenEnglish} without evidence of a non-English source skipped, ${review.revise} revisions, ${review.blocked} blocked, ${result.modelCalls} model calls. State ${result.state}.\n`, { flag: 'a' })
  if (result.state === 'missing_subscription_key') process.exitCode = 1
}
