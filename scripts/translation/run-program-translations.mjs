import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { canonicalJson, loadProgramFeed } from '../ingestion/program-catalog-feed.mjs'
import { assertFeedCheckout } from '../ingestion/harvest-program-catalog.mjs'
import { TRANSLATION_FIELDS, TRANSLATION_LOCALES, TRANSLATION_VERSION, translationKey, translationPath,
  protectTranslationText, restoreTranslationText, sourceIsTargetLanguage, validateTranslationRecord } from '../../src/lib/program-translation-contract.ts'
import { readTranslationQuota, translateMaskedBatch } from './minimax-translation-provider.ts'

const hash = text => createHash('sha256').update(text).digest('hex')
const read = path => { try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return null } }
const save = (path, value) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, canonicalJson(value) + '\n') }
const reservationPath = unit => `translations/reservations/${TRANSLATION_VERSION}/${unit.locale}/${unit.key}.json`

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

export function buildTranslationUnits(records) {
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
    for (const field of TRANSLATION_FIELDS) for (const row of ordered) {
      const source = row.fields?.[field]
      if (typeof source !== 'string' || !source.trim()) continue
      for (const locale of phase) {
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
  // One serialized data writer; a failed push stops work, never force-pushes.
  git(['push', 'origin', 'HEAD:refs/heads/catalog-program-feed'])
  return true
}

export async function runProgramTranslations({ feedDir, records, maxCalls = 120, concurrency = 8, maxMinutes = 8,
  environment = process.env, now = Date.now, quota = readTranslationQuota, translate = translateMaskedBatch,
  checkpoint = checkpointTranslations } = {}) {
  if (!Number.isSafeInteger(maxCalls) || maxCalls < 1 || maxCalls > 240 || !Number.isSafeInteger(concurrency)
    || concurrency < 1 || concurrency > 8 || !Number.isFinite(maxMinutes) || maxMinutes < 0.1 || maxMinutes > 9) throw new Error('translation_batch_bounds_invalid')
  const root = resolve(feedDir), startedAt = new Date(now()).toISOString(), deadlineAt = now() + maxMinutes * 60_000
  if (!records) { assertFeedCheckout(root); records = loadProgramFeed(root).records }
  const units = buildTranslationUnits(records), completed = new Map(), queued = [], rejectedAssemblies = new Set()
  const summary = { schemaVersion: 1, version: TRANSLATION_VERSION, startedAt, updatedAt: startedAt, state: 'running',
    modelCalls: 0, inputTokens: 0, outputTokens: 0, published: 0, reused: 0, copiedSource: 0,
    pendingUniqueUnits: 0, blockedUnknownUnits: 0, failedUnits: 0, completedByLocale: Object.fromEntries(TRANSLATION_LOCALES.map(locale => [locale, 0])), quota: null }
  const entry = unit => resolve(root, translationPath(unit.source, unit.locale))
  const record = (unit, text, method, model) => ({ schemaVersion: 1, version: TRANSLATION_VERSION, key: unit.key,
    sourceHash: hash(unit.source), targetLocale: unit.locale, text, method, model, translatedAt: new Date(now()).toISOString(), validation: 'passed' })
  const accept = (unit, value, fresh = true) => {
    const checked = validateTranslationRecord(value, unit.source, unit.locale)
    if (!checked) throw new Error('translation_validation_rejected')
    if (fresh) {
      const path = entry(unit)
      if (existsSync(path)) {
        const prior = validateTranslationRecord(read(path), unit.source, unit.locale)
        if (!prior) throw new Error('translation_existing_entry_invalid')
        completed.set(unit.key, prior); return
      }
      save(path, checked); summary.published++
    } else summary.reused++
    completed.set(unit.key, checked); summary.completedByLocale[unit.locale]++
  }
  const aggregate = () => {
    for (const unit of units) if (unit.children && !completed.has(unit.key) && !rejectedAssemblies.has(unit.key) && unit.children.every(key => completed.has(key))) {
      const children = unit.children.map(key => completed.get(key))
      try {
        accept(unit, record(unit, children.map(child => child.text).join(''), children.every(child => child.method === 'source') ? 'source' : 'minimax',
          children.some(child => child.method === 'minimax') ? 'MiniMax-M3' : null))
      } catch { rejectedAssemblies.add(unit.key); summary.failedUnits++ }
    }
  }
  for (const unit of units) {
    const prior = validateTranslationRecord(read(entry(unit)), unit.source, unit.locale)
    if (prior) { accept(unit, prior, false); continue }
    if (unit.children) continue
    if (sourceIsTargetLanguage(unit.source, unit.locale)) { accept(unit, record(unit, unit.source, 'source', null)); summary.copiedSource++; continue }
    const protection = protectTranslationText(unit.source)
    // All-critical clauses stay verbatim; there is no useful model work to buy.
    if (!protection.text.replace(/__SC_\d{6}__/g, '').replace(/[^\p{L}]/gu, '')) { accept(unit, record(unit, unit.source, 'source', null)); summary.copiedSource++; continue }
    const reservation = read(resolve(root, reservationPath(unit)))
    if (reservation && ['reserved', 'unknown'].includes(reservation.state)) { summary.blockedUnknownUnits++; continue }
    if (reservation?.state === 'failed' && (reservation.attempts >= 2 || Date.parse(reservation.retryAt) > now())) { summary.failedUnits++; continue }
    if (protection.text.length > 24_000) { summary.failedUnits++; continue }
    queued.push({ ...unit, protection, attempts: (reservation?.attempts || 0) + 1 })
  }
  aggregate()
  const pending = () => units.filter(unit => !completed.has(unit.key)).length
  const flush = () => { summary.pendingUniqueUnits = pending(); summary.updatedAt = new Date(now()).toISOString(); save(resolve(root, 'translations/status.json'), summary); return checkpoint(root) }
  flush()
  const perLocale = new Map(TRANSLATION_LOCALES.map(locale => [locale, []]))
  for (const unit of queued) {
    const local = perLocale.get(unit.locale), last = local.at(-1)
    if (last && last.locale === unit.locale && last.units.length < 6 && last.characters + unit.protection.text.length <= 12_000) {
      last.units.push(unit); last.characters += unit.protection.text.length
    } else local.push({ locale: unit.locale, units: [unit], characters: unit.protection.text.length })
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
      schemaVersion: 1, key: unit.key, locale: unit.locale, state: 'reserved', attempts: unit.attempts,
      requestedAt: new Date(now()).toISOString(), runId: String(environment.GITHUB_RUN_ID || 'manual'),
      requestHash: hash(canonicalJson({ locale: batch.locale, items: batch.units.map(row => ({ key: row.key, text: row.protection.text })) })) })
    flush()
    await Promise.all(wave.map(async batch => {
      summary.modelCalls++
      try {
        const response = await translate({ key: environment.MINIMAX_SUBSCRIPTION_KEY, locale: batch.locale,
          items: batch.units.map(unit => ({ key: unit.key, text: unit.protection.text })), signal: AbortSignal.timeout(90_000) })
        summary.inputTokens += response.usage.inputTokens; summary.outputTokens += response.usage.outputTokens
        // Validate the whole batch before making any of its translations visible.
        const outputs = batch.units.map(unit => {
          const output = response.items.find(item => item.key === unit.key)
          if (!output) throw new Error('translation_response_item_missing')
          const result = record(unit, restoreTranslationText(output.text, unit.protection), 'minimax', response.model)
          if (!validateTranslationRecord(result, unit.source, unit.locale)) throw new Error('translation_validation_rejected')
          return { unit, result }
        })
        for (const { unit, result } of outputs) {
          accept(unit, result)
          save(resolve(root, reservationPath(unit)), { schemaVersion: 1, key: unit.key, locale: unit.locale,
            state: 'completed', attempts: unit.attempts, completedAt: new Date(now()).toISOString() })
        }
      } catch (error) {
        const unknown = error?.outcome === 'unknown' || error?.name === 'TimeoutError' || error?.name === 'AbortError'
        const code = /^[a-z0-9_]{1,100}$/.test(error?.code || '') ? error.code : 'translation_validation_or_provider_rejected'
        for (const unit of batch.units) save(resolve(root, reservationPath(unit)), { schemaVersion: 1, key: unit.key,
          locale: unit.locale, state: unknown ? 'unknown' : 'failed', attempts: unit.attempts, code,
          completedAt: new Date(now()).toISOString(), retryAt: error?.retryAfter || new Date(now() + 15 * 60_000).toISOString() })
        if (code.includes('quota') || code.includes('rate_limit') || code.includes('unauthorized') || code.includes('configuration')
          || /http_(?:400|401|403|404)$/.test(code) || code.includes('model_mismatch')
          || code === 'translation_response_invalid' || code === 'translation_usage_invalid') { summary.state = 'provider_wait'; stop = true }
        if (unknown) summary.blockedUnknownUnits += batch.units.length
        else summary.failedUnits += batch.units.length
      }
    }))
    aggregate(); flush()
  }
  if (summary.state === 'running') summary.state = pending() ? 'checkpoint_complete' : 'complete'
  aggregate(); flush()
  return summary
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1] }
  if (!args.includes('--execute') || !option('--feed-dir')) throw new Error('translation_execute_and_feed_dir_required')
  const result = await runProgramTranslations({ feedDir: option('--feed-dir'), maxCalls: Number(option('--max-calls') || 120),
    concurrency: Number(option('--concurrency') || 8), maxMinutes: Number(option('--max-minutes') || 8) })
  console.log(JSON.stringify(result))
  if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY,
    `Translation checkpoint: ${result.published} new entries, ${result.modelCalls} model calls, ${result.pendingUniqueUnits} pending; state ${result.state}.\n`, { flag: 'a' })
  if (result.state === 'missing_subscription_key') process.exitCode = 1
}
