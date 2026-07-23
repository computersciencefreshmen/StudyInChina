import { createHash } from 'node:crypto'
import {
  existsSync,
  readFileSync,
  readdirSync,
} from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { z } from 'zod'

export const OFFICIAL_GOLD_SOURCE_COUNT = 100
export const MINIMUM_HIGH_RISK_SCORE = 0.98

export const OFFICIAL_SOURCE_KINDS = [
  'international_admissions_home',
  'undergraduate_catalog',
  'masters_catalog',
  'doctoral_catalog',
  'non_degree_catalog',
  'current_guide',
  'dates_deadlines',
  'fees',
  'eligibility_language',
  'application_portal',
  'university_scholarship',
  'faculty_scholarship',
  'government_scholarship',
  'program_detail',
  'contacts',
  'catalog_anchor',
] as const

const isoDateTimeSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/)
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)
const fingerprintSchema = z.string().min(1).max(256)
const corpusPathSchema = z
  .string()
  .min(1)
  .refine((value) => !isAbsolute(value), 'path must be repository-relative')
  .refine(
    (value) => !value.replaceAll('\\', '/').split('/').includes('..'),
    'path must not traverse outside the repository',
  )

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue }

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
)

const missingSnapshotSchema = z.object({ status: z.literal('missing') }).strict()
const capturedSnapshotSchema = z
  .object({
    status: z.literal('captured'),
    path: corpusPathSchema,
    sha256: sha256Schema,
    capturedAt: isoDateTimeSchema,
    mediaKind: z.enum([
      'html',
      'pdf',
      'pdf_converted_text',
      'browser_rendered_html',
      'ocr_text',
    ]),
    finalUrl: z.url().refine((value) => new URL(value).protocol === 'https:', {
      message: 'finalUrl must use HTTPS',
    }),
  })
  .strict()

const unannotatedSchema = z.object({ status: z.literal('unannotated') }).strict()
const annotatedSchema = z
  .object({
    status: z.literal('annotated'),
    path: corpusPathSchema,
    sha256: sha256Schema,
    annotatedAt: isoDateTimeSchema,
    annotationVersion: z.literal(1),
    reviewMethod: z.enum(['human', 'authoritative_import']),
    reviewerId: z.string().min(1).max(128),
  })
  .strict()

export const goldRegistryEntrySchema = z
  .object({
    sourceId: z.string().min(1).max(160),
    institutionId: z.string().min(1).max(160),
    officialUrl: z.url().refine((value) => new URL(value).protocol === 'https:', {
      message: 'officialUrl must use HTTPS',
    }),
    entityType: z.enum([
      'university',
      'program',
      'program-cycle',
      'scholarship',
      'scholarship-cycle',
    ]),
    sourceKind: z.enum(OFFICIAL_SOURCE_KINDS),
    manifestFile: corpusPathSchema,
    extractionSchemaVersion: z.string().min(1).max(160),
    highRiskFieldPaths: z.array(z.string().min(1).max(200)).min(1),
    manifestFingerprint: sha256Schema,
    snapshot: z.discriminatedUnion('status', [
      missingSnapshotSchema,
      capturedSnapshotSchema,
    ]),
    annotation: z.discriminatedUnion('status', [
      unannotatedSchema,
      annotatedSchema,
    ]),
  })
  .strict()

export const goldRegistrySchema = z
  .object({
    version: z.literal(1),
    datasetKind: z.literal('official_gold_registry'),
    registryId: z.literal('pilot-official-sources-v1'),
    expectedSourceCount: z.literal(OFFICIAL_GOLD_SOURCE_COUNT),
    minimumAnnotatedSnapshots: z.literal(OFFICIAL_GOLD_SOURCE_COUNT),
    highRiskThresholds: z
      .object({
        precision: z.literal(MINIMUM_HIGH_RISK_SCORE),
        accuracy: z.literal(MINIMUM_HIGH_RISK_SCORE),
      })
      .strict(),
    manifestSetFingerprint: sha256Schema,
    entries: z.array(goldRegistryEntrySchema).length(OFFICIAL_GOLD_SOURCE_COUNT),
  })
  .strict()

const expectedValueSchema = z
  .object({ kind: z.literal('value'), value: jsonValueSchema })
  .strict()
const expectedAbsentSchema = z.object({ kind: z.literal('absent') }).strict()

export const officialGoldAnnotationSchema = z
  .object({
    version: z.literal(1),
    datasetKind: z.literal('official_gold_annotation'),
    sourceId: z.string().min(1),
    snapshotSha256: sha256Schema,
    highRiskDecisions: z
      .array(
        z
          .object({
            fieldPath: z.string().min(1).max(200),
            expected: z.discriminatedUnion('kind', [
              expectedValueSchema,
              expectedAbsentSchema,
            ]),
            evidence: z
              .object({
                quote: z.string().min(1).max(4_000),
                locator: z.string().min(1).max(500),
              })
              .strict(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict()

export const extractionFingerprintsSchema = z
  .object({
    model: fingerprintSchema,
    prompt: fingerprintSchema,
    extractor: fingerprintSchema,
  })
  .strict()

export const goldPredictionBundleSchema = z
  .object({
    version: z.literal(1),
    datasetKind: z.literal('official_gold_predictions'),
    runId: z.string().min(1).max(160),
    completedAt: isoDateTimeSchema,
    fingerprints: extractionFingerprintsSchema,
    annotationSetFingerprint: sha256Schema,
    predictions: z.array(
      z
        .object({
          sourceId: z.string().min(1),
          snapshotSha256: sha256Schema,
          highRiskPredictions: z.array(
            z
              .object({
                fieldPath: z.string().min(1).max(200),
                value: jsonValueSchema,
              })
              .strict(),
          ),
        })
        .strict(),
    ),
  })
  .strict()

const acceptedRunSchema = z
  .object({
    acceptedAt: isoDateTimeSchema,
    runId: z.string().min(1).max(160),
    fingerprints: extractionFingerprintsSchema,
    annotationSetFingerprint: sha256Schema,
    evaluatedSourceIds: z
      .array(z.string().min(1))
      .length(OFFICIAL_GOLD_SOURCE_COUNT),
  })
  .strict()

export const goldEvaluationStateSchema = z
  .object({
    version: z.literal(1),
    datasetKind: z.literal('official_gold_evaluation_state'),
    lastAcceptedRun: acceptedRunSchema.nullable(),
  })
  .strict()

const manifestSourceSchema = z
  .object({
    id: z.string().min(1),
    institutionId: z.string().min(1),
    entityType: goldRegistryEntrySchema.shape.entityType,
    sourceCategory: z.enum(OFFICIAL_SOURCE_KINDS),
    officialUrl: z.url().refine((value) => new URL(value).protocol === 'https:'),
    extraction: z
      .object({
        schemaVersion: z.string().min(1),
        fields: z
          .array(
            z
              .object({
                path: z.string().min(1),
                critical: z.boolean().optional(),
              })
              .passthrough(),
          )
          .min(1),
      })
      .passthrough(),
  })
  .passthrough()

const pilotManifestSchema = z
  .object({
    institutionId: z.string().min(1),
    sources: z.array(manifestSourceSchema).min(1),
  })
  .passthrough()

export type GoldRegistryEntry = z.infer<typeof goldRegistryEntrySchema>
export type GoldRegistry = z.infer<typeof goldRegistrySchema>
export type OfficialGoldAnnotation = z.infer<typeof officialGoldAnnotationSchema>
export type ExtractionFingerprints = z.infer<typeof extractionFingerprintsSchema>
export type GoldPredictionBundle = z.infer<typeof goldPredictionBundleSchema>
export type GoldEvaluationState = z.infer<typeof goldEvaluationStateSchema>

export type GoldCorpus = {
  registry: GoldRegistry
  annotations: Map<string, OfficialGoldAnnotation>
  capturedSnapshotCount: number
  annotatedSnapshotCount: number
  annotationSetFingerprint: string
}

export type HighRiskMetrics = {
  precision: number
  accuracy: number
  truePositive: number
  falsePositive: number
  falseNegative: number
  correctDecisions: number
  totalDecisions: number
  unexpectedPredictions: number
}

export type GoldGateResult = {
  status: 'not_ready' | 'rerun_required' | 'failed' | 'passed'
  ready: boolean
  passed: boolean
  officialSourceCount: number
  capturedOfficialSnapshots: number
  annotatedOfficialSnapshots: number
  minimumAnnotatedSnapshots: number
  thresholds: { precision: number; accuracy: number }
  metrics: HighRiskMetrics | null
  fingerprintsChanged: boolean
  rerunRequired: boolean
  reasons: string[]
}

type RegistryIdentity = Omit<
  GoldRegistryEntry,
  'snapshot' | 'annotation'
>

function sortedObject(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortedObject)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortedObject(child)]),
    )
  }
  return value
}

export function canonicalJson(value: JsonValue): string {
  return JSON.stringify(sortedObject(value))
}

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function asJsonValue(value: unknown): JsonValue {
  return jsonValueSchema.parse(value)
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right))
}

function toPosixPath(value: string): string {
  return value.replaceAll('\\', '/')
}

function sourceIdentity(
  manifestFile: string,
  source: z.infer<typeof manifestSourceSchema>,
): RegistryIdentity {
  const identityWithoutFingerprint = {
    sourceId: source.id,
    institutionId: source.institutionId,
    officialUrl: source.officialUrl,
    entityType: source.entityType,
    sourceKind: source.sourceCategory,
    manifestFile,
    extractionSchemaVersion: source.extraction.schemaVersion,
    highRiskFieldPaths: uniqueSorted(
      source.extraction.fields
        .filter((field) => field.critical === true)
        .map((field) => field.path),
    ),
  }
  if (identityWithoutFingerprint.highRiskFieldPaths.length === 0) {
    throw new Error(`${source.id}: official gold source has no critical/high-risk field`)
  }
  return {
    ...identityWithoutFingerprint,
    manifestFingerprint: sha256(
      canonicalJson(asJsonValue(identityWithoutFingerprint)),
    ),
  }
}

export function deriveRegistryIdentities(
  projectRoot = process.cwd(),
): RegistryIdentity[] {
  const manifestDirectory = join(
    projectRoot,
    'content',
    'source-manifests',
    'pilot',
  )
  const identities: RegistryIdentity[] = []
  const sourceIds = new Set<string>()

  for (const fileName of readdirSync(manifestDirectory)
    .filter((candidate) => candidate.endsWith('.json'))
    .sort()) {
    const absolutePath = join(manifestDirectory, fileName)
    const manifest = pilotManifestSchema.parse(
      JSON.parse(readFileSync(absolutePath, 'utf8')),
    )
    const manifestFile = toPosixPath(relative(projectRoot, absolutePath))
    for (const source of manifest.sources) {
      if (source.institutionId !== manifest.institutionId) {
        throw new Error(
          `${manifestFile}: ${source.id} institutionId does not match its manifest`,
        )
      }
      if (sourceIds.has(source.id)) {
        throw new Error(`${manifestFile}: duplicate sourceId ${source.id}`)
      }
      sourceIds.add(source.id)
      identities.push(sourceIdentity(manifestFile, source))
    }
  }

  identities.sort((left, right) => left.sourceId.localeCompare(right.sourceId))
  if (identities.length !== OFFICIAL_GOLD_SOURCE_COUNT) {
    throw new Error(
      `Expected ${OFFICIAL_GOLD_SOURCE_COUNT} official sources, found ${identities.length}`,
    )
  }
  return identities
}

export function manifestSetFingerprint(
  identities: RegistryIdentity[],
): string {
  return sha256(
    canonicalJson(
      identities.map((entry) => ({
        sourceId: entry.sourceId,
        manifestFingerprint: entry.manifestFingerprint,
      })),
    ),
  )
}

export function createInitialGoldRegistry(
  projectRoot = process.cwd(),
): GoldRegistry {
  const identities = deriveRegistryIdentities(projectRoot)
  return goldRegistrySchema.parse({
    version: 1,
    datasetKind: 'official_gold_registry',
    registryId: 'pilot-official-sources-v1',
    expectedSourceCount: OFFICIAL_GOLD_SOURCE_COUNT,
    minimumAnnotatedSnapshots: OFFICIAL_GOLD_SOURCE_COUNT,
    highRiskThresholds: {
      precision: MINIMUM_HIGH_RISK_SCORE,
      accuracy: MINIMUM_HIGH_RISK_SCORE,
    },
    manifestSetFingerprint: manifestSetFingerprint(identities),
    entries: identities.map((entry) => ({
      ...entry,
      snapshot: { status: 'missing' },
      annotation: { status: 'unannotated' },
    })),
  })
}

function resolveCorpusFile(
  projectRoot: string,
  relativePath: string,
  requiredPrefix: string,
): string {
  const normalized = toPosixPath(relativePath)
  if (!normalized.startsWith(`${requiredPrefix}/`)) {
    throw new Error(`${relativePath}: must be under ${requiredPrefix}/`)
  }
  const absolutePath = resolve(projectRoot, ...normalized.split('/'))
  const absolutePrefix = `${resolve(projectRoot, ...requiredPrefix.split('/'))}${sep}`
  if (!absolutePath.startsWith(absolutePrefix)) {
    throw new Error(`${relativePath}: resolves outside ${requiredPrefix}/`)
  }
  return absolutePath
}

function assertUnique(label: string, values: string[]): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} must be unique`)
  }
}

function assertSameSet(label: string, actual: string[], expected: string[]): void {
  const left = uniqueSorted(actual)
  const right = uniqueSorted(expected)
  if (canonicalJson(left) !== canonicalJson(right)) {
    throw new Error(
      `${label} mismatch: expected [${right.join(', ')}], found [${left.join(', ')}]`,
    )
  }
}

export function validateGoldRegistryAgainstManifests(
  registry: GoldRegistry,
  projectRoot = process.cwd(),
): void {
  const expected = deriveRegistryIdentities(projectRoot)
  const expectedById = new Map(expected.map((entry) => [entry.sourceId, entry]))
  assertUnique(
    'registry sourceId values',
    registry.entries.map((entry) => entry.sourceId),
  )
  assertSameSet(
    'registry sourceId set',
    registry.entries.map((entry) => entry.sourceId),
    expected.map((entry) => entry.sourceId),
  )
  if (registry.manifestSetFingerprint !== manifestSetFingerprint(expected)) {
    throw new Error('manifestSetFingerprint is stale; run quality:gold:sync')
  }
  for (const entry of registry.entries) {
    const expectedEntry = expectedById.get(entry.sourceId)
    if (!expectedEntry) throw new Error(`${entry.sourceId}: not present in manifests`)
    const actualIdentity = Object.fromEntries(
      Object.entries(entry).filter(
        ([key]) => key !== 'snapshot' && key !== 'annotation',
      ),
    )
    if (
      canonicalJson(asJsonValue(actualIdentity)) !==
      canonicalJson(asJsonValue(expectedEntry))
    ) {
      throw new Error(`${entry.sourceId}: registry identity is stale or modified`)
    }
  }
}

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown
}

export function loadAndValidateGoldCorpus(
  projectRoot = process.cwd(),
  registryPath = 'quality/gold/registry.json',
): GoldCorpus {
  const absoluteRegistryPath = resolveCorpusFile(
    projectRoot,
    registryPath,
    'quality/gold',
  )
  const registry = goldRegistrySchema.parse(readJsonFile(absoluteRegistryPath))
  validateGoldRegistryAgainstManifests(registry, projectRoot)

  const annotations = new Map<string, OfficialGoldAnnotation>()
  let capturedSnapshotCount = 0

  for (const entry of registry.entries) {
    if (entry.snapshot.status === 'missing') {
      if (entry.annotation.status === 'annotated') {
        throw new Error(`${entry.sourceId}: annotated entry has no captured snapshot`)
      }
      continue
    }

    capturedSnapshotCount += 1
    const snapshotPath = resolveCorpusFile(
      projectRoot,
      entry.snapshot.path,
      'quality/gold/snapshots',
    )
    if (!existsSync(snapshotPath)) {
      throw new Error(`${entry.sourceId}: snapshot file does not exist`)
    }
    if (sha256(readFileSync(snapshotPath)) !== entry.snapshot.sha256) {
      throw new Error(`${entry.sourceId}: snapshot checksum mismatch`)
    }

    if (entry.annotation.status === 'unannotated') continue
    const annotationPath = resolveCorpusFile(
      projectRoot,
      entry.annotation.path,
      'quality/gold/annotations',
    )
    if (!existsSync(annotationPath)) {
      throw new Error(`${entry.sourceId}: annotation file does not exist`)
    }
    const annotationBytes = readFileSync(annotationPath)
    if (sha256(annotationBytes) !== entry.annotation.sha256) {
      throw new Error(`${entry.sourceId}: annotation checksum mismatch`)
    }
    const annotation = officialGoldAnnotationSchema.parse(
      JSON.parse(annotationBytes.toString('utf8')),
    )
    if (annotation.sourceId !== entry.sourceId) {
      throw new Error(`${entry.sourceId}: annotation sourceId mismatch`)
    }
    if (annotation.snapshotSha256 !== entry.snapshot.sha256) {
      throw new Error(`${entry.sourceId}: annotation targets a different snapshot`)
    }
    assertUnique(
      `${entry.sourceId} annotation fieldPath values`,
      annotation.highRiskDecisions.map((decision) => decision.fieldPath),
    )
    assertSameSet(
      `${entry.sourceId} annotation high-risk fields`,
      annotation.highRiskDecisions.map((decision) => decision.fieldPath),
      entry.highRiskFieldPaths,
    )
    annotations.set(entry.sourceId, annotation)
  }

  const annotatedPairs = registry.entries
    .filter(
      (entry): entry is GoldRegistryEntry & {
        snapshot: z.infer<typeof capturedSnapshotSchema>
        annotation: z.infer<typeof annotatedSchema>
      } =>
        entry.snapshot.status === 'captured' &&
        entry.annotation.status === 'annotated',
    )
    .map((entry) => ({
      sourceId: entry.sourceId,
      snapshotSha256: entry.snapshot.sha256,
      annotationSha256: entry.annotation.sha256,
    }))
    .sort((left, right) => left.sourceId.localeCompare(right.sourceId))

  return {
    registry,
    annotations,
    capturedSnapshotCount,
    annotatedSnapshotCount: annotations.size,
    annotationSetFingerprint: sha256(canonicalJson(annotatedPairs)),
  }
}

function fingerprintsEqual(
  left: ExtractionFingerprints,
  right: ExtractionFingerprints,
): boolean {
  return (
    left.model === right.model &&
    left.prompt === right.prompt &&
    left.extractor === right.extractor
  )
}

function emptyResult(
  corpus: GoldCorpus,
  overrides: Pick<
    GoldGateResult,
    | 'status'
    | 'ready'
    | 'passed'
    | 'metrics'
    | 'fingerprintsChanged'
    | 'rerunRequired'
    | 'reasons'
  >,
): GoldGateResult {
  return {
    ...overrides,
    officialSourceCount: corpus.registry.entries.length,
    capturedOfficialSnapshots: corpus.capturedSnapshotCount,
    annotatedOfficialSnapshots: corpus.annotatedSnapshotCount,
    minimumAnnotatedSnapshots: corpus.registry.minimumAnnotatedSnapshots,
    thresholds: corpus.registry.highRiskThresholds,
  }
}

function exactJsonMatch(left: JsonValue, right: JsonValue): boolean {
  return canonicalJson(left) === canonicalJson(right)
}

export function evaluateGoldGate(options: {
  corpus: GoldCorpus
  state: GoldEvaluationState
  currentFingerprints?: ExtractionFingerprints
  predictionBundle?: GoldPredictionBundle
}): GoldGateResult {
  const { corpus, state, currentFingerprints, predictionBundle } = options
  const required = corpus.registry.minimumAnnotatedSnapshots
  if (corpus.annotatedSnapshotCount < required) {
    return emptyResult(corpus, {
      status: 'not_ready',
      ready: false,
      passed: false,
      metrics: null,
      fingerprintsChanged: false,
      rerunRequired: false,
      reasons: [
        `Only ${corpus.annotatedSnapshotCount}/${required} official snapshots are annotated; synthetic fixtures never count toward this total.`,
      ],
    })
  }

  const fingerprintsChanged =
    currentFingerprints !== undefined &&
    state.lastAcceptedRun !== null &&
    !fingerprintsEqual(currentFingerprints, state.lastAcceptedRun.fingerprints)
  const rerunReasons: string[] = []
  if (!currentFingerprints) {
    rerunReasons.push('Current model, prompt, and extractor fingerprints are required.')
  }
  if (!predictionBundle) {
    rerunReasons.push('A full prediction bundle is required for every annotated snapshot.')
  }
  if (currentFingerprints && predictionBundle) {
    if (!fingerprintsEqual(currentFingerprints, predictionBundle.fingerprints)) {
      rerunReasons.push('Prediction bundle fingerprints do not match the current extractor run.')
    }
    if (predictionBundle.annotationSetFingerprint !== corpus.annotationSetFingerprint) {
      rerunReasons.push('Prediction bundle was produced for a different annotation set.')
    }

    const expectedIds = [...corpus.annotations.keys()].sort()
    const predictionIds = predictionBundle.predictions.map(
      (prediction) => prediction.sourceId,
    )
    if (new Set(predictionIds).size !== predictionIds.length) {
      rerunReasons.push('Prediction bundle contains duplicate sourceId values.')
    }
    if (canonicalJson(uniqueSorted(predictionIds)) !== canonicalJson(expectedIds)) {
      rerunReasons.push(
        `Full-corpus rerun required: predictions cover ${new Set(predictionIds).size}/${expectedIds.length} annotated official snapshots.`,
      )
    }

    const entries = new Map(
      corpus.registry.entries.map((entry) => [entry.sourceId, entry]),
    )
    for (const prediction of predictionBundle.predictions) {
      const entry = entries.get(prediction.sourceId)
      if (
        !entry ||
        entry.snapshot.status !== 'captured' ||
        prediction.snapshotSha256 !== entry.snapshot.sha256
      ) {
        rerunReasons.push(
          `${prediction.sourceId}: prediction targets a stale or unknown snapshot.`,
        )
      }
      const fieldPaths = prediction.highRiskPredictions.map(
        (field) => field.fieldPath,
      )
      if (new Set(fieldPaths).size !== fieldPaths.length) {
        rerunReasons.push(
          `${prediction.sourceId}: prediction contains duplicate high-risk field paths.`,
        )
      }
    }
  }

  if (rerunReasons.length > 0 || !currentFingerprints || !predictionBundle) {
    return emptyResult(corpus, {
      status: 'rerun_required',
      ready: true,
      passed: false,
      metrics: null,
      fingerprintsChanged,
      rerunRequired: true,
      reasons: rerunReasons,
    })
  }

  let truePositive = 0
  let falsePositive = 0
  let falseNegative = 0
  let correctDecisions = 0
  let totalDecisions = 0
  let unexpectedPredictions = 0
  const predictionsBySource = new Map(
    predictionBundle.predictions.map((prediction) => [
      prediction.sourceId,
      prediction,
    ]),
  )

  for (const [sourceId, annotation] of corpus.annotations) {
    const prediction = predictionsBySource.get(sourceId)!
    const predictedByPath = new Map(
      prediction.highRiskPredictions.map((field) => [field.fieldPath, field.value]),
    )
    const expectedPaths = new Set(
      annotation.highRiskDecisions.map((decision) => decision.fieldPath),
    )

    for (const decision of annotation.highRiskDecisions) {
      totalDecisions += 1
      const hasPrediction = predictedByPath.has(decision.fieldPath)
      if (decision.expected.kind === 'absent') {
        if (hasPrediction) falsePositive += 1
        else correctDecisions += 1
        continue
      }
      if (!hasPrediction) {
        falseNegative += 1
        continue
      }
      const predicted = predictedByPath.get(decision.fieldPath)!
      if (exactJsonMatch(predicted, decision.expected.value)) {
        truePositive += 1
        correctDecisions += 1
      } else {
        falsePositive += 1
        falseNegative += 1
      }
    }

    for (const fieldPath of predictedByPath.keys()) {
      if (!expectedPaths.has(fieldPath)) {
        falsePositive += 1
        unexpectedPredictions += 1
        totalDecisions += 1
      }
    }
  }

  const predictedPositive = truePositive + falsePositive
  const expectedPositive = truePositive + falseNegative
  const precision =
    predictedPositive === 0 ? (expectedPositive === 0 ? 1 : 0) : truePositive / predictedPositive
  const accuracy = totalDecisions === 0 ? 0 : correctDecisions / totalDecisions
  const metrics: HighRiskMetrics = {
    precision,
    accuracy,
    truePositive,
    falsePositive,
    falseNegative,
    correctDecisions,
    totalDecisions,
    unexpectedPredictions,
  }
  const passed =
    precision >= corpus.registry.highRiskThresholds.precision &&
    accuracy >= corpus.registry.highRiskThresholds.accuracy

  return emptyResult(corpus, {
    status: passed ? 'passed' : 'failed',
    ready: true,
    passed,
    metrics,
    fingerprintsChanged,
    rerunRequired: false,
    reasons: passed
      ? []
      : [
          `High-risk precision ${precision.toFixed(4)} and accuracy ${accuracy.toFixed(4)} must both be at least ${MINIMUM_HIGH_RISK_SCORE.toFixed(2)}.`,
        ],
  })
}

export function loadGoldEvaluationState(
  projectRoot = process.cwd(),
  statePath = 'quality/gold/evaluation-state.json',
): GoldEvaluationState {
  const absolutePath = resolveCorpusFile(projectRoot, statePath, 'quality/gold')
  return goldEvaluationStateSchema.parse(readJsonFile(absolutePath))
}

export function loadPredictionBundle(path: string): GoldPredictionBundle {
  return goldPredictionBundleSchema.parse(readJsonFile(resolve(path)))
}
