import { LocalizationError } from './errors'
import {
  STABLE_LOCALIZED_FIELDS,
  SUPPORTED_TARGET_LOCALES,
  type D1Database,
  type D1PreparedStatement,
  type LegacyLocalizedContentStatus,
  type SourceCandidate,
  type StableLocalizedField,
  type SupportedTargetLocale,
  type TranslatableRecordKind,
  type TranslationBatchRequest,
  type TranslationCacheEntry,
  type TranslationJob,
  type TranslationPlan,
  type TranslationUsage,
} from './types'

type SqlRow = Record<string, unknown>

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ')
}

function requiredString(row: SqlRow, key: string): string {
  const value = row[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new LocalizationError(`D1 row is missing ${key}`, 'localization_db_shape_invalid', false)
  }
  return value
}

function optionalString(row: SqlRow, key: string): string | null {
  const value = row[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function requiredNumber(row: SqlRow, key: string): number {
  const value = row[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new LocalizationError(`D1 row is missing ${key}`, 'localization_db_shape_invalid', false)
  }
  return value
}

async function rows<T extends SqlRow>(
  statement: D1PreparedStatement,
  label: string,
): Promise<T[]> {
  const result = await statement.all<T>()
  if (!result.success) {
    throw new LocalizationError(
      `D1 ${label} query failed`,
      'localization_db_error',
      true,
    )
  }
  return result.results ?? []
}

export class D1LocalizationRepository {
  constructor(private readonly database: D1Database) {}

  async createRun(
    runId: string,
    requestedBy: 'schedule' | 'api' | 'cli',
    request: TranslationBatchRequest,
    now: string,
  ): Promise<void> {
    const result = await this.database.prepare(`
      INSERT INTO translation_runs (
        id, requested_at, requested_by, request_json, status, updated_at
      ) VALUES (?, ?, ?, ?, 'planning', ?)
      ON CONFLICT(id) DO NOTHING
    `).bind(runId, now, requestedBy, JSON.stringify(request), now).run()
    if (!result.success) {
      throw new LocalizationError(
        'Could not create translation run',
        'localization_db_error',
        true,
      )
    }
  }

  async finishRun(
    runId: string,
    result: {
      dryRun: boolean
      plannedJobs: number
      cacheHits: number
      skippedCurrent: number
      queued: boolean
    },
    now: string,
  ): Promise<void> {
    const status = result.dryRun ? 'dry_run' : result.queued ? 'queued' : 'completed'
    const response = await this.database.prepare(`
      UPDATE translation_runs
         SET status = ?,
             planned_jobs = ?,
             cache_hits = ?,
             skipped_current = ?,
             completed_at = CASE WHEN ? IN ('dry_run', 'completed') THEN ? ELSE NULL END,
             updated_at = ?
       WHERE id = ?
    `).bind(
      status,
      result.plannedJobs,
      result.cacheHits,
      result.skippedCurrent,
      status,
      now,
      now,
      runId,
    ).run()
    if (!response.success) {
      throw new LocalizationError(
        'Could not finish translation run',
        'localization_db_error',
        true,
      )
    }
  }

  async failRun(runId: string, code: string, now: string): Promise<void> {
    await this.database.prepare(`
      UPDATE translation_runs
         SET status = 'failed', error_code = ?, completed_at = ?, updated_at = ?
       WHERE id = ?
    `).bind(code.slice(0, 120), now, now, runId).run()
  }

  async listCandidates(
    targetLocale: SupportedTargetLocale,
    request: TranslationBatchRequest,
    limit: number,
  ): Promise<SourceCandidate[]> {
    const kinds = request.recordKinds
    const scopes = request.institutionIds
    const supportedLocales = [...SUPPORTED_TARGET_LOCALES]
    const stableFields = [...STABLE_LOCALIZED_FIELDS]
    const scopeClause = scopes.length === 0
      ? ''
      : `AND (
          scope_record.public_id IN (${placeholders(scopes.length)})
          OR record.public_id IN (${placeholders(scopes.length)})
        )`
    const statement = this.database.prepare(`
      WITH ranked_sources AS (
        SELECT
          content.record_id,
          record.public_id AS record_public_id,
          record.kind AS record_kind,
          scope_record.public_id AS institution_id,
          content.field_name,
          content.locale AS source_locale,
          content.text_value AS source_text,
          ROW_NUMBER() OVER (
            PARTITION BY content.record_id, content.field_name
            ORDER BY CASE content.locale
              WHEN 'zh' THEN 0
              WHEN 'en' THEN 1
              WHEN 'ru' THEN 2
              WHEN 'de' THEN 3
              WHEN 'fr' THEN 4
              WHEN 'es' THEN 5
              WHEN 'pt' THEN 6
              WHEN 'ar' THEN 7
              ELSE 99
            END, content.updated_at DESC
          ) AS source_rank
        FROM localized_content AS content
        JOIN records AS record ON record.id = content.record_id
        LEFT JOIN programs AS program
          ON record.kind = 'program' AND program.record_id = record.id
        LEFT JOIN scholarships AS scholarship
          ON record.kind = 'scholarship' AND scholarship.record_id = record.id
        LEFT JOIN organizations AS institution
          ON institution.record_id = CASE
            WHEN record.kind = 'program' THEN program.institution_id
            WHEN record.kind = 'scholarship' THEN scholarship.provider_organization_id
            WHEN record.kind = 'organization' THEN record.id
            ELSE NULL
          END
        LEFT JOIN records AS scope_record ON scope_record.id = institution.record_id
        WHERE record.workflow_status IN ('validated', 'applied', 'published', 'stale')
          AND record.kind IN (${placeholders(kinds.length)})
          AND content.field_name IN (${placeholders(stableFields.length)})
          AND content.locale IN (${placeholders(supportedLocales.length)})
          AND content.locale <> ?
          AND content.translation_status IN ('reviewed', 'published')
          AND (content.source_locale IS NULL OR content.source_locale = content.locale)
          ${scopeClause}
      )
      SELECT
        source.record_id,
        source.record_public_id,
        source.record_kind,
        source.institution_id,
        source.field_name,
        source.source_locale,
        source.source_text,
        target.translation_status AS target_status,
        state.source_sha256 AS target_source_sha256
      FROM ranked_sources AS source
      LEFT JOIN localized_content AS target
        ON target.record_id = source.record_id
       AND target.field_name = source.field_name
       AND target.locale = ?
      LEFT JOIN translation_targets AS state
        ON state.record_id = source.record_id
       AND state.field_name = source.field_name
       AND state.target_locale = ?
      WHERE source.source_rank = 1
      ORDER BY COALESCE(source.institution_id, ''), source.record_kind,
               source.record_public_id, source.field_name
      LIMIT ?
    `)
    const values: unknown[] = [
      ...kinds,
      ...stableFields,
      ...supportedLocales,
      targetLocale,
      ...scopes,
      ...scopes,
      targetLocale,
      targetLocale,
      limit,
    ]
    const result = await rows(statement.bind(...values), 'candidate discovery')
    return result.map((row) => ({
      recordId: requiredString(row, 'record_id'),
      recordPublicId: requiredString(row, 'record_public_id'),
      recordKind: requiredString(row, 'record_kind') as TranslatableRecordKind,
      institutionId: optionalString(row, 'institution_id'),
      fieldName: requiredString(row, 'field_name') as StableLocalizedField,
      sourceLocale: requiredString(row, 'source_locale') as SupportedTargetLocale,
      sourceText: requiredString(row, 'source_text'),
      targetLocale,
      targetStatus: optionalString(row, 'target_status') as LegacyLocalizedContentStatus | null,
      targetSourceSha256: optionalString(row, 'target_source_sha256'),
    }))
  }

  async createBatch(
    batch: {
      batchId: string
      runId: string
      sourceLocale: SupportedTargetLocale
      targetLocale: SupportedTargetLocale
      institutionId: string | null
    },
    plans: TranslationPlan[],
    now: string,
  ): Promise<void> {
    const statements = [
      this.database.prepare(`
        INSERT INTO translation_batches (
          id, run_id, source_locale, target_locale, institution_id,
          status, job_count, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?)
        ON CONFLICT(id) DO NOTHING
      `).bind(
        batch.batchId,
        batch.runId,
        batch.sourceLocale,
        batch.targetLocale,
        batch.institutionId,
        plans.length,
        now,
        now,
      ),
      ...plans.map((plan) => this.database.prepare(`
        INSERT INTO translation_jobs (
          id, batch_id, record_id, record_kind, institution_id, field_name,
          source_locale, target_locale, source_sha256, cache_key, model,
          prompt_version, status, attempts, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          batch_id = excluded.batch_id,
          status = CASE
            WHEN translation_jobs.status IN ('failed', 'deferred', 'stale')
              THEN 'queued'
            ELSE translation_jobs.status
          END,
          error_code = CASE
            WHEN translation_jobs.status IN ('failed', 'deferred', 'stale')
              THEN NULL
            ELSE translation_jobs.error_code
          END,
          next_attempt_at = CASE
            WHEN translation_jobs.status IN ('failed', 'deferred', 'stale')
              THEN NULL
            ELSE translation_jobs.next_attempt_at
          END,
          updated_at = excluded.updated_at
      `).bind(
        plan.jobId,
        batch.batchId,
        plan.recordId,
        plan.recordKind,
        plan.institutionId,
        plan.fieldName,
        plan.sourceLocale,
        plan.targetLocale,
        plan.sourceSha256,
        plan.cacheKey,
        plan.model,
        plan.promptVersion,
        now,
        now,
      )),
    ]
    const results = await this.database.batch(statements)
    if (results.some((result) => !result.success)) {
      throw new LocalizationError(
        'Could not reserve translation batch',
        'localization_db_error',
        true,
      )
    }
  }

  async loadJobs(jobIds: string[]): Promise<TranslationJob[]> {
    if (jobIds.length === 0) return []
    const result = await rows(this.database.prepare(`
      SELECT
        job.id, job.batch_id, job.record_id, record.public_id AS record_public_id,
        job.record_kind, job.institution_id, job.field_name, job.source_locale,
        job.target_locale, job.source_sha256, job.cache_key, job.model,
        job.prompt_version, job.status, job.attempts,
        source.text_value AS source_text,
        source.translation_status AS source_status,
        source.source_locale AS source_origin_locale,
        target.translation_status AS target_status,
        state.source_sha256 AS target_source_sha256
      FROM translation_jobs AS job
      JOIN records AS record ON record.id = job.record_id
      LEFT JOIN localized_content AS source
        ON source.record_id = job.record_id
       AND source.field_name = job.field_name
       AND source.locale = job.source_locale
      LEFT JOIN localized_content AS target
        ON target.record_id = job.record_id
       AND target.field_name = job.field_name
       AND target.locale = job.target_locale
      LEFT JOIN translation_targets AS state
        ON state.record_id = job.record_id
       AND state.field_name = job.field_name
       AND state.target_locale = job.target_locale
      WHERE job.id IN (${placeholders(jobIds.length)})
      ORDER BY job.id
    `).bind(...jobIds), 'job load')
    return result.map((row) => ({
      jobId: requiredString(row, 'id'),
      batchId: requiredString(row, 'batch_id'),
      recordId: requiredString(row, 'record_id'),
      recordPublicId: requiredString(row, 'record_public_id'),
      recordKind: requiredString(row, 'record_kind') as TranslatableRecordKind,
      institutionId: optionalString(row, 'institution_id'),
      fieldName: requiredString(row, 'field_name') as StableLocalizedField,
      sourceLocale: requiredString(row, 'source_locale') as SupportedTargetLocale,
      targetLocale: requiredString(row, 'target_locale') as SupportedTargetLocale,
      sourceText: optionalString(row, 'source_text') ?? '',
      sourceStatus: optionalString(row, 'source_status') as LegacyLocalizedContentStatus | null,
      sourceOriginLocale: optionalString(row, 'source_origin_locale'),
      sourceSha256: requiredString(row, 'source_sha256'),
      cacheKey: requiredString(row, 'cache_key'),
      model: requiredString(row, 'model'),
      promptVersion: requiredString(row, 'prompt_version'),
      status: requiredString(row, 'status') as TranslationJob['status'],
      attempts: requiredNumber(row, 'attempts'),
      targetStatus: optionalString(row, 'target_status') as LegacyLocalizedContentStatus | null,
      targetSourceSha256: optionalString(row, 'target_source_sha256'),
    }))
  }

  async claimJob(jobId: string, now: string, maxAttempts: number): Promise<boolean> {
    const result = await this.database.prepare(`
      UPDATE translation_jobs
         SET status = 'running',
             attempts = attempts + 1,
             started_at = ?,
             updated_at = ?
       WHERE id = ?
         AND attempts < ?
         AND status IN ('queued', 'deferred', 'failed')
         AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
    `).bind(now, now, jobId, maxAttempts, now).run()
    return result.success && Number(result.meta?.changes ?? 0) === 1
  }

  async findCache(cacheKey: string): Promise<TranslationCacheEntry | null> {
    const row = await this.database.prepare(`
      SELECT * FROM translation_cache WHERE cache_key = ?
    `).bind(cacheKey).first<SqlRow>()
    if (!row) return null
    return {
      cacheKey: requiredString(row, 'cache_key'),
      sourceSha256: requiredString(row, 'source_sha256'),
      sourceLocale: requiredString(row, 'source_locale') as SupportedTargetLocale,
      targetLocale: requiredString(row, 'target_locale') as SupportedTargetLocale,
      recordKind: requiredString(row, 'record_kind') as TranslatableRecordKind,
      fieldName: requiredString(row, 'field_name') as StableLocalizedField,
      model: requiredString(row, 'model'),
      promptVersion: requiredString(row, 'prompt_version'),
      translatedText: requiredString(row, 'translated_text'),
      translatedSha256: requiredString(row, 'translated_sha256'),
      translationStatus: 'machine_generated',
    }
  }

  async storeCache(entry: TranslationCacheEntry, now: string): Promise<TranslationCacheEntry> {
    const result = await this.database.prepare(`
      INSERT INTO translation_cache (
        cache_key, source_sha256, source_locale, target_locale, record_kind,
        field_name, model, prompt_version, translated_text, translated_sha256,
        translation_status, created_at, last_used_at, hit_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'machine_generated', ?, ?, 0)
      ON CONFLICT(cache_key) DO NOTHING
    `).bind(
      entry.cacheKey,
      entry.sourceSha256,
      entry.sourceLocale,
      entry.targetLocale,
      entry.recordKind,
      entry.fieldName,
      entry.model,
      entry.promptVersion,
      entry.translatedText,
      entry.translatedSha256,
      now,
      now,
    ).run()
    if (!result.success) {
      throw new LocalizationError(
        'Could not store translation cache entry',
        'localization_db_error',
        true,
      )
    }
    const stored = await this.findCache(entry.cacheKey)
    if (!stored) {
      throw new LocalizationError(
        'Translation cache entry was not readable after insert',
        'localization_db_error',
        true,
      )
    }
    return stored
  }

  async applyTranslation(
    job: TranslationJob,
    entry: TranslationCacheEntry,
    fromCache: boolean,
    now: string,
  ): Promise<void> {
    const terminalStatus = fromCache ? 'cached' : 'succeeded'
    const statements = [
      this.database.prepare(`
        INSERT INTO localized_content (
          record_id, locale, field_name, text_value,
          translation_status, source_locale, updated_at
        ) VALUES (?, ?, ?, ?, 'machine', ?, ?)
        ON CONFLICT(record_id, locale, field_name) DO UPDATE SET
          text_value = excluded.text_value,
          translation_status = 'machine',
          source_locale = excluded.source_locale,
          updated_at = excluded.updated_at
        WHERE localized_content.translation_status IN ('draft', 'machine')
      `).bind(
        job.recordId,
        job.targetLocale,
        job.fieldName,
        entry.translatedText,
        job.sourceLocale,
        now,
      ),
      this.database.prepare(`
        INSERT INTO translation_targets (
          record_id, field_name, target_locale, source_locale, source_sha256,
          cache_key, translated_sha256, translation_status, generated_at, updated_at
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, 'machine_generated', ?, ?
        WHERE NOT EXISTS (
          SELECT 1 FROM localized_content
           WHERE record_id = ? AND locale = ? AND field_name = ?
             AND translation_status IN ('reviewed', 'published')
        )
        ON CONFLICT(record_id, field_name, target_locale) DO UPDATE SET
          source_locale = excluded.source_locale,
          source_sha256 = excluded.source_sha256,
          cache_key = excluded.cache_key,
          translated_sha256 = excluded.translated_sha256,
          translation_status = 'machine_generated',
          generated_at = excluded.generated_at,
          updated_at = excluded.updated_at
      `).bind(
        job.recordId,
        job.fieldName,
        job.targetLocale,
        job.sourceLocale,
        job.sourceSha256,
        entry.cacheKey,
        entry.translatedSha256,
        now,
        now,
        job.recordId,
        job.targetLocale,
        job.fieldName,
      ),
      this.database.prepare(`
        UPDATE translation_cache
           SET last_used_at = ?, hit_count = hit_count + ?
         WHERE cache_key = ?
      `).bind(now, fromCache ? 1 : 0, entry.cacheKey),
      this.database.prepare(`
        UPDATE translation_jobs
           SET status = ?, completed_at = ?, error_code = NULL,
               next_attempt_at = NULL, updated_at = ?
         WHERE id = ? AND status = 'running'
      `).bind(terminalStatus, now, now, job.jobId),
    ]
    const results = await this.database.batch(statements)
    if (results.some((result) => !result.success)) {
      throw new LocalizationError(
        'Could not atomically apply translation',
        'localization_db_error',
        true,
      )
    }
  }

  async markJob(
    jobId: string,
    status: 'deferred' | 'failed' | 'stale' | 'cancelled',
    errorCode: string,
    now: string,
    nextAttemptAt: string | null = null,
  ): Promise<void> {
    await this.database.prepare(`
      UPDATE translation_jobs
         SET status = ?, error_code = ?, next_attempt_at = ?,
             completed_at = CASE WHEN ? IN ('stale', 'cancelled') THEN ? ELSE NULL END,
             updated_at = ?
       WHERE id = ?
    `).bind(
      status,
      errorCode.slice(0, 120),
      nextAttemptAt,
      status,
      now,
      now,
      jobId,
    ).run()
  }

  async usage(monthKey: string): Promise<TranslationUsage> {
    const row = await this.database.prepare(`
      SELECT * FROM translation_monthly_usage WHERE month_key = ?
    `).bind(monthKey).first<SqlRow>()
    return {
      monthKey,
      apiCalls: row ? requiredNumber(row, 'api_calls') : 0,
      inputCharacters: row ? requiredNumber(row, 'input_characters') : 0,
      outputCharacters: row ? requiredNumber(row, 'output_characters') : 0,
      translatedItems: row ? requiredNumber(row, 'translated_items') : 0,
      cacheHits: row ? requiredNumber(row, 'cache_hits') : 0,
    }
  }

  async recordUsage(
    monthKey: string,
    delta: Omit<TranslationUsage, 'monthKey'>,
    now: string,
  ): Promise<void> {
    const result = await this.database.prepare(`
      INSERT INTO translation_monthly_usage (
        month_key, api_calls, input_characters, output_characters,
        translated_items, cache_hits, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(month_key) DO UPDATE SET
        api_calls = api_calls + excluded.api_calls,
        input_characters = input_characters + excluded.input_characters,
        output_characters = output_characters + excluded.output_characters,
        translated_items = translated_items + excluded.translated_items,
        cache_hits = cache_hits + excluded.cache_hits,
        updated_at = excluded.updated_at
    `).bind(
      monthKey,
      delta.apiCalls,
      delta.inputCharacters,
      delta.outputCharacters,
      delta.translatedItems,
      delta.cacheHits,
      now,
    ).run()
    if (!result.success) {
      throw new LocalizationError(
        'Could not record translation usage',
        'localization_db_error',
        true,
      )
    }
  }

  async refreshBatch(batchId: string, now: string): Promise<void> {
    await this.database.prepare(`
      UPDATE translation_batches
         SET completed_count = (
               SELECT COUNT(*) FROM translation_jobs
                WHERE batch_id = ?
                  AND status IN ('cached', 'succeeded', 'stale', 'cancelled')
             ),
             failed_count = (
               SELECT COUNT(*) FROM translation_jobs
                WHERE batch_id = ? AND status = 'failed'
             ),
             status = CASE
               WHEN EXISTS (
                 SELECT 1 FROM translation_jobs
                  WHERE batch_id = ? AND status IN ('queued', 'running')
               ) THEN 'running'
               WHEN EXISTS (
                 SELECT 1 FROM translation_jobs
                  WHERE batch_id = ? AND status = 'deferred'
               ) THEN 'deferred'
               WHEN EXISTS (
                 SELECT 1 FROM translation_jobs
                  WHERE batch_id = ? AND status = 'failed'
               ) AND EXISTS (
                 SELECT 1 FROM translation_jobs
                  WHERE batch_id = ? AND status IN ('cached', 'succeeded')
               ) THEN 'partial'
               WHEN EXISTS (
                 SELECT 1 FROM translation_jobs
                  WHERE batch_id = ? AND status = 'failed'
               ) THEN 'failed'
               ELSE 'completed'
             END,
             updated_at = ?
       WHERE id = ?
    `).bind(
      batchId,
      batchId,
      batchId,
      batchId,
      batchId,
      batchId,
      batchId,
      now,
      batchId,
    ).run()
  }

  async batchSummary(batchId: string): Promise<SqlRow | null> {
    return this.database.prepare(`
      SELECT id, run_id, source_locale, target_locale, institution_id,
             status, job_count, completed_count, failed_count, created_at, updated_at
        FROM translation_batches WHERE id = ?
    `).bind(batchId).first<SqlRow>()
  }
}

