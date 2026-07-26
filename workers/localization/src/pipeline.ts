import { translationLimits } from './config'
import { asLocalizationError, LocalizationError } from './errors'
import { sha256Hex, stableJson } from './hash'
import { translateWithMiniMax } from './minimax'
import { protectStructuredFacts, restoreStructuredFacts } from './protection'
import { D1LocalizationRepository } from './repository'
import {
  TRANSLATION_PROMPT_VERSION,
  type BatchPlanResult,
  type Fetcher,
  type LegacyLocalizedContentStatus,
  type LocalizationEnv,
  type SourceCandidate,
  type TranslationBatchRequest,
  type TranslationCacheEntry,
  type TranslationJob,
  type TranslationPlan,
  type TranslationQueueBatch,
} from './types'

type RuntimeTranslationJob = TranslationJob & {
  sourceStatus?: LegacyLocalizedContentStatus | null
  sourceOriginLocale?: string | null
}

function monthKey(now: Date): string {
  return now.toISOString().slice(0, 7)
}

function nextMonth(now: Date): string {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 5))
  return next.toISOString()
}

function retryAt(now: Date, seconds: number): string {
  return new Date(now.getTime() + Math.max(60, Math.min(seconds, 86_400)) * 1_000).toISOString()
}

function isHumanReviewed(status: LegacyLocalizedContentStatus | null): boolean {
  return status === 'reviewed' || status === 'published'
}

export async function sourceFingerprint(candidate: SourceCandidate): Promise<string> {
  return sha256Hex(stableJson({
    locale: candidate.sourceLocale,
    text: candidate.sourceText.normalize('NFC'),
  }))
}

export async function translationCacheKey(
  candidate: Pick<
    SourceCandidate,
    'recordKind' | 'fieldName' | 'sourceLocale' | 'targetLocale'
  >,
  sourceSha256: string,
  model: string,
): Promise<string> {
  return sha256Hex(stableJson({
    version: TRANSLATION_PROMPT_VERSION,
    model,
    recordKind: candidate.recordKind,
    fieldName: candidate.fieldName,
    sourceLocale: candidate.sourceLocale,
    targetLocale: candidate.targetLocale,
    sourceSha256,
  }))
}

async function planCandidate(
  candidate: SourceCandidate,
  model: string,
): Promise<TranslationPlan> {
  const sourceSha256 = await sourceFingerprint(candidate)
  const cacheKey = await translationCacheKey(candidate, sourceSha256, model)
  const jobId = await sha256Hex(stableJson({
    cacheKey,
    recordId: candidate.recordId,
    fieldName: candidate.fieldName,
    targetLocale: candidate.targetLocale,
  }))
  return {
    ...candidate,
    sourceSha256,
    cacheKey,
    jobId,
    model,
    promptVersion: TRANSLATION_PROMPT_VERSION,
  }
}

function groupKey(plan: TranslationPlan): string {
  return [
    plan.institutionId ?? 'unscoped',
    plan.sourceLocale,
    plan.targetLocale,
    plan.model,
  ].join('\u0000')
}

function chunkPlans(
  plans: TranslationPlan[],
  itemLimit: number,
  characterLimit: number,
): TranslationPlan[][] {
  const chunks: TranslationPlan[][] = []
  let current: TranslationPlan[] = []
  let characters = 0
  for (const plan of plans) {
    if (plan.sourceText.length > characterLimit) {
      throw new LocalizationError(
        `${plan.recordPublicId}.${plan.fieldName} exceeds the per-batch text limit`,
        'translation_source_too_large',
        false,
      )
    }
    if (
      current.length > 0
      && (current.length >= itemLimit || characters + plan.sourceText.length > characterLimit)
    ) {
      chunks.push(current)
      current = []
      characters = 0
    }
    current.push(plan)
    characters += plan.sourceText.length
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

export async function planTranslationBatch(
  environment: LocalizationEnv,
  request: TranslationBatchRequest,
  requestedBy: 'schedule' | 'api' | 'cli',
  now = new Date(),
): Promise<BatchPlanResult> {
  const limits = translationLimits(environment)
  if (!limits.enabled) {
    throw new LocalizationError(
      'Translation scheduling is disabled by the quota fuse',
      'translation_disabled',
      false,
    )
  }
  const model = environment.MINIMAX_MODEL
  if (!model) {
    throw new LocalizationError(
      'MINIMAX_MODEL is required before translation work can be planned',
      'minimax_not_configured',
      false,
    )
  }
  const repository = new D1LocalizationRepository(environment.PIPELINE_DB)
  const timestamp = now.toISOString()
  const runId = await sha256Hex(stableJson({
    type: 'translation-run',
    requestedBy,
    request,
    timestamp,
    nonce: crypto.randomUUID(),
  }))
  await repository.createRun(runId, requestedBy, request, timestamp)

  try {
    const selected: TranslationPlan[] = []
    let skippedCurrent = 0
    for (const targetLocale of request.targetLocales) {
      if (selected.length >= request.limit) break
      const candidates = await repository.listCandidates(
        targetLocale,
        request,
        Math.max(request.limit * 2, 50),
      )
      for (const candidate of candidates) {
        if (selected.length >= request.limit) break
        if (isHumanReviewed(candidate.targetStatus)) {
          skippedCurrent += 1
          continue
        }
        const plan = await planCandidate(candidate, model)
        if (
          candidate.targetStatus === 'machine'
          && candidate.targetSourceSha256 === plan.sourceSha256
        ) {
          skippedCurrent += 1
          continue
        }
        selected.push(plan)
      }
    }

    const groups = new Map<string, TranslationPlan[]>()
    for (const plan of selected) {
      groups.set(groupKey(plan), [...(groups.get(groupKey(plan)) ?? []), plan])
    }
    const batches: Array<{ batchId: string; plans: TranslationPlan[] }> = []
    for (const plans of groups.values()) {
      for (const chunk of chunkPlans(plans, limits.batchItems, limits.batchCharacters)) {
        const batchId = await sha256Hex(stableJson({
          runId,
          jobIds: chunk.map((plan) => plan.jobId).sort(),
        }))
        batches.push({ batchId, plans: chunk })
      }
    }

    if (!request.dryRun) {
      for (const batch of batches) {
        const first = batch.plans[0]
        if (!first) continue
        await repository.createBatch({
          batchId: batch.batchId,
          runId,
          sourceLocale: first.sourceLocale,
          targetLocale: first.targetLocale,
          institutionId: first.institutionId,
        }, batch.plans, timestamp)
        await environment.LOCALIZATION_QUEUE.send({
          version: 1,
          batchId: batch.batchId,
          jobIds: batch.plans.map((plan) => plan.jobId),
          queuedAt: timestamp,
        })
      }
    }

    await repository.finishRun(runId, {
      dryRun: request.dryRun,
      plannedJobs: selected.length,
      cacheHits: 0,
      skippedCurrent,
      queued: batches.length > 0,
    }, timestamp)
    return {
      runId,
      dryRun: request.dryRun,
      plannedJobs: selected.length,
      queuedBatches: request.dryRun ? 0 : batches.length,
      skippedCurrent,
      cacheEligible: 0,
    }
  } catch (error) {
    const normalized = asLocalizationError(error)
    await repository.failRun(runId, normalized.code, new Date().toISOString()).catch(() => undefined)
    throw normalized
  }
}

function isQueueBatch(value: unknown): value is TranslationQueueBatch {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return (
    item.version === 1
    && typeof item.batchId === 'string'
    && /^[a-f0-9]{64}$/.test(item.batchId)
    && Array.isArray(item.jobIds)
    && item.jobIds.length >= 1
    && item.jobIds.length <= 50
    && item.jobIds.every((jobId) => typeof jobId === 'string' && /^[a-f0-9]{64}$/.test(jobId))
    && new Set(item.jobIds).size === item.jobIds.length
    && typeof item.queuedAt === 'string'
    && !Number.isNaN(new Date(item.queuedAt).getTime())
  )
}

async function applyCached(
  repository: D1LocalizationRepository,
  job: RuntimeTranslationJob,
  entry: TranslationCacheEntry,
  now: string,
): Promise<void> {
  if (
    entry.sourceSha256 !== job.sourceSha256
    || entry.sourceLocale !== job.sourceLocale
    || entry.targetLocale !== job.targetLocale
    || entry.recordKind !== job.recordKind
    || entry.fieldName !== job.fieldName
    || entry.model !== job.model
    || entry.promptVersion !== job.promptVersion
  ) {
    throw new LocalizationError(
      'Translation cache metadata does not match its job',
      'translation_cache_mismatch',
      false,
    )
  }
  await repository.applyTranslation(job, entry, true, now)
}

export async function processTranslationQueueBatch(
  environment: LocalizationEnv,
  value: unknown,
  fetcher: Fetcher = fetch,
  now = new Date(),
): Promise<void> {
  if (!isQueueBatch(value)) {
    throw new LocalizationError(
      'Queue payload does not match TranslationQueueBatch v1',
      'translation_queue_message_invalid',
      false,
    )
  }
  const limits = translationLimits(environment)
  const repository = new D1LocalizationRepository(environment.PIPELINE_DB)
  const timestamp = now.toISOString()
  const jobs = await repository.loadJobs(value.jobIds) as RuntimeTranslationJob[]
  if (
    jobs.length !== value.jobIds.length
    || jobs.some((job) => job.batchId !== value.batchId)
  ) {
    throw new LocalizationError(
      'Translation queue batch does not match reserved jobs',
      'translation_queue_batch_mismatch',
      false,
    )
  }

  const uncached: RuntimeTranslationJob[] = []
  let cacheHits = 0
  for (const job of jobs) {
    if (!(await repository.claimJob(job.jobId, timestamp, limits.maxAttempts))) continue
    if (
      !job.sourceText
      || !isHumanReviewed(job.sourceStatus ?? null)
      || (
        job.sourceOriginLocale !== null
        && job.sourceOriginLocale !== undefined
        && job.sourceOriginLocale !== job.sourceLocale
      )
    ) {
      await repository.markJob(
        job.jobId,
        'stale',
        'translation_source_no_longer_reviewed',
        timestamp,
      )
      continue
    }
    if (await sourceFingerprint(job) !== job.sourceSha256) {
      await repository.markJob(job.jobId, 'stale', 'translation_source_changed', timestamp)
      continue
    }
    if (isHumanReviewed(job.targetStatus)) {
      await repository.markJob(job.jobId, 'cancelled', 'human_translation_present', timestamp)
      continue
    }
    if (
      job.targetStatus === 'machine'
      && job.targetSourceSha256 === job.sourceSha256
    ) {
      await repository.markJob(job.jobId, 'cancelled', 'translation_already_current', timestamp)
      continue
    }
    const cached = await repository.findCache(job.cacheKey)
    if (cached) {
      await applyCached(repository, job, cached, timestamp)
      cacheHits += 1
      continue
    }
    uncached.push(job)
  }

  if (cacheHits > 0) {
    await repository.recordUsage(monthKey(now), {
      apiCalls: 0,
      inputCharacters: 0,
      outputCharacters: 0,
      translatedItems: 0,
      cacheHits,
    }, timestamp)
  }
  if (uncached.length === 0) {
    await repository.refreshBatch(value.batchId, timestamp)
    return
  }

  const first = uncached[0] as RuntimeTranslationJob
  if (uncached.some((job) => (
    job.sourceLocale !== first.sourceLocale
    || job.targetLocale !== first.targetLocale
    || job.model !== first.model
  ))) {
    throw new LocalizationError(
      'A model call may only contain one source/target locale and model',
      'translation_batch_mixed_configuration',
      false,
    )
  }

  const protectedById = new Map(uncached.map((job) => [
    job.jobId,
    protectStructuredFacts(job.sourceText),
  ]))
  const modelItems = uncached.map((job) => ({
    id: job.jobId,
    fieldName: job.fieldName,
    sourceText: protectedById.get(job.jobId)?.text ?? '',
  }))
  const estimatedInput = modelItems.reduce((total, item) => total + item.sourceText.length, 0)
  const usage = await repository.usage(monthKey(now))
  if (
    !limits.enabled
    || usage.apiCalls + 1 > limits.monthlyApiCalls
    || usage.inputCharacters + estimatedInput > limits.monthlyInputCharacters
  ) {
    for (const job of uncached) {
      await repository.markJob(
        job.jobId,
        'deferred',
        'translation_monthly_quota_reached',
        timestamp,
        nextMonth(now),
      )
    }
    await repository.refreshBatch(value.batchId, timestamp)
    return
  }

  try {
    const translated = await translateWithMiniMax(
      environment,
      limits,
      first.sourceLocale,
      first.targetLocale,
      modelItems,
      fetcher,
    )
    const outputs = new Map(translated.output.items.map((item) => [item.id, item.translatedText]))
    let completed = 0
    for (const job of uncached) {
      try {
        const protectedText = protectedById.get(job.jobId)
        const rawTranslation = outputs.get(job.jobId)
        if (!protectedText || !rawTranslation) {
          throw new LocalizationError(
            'Translation output omitted a reserved job',
            'translation_output_schema_invalid',
            true,
          )
        }
        const translatedText = restoreStructuredFacts(rawTranslation, protectedText)
        const entry: TranslationCacheEntry = {
          cacheKey: job.cacheKey,
          sourceSha256: job.sourceSha256,
          sourceLocale: job.sourceLocale,
          targetLocale: job.targetLocale,
          recordKind: job.recordKind,
          fieldName: job.fieldName,
          model: job.model,
          promptVersion: job.promptVersion,
          translatedText,
          translatedSha256: await sha256Hex(translatedText.normalize('NFC')),
          translationStatus: 'machine_generated',
        }
        const canonical = await repository.storeCache(entry, timestamp)
        await repository.applyTranslation(job, canonical, false, timestamp)
        completed += 1
      } catch (error) {
        const normalized = asLocalizationError(error)
        await repository.markJob(
          job.jobId,
          normalized.retryable ? 'deferred' : 'failed',
          normalized.code,
          timestamp,
          normalized.retryable
            ? retryAt(now, normalized.retryAfterSeconds ?? 900)
            : null,
        )
      }
    }
    await repository.recordUsage(monthKey(now), {
      apiCalls: 1,
      inputCharacters: translated.inputCharacters,
      outputCharacters: translated.outputCharacters,
      translatedItems: completed,
      cacheHits: 0,
    }, timestamp)
  } catch (error) {
    const normalized = asLocalizationError(error)
    for (const job of uncached) {
      await repository.markJob(
        job.jobId,
        normalized.retryable ? 'deferred' : 'failed',
        normalized.code,
        timestamp,
        normalized.retryable
          ? retryAt(now, normalized.retryAfterSeconds ?? 900)
          : null,
      )
    }
  }
  await repository.refreshBatch(value.batchId, new Date().toISOString())
}

