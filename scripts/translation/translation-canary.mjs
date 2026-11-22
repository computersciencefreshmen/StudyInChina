import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadProgramFeed, canonicalJson } from '../ingestion/program-catalog-feed.mjs'
import { assertFeedCheckout } from '../ingestion/harvest-program-catalog.mjs'
import { programWithdrawalReason } from '../../src/lib/program-publication-policy.mjs'
import { programTranslationSource, TRANSLATION_FIELDS } from '../../src/lib/program-translation-contract.ts'
import { publicOfficialTitles } from './official-title-records.ts'
import { publicationPath, translationScope, validatePublishedTranslation, REVIEW_POLICY } from '../../src/lib/program-translation-review.ts'
import { checkpointTranslations, runProgramTranslations } from './run-program-translations.mjs'
import { reviewTranslationBacklog } from './review-program-translations.mjs'
import { CANARY_REVIEW_CONTRACT, SAMPLES, manualCanaryRetryContext } from './translation-canary-contract.mjs'
export { SAMPLES } from './translation-canary-contract.mjs'

const hash = text => createHash('sha256').update(text).digest('hex')

export function canaryRecords(catalog) {
  const records = new Map(catalog.map(row => [row.id, row]))
  return SAMPLES.map(({ id, schoolId, field, sourceHash, referenceEnglishTitle }) => {
    const row = records.get(id)
    const locale = field === 'title' ? 'en' : 'zh'
    const source = row && programTranslationSource(row, field, locale)
    if (!row || row.schoolId !== schoolId || row.status !== 'extracted' || programWithdrawalReason(row)
      || typeof source !== 'string' || hash(source) !== sourceHash)
      throw new Error('translation_canary_source_changed_' + id)
    const fields = { ...row.fields }
    for (const other of TRANSLATION_FIELDS) if (other !== field) delete fields[other]
    return { ...row, fields, canaryLocale: locale, referenceEnglishTitle }
  })
}

export function inspectCanary(root, records) {
  return records.map((row, index) => {
    const { field, sourceHash, referenceEnglishTitle, referenceUrl, programCode } = SAMPLES[index], locale = row.canaryLocale, source = programTranslationSource(row, field, locale)
    const scope = translationScope(row, field), file = publicationPath(source, locale, scope)
    const raw = existsSync(join(root, file)) ? JSON.parse(readFileSync(join(root, file), 'utf8')) : null
    const approved = validatePublishedTranslation(raw, source, locale, scope)
    return { id: row.id, slug: row.slug || row.id, field, locale, sourceHash,
      ...(referenceUrl && { referenceUrl, programCode }),
      ...(approved?.method === 'minimax' && (!referenceEnglishTitle || approved.text.trim() === referenceEnglishTitle) ? { state: 'approved', translationHash: hash(approved.text),
        binding: raw.review.binding, checkedAt: raw.review.checkedAt, path: file } : { state: 'original_only' }) }
  })
}

export function matchesPublicSample(sample, body) {
  const original = sample.field === 'title' ? body?.data?.name?.zh : body?.data?.fields?.[sample.field]
  const translated = body?.translations?.fields?.[sample.field]
  if (!/^[a-f0-9]{64}$/u.test(body?.meta?.revision || '') || body?.data?.id !== sample.id ||
    typeof original !== 'string' || hash(original) !== sample.sourceHash) return false
  if (sample.state === 'original_only') return translated === undefined
  return body.translations?.locale === sample.locale && translated?.method === 'minimax' &&
    typeof translated.text === 'string' && hash(translated.text) === sample.translationHash
}

async function observeProduction(receipt) {
  const fields = await Promise.all(receipt.fields.map(async sample => {
    const url = new URL('https://studyinchina.vercel.app/api/v1/programs/' + encodeURIComponent(sample.slug))
    url.search = new URLSearchParams({ view: 'all', locale: sample.locale, receipt: receipt.runId + '-' + receipt.runAttempt }).toString()
    let revision = null
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const response = await fetch(url, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000) })
        if (response.ok) {
          const body = await response.json()
          if (matchesPublicSample(sample, body)) { revision = body.meta.revision; break }
        } else await response.body?.cancel()
      } catch { /* Read failures are retried; they never dispatch a model call. */ }
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 25000))
    }
    return { id: sample.id, field: sample.field, expected: sample.state, matched: Boolean(revision), revision, url: url.href }
  }))
  const sameRevision = fields.every(row => row.revision && row.revision === fields[0].revision)
  return { checkedAt: new Date().toISOString(), sameRevision, fields }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv[2] !== '--execute' || process.argv[3] !== '--feed-dir' || process.argv.length !== 5
    || process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || process.env.GITHUB_REF !== 'refs/heads/main'
    || !/^\d+$/.test(process.env.GITHUB_RUN_ID || '') || !/^\d+$/.test(process.env.GITHUB_RUN_ATTEMPT || ''))
    throw new Error('translation_canary_manual_main_required')
  const root = resolve(process.argv[4])
  assertFeedCheckout(root)
  const { records: catalog, manifest } = loadProgramFeed(root)
  const records = canaryRecords([...catalog, ...publicOfficialTitles()])
  const retryLegacyFailedCanary = process.env.CANARY_RETRY_LEGACY_FAILED === 'true'
  if (retryLegacyFailedCanary) manualCanaryRetryContext(process.env)
  const batches = []
  for (const locale of ['en', 'zh']) {
    const selected = records.filter(row => row.canaryLocale === locale)
    const options = { records: selected, locales: [locale], concurrency: 1, writeStatus: false, checkpoint: checkpointTranslations }
    const generation = await runProgramTranslations({ ...options, feedDir: root, maxCalls: 1, maxMinutes: 3 })
    const review = await reviewTranslationBacklog({ ...options, root, maxCalls: selected.length, deadline: Date.now() + 4.5 * 60_000, retryLegacyFailedCanary })
    batches.push({ locale, generation, review })
  }
  const fields = inspectCanary(root, records)
  const receipt = { schemaVersion: 1, policy: REVIEW_POLICY, catalogRevision: manifest.revision, codeCommit: process.env.GITHUB_SHA,
    runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    updatedAt: new Date().toISOString(), batches, fields,
    ...(retryLegacyFailedCanary ? { manualRetryContract: CANARY_REVIEW_CONTRACT } : {}) }
  const path = join(root, 'translations/canary', receipt.runId + '-' + receipt.runAttempt + '.json')
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, canonicalJson(receipt) + '\n', { flag: 'wx' })
  checkpointTranslations(root)
  console.log(JSON.stringify(receipt))
  const production = await observeProduction(receipt)
  writeFileSync(path.replace(/\.json$/u, '-production.json'), canonicalJson(production) + '\n', { flag: 'wx' })
  checkpointTranslations(root)
  console.log(JSON.stringify(production))
  if (fields.some(row => row.state !== 'approved') || !production.sameRevision) process.exitCode = 1
}
