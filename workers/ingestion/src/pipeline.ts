import { IngestionError } from './errors'
import { readBoundedBody } from './body'
import {
  extractionTextObjectKey,
  normalizeCanonicalText,
  sha256Hex,
  snapshotObjectKey,
  stableJson,
} from './hash'
import { infrastructureCostPolicy, permitsBrowserForSource } from './cost-policy'
import { runDualMiniMaxExtraction } from './minimax'
import { miniMaxCandidateProvenance, ruleCandidateProvenance } from './provenance'
import {
  hasEntityExtraction,
  loadSourceState,
  persistChangedResult,
  readRobotsCache,
  recordNoChange,
  writeRobotsCache,
} from './repository'
import { nextFetchAt, parseRetryAfter, boundedInteger } from './retry'
import { htmlToText, extractWithRules } from './rules'
import { parseOfficialCatalogHtml } from './catalog-parser'
import { isRobotsPathAllowed } from './robots'
import { fetchWithValidatedRedirects } from './security'
import {
  convertDocumentToText,
  isConvertibleDocument,
  renderBrowserPage,
} from './rich-content'
import type {
  ExtractionCandidate,
  ExtractedEntityCandidate,
  ExtractionFact,
  Fetcher,
  IngestionEnv,
  IngestionJob,
  SnapshotRecord,
  SourceManifestV1,
  QuarantineTask,
} from './types'

const DEFAULT_USER_AGENT =
  'StudyInChinaDataBot/1.0 (+https://github.com/computersciencefreshmen/StudyInChina; public-official-sources-only)'
const TEXT_CONTENT_TYPES = [
  'application/atom+xml',
  'application/json',
  'application/ld+json',
  'application/rss+xml',
  'application/xhtml+xml',
  'application/xml',
  'text/',
]
const MAX_IN_MEMORY_SOURCE_BYTES = 10 * 1024 * 1024
const OFFICIAL_HTML_ENTITY_EXTRACTOR = 'official-html-v2'
const ENTITY_CATALOG_CATEGORIES = new Set<SourceManifestV1['sourceCategory']>([
  'undergraduate_catalog',
  'masters_catalog',
  'doctoral_catalog',
  'non_degree_catalog',
  'university_scholarship',
  'faculty_scholarship',
  'government_scholarship',
  'program_detail',
])


function isTextContentType(contentType: string): boolean {
  const normalized = contentType.toLowerCase().split(';', 1)[0]?.trim() ?? ''
  return TEXT_CONTENT_TYPES.some((candidate) =>
    candidate.endsWith('/') ? normalized.startsWith(candidate) : normalized === candidate,
  )
}

function contentTypeOf(response: Response): string {
  return response.headers.get('content-type')?.trim() || 'application/octet-stream'
}

export { readBoundedBody } from './body'

async function fetchRobotsBody(
  environment: IngestionEnv,
  manifest: SourceManifestV1,
  sourceUrl: URL,
  fetcher: Fetcher,
  now: Date,
): Promise<{ body: string | null; fetched: boolean }> {
  const nowIso = now.toISOString()
  const cached = await readRobotsCache(environment, sourceUrl.hostname, nowIso)
  if (cached) {
    if (cached.statusCode === 404 || cached.statusCode === 410) {
      return { body: null, fetched: false }
    }
    if (cached.statusCode === 200) return { body: cached.body ?? '', fetched: false }
    throw new IngestionError(
      `robots.txt cached HTTP ${cached.statusCode}`,
      'robots_unavailable',
      cached.statusCode >= 500,
    )
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5_000)
  const robotsUrl = new URL('/robots.txt', sourceUrl.origin)
  let response: Response
  let body: string | null = null
  try {
    ;({ response } = await fetchWithValidatedRedirects(
      fetcher,
      robotsUrl,
      manifest,
      {
        method: 'GET',
        headers: {
          Accept: 'text/plain,*/*;q=0.1',
          'User-Agent': environment.USER_AGENT ?? DEFAULT_USER_AGENT,
        },
        cache: 'no-store',
        signal: controller.signal,
      },
      3,
      5_000,
    ))
    if (response.status === 200) {
      const bytes = await readBoundedBody(response, 512 * 1024, controller.signal)
      body = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
    } else if (response.status !== 404 && response.status !== 410) {
      throw new IngestionError(
        `robots.txt returned HTTP ${response.status}`,
        `robots_http_${response.status}`,
        response.status === 408 || response.status === 429 || response.status >= 500,
        parseRetryAfter(response.headers.get('retry-after'), now),
      )
    }
  } finally {
    clearTimeout(timeout)
  }

  await writeRobotsCache(environment, {
    host: sourceUrl.hostname,
    body,
    statusCode: response.status,
    fetchedAt: nowIso,
    expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1_000).toISOString(),
  })
  return { body, fetched: true }
}

async function enforceRobots(
  environment: IngestionEnv,
  manifest: SourceManifestV1,
  sourceUrl: URL,
  fetcher: Fetcher,
  now: Date,
): Promise<boolean> {
  if (manifest.robots.mode === 'blocked') {
    throw new IngestionError('Source is disabled by collection policy', 'source_policy_blocked', false)
  }
  const { body: robotsBody, fetched } = await fetchRobotsBody(
    environment,
    manifest,
    sourceUrl,
    fetcher,
    now,
  )
  if (
    robotsBody !== null &&
    !isRobotsPathAllowed(
      robotsBody,
      sourceUrl,
      environment.USER_AGENT ?? DEFAULT_USER_AGENT,
    )
  ) {
    throw new IngestionError('robots.txt disallows this source path', 'robots_disallowed', false)
  }
  return fetched
}

function statusError(response: Response, now: Date): IngestionError {
  const status = response.status
  if (status === 408 || status === 429 || status >= 500) {
    return new IngestionError(
      `Official source returned HTTP ${status}`,
      `source_http_${status}`,
      true,
      parseRetryAfter(response.headers.get('retry-after'), now),
    )
  }
  return new IngestionError(
    `Official source returned HTTP ${status}`,
    `source_http_${status}`,
    false,
  )
}

function sourceTextForExtraction(rawText: string, contentType: string): string {
  return contentType.toLowerCase().includes('html') ? htmlToText(rawText) : rawText
}

function isOfficialEntityCatalog(
  manifest: SourceManifestV1,
  contentType: string,
  rawText: string | null,
): rawText is string {
  return rawText !== null
    && contentType.toLowerCase().includes('html')
    && ENTITY_CATALOG_CATEGORIES.has(manifest.sourceCategory)
}

function normalizedEntityNameKey(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 380)
}

export async function buildOfficialEntityExtraction(
  manifest: SourceManifestV1,
  snapshotId: string,
  ingestionJobId: string,
  sourceUrl: string,
  rawText: string | null,
  contentType: string,
  checkedAt: string,
): Promise<{
  extractor: string
  institutionId: string
  candidates: ExtractedEntityCandidate[]
} | null> {
  if (!isOfficialEntityCatalog(manifest, contentType, rawText)) return null
  const parsed = parseOfficialCatalogHtml(rawText, {
    sourceUrl,
    allowedHosts: [...manifest.allowedHosts, ...(manifest.allowedRedirectHosts ?? [])],
    sourceCategory: manifest.sourceCategory,
    maxCandidates: 2_000,
  })
  const candidates: ExtractedEntityCandidate[] = []
  for (const item of parsed) {
    const entityType = item.kind
    const normalizedName = item.name.normalize('NFKC').replace(/\s+/gu, ' ').trim()
    const identity = {
      institutionId: manifest.institutionId,
      entityType,
      degreeLevel: item.degreeLevel,
      normalizedName: normalizedName.toLocaleLowerCase('en-US'),
    }
    const identitySha256 = await sha256Hex(stableJson(identity))
    const entityKey = [
      item.degreeLevel ?? 'all',
      normalizedEntityNameKey(normalizedName),
      identitySha256.slice(0, 16),
    ].join(':')
    const facts: Record<string, unknown> = {
      name: normalizedName,
      degreeLevel: item.degreeLevel,
      officialUrl: item.officialUrl,
      sourceCategory: manifest.sourceCategory,
      checkedAt,
    }
    const evidence = [{
      fieldPath: 'name',
      quote: item.evidence.quote,
      locator: item.evidence.locator ?? null,
      officialUrl: item.officialUrl,
    }]
    const urlSha256 = await sha256Hex(item.officialUrl)
    candidates.push({
      candidateId: await sha256Hex(
        `entity-candidate:${snapshotId}:${OFFICIAL_HTML_ENTITY_EXTRACTOR}:${entityType}:${entityKey}`,
      ),
      discoveryId: await sha256Hex(`source-discovery:${manifest.institutionId}:${item.officialUrl}`),
      registryId: await sha256Hex(`entity-registry:${manifest.institutionId}:${entityType}:${entityKey}`),
      reconciliationId: await sha256Hex(
        `catalog-reconciliation:${snapshotId}:${entityType}:${entityKey}`,
      ),
      institutionId: manifest.institutionId,
      entityType,
      entityKey,
      sourceId: manifest.id,
      snapshotId,
      ingestionJobId,
      extractor: OFFICIAL_HTML_ENTITY_EXTRACTOR,
      officialUrl: item.officialUrl,
      urlSha256,
      identitySha256,
      entitySha256: await sha256Hex(stableJson({ facts, evidence })),
      facts,
      evidence,
      createdAt: checkedAt,
    })
  }
  return {
    extractor: OFFICIAL_HTML_ENTITY_EXTRACTOR,
    institutionId: manifest.institutionId,
    candidates,
  }
}

function compareRuleFacts(ruleFacts: ExtractionFact[], modelFacts: ExtractionFact[]): string[] {
  const modelByField = new Map(modelFacts.map((fact) => [fact.fieldPath, fact]))
  const issues: string[] = []
  for (const fact of ruleFacts) {
    const modelFact = modelByField.get(fact.fieldPath)
    if (modelFact && stableJson(modelFact.value) !== stableJson(fact.value)) {
      issues.push(`Rule and MiniMax disagree for ${fact.fieldPath}`)
    }
  }
  return issues
}

export async function buildCandidate(
  environment: IngestionEnv,
  manifest: SourceManifestV1,
  snapshotId: string,
  sourceUrl: string,
  rawText: string | null,
  contentType: string,
  fetcher: Fetcher,
  now: string,
): Promise<ExtractionCandidate> {
  const ruleResult = rawText === null
    ? { complete: false, facts: [], issues: ['Binary or unsupported content must be quarantined'] }
    : extractWithRules(manifest, rawText, contentType)
  const hasCriticalFields = manifest.extraction.fields.some((field) => field.critical)

  if (
    manifest.extraction.mode !== 'minimax' &&
    ruleResult.complete &&
    !hasCriticalFields
  ) {
    const provenance = await ruleCandidateProvenance(
      manifest,
      ruleResult.facts,
      hasCriticalFields,
    )
    const candidateId = await sha256Hex(
      `${manifest.id}:${snapshotId}:rules:${provenance.extractorFingerprint}:${stableJson(ruleResult.facts)}`,
    )
    return {
      candidateId,
      sourceId: manifest.id,
      snapshotId,
      extractor: 'rules',
      gateStatus: 'rule-pass',
      facts: ruleResult.facts,
      issues: [],
      provenance,
      createdAt: now,
    }
  }

  if (manifest.extraction.mode === 'rules-only' || rawText === null) {
    const provenance = await ruleCandidateProvenance(
      manifest,
      ruleResult.facts,
      hasCriticalFields,
    )
    const issues = ruleResult.issues.length > 0
      ? ruleResult.issues
      : [hasCriticalFields
          ? 'Critical fields require two agreeing MiniMax extractions'
          : 'Rules did not produce facts']
    const candidateId = await sha256Hex(
      `${manifest.id}:${snapshotId}:quarantine:${provenance.extractorFingerprint}:${stableJson(issues)}`,
    )
    return {
      candidateId,
      sourceId: manifest.id,
      snapshotId,
      extractor: 'rules',
      gateStatus: 'quarantined',
      facts: ruleResult.facts,
      issues,
      provenance,
      createdAt: now,
    }
  }

  const sourceText = sourceTextForExtraction(rawText, contentType)
  try {
    const gate = await runDualMiniMaxExtraction(
      environment,
      manifest,
      sourceUrl,
      sourceText,
      fetcher,
    )
    const disagreements = compareRuleFacts(ruleResult.facts, gate.facts)
    const issues = gate.status === 'dual-pass'
      ? disagreements
      : [...ruleResult.issues, ...gate.issues, ...disagreements]
    const gateStatus = gate.status === 'dual-pass' && disagreements.length === 0
      ? 'dual-pass'
      : 'quarantined'
    const model = environment.MINIMAX_MODEL ?? manifest.extraction.minimaxModel
    if (!model) {
      throw new IngestionError('MiniMax model was not resolved', 'minimax_not_configured', false)
    }
    const provenance = await miniMaxCandidateProvenance(
      manifest,
      gate.facts,
      gate.primary,
      gate.secondary,
      model,
      hasCriticalFields,
    )
    const candidateId = await sha256Hex(
      `${manifest.id}:${snapshotId}:minimax-dual:${provenance.extractorFingerprint}:${stableJson(gate.facts)}:${stableJson(issues)}`,
    )
    return {
      candidateId,
      sourceId: manifest.id,
      snapshotId,
      extractor: 'minimax-dual',
      gateStatus,
      facts: gate.facts,
      issues,
      provenance,
      createdAt: now,
    }
  } catch (error) {
    if (error instanceof IngestionError) throw error
    const issue = error instanceof Error ? error.message : String(error)
    throw new IngestionError(
      `MiniMax extraction failed before a candidate was persisted: ${issue}`,
      'minimax_extraction_failed',
      true,
    )
  }
}

async function putSnapshot(
  environment: IngestionEnv,
  snapshot: SnapshotRecord,
  body: ArrayBuffer,
): Promise<void> {
  const existing = await environment.SNAPSHOTS_BUCKET.head(snapshot.r2Key)
  if (existing) return
  await environment.SNAPSHOTS_BUCKET.put(snapshot.r2Key, body, {
    httpMetadata: { contentType: snapshot.contentType },
    customMetadata: {
      sourceId: snapshot.sourceId,
      fetchedAt: snapshot.fetchedAt,
      rawSha256: snapshot.rawSha256,
      canonicalSha256: snapshot.canonicalSha256,
    },
  })
}

async function putDerivativeText(
  environment: IngestionEnv,
  snapshot: SnapshotRecord,
  text: string,
): Promise<void> {
  if (!snapshot.derivative) return
  const existing = await environment.SNAPSHOTS_BUCKET.head(snapshot.derivative.r2Key)
  if (existing) return
  await environment.SNAPSHOTS_BUCKET.put(snapshot.derivative.r2Key, text, {
    httpMetadata: { contentType: snapshot.derivative.contentType },
    customMetadata: {
      sourceId: snapshot.sourceId,
      snapshotId: snapshot.snapshotId,
      fetchedAt: snapshot.fetchedAt,
      rawSha256: snapshot.rawSha256,
      contentSha256: snapshot.derivative.contentSha256,
      derivativeKind: snapshot.derivative.kind,
    },
  })
}

export async function processIngestionJob(
  environment: IngestionEnv,
  job: IngestionJob,
  fetcher: Fetcher = fetch,
  now = new Date(),
): Promise<void> {
  const state = await loadSourceState(environment, job.sourceId)
  if (!state) throw new IngestionError('Source manifest was not found or is disabled', 'source_not_found', false)
  const manifest = state.manifest
  const sourceUrl = new URL(manifest.officialUrl)
  const robotsFetched = await enforceRobots(environment, manifest, sourceUrl, fetcher, now)
  if (robotsFetched) {
    await new Promise<void>((resolve) => setTimeout(resolve, 5_000))
  }

  const timeoutMs = manifest.fetch.timeoutMs ?? boundedInteger(
    environment.DEFAULT_FETCH_TIMEOUT_MS,
    15_000,
    1_000,
    60_000,
  )
  const maximumBytes = manifest.fetch.maxBytes ?? boundedInteger(
    environment.DEFAULT_MAX_BYTES,
    MAX_IN_MEMORY_SOURCE_BYTES,
    1_024,
    MAX_IN_MEMORY_SOURCE_BYTES,
  )
  const checkedAt = now.toISOString()
  const scheduledNextFetch = nextFetchAt(manifest, now)
  let body: ArrayBuffer
  let contentType: string
  let finalUrl: URL
  let etag: string | null = null
  let lastModified: string | null = null

  if (manifest.fetch.renderMode === 'browser') {
    const costPolicy = infrastructureCostPolicy(environment.INFRA_FORECAST_CNY)
    if (!permitsBrowserForSource(costPolicy, manifest.sourceCategory)) {
      throw new IngestionError(
        'Browser rendering is deferred by the infrastructure cost policy',
        'browser_cost_deferred',
        true,
        24 * 60 * 60,
      )
    }
    const rendered = await renderBrowserPage(environment.BROWSER, {
      url: sourceUrl.href,
      allowedHosts: [...manifest.allowedHosts, ...(manifest.allowedRedirectHosts ?? [])],
      userAgent: environment.USER_AGENT ?? DEFAULT_USER_AGENT,
      waitUntil: manifest.fetch.browserWaitUntil,
      waitForSelector: manifest.fetch.browserWaitForSelector,
      timeoutMs,
      maxBytes: maximumBytes,
      action: 'content',
    })
    const renderedBytes = new TextEncoder().encode(rendered)
    if (renderedBytes.byteLength > maximumBytes) {
      throw new IngestionError(
        `Rendered source exceeds ${maximumBytes} bytes`,
        'response_too_large',
        false,
      )
    }
    body = renderedBytes.buffer
    contentType = 'text/html; source=browser-run'
    finalUrl = sourceUrl
  } else {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    const headers = new Headers({
      Accept: manifest.fetch.accept ?? 'text/html,application/xhtml+xml,application/json,application/pdf;q=0.9,*/*;q=0.1',
      'User-Agent': environment.USER_AGENT ?? DEFAULT_USER_AGENT,
    })
    if (state.etag) headers.set('If-None-Match', state.etag)
    if (state.lastModified) headers.set('If-Modified-Since', state.lastModified)

    let response: Response
    try {
      ;({ response, finalUrl } = await fetchWithValidatedRedirects(
        fetcher,
        sourceUrl,
        manifest,
        { method: 'GET', headers, cache: 'no-store', signal: controller.signal },
        5,
        5_000,
      ))
    } catch (error) {
      clearTimeout(timeout)
      throw error
    }

    if (response.status === 304) {
      clearTimeout(timeout)
      await recordNoChange(environment, {
        job,
        sourceId: manifest.id,
        checkedAt,
        nextFetchAt: scheduledNextFetch,
        etag: response.headers.get('etag') ?? state.etag,
        lastModified: response.headers.get('last-modified') ?? state.lastModified,
        outcome: 'not-modified',
      })
      return
    }
    if (!response.ok) {
      clearTimeout(timeout)
      throw statusError(response, now)
    }

    try {
      body = await readBoundedBody(response, maximumBytes, controller.signal)
    } finally {
      clearTimeout(timeout)
    }
    contentType = contentTypeOf(response)
    etag = response.headers.get('etag')
    lastModified = response.headers.get('last-modified')
  }

  const rawSha256 = await sha256Hex(body)
  const snapshotId = await sha256Hex(`${manifest.id}:${rawSha256}`)
  const entityCatalog = contentType.toLowerCase().includes('html')
    && ENTITY_CATALOG_CATEGORIES.has(manifest.sourceCategory)
  const entityExtractionCurrent = !entityCatalog || await hasEntityExtraction(
    environment,
    manifest.id,
    snapshotId,
    OFFICIAL_HTML_ENTITY_EXTRACTOR,
  )
  if (rawSha256 === state.rawSha256 && entityExtractionCurrent) {
    await recordNoChange(environment, {
      job,
      sourceId: manifest.id,
      checkedAt,
      nextFetchAt: scheduledNextFetch,
      etag,
      lastModified,
      rawSha256,
      outcome: 'raw-duplicate',
    })
    return
  }

  let rawText = isTextContentType(contentType)
    ? new TextDecoder('utf-8', { fatal: false }).decode(body)
    : null
  let derivative: SnapshotRecord['derivative']
  if (
    rawText === null
    && manifest.fetch.documentConversion !== 'disabled'
    && isConvertibleDocument(contentType, finalUrl.href)
  ) {
    rawText = await convertDocumentToText(
      environment.AI,
      body,
      contentType,
      finalUrl.href,
      {
        timeoutMs: boundedInteger(
          environment.DOCUMENT_CONVERSION_TIMEOUT_MS,
          45_000,
          5_000,
          60_000,
        ),
        maxCharacters: boundedInteger(
          environment.DOCUMENT_MAX_TEXT_CHARACTERS,
          1_000_000,
          5_000,
          2_000_000,
        ),
      },
    )
    const derivativeBytes = new TextEncoder().encode(rawText)
    derivative = {
      kind: 'document_text',
      r2Key: extractionTextObjectKey(manifest.id, rawSha256),
      contentSha256: await sha256Hex(derivativeBytes),
      contentType: 'text/plain; charset=utf-8',
      byteLength: derivativeBytes.byteLength,
    }
  }
  const canonicalSha256 = rawText === null
    ? rawSha256
    : await sha256Hex(normalizeCanonicalText(rawText, manifest.canonicalization))
  if (canonicalSha256 === state.canonicalSha256 && entityExtractionCurrent) {
    await recordNoChange(environment, {
      job,
      sourceId: manifest.id,
      checkedAt,
      nextFetchAt: scheduledNextFetch,
      etag,
      lastModified,
      rawSha256,
      outcome: 'canonical-duplicate',
    })
    return
  }

  const r2Key = snapshotObjectKey(manifest.id, rawSha256, contentType)
  const snapshot: SnapshotRecord = {
    snapshotId,
    sourceId: manifest.id,
    r2Key,
    rawSha256,
    canonicalSha256,
    contentType,
    byteLength: body.byteLength,
    finalUrl: finalUrl.href,
    fetchedAt: checkedAt,
    etag,
    lastModified,
    derivative,
  }
  await putSnapshot(environment, snapshot, body)
  if (derivative && rawText !== null) {
    await putDerivativeText(environment, snapshot, rawText)
  }
  const entityExtraction = await buildOfficialEntityExtraction(
    manifest,
    snapshotId,
    job.jobId,
    finalUrl.href,
    rawText,
    contentType,
    checkedAt,
  )
  const candidate = await buildCandidate(
    environment,
    manifest,
    snapshotId,
    finalUrl.href,
    rawText,
    derivative ? derivative.contentType : contentType,
    fetcher,
    checkedAt,
  )

  if (candidate.gateStatus === 'quarantined') {
    const quarantineId = await sha256Hex(`${manifest.id}:${snapshotId}:quarantine`)
    const quarantineTask: QuarantineTask = {
      version: 1,
      quarantineId,
      sourceId: manifest.id,
      snapshotId,
      snapshotKey: r2Key,
      sourceUrl: finalUrl.href,
      previousCanonicalSha256: state.canonicalSha256,
      canonicalSha256,
      reason: 'Changed source did not pass deterministic extraction gates',
      issues: candidate.issues,
      createdAt: checkedAt,
    }
    await environment.QUARANTINE_QUEUE.send(quarantineTask)
  }

  await persistChangedResult(environment, {
    job,
    snapshot,
    candidate,
    nextFetchAt: scheduledNextFetch,
    entityExtraction: entityExtraction ?? undefined,
  })
}
