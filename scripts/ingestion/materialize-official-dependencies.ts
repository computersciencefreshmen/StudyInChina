import { createHash } from 'node:crypto'
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import {
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path'
import { pathToFileURL } from 'node:url'

type JsonObject = Record<string, unknown>
type DependencyKind = 'organization' | 'location'
type SourceKind = 'institution' | 'city'
type SqlValue = string | number | null

export type OfficialDependencySpec = {
  dependencyId: string
  recordId: string
  recordKind: DependencyKind
  slug: string
  expectedNameEn: string
  sourceUrl: string
  sourceHost: string
  sourceKind: SourceKind
  publisherOrganizationId: string | null
  publisherName: string
  canonicalOfficialUrl: string | null
  bootstrapPrimaryDomain: string | null
  cityId: string | null
}

type RawDependencyArtifact = {
  dependencyId: string
  assetId: string
  officialUrl: string
  finalUrl: string
  localPath: string
  contentType: string
  byteLength: number
  sha256: string
  httpStatus: number
  checkedAt: string
  r2Key: string
  isFixture: false
  unchanged: boolean
  role: 'dependency'
  batchScope: 'dependency'
}

export type OfficialDependencySourceArtifact = {
  sourceId: string
  fetchId: string
  localPath: string
  artifactSha256: string
  artifactUri: string
  contentType: string
  byteLength: number
  capturedAt: string
  isFixture: false
  captureMode: 'live'
}

type PreparedDependency = {
  spec: OfficialDependencySpec
  artifact: RawDependencyArtifact
  outputArtifact: OfficialDependencySourceArtifact
  evidenceQuote: string
  evidenceLocator: string
  fragmentId: string
  reviewAfter: string
}

type RecordMapping = {
  recordId: string
  recordKind: DependencyKind
}

export type OfficialDependencyMaterializationManifest = {
  format: 'studyinchina.pipeline.materialization'
  formatVersion: 1
  materializerVersion: string
  batchId: string
  batchPurpose: 'dependencies'
  provenanceStatus: 'complete'
  requiredSourceArtifacts: 10
  sourceArtifacts: OfficialDependencySourceArtifact[]
  recordMappings: RecordMapping[]
  generatedAt: string
  contentSha256: string
  sqlStatements: number
  maxSqlStatementBytes: number
  counts: {
    records: 10
    recordSlugs: 0
    programs: 0
    scholarships: 0
    organizations: 6
    locations: 4
    localizedContent: 10
    sourceDocuments: 10
    sourceFetches: 10
    sourceFragments: 10
    claimEvidence: 16
    claims: 16
    canonicalFields: 16
    programCycles: 0
    scholarshipCycles: 0
  }
}

export type OfficialDependencyMaterializationArtifacts = {
  sql: string
  manifest: OfficialDependencyMaterializationManifest
}

export type OfficialDependencyMaterializationOptions = {
  manifestPath: string
  remote?: boolean
}

export const OFFICIAL_DEPENDENCY_SPECS: readonly OfficialDependencySpec[] = [
  {
    dependencyId: 'institution-home-tsinghua',
    recordId: 'uni-tsinghua-university',
    recordKind: 'organization',
    slug: 'tsinghua-university',
    expectedNameEn: 'Tsinghua University',
    sourceUrl: 'https://www.tsinghua.edu.cn/en/',
    sourceHost: 'www.tsinghua.edu.cn',
    sourceKind: 'institution',
    publisherOrganizationId: 'uni-tsinghua-university',
    publisherName: 'Tsinghua University',
    canonicalOfficialUrl: 'https://www.tsinghua.edu.cn/en/',
    bootstrapPrimaryDomain: 'www.tsinghua.edu.cn',
    cityId: 'city-beijing',
  },
  {
    dependencyId: 'institution-home-pku',
    recordId: 'uni-peking-university',
    recordKind: 'organization',
    slug: 'peking-university',
    expectedNameEn: 'Peking University',
    sourceUrl: 'https://english.pku.edu.cn/',
    sourceHost: 'english.pku.edu.cn',
    sourceKind: 'institution',
    publisherOrganizationId: 'uni-peking-university',
    publisherName: 'Peking University',
    canonicalOfficialUrl: 'https://english.pku.edu.cn/',
    bootstrapPrimaryDomain: 'english.pku.edu.cn',
    cityId: 'city-beijing',
  },
  {
    dependencyId: 'institution-home-zju',
    recordId: 'uni-zhejiang-university',
    recordKind: 'organization',
    slug: 'zhejiang-university',
    expectedNameEn: 'Zhejiang University',
    sourceUrl: 'https://www.zju.edu.cn/english/',
    sourceHost: 'www.zju.edu.cn',
    sourceKind: 'institution',
    publisherOrganizationId: 'uni-zhejiang-university',
    publisherName: 'Zhejiang University',
    canonicalOfficialUrl: 'https://www.zju.edu.cn/english/',
    bootstrapPrimaryDomain: 'www.zju.edu.cn',
    cityId: 'city-hangzhou',
  },
  {
    dependencyId: 'institution-home-fudan',
    recordId: 'uni-fudan-university',
    recordKind: 'organization',
    slug: 'fudan-university',
    expectedNameEn: 'Fudan University',
    sourceUrl: 'https://www.fudan.edu.cn/en/',
    sourceHost: 'www.fudan.edu.cn',
    sourceKind: 'institution',
    publisherOrganizationId: 'uni-fudan-university',
    publisherName: 'Fudan University',
    canonicalOfficialUrl: 'https://www.fudan.edu.cn/en/',
    bootstrapPrimaryDomain: 'www.fudan.edu.cn',
    cityId: 'city-shanghai',
  },
  {
    dependencyId: 'institution-home-sjtu',
    recordId: 'uni-shanghai-jiao-tong-university',
    recordKind: 'organization',
    slug: 'shanghai-jiao-tong-university',
    expectedNameEn: 'Shanghai Jiao Tong University',
    sourceUrl: 'https://en.sjtu.edu.cn/',
    sourceHost: 'en.sjtu.edu.cn',
    sourceKind: 'institution',
    publisherOrganizationId: 'uni-shanghai-jiao-tong-university',
    publisherName: 'Shanghai Jiao Tong University',
    canonicalOfficialUrl: 'https://en.sjtu.edu.cn/',
    bootstrapPrimaryDomain: 'en.sjtu.edu.cn',
    cityId: 'city-shanghai',
  },
  {
    dependencyId: 'institution-home-ustc',
    recordId: 'uni-university-of-science-and-technology-of-china',
    recordKind: 'organization',
    slug: 'university-of-science-and-technology-of-china',
    expectedNameEn: 'University of Science and Technology of China',
    sourceUrl: 'https://en.ustc.edu.cn/',
    sourceHost: 'en.ustc.edu.cn',
    sourceKind: 'institution',
    publisherOrganizationId: 'uni-university-of-science-and-technology-of-china',
    publisherName: 'University of Science and Technology of China',
    canonicalOfficialUrl: 'https://www.ustc.edu.cn/',
    bootstrapPrimaryDomain: 'ustc.edu.cn',
    cityId: 'city-hefei',
  },
  {
    dependencyId: 'city-government-beijing',
    recordId: 'city-beijing',
    recordKind: 'location',
    slug: 'beijing',
    expectedNameEn: 'Beijing',
    sourceUrl: 'https://english.beijing.gov.cn/',
    sourceHost: 'english.beijing.gov.cn',
    sourceKind: 'city',
    publisherOrganizationId: null,
    publisherName: 'Beijing Municipal Government',
    canonicalOfficialUrl: null,
    bootstrapPrimaryDomain: null,
    cityId: null,
  },
  {
    dependencyId: 'city-government-shanghai',
    recordId: 'city-shanghai',
    recordKind: 'location',
    slug: 'shanghai',
    expectedNameEn: 'Shanghai',
    sourceUrl: 'https://english.shanghai.gov.cn/',
    sourceHost: 'english.shanghai.gov.cn',
    sourceKind: 'city',
    publisherOrganizationId: null,
    publisherName: 'Shanghai Municipal Government',
    canonicalOfficialUrl: null,
    bootstrapPrimaryDomain: null,
    cityId: null,
  },
  {
    dependencyId: 'city-government-hangzhou',
    recordId: 'city-hangzhou',
    recordKind: 'location',
    slug: 'hangzhou',
    expectedNameEn: 'Hangzhou',
    sourceUrl: 'https://eng.hangzhou.gov.cn/index.html',
    sourceHost: 'eng.hangzhou.gov.cn',
    sourceKind: 'city',
    publisherOrganizationId: null,
    publisherName: 'Hangzhou Municipal Government',
    canonicalOfficialUrl: null,
    bootstrapPrimaryDomain: null,
    cityId: null,
  },
  {
    dependencyId: 'city-hefei-ustc-about',
    recordId: 'city-hefei',
    recordKind: 'location',
    slug: 'hefei',
    expectedNameEn: 'Hefei',
    sourceUrl: 'https://en.ustc.edu.cn/About.htm',
    sourceHost: 'en.ustc.edu.cn',
    sourceKind: 'city',
    publisherOrganizationId: 'uni-university-of-science-and-technology-of-china',
    publisherName: 'University of Science and Technology of China',
    canonicalOfficialUrl: null,
    bootstrapPrimaryDomain: null,
    cityId: null,
  },
] as const

export const OFFICIAL_DEPENDENCY_MATERIALIZER_VERSION =
  'official-dependency-materializer/v1'

const MAX_SQL_STATEMENT_BYTES = 20_000
const PRIVATE_R2_PREFIX = 'r2://studyinchina-source-snapshots/'
const FIXTURE_PATH_PATTERN =
  /(?:^|[\\/])(?:tests?[\\/]fixtures?|fixtures?)(?:[\\/]|$)|(?:^|[\\/])[^\\/]*fixture[^\\/]*(?:[\\/]|$)/iu
const SHA256_PATTERN = /^[0-9a-f]{64}$/u

function asObject(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as JsonObject
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value.trim()
}

function safeInteger(
  value: unknown,
  label: string,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (
    typeof value !== 'number'
    || !Number.isSafeInteger(value)
    || value < minimum
    || value > maximum
  ) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}`)
  }
  return value
}

function isoTimestamp(value: unknown, label: string): string {
  const text = nonEmptyString(value, label)
  const parsed = new Date(text)
  if (Number.isNaN(parsed.getTime())) throw new Error(`${label} must be an ISO timestamp`)
  return parsed.toISOString()
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as JsonObject)
        .sort(([left], [right]) => left.localeCompare(right, 'en'))
        .map(([key, child]) => [key, canonical(child)]),
    )
  }
  return value
}

function stableJson(value: unknown): string {
  return JSON.stringify(canonical(value))
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function sqlValue(value: SqlValue): string {
  if (value === null) return 'NULL'
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('SQL integer must be safe')
    return String(value)
  }
  return `'${value.replaceAll("'", "''")}'`
}

function sourceIdForUrl(url: string): string {
  return `source-document-${sha256(url).slice(0, 24)}`
}

function fetchIdForSource(sourceId: string, checkedAt: string): string {
  return `fetch-${sha256([sourceId, checkedAt].join('\u0000'))}`
}

function reviewAfter(checkedAt: string, days: number): string {
  const value = new Date(checkedAt)
  value.setUTCHours(0, 0, 0, 0)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

function assertExactHttpsUrl(
  value: unknown,
  expectedUrl: string,
  expectedHost: string,
  label: string,
  exact: boolean,
): string {
  const text = nonEmptyString(value, label)
  let parsed: URL
  try {
    parsed = new URL(text)
  } catch {
    throw new Error(`${label} must be a valid URL`)
  }
  if (
    parsed.protocol !== 'https:'
    || parsed.username
    || parsed.password
    || (parsed.port && parsed.port !== '443')
    || parsed.hostname.toLowerCase() !== expectedHost
  ) {
    throw new Error(`${label} is outside the exact official HTTPS allowlist`)
  }
  parsed.hash = ''
  const normalized = parsed.href
  if (exact && normalized !== new URL(expectedUrl).href) {
    throw new Error(`${label} does not match the registered dependency URL`)
  }
  return normalized
}

function safeR2Key(value: unknown, expected: string, label: string): string {
  const key = nonEmptyString(value, label)
  if (
    key !== expected
    || key.startsWith('/')
    || key.includes('\\')
    || key.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error(`${label} does not match the deterministic private R2 key`)
  }
  return key
}

function resolveArtifactPath(
  manifestPath: string,
  value: unknown,
  remote: boolean,
  label: string,
): string {
  const localPath = nonEmptyString(value, label)
  if (isAbsolute(localPath)) {
    throw new Error(`${label} must be relative to the priority harvest manifest`)
  }
  const manifestDirectory = realpathSync(dirname(resolve(manifestPath)))
  const candidate = resolve(manifestDirectory, localPath)
  const relativePath = relative(manifestDirectory, candidate)
  if (
    !relativePath
    || relativePath === '..'
    || relativePath.startsWith(`..${sep}`)
    || isAbsolute(relativePath)
  ) {
    throw new Error(`${label} escapes the priority harvest directory`)
  }
  if (remote && FIXTURE_PATH_PATTERN.test(candidate)) {
    throw new Error(`${label} is a fixture path and cannot satisfy the remote contract`)
  }
  const stat = lstatSync(candidate)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${label} must reference a regular non-symlink file`)
  }
  const realCandidate = realpathSync(candidate)
  const realRelative = relative(manifestDirectory, realCandidate)
  if (
    realRelative === '..'
    || realRelative.startsWith(`..${sep}`)
    || isAbsolute(realRelative)
  ) {
    throw new Error(`${label} resolves outside the priority harvest directory`)
  }
  return realCandidate
}

const HTML_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
}

function decodeHtmlEntities(value: string): string {
  return value.replace(
    /&(?:#(?<decimal>\d+)|#x(?<hex>[0-9a-f]+)|(?<named>[a-z]+));/giu,
    (entity, _decimal, _hex, _named, _offset, _input, groups: {
      decimal?: string
      hex?: string
      named?: string
    }) => {
      const numeric = groups.decimal
        ? Number.parseInt(groups.decimal, 10)
        : groups.hex ? Number.parseInt(groups.hex, 16) : null
      if (numeric !== null) {
        if (
          Number.isSafeInteger(numeric)
          && numeric > 0
          && numeric <= 0x10ffff
          && !(numeric >= 0xd800 && numeric <= 0xdfff)
        ) {
          return String.fromCodePoint(numeric)
        }
        return entity
      }
      return HTML_ENTITIES[groups.named?.toLowerCase() ?? ''] ?? entity
    },
  )
}

function htmlText(bytes: Buffer, contentType: string): string {
  const leading = bytes.subarray(0, Math.min(bytes.length, 8_192)).toString('utf8')
  const declaredCharset = (
    /charset\s*=\s*["']?\s*([a-z0-9_-]+)/iu.exec(contentType)?.[1]
    ?? /<meta[^>]+charset\s*=\s*["']?\s*([a-z0-9_-]+)/iu.exec(leading)?.[1]
    ?? 'utf-8'
  ).toLowerCase()
  const charset = ({
    utf8: 'utf-8',
    gbk: 'gb18030',
    gb2312: 'gb18030',
  } as Record<string, string>)[declaredCharset] ?? declaredCharset
  let html: string
  try {
    html = new TextDecoder(charset).decode(bytes)
  } catch {
    throw new Error(`unsupported dependency HTML charset: ${declaredCharset}`)
  }
  return decodeHtmlEntities(
    html
      .replace(/<!--[\s\S]*?-->/gu, ' ')
      .replace(/<(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, ' ')
      .replace(/<[^>]+>/gu, ' '),
  )
    .normalize('NFKC')
    .replace(/\s+/gu, ' ')
    .trim()
}

function locateExpectedEvidence(
  bytes: Buffer,
  contentType: string,
  expectedName: string,
  dependencyId: string,
): { quote: string; locator: string } {
  const text = htmlText(bytes, contentType)
  const index = text.toLocaleLowerCase('en-US')
    .indexOf(expectedName.toLocaleLowerCase('en-US'))
  if (index < 0) {
    throw new Error(
      `${dependencyId} raw HTML does not contain expected English evidence ${JSON.stringify(expectedName)}`,
    )
  }
  const quote = text.slice(index, index + expectedName.length)
  return {
    quote,
    locator: `normalized-text:${index}-${index + quote.length}`,
  }
}

function compareRunArtifact(
  runArtifactValue: unknown,
  dependencyArtifact: RawDependencyArtifact,
  label: string,
): void {
  const runArtifact = asObject(runArtifactValue, label)
  const keys = [
    'assetId',
    'officialUrl',
    'finalUrl',
    'localPath',
    'contentType',
    'byteLength',
    'sha256',
    'httpStatus',
    'checkedAt',
    'r2Key',
    'isFixture',
    'unchanged',
  ] as const
  for (const key of keys) {
    if (runArtifact[key] !== dependencyArtifact[key]) {
      throw new Error(`${label}.${key} conflicts with dependencyArtifacts`)
    }
  }
}

function validateSourceRuns(
  root: JsonObject,
  artifactsByDependencyId: ReadonlyMap<string, RawDependencyArtifact>,
): void {
  if (!Array.isArray(root.sources)) {
    throw new Error('priority manifest.sources must be an array')
  }
  const dependencyRuns = root.sources
    .map((value, index) => ({ value: asObject(value, `sources[${index}]`), index }))
    .filter(({ value }) => value.kind === 'dependency')
  if (dependencyRuns.length !== OFFICIAL_DEPENDENCY_SPECS.length) {
    throw new Error('priority manifest must contain exactly ten dependency source runs')
  }
  const seen = new Set<string>()
  for (const { value: run, index } of dependencyRuns) {
    const label = `sources[${index}]`
    const dependencyId = nonEmptyString(run.sourceId, `${label}.sourceId`)
    const spec = OFFICIAL_DEPENDENCY_SPECS.find(
      (candidate) => candidate.dependencyId === dependencyId,
    )
    if (!spec || seen.has(dependencyId)) {
      throw new Error(`${label}.sourceId is not an exact unique dependency allowlist entry`)
    }
    seen.add(dependencyId)
    if (
      run.required !== true
      || run.status !== 'verified'
      || run.error !== null
      || run.kind !== 'dependency'
    ) {
      throw new Error(`${label} is not a verified required dependency run`)
    }
    if (
      !Array.isArray(run.officialUrls)
      || run.officialUrls.length !== 1
      || run.officialUrls[0] !== spec.sourceUrl
    ) {
      throw new Error(`${label}.officialUrls does not match the dependency allowlist`)
    }
    if (!Array.isArray(run.sourceArtifacts) || run.sourceArtifacts.length !== 1) {
      throw new Error(`${label} must contain exactly one raw source artifact`)
    }
    compareRunArtifact(
      run.sourceArtifacts[0],
      artifactsByDependencyId.get(dependencyId)!,
      `${label}.sourceArtifacts[0]`,
    )
  }
}

function normalizePriorityManifest(
  input: unknown,
  options: OfficialDependencyMaterializationOptions,
): PreparedDependency[] {
  const root = asObject(input, 'priority manifest')
  if (
    root.format !== 'studyinchina.priority-official-harvest'
    || root.formatVersion !== 2
  ) {
    throw new Error('input must be a priority official harvest v2 manifest')
  }
  if (
    root.status !== 'passed'
    || root.provenanceStatus !== 'complete'
    || root.aiUsed !== false
  ) {
    throw new Error('priority harvest must be passed, complete, live, and deterministic')
  }
  const gate = asObject(root.gate, 'priority manifest.gate')
  if (gate.passed !== true) {
    throw new Error('priority harvest gate must pass before dependency materialization')
  }
  const totals = asObject(root.totals, 'priority manifest.totals')
  if (totals.dependencies !== OFFICIAL_DEPENDENCY_SPECS.length) {
    throw new Error('priority manifest totals.dependencies must be exactly ten')
  }
  const checkedAt = isoTimestamp(root.checkedAt, 'priority manifest.checkedAt')
  if (!Array.isArray(root.dependencyArtifacts)) {
    throw new Error('priority manifest.dependencyArtifacts must be an array')
  }
  if (root.dependencyArtifacts.length !== OFFICIAL_DEPENDENCY_SPECS.length) {
    throw new Error('priority manifest must contain exactly ten live dependency artifacts')
  }

  const artifactsByDependencyId = new Map<string, RawDependencyArtifact>()
  const sourceIds = new Set<string>()
  const fetchIds = new Set<string>()
  const artifactUris = new Set<string>()
  const prepared = root.dependencyArtifacts.map((value, index) => {
    const label = `dependencyArtifacts[${index}]`
    const raw = asObject(value, label)
    const dependencyId = nonEmptyString(raw.dependencyId, `${label}.dependencyId`)
    const spec = OFFICIAL_DEPENDENCY_SPECS.find(
      (candidate) => candidate.dependencyId === dependencyId,
    )
    if (!spec || artifactsByDependencyId.has(dependencyId)) {
      throw new Error(`${label}.dependencyId is not an exact unique dependency allowlist entry`)
    }
    if (raw.role !== 'dependency' || raw.batchScope !== 'dependency') {
      throw new Error(`${label} must declare role=batchScope=dependency`)
    }
    if (raw.isFixture !== false) {
      throw new Error(`${label} is not a live artifact (isFixture must be false)`)
    }
    if (typeof raw.unchanged !== 'boolean') {
      throw new Error(`${label}.unchanged must be boolean`)
    }
    const assetId = nonEmptyString(raw.assetId, `${label}.assetId`)
    if (assetId !== `${dependencyId}:html`) {
      throw new Error(`${label}.assetId does not match the registered dependency`)
    }
    const officialUrl = assertExactHttpsUrl(
      raw.officialUrl,
      spec.sourceUrl,
      spec.sourceHost,
      `${label}.officialUrl`,
      true,
    )
    const finalUrl = assertExactHttpsUrl(
      raw.finalUrl,
      spec.sourceUrl,
      spec.sourceHost,
      `${label}.finalUrl`,
      false,
    )
    const contentType = nonEmptyString(raw.contentType, `${label}.contentType`)
    const normalizedContentType = contentType.split(';', 1)[0]!.trim().toLowerCase()
    if (!['text/html', 'application/xhtml+xml'].includes(normalizedContentType)) {
      throw new Error(`${label}.contentType must be HTML`)
    }
    const byteLength = safeInteger(raw.byteLength, `${label}.byteLength`, 1)
    const artifactSha256 = nonEmptyString(raw.sha256, `${label}.sha256`).toLowerCase()
    if (!SHA256_PATTERN.test(artifactSha256)) {
      throw new Error(`${label}.sha256 must be a lowercase SHA-256 digest`)
    }
    const httpStatus = safeInteger(raw.httpStatus, `${label}.httpStatus`, 200, 299)
    const capturedAt = isoTimestamp(raw.checkedAt, `${label}.checkedAt`)
    if (capturedAt !== checkedAt) {
      throw new Error(`${label}.checkedAt must match priority manifest.checkedAt`)
    }
    const manifestLocalPath = nonEmptyString(raw.localPath, `${label}.localPath`)
    const localPath = resolveArtifactPath(
      options.manifestPath,
      manifestLocalPath,
      options.remote === true,
      `${label}.localPath`,
    )
    const bytes = readFileSync(localPath)
    if (bytes.byteLength !== byteLength) {
      throw new Error(`${label}.byteLength does not match the raw artifact`)
    }
    if (sha256(bytes) !== artifactSha256) {
      throw new Error(`${label}.sha256 does not match the raw artifact`)
    }
    const assetNamespace = sha256(assetId).slice(0, 24)
    const expectedR2Key =
      `source-artifacts/${assetNamespace}/${artifactSha256}.html`
    const r2Key = safeR2Key(raw.r2Key, expectedR2Key, `${label}.r2Key`)
    const sourceId = sourceIdForUrl(officialUrl)
    const fetchId = fetchIdForSource(sourceId, capturedAt)
    const artifactUri = `${PRIVATE_R2_PREFIX}${r2Key}`
    if (
      sourceIds.has(sourceId)
      || fetchIds.has(fetchId)
      || artifactUris.has(artifactUri)
    ) {
      throw new Error(`${label} collides with another dependency source artifact`)
    }
    sourceIds.add(sourceId)
    fetchIds.add(fetchId)
    artifactUris.add(artifactUri)
    const rawArtifact: RawDependencyArtifact = {
      dependencyId,
      assetId,
      officialUrl,
      finalUrl,
      localPath: manifestLocalPath,
      contentType,
      byteLength,
      sha256: artifactSha256,
      httpStatus,
      checkedAt: capturedAt,
      r2Key,
      isFixture: false,
      unchanged: raw.unchanged,
      role: 'dependency',
      batchScope: 'dependency',
    }
    artifactsByDependencyId.set(dependencyId, rawArtifact)
    const evidence = locateExpectedEvidence(
      bytes,
      contentType,
      spec.expectedNameEn,
      dependencyId,
    )
    const fragmentId = `fragment-${sha256([
      fetchId,
      evidence.locator,
      evidence.quote,
    ].join('\u0000'))}`
    return {
      spec,
      artifact: rawArtifact,
      outputArtifact: {
        sourceId,
        fetchId,
        localPath,
        artifactSha256,
        artifactUri,
        contentType,
        byteLength,
        capturedAt,
        isFixture: false as const,
        captureMode: 'live' as const,
      },
      evidenceQuote: evidence.quote,
      evidenceLocator: evidence.locator,
      fragmentId,
      reviewAfter: reviewAfter(capturedAt, spec.recordKind === 'organization' ? 90 : 365),
    }
  })

  validateSourceRuns(root, artifactsByDependencyId)
  for (const spec of OFFICIAL_DEPENDENCY_SPECS) {
    if (!artifactsByDependencyId.has(spec.dependencyId)) {
      throw new Error(`priority manifest is missing dependency ${spec.dependencyId}`)
    }
  }
  return prepared.sort((left, right) => (
    left.spec.dependencyId.localeCompare(right.spec.dependencyId, 'en')
  ))
}

function guardStatements(
  dependency: PreparedDependency,
  generatedAt: string,
): string[] {
  const { spec } = dependency
  const guardId = `guard-${sha256([
    OFFICIAL_DEPENDENCY_MATERIALIZER_VERSION,
    'bootstrap',
    spec.recordId,
  ].join('\u0000')).slice(0, 32)}`
  const exactPredicate = spec.recordKind === 'organization'
    ? `
EXISTS (
  SELECT 1
  FROM records record
  JOIN record_slugs slug
    ON slug.record_id = record.id
   AND slug.slug = ${sqlValue(spec.slug)}
   AND slug.is_current = 1
  JOIN organizations organization ON organization.record_id = record.id
  JOIN institutions institution ON institution.record_id = record.id
  JOIN organization_domains domain
    ON domain.organization_id = record.id
   AND domain.domain = ${sqlValue(spec.bootstrapPrimaryDomain)}
   AND domain.is_primary = 1
  WHERE record.id = ${sqlValue(spec.recordId)}
    AND record.public_id = ${sqlValue(spec.recordId)}
    AND record.kind = 'organization'
    AND organization.organization_type = 'university'
    AND organization.official_url = ${sqlValue(spec.canonicalOfficialUrl)}
    AND institution.city_id = ${sqlValue(spec.cityId)}
    AND (
      SELECT COUNT(*)
      FROM organization_domains primary_domain
      WHERE primary_domain.organization_id = record.id
        AND primary_domain.is_primary = 1
    ) = 1
)`
    : `
EXISTS (
  SELECT 1
  FROM records record
  JOIN record_slugs slug
    ON slug.record_id = record.id
   AND slug.slug = ${sqlValue(spec.slug)}
   AND slug.is_current = 1
  JOIN locations location ON location.record_id = record.id
  WHERE record.id = ${sqlValue(spec.recordId)}
    AND record.public_id = ${sqlValue(spec.recordId)}
    AND record.kind = 'location'
    AND location.location_type = 'city'
    AND location.country_code = 'CN'
)`
  return [
    `
INSERT INTO audit_log (
  id, occurred_at, actor_type, actor_id, action,
  subject_type, subject_id, detail
) VALUES (
  ${sqlValue(guardId)}, ${sqlValue(generatedAt)},
  CASE WHEN ${exactPredicate} THEN 'system' ELSE 'dependency_contract_violation' END,
  ${sqlValue(OFFICIAL_DEPENDENCY_MATERIALIZER_VERSION)},
  'dependency_bootstrap_guard', ${sqlValue(spec.recordKind)},
  ${sqlValue(spec.recordId)}, 'Exact bootstrap record and domain contract'
);`.trim(),
    `DELETE FROM audit_log WHERE id = ${sqlValue(guardId)};`,
  ]
}

function sourceGuardStatements(dependency: PreparedDependency): string[] {
  const { spec, outputArtifact } = dependency
  const guardId = `guard-${sha256([
    OFFICIAL_DEPENDENCY_MATERIALIZER_VERSION,
    'source',
    outputArtifact.sourceId,
  ].join('\u0000')).slice(0, 32)}`
  return [
    `
INSERT INTO audit_log (
  id, occurred_at, actor_type, actor_id, action,
  subject_type, subject_id, detail
) VALUES (
  ${sqlValue(guardId)}, ${sqlValue(outputArtifact.capturedAt)},
  CASE WHEN (
    NOT EXISTS (
      SELECT 1 FROM source_documents
      WHERE id = ${sqlValue(outputArtifact.sourceId)}
         OR canonical_url = ${sqlValue(spec.sourceUrl)}
    )
    OR EXISTS (
      SELECT 1
      FROM source_documents source
      WHERE source.id = ${sqlValue(outputArtifact.sourceId)}
        AND source.public_id = ${sqlValue(outputArtifact.sourceId)}
        AND source.canonical_url = ${sqlValue(spec.sourceUrl)}
        AND source.publisher_organization_id IS ${sqlValue(spec.publisherOrganizationId)}
        AND source.source_kind = ${sqlValue(spec.sourceKind)}
        AND source.authority_level = 'primary_official'
        AND source.official = 1
    )
  ) THEN 'system' ELSE 'dependency_source_collision' END,
  ${sqlValue(OFFICIAL_DEPENDENCY_MATERIALIZER_VERSION)},
  'dependency_source_guard', 'source_document',
  ${sqlValue(outputArtifact.sourceId)}, 'Exact official dependency source identity'
);`.trim(),
    `DELETE FROM audit_log WHERE id = ${sqlValue(guardId)};`,
  ]
}

function fetchGuardStatements(dependency: PreparedDependency): string[] {
  const { artifact, outputArtifact } = dependency
  const guardId = `guard-${sha256([
    OFFICIAL_DEPENDENCY_MATERIALIZER_VERSION,
    'fetch',
    outputArtifact.fetchId,
  ].join('\u0000')).slice(0, 32)}`
  return [
    `
INSERT INTO audit_log (
  id, occurred_at, actor_type, actor_id, action,
  subject_type, subject_id, detail
) VALUES (
  ${sqlValue(guardId)}, ${sqlValue(outputArtifact.capturedAt)},
  CASE WHEN (
    NOT EXISTS (
      SELECT 1 FROM source_fetches WHERE id = ${sqlValue(outputArtifact.fetchId)}
    )
    OR EXISTS (
      SELECT 1
      FROM source_fetches fetch
      WHERE fetch.id = ${sqlValue(outputArtifact.fetchId)}
        AND fetch.source_id = ${sqlValue(outputArtifact.sourceId)}
        AND fetch.status = 'succeeded'
        AND fetch.completed_at = ${sqlValue(outputArtifact.capturedAt)}
        AND fetch.http_status = ${artifact.httpStatus}
        AND fetch.content_type = ${sqlValue(outputArtifact.contentType)}
        AND fetch.content_length = ${outputArtifact.byteLength}
        AND fetch.sha256 = ${sqlValue(outputArtifact.artifactSha256)}
        AND fetch.artifact_uri = ${sqlValue(outputArtifact.artifactUri)}
    )
  ) THEN 'system' ELSE 'dependency_fetch_collision' END,
  ${sqlValue(OFFICIAL_DEPENDENCY_MATERIALIZER_VERSION)},
  'dependency_fetch_guard', 'source_fetch',
  ${sqlValue(outputArtifact.fetchId)}, 'Exact live artifact fetch identity'
);`.trim(),
    `DELETE FROM audit_log WHERE id = ${sqlValue(guardId)};`,
  ]
}

function fieldDefinitionStatements(): string[] {
  return [
    `
INSERT INTO field_definitions (
  record_kind, field_path, value_type, risk_class,
  required_for_publish, max_age_days, validation_profile
) VALUES (
  'organization', 'localized.name', 'localized_string', 'low',
  1, 365, 'non-empty-text'
)
ON CONFLICT(record_kind, field_path) DO NOTHING;`.trim(),
    `
INSERT INTO field_definitions (
  record_kind, field_path, value_type, risk_class,
  required_for_publish, max_age_days, validation_profile
) VALUES (
  'organization', 'official_url', 'url', 'medium',
  1, 90, 'official-https-url'
)
ON CONFLICT(record_kind, field_path) DO NOTHING;`.trim(),
    `
INSERT INTO field_definitions (
  record_kind, field_path, value_type, risk_class,
  required_for_publish, max_age_days, validation_profile
) VALUES (
  'location', 'localized.name', 'localized_string', 'low',
  1, 365, 'non-empty-text'
)
ON CONFLICT(record_kind, field_path) DO NOTHING;`.trim(),
  ]
}


function sourceStatements(dependency: PreparedDependency, generatedAt: string): string[] {
  const { spec, outputArtifact } = dependency
  return [
    `
INSERT INTO source_documents (
  id, public_id, canonical_url, publisher_organization_id, source_kind,
  authority_level, official, language_code, active,
  fetch_cadence_minutes, robots_policy, created_at, updated_at
) VALUES (
  ${sqlValue(outputArtifact.sourceId)}, ${sqlValue(outputArtifact.sourceId)},
  ${sqlValue(spec.sourceUrl)}, ${sqlValue(spec.publisherOrganizationId)},
  ${sqlValue(spec.sourceKind)}, 'primary_official', 1, 'en', 1,
  NULL, 'enforce', ${sqlValue(generatedAt)}, ${sqlValue(generatedAt)}
)
ON CONFLICT(id) DO UPDATE SET
  canonical_url = excluded.canonical_url,
  publisher_organization_id = excluded.publisher_organization_id,
  source_kind = excluded.source_kind,
  authority_level = 'primary_official',
  official = 1,
  language_code = 'en',
  active = 1,
  robots_policy = 'enforce',
  updated_at = CASE
    WHEN source_documents.publisher_organization_id
          IS NOT excluded.publisher_organization_id
      OR source_documents.source_kind <> excluded.source_kind
      OR source_documents.authority_level <> 'primary_official'
      OR source_documents.official <> 1
      OR source_documents.language_code <> 'en'
      OR source_documents.active <> 1
      OR source_documents.robots_policy <> 'enforce'
    THEN excluded.updated_at
    ELSE source_documents.updated_at
  END;`.trim(),
    `
INSERT INTO publication_source_metadata (
  source_id, title, publisher, reviewed_by, reviewed_at, updated_at
) VALUES (
  ${sqlValue(outputArtifact.sourceId)},
  ${sqlValue(`${spec.expectedNameEn} official dependency source`)},
  ${sqlValue(spec.publisherName)},
  ${sqlValue(OFFICIAL_DEPENDENCY_MATERIALIZER_VERSION)},
  ${sqlValue(outputArtifact.capturedAt)}, ${sqlValue(generatedAt)}
)
ON CONFLICT(source_id) DO UPDATE SET
  title = excluded.title,
  publisher = excluded.publisher,
  reviewed_by = excluded.reviewed_by,
  reviewed_at = CASE
    WHEN publication_source_metadata.reviewed_at < excluded.reviewed_at
    THEN excluded.reviewed_at
    ELSE publication_source_metadata.reviewed_at
  END,
  updated_at = CASE
    WHEN publication_source_metadata.title <> excluded.title
      OR publication_source_metadata.publisher <> excluded.publisher
      OR publication_source_metadata.reviewed_by <> excluded.reviewed_by
      OR publication_source_metadata.reviewed_at < excluded.reviewed_at
    THEN excluded.updated_at
    ELSE publication_source_metadata.updated_at
  END;`.trim(),
  ]
}

function fetchStatement(dependency: PreparedDependency): string {
  const { artifact, outputArtifact } = dependency
  return `
INSERT OR IGNORE INTO source_fetches (
  id, source_id, status, requested_at, completed_at, http_status,
  content_type, content_length, sha256, artifact_uri,
  parser_key, parser_version, metadata_json
) VALUES (
  ${sqlValue(outputArtifact.fetchId)}, ${sqlValue(outputArtifact.sourceId)},
  'succeeded', ${sqlValue(outputArtifact.capturedAt)},
  ${sqlValue(outputArtifact.capturedAt)}, ${artifact.httpStatus},
  ${sqlValue(outputArtifact.contentType)}, ${outputArtifact.byteLength},
  ${sqlValue(outputArtifact.artifactSha256)},
  ${sqlValue(outputArtifact.artifactUri)},
  'official-dependency-materializer', '1',
  ${sqlValue(stableJson({
    dependencyId: dependency.spec.dependencyId,
    finalUrl: dependency.artifact.finalUrl,
    liveArtifact: true,
  }))}
);`.trim()
}


function fragmentStatement(dependency: PreparedDependency): string {
  return `
INSERT OR IGNORE INTO source_fragments (
  id, fetch_id, locator_type, locator, page_number,
  text_excerpt, sha256, created_at
) VALUES (
  ${sqlValue(dependency.fragmentId)},
  ${sqlValue(dependency.outputArtifact.fetchId)},
  'text_offset', ${sqlValue(dependency.evidenceLocator)}, NULL,
  ${sqlValue(dependency.evidenceQuote)},
  ${sqlValue(sha256(dependency.evidenceQuote))},
  ${sqlValue(dependency.outputArtifact.capturedAt)}
);`.trim()
}

function localizedStatement(
  dependency: PreparedDependency,
  generatedAt: string,
): string {
  return `
INSERT INTO localized_content (
  record_id, locale, field_name, text_value,
  translation_status, source_locale, updated_at
) VALUES (
  ${sqlValue(dependency.spec.recordId)}, 'en', 'name',
  ${sqlValue(dependency.spec.expectedNameEn)}, 'published', 'en',
  ${sqlValue(generatedAt)}
)
ON CONFLICT(record_id, locale, field_name) DO UPDATE SET
  text_value = excluded.text_value,
  translation_status = 'published',
  source_locale = 'en',
  updated_at = CASE
    WHEN localized_content.text_value <> excluded.text_value
      OR localized_content.translation_status <> 'published'
      OR localized_content.source_locale IS NOT 'en'
    THEN excluded.updated_at
    ELSE localized_content.updated_at
  END;`.trim()
}

type DependencyFact = {
  fieldPath: 'localized.name' | 'official_url'
  locale: '' | 'en'
  valueType: 'localized_string' | 'url'
  value: string
  reviewAfter: string
}

function factsFor(dependency: PreparedDependency): DependencyFact[] {
  const facts: DependencyFact[] = [{
    fieldPath: 'localized.name',
    locale: 'en',
    valueType: 'localized_string',
    value: dependency.spec.expectedNameEn,
    reviewAfter: reviewAfter(dependency.outputArtifact.capturedAt, 365),
  }]
  if (
    dependency.spec.recordKind === 'organization'
    && dependency.spec.canonicalOfficialUrl
  ) {
    facts.push({
      fieldPath: 'official_url',
      locale: '',
      valueType: 'url',
      value: dependency.spec.canonicalOfficialUrl,
      reviewAfter: reviewAfter(dependency.outputArtifact.capturedAt, 90),
    })
  }
  return facts
}

function claimStatements(
  dependency: PreparedDependency,
  fact: DependencyFact,
): string[] {
  const checkedAt = dependency.outputArtifact.capturedAt
  const claimId = `claim-${sha256([
    dependency.spec.recordId,
    fact.fieldPath,
    fact.locale,
    stableJson(fact.value),
    checkedAt,
    dependency.outputArtifact.fetchId,
    dependency.fragmentId,
  ].join('\u0000'))}`
  return [
    `
INSERT OR IGNORE INTO claims (
  id, subject_record_id, field_path, locale, value_type,
  raw_value_text, normalized_value_json, confidence,
  extraction_method, extractor_version, claim_status,
  provenance_precision, discovered_at, decided_at
) VALUES (
  ${sqlValue(claimId)}, ${sqlValue(dependency.spec.recordId)},
  ${sqlValue(fact.fieldPath)}, ${sqlValue(fact.locale)},
  ${sqlValue(fact.valueType)}, ${sqlValue(fact.value)},
  ${sqlValue(stableJson(fact.value))}, 1.0, 'selector',
  ${sqlValue(OFFICIAL_DEPENDENCY_MATERIALIZER_VERSION)},
  'candidate', 'field', ${sqlValue(checkedAt)}, NULL
);`.trim(),
    `
INSERT OR IGNORE INTO claim_evidence (
  claim_id, fragment_id, evidence_role
) VALUES (
  ${sqlValue(claimId)}, ${sqlValue(dependency.fragmentId)}, 'primary'
);`.trim(),
    `
UPDATE claims
SET claim_status = 'validated', decided_at = NULL
WHERE id = ${sqlValue(claimId)}
  AND claim_status = 'candidate';`.trim(),
    `
UPDATE claims
SET claim_status = 'accepted', decided_at = ${sqlValue(checkedAt)}
WHERE id = ${sqlValue(claimId)}
  AND claim_status = 'validated'
  AND NOT EXISTS (
    SELECT 1
    FROM canonical_fields canonical
    WHERE canonical.subject_record_id = ${sqlValue(dependency.spec.recordId)}
      AND canonical.field_path = ${sqlValue(fact.fieldPath)}
      AND canonical.locale = ${sqlValue(fact.locale)}
      AND canonical.field_status = 'accepted'
      AND canonical.verified_at > ${sqlValue(checkedAt)}
  );`.trim(),
    `
INSERT INTO canonical_fields (
  subject_record_id, field_path, locale, field_status,
  claim_id, value_json, verified_at, review_after, updated_at
)
SELECT
  ${sqlValue(dependency.spec.recordId)}, ${sqlValue(fact.fieldPath)},
  ${sqlValue(fact.locale)}, 'accepted', ${sqlValue(claimId)},
  ${sqlValue(stableJson(fact.value))}, ${sqlValue(checkedAt)},
  ${sqlValue(fact.reviewAfter)}, ${sqlValue(checkedAt)}
FROM claims
WHERE id = ${sqlValue(claimId)} AND claim_status = 'accepted'
ON CONFLICT(subject_record_id, field_path, locale) DO UPDATE SET
  field_status = 'accepted',
  claim_id = excluded.claim_id,
  value_json = excluded.value_json,
  verified_at = excluded.verified_at,
  review_after = excluded.review_after,
  updated_at = excluded.updated_at
WHERE canonical_fields.verified_at <= excluded.verified_at;`.trim(),
    `
UPDATE claims
SET claim_status = 'superseded', decided_at = ${sqlValue(checkedAt)}
WHERE subject_record_id = ${sqlValue(dependency.spec.recordId)}
  AND field_path = ${sqlValue(fact.fieldPath)}
  AND locale = ${sqlValue(fact.locale)}
  AND claim_status = 'accepted'
  AND id <> ${sqlValue(claimId)}
  AND EXISTS (
    SELECT 1
    FROM canonical_fields canonical
    WHERE canonical.subject_record_id = ${sqlValue(dependency.spec.recordId)}
      AND canonical.field_path = ${sqlValue(fact.fieldPath)}
      AND canonical.locale = ${sqlValue(fact.locale)}
      AND canonical.claim_id = ${sqlValue(claimId)}
  );`.trim(),
    `
UPDATE claims
SET claim_status = 'superseded', decided_at = ${sqlValue(checkedAt)}
WHERE id = ${sqlValue(claimId)}
  AND claim_status = 'validated'
  AND EXISTS (
    SELECT 1
    FROM canonical_fields canonical
    WHERE canonical.subject_record_id = ${sqlValue(dependency.spec.recordId)}
      AND canonical.field_path = ${sqlValue(fact.fieldPath)}
      AND canonical.locale = ${sqlValue(fact.locale)}
      AND canonical.field_status = 'accepted'
      AND canonical.claim_id <> ${sqlValue(claimId)}
      AND canonical.verified_at > ${sqlValue(checkedAt)}
  );`.trim(),
  ]
}

function canonicalGuardStatements(dependency: PreparedDependency): string[] {
  const facts = factsFor(dependency)
  const guardId = `guard-${sha256([
    OFFICIAL_DEPENDENCY_MATERIALIZER_VERSION,
    'canonical',
    dependency.spec.recordId,
    dependency.outputArtifact.fetchId,
  ].join('\u0000')).slice(0, 32)}`
  const factPredicate = facts.map((fact) => (
    `(canonical.field_path = ${sqlValue(fact.fieldPath)}
      AND canonical.locale = ${sqlValue(fact.locale)})`
  )).join(' OR ')
  return [
    `
INSERT INTO audit_log (
  id, occurred_at, actor_type, actor_id, action,
  subject_type, subject_id, detail
) VALUES (
  ${sqlValue(guardId)}, ${sqlValue(dependency.outputArtifact.capturedAt)},
  CASE WHEN (
    SELECT COUNT(*)
    FROM canonical_fields canonical
    JOIN claims claim ON claim.id = canonical.claim_id
    JOIN claim_evidence evidence
      ON evidence.claim_id = claim.id
     AND evidence.evidence_role = 'primary'
    JOIN source_fragments fragment
      ON fragment.id = evidence.fragment_id
     AND fragment.fetch_id = ${sqlValue(dependency.outputArtifact.fetchId)}
    JOIN source_fetches fetch
      ON fetch.id = fragment.fetch_id
     AND fetch.status = 'succeeded'
     AND fetch.sha256 = ${sqlValue(dependency.outputArtifact.artifactSha256)}
     AND fetch.artifact_uri = ${sqlValue(dependency.outputArtifact.artifactUri)}
    JOIN source_documents source
      ON source.id = fetch.source_id
     AND source.id = ${sqlValue(dependency.outputArtifact.sourceId)}
     AND source.official = 1
     AND source.authority_level = 'primary_official'
    WHERE canonical.subject_record_id = ${sqlValue(dependency.spec.recordId)}
      AND canonical.field_status = 'accepted'
      AND claim.claim_status = 'accepted'
      AND claim.extractor_version =
        ${sqlValue(OFFICIAL_DEPENDENCY_MATERIALIZER_VERSION)}
      AND (${factPredicate})
  ) = ${facts.length}
  THEN 'system' ELSE 'dependency_canonicalization_incomplete' END,
  ${sqlValue(OFFICIAL_DEPENDENCY_MATERIALIZER_VERSION)},
  'dependency_canonical_guard', ${sqlValue(dependency.spec.recordKind)},
  ${sqlValue(dependency.spec.recordId)},
  'Every canonical dependency field requires current-batch primary evidence'
);`.trim(),
    `DELETE FROM audit_log WHERE id = ${sqlValue(guardId)};`,
  ]
}

function recordUpdateStatements(
  dependency: PreparedDependency,
  generatedAt: string,
): string[] {
  const statements = [localizedStatement(dependency, generatedAt)]
  if (
    dependency.spec.recordKind === 'organization'
    && dependency.spec.canonicalOfficialUrl
  ) {
    statements.push(`
UPDATE organizations
SET official_url = ${sqlValue(dependency.spec.canonicalOfficialUrl)}
WHERE record_id = ${sqlValue(dependency.spec.recordId)};`.trim())
  }
  return statements
}


export function buildOfficialDependencyMaterialization(
  input: unknown,
  options: OfficialDependencyMaterializationOptions,
): OfficialDependencyMaterializationArtifacts {
  const prepared = normalizePriorityManifest(input, options)
  const generatedAt = prepared
    .map((dependency) => dependency.outputArtifact.capturedAt)
    .sort((left, right) => left.localeCompare(right, 'en'))
    .at(-1)!
  const batchId = sha256(stableJson({
    materializerVersion: OFFICIAL_DEPENDENCY_MATERIALIZER_VERSION,
    dependencies: prepared.map((dependency) => ({
      dependencyId: dependency.spec.dependencyId,
      recordId: dependency.spec.recordId,
      recordKind: dependency.spec.recordKind,
      sourceId: dependency.outputArtifact.sourceId,
      fetchId: dependency.outputArtifact.fetchId,
      artifactSha256: dependency.outputArtifact.artifactSha256,
      artifactUri: dependency.outputArtifact.artifactUri,
      capturedAt: dependency.outputArtifact.capturedAt,
      evidenceQuote: dependency.evidenceQuote,
      evidenceLocator: dependency.evidenceLocator,
    })),
  }))
  const statements = [
    '-- Generated by scripts/ingestion/materialize-official-dependencies.ts. Do not edit.',
    '-- Canonicalizes ten existing bootstrap dependencies; creates no entity or cycle.',
    '-- Batch reservation, evidence binding, validation, and apply are owned by the strict importer.',
    'PRAGMA foreign_keys = ON;',
  ]
  for (const dependency of prepared) {
    statements.push(...guardStatements(dependency, generatedAt))
  }
  statements.push(...fieldDefinitionStatements())
  for (const dependency of prepared) {
    statements.push(...sourceGuardStatements(dependency))
    statements.push(...sourceStatements(dependency, generatedAt))
    statements.push(...fetchGuardStatements(dependency))
    statements.push(fetchStatement(dependency))
    statements.push(fragmentStatement(dependency))
  }
  for (const dependency of prepared) {
    statements.push(...recordUpdateStatements(dependency, generatedAt))
    for (const fact of factsFor(dependency)) {
      statements.push(...claimStatements(dependency, fact))
    }
    statements.push(...canonicalGuardStatements(dependency))
  }
  statements.push('PRAGMA optimize;')
  const maxSqlStatementBytes = Math.max(
    ...statements.map((statement) => Buffer.byteLength(statement, 'utf8')),
  )
  if (maxSqlStatementBytes >= MAX_SQL_STATEMENT_BYTES) {
    throw new Error(
      `generated SQL statement is ${maxSqlStatementBytes} bytes; limit is below ${MAX_SQL_STATEMENT_BYTES}`,
    )
  }
  const sql = `${statements.join('\n')}\n`
  const organizations = prepared.filter(
    (dependency) => dependency.spec.recordKind === 'organization',
  ).length
  const locations = prepared.filter(
    (dependency) => dependency.spec.recordKind === 'location',
  ).length
  const claimCount = prepared.reduce(
    (total, dependency) => total + factsFor(dependency).length,
    0,
  )
  if (
    prepared.length !== 10
    || organizations !== 6
    || locations !== 4
    || claimCount !== 16
  ) {
    throw new Error('dependency materialization allowlist cardinality changed unexpectedly')
  }
  return {
    sql,
    manifest: {
      format: 'studyinchina.pipeline.materialization',
      formatVersion: 1,
      materializerVersion: OFFICIAL_DEPENDENCY_MATERIALIZER_VERSION,
      batchId,
      batchPurpose: 'dependencies',
      provenanceStatus: 'complete',
      requiredSourceArtifacts: 10,
      sourceArtifacts: prepared.map((dependency) => dependency.outputArtifact),
      recordMappings: prepared
        .map((dependency) => ({
          recordId: dependency.spec.recordId,
          recordKind: dependency.spec.recordKind,
        }))
        .sort((left, right) => left.recordId.localeCompare(right.recordId, 'en')),
      generatedAt,
      contentSha256: sha256(sql),
      sqlStatements: statements.length,
      maxSqlStatementBytes,
      counts: {
        records: 10,
        recordSlugs: 0,
        programs: 0,
        scholarships: 0,
        organizations: 6,
        locations: 4,
        localizedContent: 10,
        sourceDocuments: 10,
        sourceFetches: 10,
        sourceFragments: 10,
        claimEvidence: 16,
        claims: 16,
        canonicalFields: 16,
        programCycles: 0,
        scholarshipCycles: 0,
      },
    },
  }
}

function argument(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

function help(): string {
  return [
    'Usage: npx tsx scripts/ingestion/materialize-official-dependencies.ts [options]',
    '',
    'Options:',
    '  --provenance-manifest <path>  Passed priority harvest run-manifest.json',
    '  --output <dir>                Output directory (default .pipeline-build/dependencies)',
    '  --remote-contract             Reject fixture/test paths before generating SQL',
    '  --help                        Show this help',
  ].join('\n')
}

function main(): void {
  const args = process.argv.slice(2)
  if (args.includes('--help')) {
    process.stdout.write(`${help()}\n`)
    return
  }
  const provenanceArgument = argument(args, '--provenance-manifest')
  if (!provenanceArgument) {
    throw new Error('--provenance-manifest is required; no live artifacts means no dependency batch')
  }
  const provenanceManifestPath = resolve(provenanceArgument)
  const outputDirectory = resolve(
    argument(args, '--output') ?? '.pipeline-build/dependencies',
  )
  const input = JSON.parse(readFileSync(provenanceManifestPath, 'utf8')) as unknown
  const artifacts = buildOfficialDependencyMaterialization(input, {
    manifestPath: provenanceManifestPath,
    remote: args.includes('--remote-contract'),
  })
  const basename =
    `official-dependencies-${artifacts.manifest.contentSha256.slice(0, 12)}`
  const sqlPath = resolve(outputDirectory, `${basename}.sql`)
  const manifestPath = resolve(outputDirectory, `${basename}.manifest.json`)
  mkdirSync(outputDirectory, { recursive: true })
  writeFileSync(sqlPath, artifacts.sql, 'utf8')
  writeFileSync(manifestPath, `${JSON.stringify({
    ...artifacts.manifest,
    inputPaths: [provenanceManifestPath],
    inputPath: provenanceManifestPath,
    provenanceManifestPath,
    sqlPath,
  }, null, 2)}\n`, 'utf8')
  process.stdout.write(`${manifestPath}\n`)
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : ''
if (import.meta.url === invokedPath) {
  try {
    main()
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
