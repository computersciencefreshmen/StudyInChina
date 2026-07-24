import { createHash } from 'node:crypto'
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  TSINGHUA_CATALOG_QUERY_URL,
  TSINGHUA_DOCTORATE_CATALOG_URL,
  TSINGHUA_MASTER_CATALOG_URL,
  harvestTsinghuaCatalog,
  type TsinghuaDegreeLevel,
} from './tsinghua-catalog-harvester'
import {
  harvestZjuPdfCatalog,
  type ZjuDegreeLevel,
  type ZjuInstructionLanguage,
} from './zju-pdf-catalog-harvester'
import {
  harvestPkuCatalogDirectory,
  parsePkuCatalogIndexHtml,
} from './pku-pdf-catalog-harvester'
import {
  DEFAULT_SCHOLARSHIP_INDEX_SOURCES,
  SCHOLARSHIP_HARVESTER_USER_AGENT,
  harvestScholarshipIndexes,
  type ScholarshipEntity,
  type ScholarshipIndexHarvest,
  type ScholarshipIndexSource,
  type ScholarshipSourceHarvest,
} from './scholarship-index-harvester'
import { isRobotsPathAllowed } from '../../workers/ingestion/src/robots'

export const MINIMUM_DOMAIN_INTERVAL_MS = 5_000
export const DEFAULT_MAX_HARVEST_ATTEMPTS = 3
export const PRIORITY_HARVEST_THRESHOLDS = {
  programs: 1_006,
  scholarships: 55,
  sourceArtifacts: 54,
} as const

const MAX_HTML_BYTES = 10 * 1024 * 1024
const MAX_PDF_BYTES = 80 * 1024 * 1024
const MAX_REDIRECTS = 5
const RUN_MANIFEST_FORMAT = 'studyinchina.priority-official-harvest'
const HASH_STATE_FORMAT = 'studyinchina.official-source-hashes'
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const PKU_INSTITUTION_ID = 'uni-peking-university'
const ZJU_INSTITUTION_ID = 'uni-zhejiang-university'
const USER_AGENT = SCHOLARSHIP_HARVESTER_USER_AGENT

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>
type Sleep = (milliseconds: number) => Promise<void>
type SourceKind = 'tsinghua_catalog' | 'zju_pdf' | 'pku_pdf_directory'
  | 'scholarship_index' | 'dependency'
export type HarvestSourceStatus = 'verified' | 'quarantined' | 'failed'
export type ContentState = 'changed' | 'unchanged' | 'mixed' | 'unknown'

export type SourceArtifactProvenance = {
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
}

export type RegisteredAsset = SourceArtifactProvenance & {
  assetId: string
  unchanged: boolean
}

export type MaterializationSourceArtifact = RegisteredAsset & {
  sourceId: string
  fetchId: string
  artifactSha256: string
  artifactUri: string
  capturedAt: string
  isFixture: false
  captureMode: 'live'
  provenanceStatus: 'complete'
}


export type DependencySourceArtifact = RegisteredAsset & {
  dependencyId: string
  role: 'dependency'
  batchScope: 'dependency'
}
export type HarvestSourceRun = {
  sourceId: string
  kind: SourceKind
  required: boolean
  officialUrls: string[]
  status: HarvestSourceStatus
  contentState: ContentState
  verified: number
  quarantined: number
  sourceArtifacts: RegisteredAsset[]
  primaryEvidenceOfficialUrls?: string[]
  harvestPath: string | null
  error: string | null
}

export type HarvestGate = {
  passed: boolean
  reasons: string[]
  requiredFailures: string[]
}

export type PriorityHarvestRunManifest = {
  format: typeof RUN_MANIFEST_FORMAT
  formatVersion: 2
  startedAt: string
  completedAt: string
  checkedAt: string
  aiUsed: false
  policy: {
    officialHttpsOnly: true
    serialRequests: true
    minimumDomainIntervalMs: number
    maxAttempts: number
    robotsEnforced: true
  }
  thresholds: {
    programs: number
    scholarships: number
    sourceArtifacts: number
  }
  totals: {
    sourceArtifacts: number
    projects: number
    scholarships: number
    verified: number
    quarantined: number
    sources: number
    verifiedSources: number
    dependencies: number
  }
  sources: HarvestSourceRun[]
  gate: HarvestGate
  provenanceStatus: 'complete' | 'incomplete'
  sourceArtifacts: MaterializationSourceArtifact[]
  dependencyArtifacts: DependencySourceArtifact[]
  status: 'passed' | 'failed'
}

export type TsinghuaSourceConfig = {
  id: string
  degreeLevel: TsinghuaDegreeLevel
  officialUrl: string
  allowedHosts: readonly string[]
  expectedVerifiedCount: number
}

export type ZjuPdfSourceConfig = {
  id: string
  degreeLevel: ZjuDegreeLevel
  instructionLanguage: ZjuInstructionLanguage
  officialUrl: string
  allowedHosts: readonly string[]
  auditedVerifiedCount: number
}

export type DependencySourceConfig = {
  id: string
  role: 'dependency'
  officialUrl: string
  allowedHosts: readonly string[]
}

export const TSINGHUA_PRIORITY_SOURCES: readonly TsinghuaSourceConfig[] = [
  {
    id: 'tsinghua-master-catalog',
    degreeLevel: 'master',
    officialUrl: TSINGHUA_MASTER_CATALOG_URL,
    allowedHosts: ['yzbm.tsinghua.edu.cn'],
    expectedVerifiedCount: 99,
  },
  {
    id: 'tsinghua-doctorate-catalog',
    degreeLevel: 'doctorate',
    officialUrl: TSINGHUA_DOCTORATE_CATALOG_URL,
    allowedHosts: ['yzbm.tsinghua.edu.cn'],
    expectedVerifiedCount: 118,
  },
] as const

export const ZJU_PRIORITY_PDF_SOURCES: readonly ZjuPdfSourceConfig[] = [
  {
    id: 'zju-bachelor-chinese-2026',
    degreeLevel: 'bachelor',
    instructionLanguage: 'Chinese',
    officialUrl: 'https://iczu.zju.edu.cn/_upload/article/files/e7/8c/1be7b2df433fb9427df707571d84/3300a725-ca29-443b-845f-8c1a3c15c929.pdf',
    allowedHosts: ['iczu.zju.edu.cn'],
    auditedVerifiedCount: 80,
  },
  {
    id: 'zju-bachelor-english-2026',
    degreeLevel: 'bachelor',
    instructionLanguage: 'English',
    officialUrl: 'https://iczu.zju.edu.cn/_upload/article/files/e7/8c/1be7b2df433fb9427df707571d84/f8f1cb33-05a5-4fec-a602-3eac6caf8e14.pdf',
    allowedHosts: ['iczu.zju.edu.cn'],
    auditedVerifiedCount: 4,
  },
  {
    id: 'zju-master-chinese-2026',
    degreeLevel: 'master',
    instructionLanguage: 'Chinese',
    officialUrl: 'https://iczu.zju.edu.cn/_upload/article/files/32/c1/d48dfe1349279755c872b98ce7e1/d465a621-a100-4371-b988-bf55b6704763.pdf',
    allowedHosts: ['iczu.zju.edu.cn'],
    auditedVerifiedCount: 209,
  },
  {
    id: 'zju-master-english-2026',
    degreeLevel: 'master',
    instructionLanguage: 'English',
    officialUrl: 'https://iczu.zju.edu.cn/_upload/article/files/32/c1/d48dfe1349279755c872b98ce7e1/aae5a919-1f07-4115-bb1c-db41ea36e1b0.pdf',
    allowedHosts: ['iczu.zju.edu.cn'],
    auditedVerifiedCount: 59,
  },
  {
    id: 'zju-doctorate-chinese-2026',
    degreeLevel: 'doctorate',
    instructionLanguage: 'Chinese',
    officialUrl: 'https://iczu.zju.edu.cn/_upload/article/files/2b/3b/e20929be480ba21faedb2a0198ed/6a99549b-04ed-49a2-a25e-adbee71d7e62.pdf',
    allowedHosts: ['iczu.zju.edu.cn'],
    auditedVerifiedCount: 174,
  },
  {
    id: 'zju-doctorate-english-2026',
    degreeLevel: 'doctorate',
    instructionLanguage: 'English',
    officialUrl: 'https://iczu.zju.edu.cn/_upload/article/files/2b/3b/e20929be480ba21faedb2a0198ed/5dc7d290-ef6f-49f5-8a76-c4e4a1f5c6fa.pdf',
    allowedHosts: ['iczu.zju.edu.cn'],
    auditedVerifiedCount: 86,
  },
] as const

export const PKU_MASTER_CHINESE_2026_SOURCE = {
  id: 'pku-master-chinese-2026',
  institutionId: PKU_INSTITUTION_ID,
  degreeLevel: 'master' as const,
  instructionLanguage: 'Chinese' as const,
  indexUrl: 'https://admission.pku.edu.cn/zsxx/lxszs/lxszyml/2026/ss/zsml_ss_lxs_cn.html',
  allowedHosts: ['admission.pku.edu.cn'] as const,
  expectedDocuments: 36,
  expectedPrograms: 177,
  expectedQuarantinedIndexAnchors: 1,
} as const

export const OFFICIAL_DEPENDENCY_SOURCES: readonly DependencySourceConfig[] = [
  {
    id: 'institution-home-tsinghua',
    role: 'dependency',
    officialUrl: 'https://www.tsinghua.edu.cn/en/',
    allowedHosts: ['www.tsinghua.edu.cn'],
  },
  {
    id: 'institution-home-pku',
    role: 'dependency',
    officialUrl: 'https://english.pku.edu.cn/',
    allowedHosts: ['english.pku.edu.cn'],
  },
  {
    id: 'institution-home-zju',
    role: 'dependency',
    officialUrl: 'https://www.zju.edu.cn/english/',
    allowedHosts: ['www.zju.edu.cn'],
  },
  {
    id: 'institution-home-fudan',
    role: 'dependency',
    officialUrl: 'https://www.fudan.edu.cn/en/',
    allowedHosts: ['www.fudan.edu.cn'],
  },
  {
    id: 'institution-home-sjtu',
    role: 'dependency',
    officialUrl: 'https://en.sjtu.edu.cn/',
    allowedHosts: ['en.sjtu.edu.cn'],
  },
  {
    id: 'institution-home-ustc',
    role: 'dependency',
    officialUrl: 'https://en.ustc.edu.cn/',
    allowedHosts: ['en.ustc.edu.cn'],
  },
  {
    id: 'city-government-beijing',
    role: 'dependency',
    officialUrl: 'https://english.beijing.gov.cn/',
    allowedHosts: ['english.beijing.gov.cn'],
  },
  {
    id: 'city-government-shanghai',
    role: 'dependency',
    officialUrl: 'https://english.shanghai.gov.cn/',
    allowedHosts: ['english.shanghai.gov.cn'],
  },
  {
    id: 'city-government-hangzhou',
    role: 'dependency',
    officialUrl: 'https://eng.hangzhou.gov.cn/index.html',
    allowedHosts: ['eng.hangzhou.gov.cn'],
  },
  {
    id: 'city-hefei-ustc-about',
    role: 'dependency',
    officialUrl: 'https://en.ustc.edu.cn/About.htm',
    allowedHosts: ['en.ustc.edu.cn'],
  },
] as const

export const PRIORITY_OFFICIAL_HARVEST_CONFIG = {
  minimumDomainIntervalMs: MINIMUM_DOMAIN_INTERVAL_MS,
  thresholds: PRIORITY_HARVEST_THRESHOLDS,
  tsinghua: TSINGHUA_PRIORITY_SOURCES,
  zju: ZJU_PRIORITY_PDF_SOURCES,
  pku: PKU_MASTER_CHINESE_2026_SOURCE,
  scholarships: DEFAULT_SCHOLARSHIP_INDEX_SOURCES,
  dependencies: OFFICIAL_DEPENDENCY_SOURCES,
} as const

export function assertRegisteredOfficialUrl(
  value: string | URL,
  allowedHosts: readonly string[],
): URL {
  const url = value instanceof URL ? new URL(value.href) : new URL(value)
  const hosts = new Set(allowedHosts.map((host) => host.trim().toLowerCase()))
  if ([...hosts].some((host) => !host || host.includes('/') || host.includes(':'))) {
    throw new Error('Official host allowlist contains an invalid hostname')
  }
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    (url.port !== '' && url.port !== '443') ||
    !hosts.has(url.hostname.toLowerCase())
  ) {
    throw new Error(`URL is not on the registered official HTTPS host allowlist: ${url.href}`)
  }
  url.hash = ''
  return url
}

export function contentStateOf(assets: readonly RegisteredAsset[]): ContentState {
  if (assets.length === 0) return 'unknown'
  const unchanged = assets.filter((asset) => asset.unchanged).length
  if (unchanged === assets.length) return 'unchanged'
  if (unchanged === 0) return 'changed'
  return 'mixed'
}

export function evaluateSourceCountBaseline(input: {
  sourceId: string
  actual: number
  expected: number
}): { status: 'verified' | 'failed'; error: string | null } {
  if (
    !input.sourceId.trim() ||
    !Number.isInteger(input.actual) ||
    input.actual < 0 ||
    !Number.isInteger(input.expected) ||
    input.expected < 1
  ) {
    throw new Error('Source count baseline requires a source ID and non-negative integer counts')
  }
  if (input.actual === input.expected) return { status: 'verified', error: null }
  return {
    status: 'failed',
    error: `verified_count_mismatch:${input.actual}!=${input.expected}`,
  }
}

export function evaluateHarvestGate(input: {
  sources: readonly HarvestSourceRun[]
  projects: number
  scholarships: number
  sourceArtifacts?: number
  minimumProjects?: number
  minimumScholarships?: number
  expectedSourceArtifacts?: number
}): HarvestGate {
  const minimumProjects = input.minimumProjects ?? PRIORITY_HARVEST_THRESHOLDS.programs
  const minimumScholarships = input.minimumScholarships ?? PRIORITY_HARVEST_THRESHOLDS.scholarships
  const expectedSourceArtifacts = input.expectedSourceArtifacts
    ?? PRIORITY_HARVEST_THRESHOLDS.sourceArtifacts
  const requiredFailures = input.sources
    .filter((source) => source.required && source.status !== 'verified')
    .map((source) => source.sourceId)
    .sort((left, right) => left.localeCompare(right, 'en'))
  const reasons: string[] = []
  if (input.projects < minimumProjects) {
    reasons.push(`projects_below_threshold:${input.projects}<${minimumProjects}`)
  }
  if (input.scholarships < minimumScholarships) {
    reasons.push(`scholarships_below_threshold:${input.scholarships}<${minimumScholarships}`)
  }
  if (input.sourceArtifacts !== undefined && input.sourceArtifacts !== expectedSourceArtifacts) {
    reasons.push(
      `source_artifacts_count_mismatch:${input.sourceArtifacts}!=${expectedSourceArtifacts}`,
    )
  }
  if (requiredFailures.length > 0) {
    reasons.push(`required_sources_failed:${requiredFailures.join(',')}`)
  }
  return { passed: reasons.length === 0, reasons, requiredFailures }
}

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export function materializerSourceId(officialUrl: string): string {
  return `source-document-${sha256(officialUrl).slice(0, 24)}`
}

export function materializerFetchId(sourceId: string, capturedAt: string): string {
  return `fetch-${sha256([sourceId, capturedAt].join('\u0000'))}`
}

function materializationCandidates(source: HarvestSourceRun): RegisteredAsset[] {
  if (source.status !== 'verified') return []
  if (source.kind === 'dependency') return []
  let candidates: RegisteredAsset[]
  if (source.kind === 'tsinghua_catalog') {
    candidates = source.sourceArtifacts.filter((asset) => asset.assetId.endsWith(':source-bundle'))
  } else if (source.kind === 'pku_pdf_directory') {
    candidates = source.sourceArtifacts.filter((asset) => asset.localPath.toLowerCase().endsWith('.pdf'))
  } else {
    candidates = [...source.sourceArtifacts]
  }
  if (source.primaryEvidenceOfficialUrls === undefined) return candidates
  const primaryUrls = new Set(source.primaryEvidenceOfficialUrls)
  return candidates.filter((asset) => primaryUrls.has(asset.officialUrl))
}

export function buildMaterializationSourceArtifacts(
  sources: readonly HarvestSourceRun[],
): MaterializationSourceArtifact[] {
  const artifactsBySourceId = new Map<string, MaterializationSourceArtifact>()
  for (const source of sources) {
    for (const artifact of materializationCandidates(source)) {
      const sourceId = materializerSourceId(artifact.officialUrl)
      if (artifactsBySourceId.has(sourceId)) continue
      const capturedAt = artifact.checkedAt
      artifactsBySourceId.set(sourceId, {
        ...artifact,
        sourceId,
        fetchId: materializerFetchId(sourceId, capturedAt),
        artifactSha256: artifact.sha256,
        artifactUri: `r2://studyinchina-source-snapshots/${artifact.r2Key}`,
        capturedAt,
        isFixture: false,
        captureMode: 'live',
        provenanceStatus: 'complete',
      })
    }
  }
  return [...artifactsBySourceId.values()]
    .sort((left, right) => left.sourceId.localeCompare(right.sourceId, 'en'))
}

export function buildDependencySourceArtifacts(
  sources: readonly HarvestSourceRun[],
): DependencySourceArtifact[] {
  return sources
    .filter((source) => source.kind === 'dependency' && source.status === 'verified')
    .flatMap((source) => source.sourceArtifacts.map((artifact) => ({
      ...artifact,
      dependencyId: source.sourceId,
      role: 'dependency' as const,
      batchScope: 'dependency' as const,
    })))
    .sort((left, right) => left.dependencyId.localeCompare(right.dependencyId, 'en'))
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2_000)
}

function normalizedRelativePath(value: string): string {
  return value.split(sep).join('/')
}

function sourceArtifactExtension(localPath: string, contentType: string): string {
  const pathExtension = extname(localPath).slice(1).toLowerCase()
  if (/^[a-z0-9]{1,12}$/u.test(pathExtension)) return pathExtension
  const normalizedContentType = contentType.split(';', 1)[0]?.trim().toLowerCase()
  if (normalizedContentType === 'application/pdf') return 'pdf'
  if (normalizedContentType === 'application/json') return 'json'
  if (
    normalizedContentType === 'text/html' ||
    normalizedContentType === 'application/xhtml+xml'
  ) return 'html'
  return 'bin'
}

export function buildSourceArtifactR2Key(input: {
  assetId: string
  sha256: string
  localPath: string
  contentType: string
}): string {
  if (!input.assetId.trim() || /[\u0000-\u001f\u007f]/u.test(input.assetId)) {
    throw new Error('Source artifact assetId must be a non-empty stable identifier')
  }
  if (!/^[0-9a-f]{64}$/u.test(input.sha256)) {
    throw new Error('Source artifact SHA-256 must be lowercase hexadecimal')
  }
  const assetNamespace = sha256(input.assetId).slice(0, 24)
  const extension = sourceArtifactExtension(input.localPath, input.contentType)
  return `source-artifacts/${assetNamespace}/${input.sha256}.${extension}`
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500
}

function validateInteger(value: number, label: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}`)
  }
  return value
}
function isPathWithin(parent: string, candidate: string): boolean {
  const value = relative(parent, candidate)
  return value === '' || (
    value !== '..'
    && !value.startsWith(`..${sep}`)
    && !isAbsolute(value)
  )
}

function errorCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code)
    : ''
}

export async function assertSafeHarvestOutputDirectory(
  outputDirectoryValue: string,
  repositoryRootValue = REPOSITORY_ROOT,
): Promise<void> {
  const repositoryRoot = resolve(repositoryRootValue)
  const outputDirectory = resolve(outputDirectoryValue)
  let repositoryStats
  try {
    repositoryStats = await lstat(repositoryRoot)
  } catch (error) {
    throw new Error(`Harvest repository root is unavailable: ${errorMessage(error)}`)
  }
  if (!repositoryStats.isDirectory() || repositoryStats.isSymbolicLink()) {
    throw new Error('Harvest repository root must be a real directory')
  }
  if (!isPathWithin(repositoryRoot, outputDirectory) || outputDirectory === repositoryRoot) {
    throw new Error('Harvest output must be a dedicated directory inside the repository')
  }
  const allowedRoots = [
    resolve(repositoryRoot, '.official-harvest'),
    resolve(repositoryRoot, 'artifacts', 'official-harvest'),
  ]
  if (!allowedRoots.some((root) => isPathWithin(root, outputDirectory))) {
    throw new Error(
      'Harvest output must be under .official-harvest or artifacts/official-harvest',
    )
  }

  const realRepositoryRoot = await realpath(repositoryRoot)
  let current = repositoryRoot
  for (const component of relative(repositoryRoot, outputDirectory).split(sep)) {
    current = join(current, component)
    let stats
    try {
      stats = await lstat(current)
    } catch (error) {
      if (errorCode(error) === 'ENOENT') break
      throw error
    }
    if (stats.isSymbolicLink()) {
      throw new Error(`Harvest output path traverses a symbolic link: ${current}`)
    }
    const realCurrent = await realpath(current)
    if (!isPathWithin(realRepositoryRoot, realCurrent)) {
      throw new Error(`Harvest output path escapes the repository: ${current}`)
    }
  }
}


type HashState = {
  format: typeof HASH_STATE_FORMAT
  formatVersion: 1
  updatedAt: string
  hashes: Record<string, string>
}

class HarvestArtifactStore {
  private readonly previousHashes: Record<string, string>
  private readonly nextHashes: Record<string, string>

  private constructor(
    readonly outputDirectory: string,
    readonly stateFile: string,
    readonly checkedAt: string,
    hashes: Record<string, string>,
  ) {
    this.previousHashes = hashes
    this.nextHashes = { ...hashes }
  }

  static async create(
    outputDirectory: string,
    stateFile: string,
    checkedAt: string,
  ): Promise<HarvestArtifactStore> {
    let hashes: Record<string, string> = {}
    try {
      const parsed = JSON.parse(await readFile(stateFile, 'utf8')) as Partial<HashState>
      if (parsed.format === HASH_STATE_FORMAT && parsed.formatVersion === 1 && parsed.hashes) {
        hashes = Object.fromEntries(
          Object.entries(parsed.hashes).filter((entry) => /^[0-9a-f]{64}$/u.test(entry[1])),
        )
      }
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: unknown }).code)
        : ''
      if (code !== 'ENOENT') throw error
    }
    return new HarvestArtifactStore(outputDirectory, stateFile, checkedAt, hashes)
  }

  async resetOutputDirectory(): Promise<void> {
    await assertSafeHarvestOutputDirectory(this.outputDirectory)
    await rm(this.outputDirectory, { recursive: true, force: true })
    await mkdir(this.outputDirectory, { recursive: true })
  }

  private absolutePath(relativePath: string): string {
    const target = resolve(this.outputDirectory, relativePath)
    const prefix = this.outputDirectory.endsWith(sep) ? this.outputDirectory : `${this.outputDirectory}${sep}`
    if (!target.startsWith(prefix)) throw new Error(`Output path escaped the harvest directory: ${relativePath}`)
    return target
  }

  absoluteArtifactPath(relativePath: string): string {
    return this.absolutePath(relativePath)
  }

  relativeArtifactPath(absolutePath: string): string {
    const value = relative(this.outputDirectory, absolutePath)
    return normalizedRelativePath(value)
  }

  async saveAsset(input: {
    assetId: string
    officialUrl: string
    finalUrl: string
    relativePath: string
    httpStatus: number
    contentType: string
    bytes: Uint8Array
  }): Promise<RegisteredAsset> {
    const hash = sha256(input.bytes)
    const target = this.absolutePath(input.relativePath)
    if (!Number.isInteger(input.httpStatus) || input.httpStatus < 100 || input.httpStatus > 599) {
      throw new Error('Source artifact httpStatus must be an integer from 100 through 599')
    }
    const localPath = normalizedRelativePath(input.relativePath)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, input.bytes)
    const unchanged = this.previousHashes[input.assetId] === hash
    this.nextHashes[input.assetId] = hash
    return {
      assetId: input.assetId,
      officialUrl: input.officialUrl,
      finalUrl: input.finalUrl,
      localPath,
      contentType: input.contentType,
      byteLength: input.bytes.byteLength,
      sha256: hash,
      httpStatus: input.httpStatus,
      checkedAt: this.checkedAt,
      r2Key: buildSourceArtifactR2Key({
        assetId: input.assetId,
        sha256: hash,
        localPath,
        contentType: input.contentType,
      }),
      isFixture: false,
      unchanged,
    }
  }

  async writeJson(relativePath: string, value: unknown): Promise<string> {
    const target = this.absolutePath(relativePath)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    return normalizedRelativePath(relativePath)
  }

  async flushHashState(updatedAt: string): Promise<void> {
    const state: HashState = {
      format: HASH_STATE_FORMAT,
      formatVersion: 1,
      updatedAt,
      hashes: Object.fromEntries(
        Object.entries(this.nextHashes).sort(([left], [right]) => left.localeCompare(right, 'en')),
      ),
    }
    await mkdir(dirname(this.stateFile), { recursive: true })
    const temporary = `${this.stateFile}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    await rm(this.stateFile, { force: true })
    await rename(temporary, this.stateFile)
  }
}

class DomainRequestGate {
  private readonly lastRequestAt = new Map<string, number>()
  private tail: Promise<void> = Promise.resolve()

  constructor(
    private readonly delayMs: number,
    private readonly fetchImpl: FetchLike,
    private readonly sleep: Sleep,
  ) {}

  async fetch(url: URL, init: RequestInit): Promise<Response> {
    let release!: () => void
    const previous = this.tail
    this.tail = new Promise<void>((resolveTail) => { release = resolveTail })
    await previous
    try {
      const last = this.lastRequestAt.get(url.hostname)
      if (last !== undefined) {
        const remaining = this.delayMs - (Date.now() - last)
        if (remaining > 0) await this.sleep(remaining)
      }
      this.lastRequestAt.set(url.hostname, Date.now())
      return await this.fetchImpl(url, init)
    } finally {
      release()
    }
  }
}

type DownloadedAsset = {
  officialUrl: string
  finalUrl: string
  httpStatus: number
  contentType: string
  bytes: Uint8Array
}

class OfficialHttpClient {
  private readonly gate: DomainRequestGate
  private readonly robotsBodies = new Map<string, string | null>()

  constructor(
    private readonly delayMs: number,
    private readonly maxAttempts: number,
    fetchImpl: FetchLike = fetch,
    private readonly sleep: Sleep = (milliseconds) => new Promise((resolveSleep) => {
      setTimeout(resolveSleep, milliseconds)
    }),
  ) {
    this.gate = new DomainRequestGate(delayMs, fetchImpl, this.sleep)
  }

  private async requestOnce(
    value: string | URL,
    allowedHosts: readonly string[],
    init: RequestInit = {},
  ): Promise<Response> {
    const url = assertRegisteredOfficialUrl(value, allowedHosts)
    const headers = new Headers(init.headers)
    if (!headers.has('user-agent')) headers.set('user-agent', USER_AGENT)
    return this.gate.fetch(url, {
      ...init,
      headers,
      redirect: 'manual',
    })
  }

  private async requestFollowingRedirects(
    value: string | URL,
    allowedHosts: readonly string[],
    init: RequestInit = {},
    enforceRobots = true,
  ): Promise<{ response: Response; finalUrl: URL }> {
    let lastError: unknown
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        let current = assertRegisteredOfficialUrl(value, allowedHosts)
        for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
          if (enforceRobots && current.pathname !== '/robots.txt') {
            await this.ensureRobotsAllowed(current, allowedHosts)
          }
          const response = await this.requestOnce(current, allowedHosts, init)
          if ([301, 302, 303, 307, 308].includes(response.status)) {
            if (redirect === MAX_REDIRECTS) throw new Error('Official redirect limit exceeded')
            const location = response.headers.get('location')
            if (!location) throw new Error('Official redirect omitted Location')
            current = assertRegisteredOfficialUrl(new URL(location, current), allowedHosts)
            continue
          }
          if (retryableStatus(response.status)) {
            throw new Error(`Official source returned retryable HTTP ${response.status}`)
          }
          return { response, finalUrl: current }
        }
      } catch (error) {
        lastError = error
      }
      if (attempt < this.maxAttempts) await this.sleep(this.delayMs * attempt)
    }
    throw lastError instanceof Error ? lastError : new Error('Official source request failed')
  }

  private async readBounded(response: Response, maximumBytes: number): Promise<Uint8Array> {
    const declaredLength = Number(response.headers.get('content-length'))
    if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
      throw new Error(`Official response exceeds ${maximumBytes} bytes`)
    }
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength === 0) throw new Error('Official response body is empty')
    if (bytes.byteLength > maximumBytes) {
      throw new Error(`Official response exceeds ${maximumBytes} bytes`)
    }
    return bytes
  }

  private async ensureRobotsAllowed(
    target: URL,
    allowedHosts: readonly string[],
  ): Promise<void> {
    const cacheKey = target.origin
    if (!this.robotsBodies.has(cacheKey)) {
      const robotsUrl = new URL('/robots.txt', target)
      const { response } = await this.requestFollowingRedirects(
        robotsUrl,
        allowedHosts,
        { method: 'GET', headers: { accept: 'text/plain,*/*;q=0.1' } },
        false,
      )
      if (response.status === 404 || response.status === 410) {
        this.robotsBodies.set(cacheKey, null)
      } else if (response.status === 200) {
        const bytes = await this.readBounded(response, 512 * 1024)
        this.robotsBodies.set(cacheKey, new TextDecoder().decode(bytes))
      } else {
        throw new Error(`robots.txt unavailable with HTTP ${response.status}`)
      }
    }
    const robotsBody = this.robotsBodies.get(cacheKey)
    if (robotsBody !== null && robotsBody !== undefined && !isRobotsPathAllowed(
      robotsBody,
      target,
      USER_AGENT,
    )) {
      throw new Error(`robots.txt disallows ${target.pathname}`)
    }
  }

  async download(
    value: string,
    allowedHosts: readonly string[],
    kind: 'html' | 'pdf',
  ): Promise<DownloadedAsset> {
    const requestedUrl = assertRegisteredOfficialUrl(value, allowedHosts).href
    const { response, finalUrl } = await this.requestFollowingRedirects(
      requestedUrl,
      allowedHosts,
      {
        method: 'GET',
        headers: {
          accept: kind === 'pdf'
            ? 'application/pdf,application/octet-stream;q=0.9,*/*;q=0.1'
            : 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1',
        },
      },
    )
    if (!response.ok) throw new Error(`Official source returned HTTP ${response.status}`)
    const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
      || 'application/octet-stream'
    const bytes = await this.readBounded(
      response,
      kind === 'pdf' ? MAX_PDF_BYTES : MAX_HTML_BYTES,
    )
    if (kind === 'pdf') {
      const signature = new TextDecoder('ascii').decode(bytes.slice(0, 5))
      if (signature !== '%PDF-') throw new Error('Official PDF response has no PDF signature')
    }
    return {
      officialUrl: requestedUrl,
      finalUrl: finalUrl.href,
      httpStatus: response.status,
      contentType,
      bytes,
    }
  }

  fetcherFor(
    allowedHosts: readonly string[],
    enforceRobots: boolean,
  ): FetchLike {
    return async (input, init) => {
      const url = input instanceof URL ? input : new URL(input)
      if (enforceRobots && url.pathname !== '/robots.txt') {
        await this.ensureRobotsAllowed(url, allowedHosts)
      }
      return this.requestOnce(url, allowedHosts, init)
    }
  }
}

type CapturedTsinghuaApiResponse = {
  departmentCode: string
  officialUrl: string
  finalUrl: string
  httpStatus: number
  contentType: string
  byteLength: number
  sha256: string
  bodyBase64: string
}

type TsinghuaApiResponseBundle = {
  format: 'studyinchina.tsinghua-source-bundle'
  formatVersion: 1
  catalogUrl: string
  queryUrl: typeof TSINGHUA_CATALOG_QUERY_URL
  checkedAt: string
  isFixture: false
  catalogHtml: {
    officialUrl: string
    finalUrl: string
    httpStatus: number
    contentType: string
    byteLength: number
    sha256: string
    bodyBase64: string
  }
  responses: CapturedTsinghuaApiResponse[]
}

function requestBodyParameters(body: BodyInit | null | undefined): URLSearchParams {
  if (body instanceof URLSearchParams) return body
  if (typeof body === 'string') return new URLSearchParams(body)
  throw new Error('Tsinghua query request body is not URL-encoded')
}

function capturingTsinghuaApiFetcher(input: {
  baseFetcher: FetchLike
  captured: Map<string, CapturedTsinghuaApiResponse>
}): FetchLike {
  return async (requestInput, init) => {
    const requestUrl = requestInput instanceof URL ? requestInput : new URL(requestInput)
    const response = await input.baseFetcher(requestUrl, init)
    const method = (init?.method ?? 'GET').toUpperCase()
    if (
      method !== 'POST' ||
      requestUrl.href !== TSINGHUA_CATALOG_QUERY_URL ||
      !response.ok
    ) return response

    const departmentCode = requestBodyParameters(init?.body).get('yxsdm')?.trim()
    if (!departmentCode) throw new Error('Tsinghua query omitted department code')
    const bytes = new Uint8Array(await response.clone().arrayBuffer())
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_HTML_BYTES) {
      throw new Error('Tsinghua department response is empty or exceeds the byte limit')
    }
    const contentType = response.headers.get('content-type') ?? 'application/json'
    input.captured.set(departmentCode, {
      departmentCode,
      officialUrl: TSINGHUA_CATALOG_QUERY_URL,
      finalUrl: response.url || requestUrl.href,
      httpStatus: response.status,
      contentType,
      byteLength: bytes.byteLength,
      sha256: sha256(bytes),
      bodyBase64: Buffer.from(bytes).toString('base64'),
    })
    return response
  }
}

function capturingHtmlFetcher(input: {
  source: ScholarshipIndexSource
  baseFetcher: FetchLike
  store: HarvestArtifactStore
  captured: RegisteredAsset[]
}): FetchLike {
  return async (requestInput, init) => {
    const requestUrl = requestInput instanceof URL ? requestInput : new URL(requestInput)
    const response = await input.baseFetcher(requestUrl, init)
    const method = (init?.method ?? 'GET').toUpperCase()
    if (!response.ok || method !== 'GET' || requestUrl.pathname === '/robots.txt') return response
    const contentType = response.headers.get('content-type') ?? 'text/html; charset=utf-8'
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_HTML_BYTES) {
      throw new Error('Scholarship source HTML is empty or exceeds the byte limit')
    }
    const asset = await input.store.saveAsset({
      assetId: `${input.source.id}:html`,
      officialUrl: input.source.officialUrl,
      finalUrl: requestUrl.href,
      httpStatus: response.status,
      relativePath: join('raw', 'scholarships', `${input.source.id}.html`),
      contentType,
      bytes,
    })
    input.captured.splice(0, input.captured.length, asset)
    return new Response(bytes, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  }
}

function failedSource(input: {
  sourceId: string
  kind: SourceKind
  officialUrls: string[]
  sourceArtifacts?: RegisteredAsset[]
  harvestPath?: string | null
  error: unknown
}): HarvestSourceRun {
  const sourceArtifacts = input.sourceArtifacts ?? []
  return {
    sourceId: input.sourceId,
    kind: input.kind,
    required: true,
    officialUrls: input.officialUrls,
    status: 'failed',
    contentState: contentStateOf(sourceArtifacts),
    verified: 0,
    quarantined: 0,
    sourceArtifacts,
    harvestPath: input.harvestPath ?? null,
    error: errorMessage(input.error),
  }
}

async function runTsinghuaSources(input: {
  client: OfficialHttpClient
  store: HarvestArtifactStore
  checkedAt: string
  delayMs: number
  maxAttempts: number
}): Promise<{ sources: HarvestSourceRun[]; projects: number }> {
  const sources: HarvestSourceRun[] = []
  let projects = 0
  for (const source of TSINGHUA_PRIORITY_SOURCES) {
    const sourceArtifacts: RegisteredAsset[] = []
    try {
      const downloaded = await input.client.download(source.officialUrl, source.allowedHosts, 'html')
      const asset = await input.store.saveAsset({
        assetId: `${source.id}:html`,
        officialUrl: downloaded.officialUrl,
        finalUrl: downloaded.finalUrl,
        httpStatus: downloaded.httpStatus,
        relativePath: join('raw', 'tsinghua', `${source.id}.html`),
        contentType: downloaded.contentType,
        bytes: downloaded.bytes,
      })
      sourceArtifacts.push(asset)
      const detailHtml = new TextDecoder('utf-8', { fatal: false }).decode(downloaded.bytes)
      const capturedResponses = new Map<string, CapturedTsinghuaApiResponse>()
      const apiFetcher = capturingTsinghuaApiFetcher({
        baseFetcher: input.client.fetcherFor(source.allowedHosts, true),
        captured: capturedResponses,
      })
      const harvest = await harvestTsinghuaCatalog({
        catalogUrl: source.officialUrl,
        degreeLevel: source.degreeLevel,
        checkedAt: input.checkedAt,
        delayMs: input.delayMs,
        maxAttempts: input.maxAttempts,
        detailHtml,
        fetchImpl: apiFetcher,
      })
      if (capturedResponses.size !== harvest.departments.length) {
        throw new Error(
          `Captured Tsinghua responses ${capturedResponses.size} do not match departments ${harvest.departments.length}`,
        )
      }
      const responses = [...capturedResponses.values()]
        .sort((left, right) => left.departmentCode.localeCompare(right.departmentCode, 'en'))
      if (
        responses.length === 0 ||
        responses.some((response) => response.httpStatus !== 200) ||
        responses.some((response) => response.finalUrl !== TSINGHUA_CATALOG_QUERY_URL)
      ) {
        throw new Error('Tsinghua API response bundle has inconsistent endpoint provenance')
      }
      const bundle: TsinghuaApiResponseBundle = {
        format: 'studyinchina.tsinghua-source-bundle',
        formatVersion: 1,
        catalogUrl: source.officialUrl,
        queryUrl: TSINGHUA_CATALOG_QUERY_URL,
        checkedAt: input.checkedAt,
        isFixture: false,
        catalogHtml: {
          officialUrl: downloaded.officialUrl,
          finalUrl: downloaded.finalUrl,
          httpStatus: downloaded.httpStatus,
          contentType: downloaded.contentType,
          byteLength: downloaded.bytes.byteLength,
          sha256: sha256(downloaded.bytes),
          bodyBase64: Buffer.from(downloaded.bytes).toString('base64'),
        },
        responses,
      }
      const bundleBytes = new TextEncoder().encode(`${JSON.stringify(bundle, null, 2)}\n`)
      if (bundleBytes.byteLength > MAX_PDF_BYTES) {
        throw new Error('Tsinghua API response bundle exceeds the byte limit')
      }
      sourceArtifacts.push(await input.store.saveAsset({
        assetId: `${source.id}:source-bundle`,
        officialUrl: downloaded.officialUrl,
        finalUrl: downloaded.finalUrl,
        httpStatus: downloaded.httpStatus,
        relativePath: join(
          'raw',
          'tsinghua',
          `${source.id}-source-bundle.json`,
        ),
        contentType: 'application/json',
        bytes: bundleBytes,
      }))
      const harvestPath = await input.store.writeJson(
        join('harvests', `${source.id}.json`),
        harvest,
      )
      const baseline = evaluateSourceCountBaseline({
        sourceId: source.id,
        actual: harvest.entities.length,
        expected: source.expectedVerifiedCount,
      })
      const status: HarvestSourceStatus = baseline.status
      projects += harvest.entities.length
      sources.push({
        sourceId: source.id,
        kind: 'tsinghua_catalog',
        required: true,
        officialUrls: [source.officialUrl, TSINGHUA_CATALOG_QUERY_URL],
        status,
        contentState: contentStateOf(sourceArtifacts),
        verified: harvest.entities.length,
        quarantined: 0,
        sourceArtifacts,
        primaryEvidenceOfficialUrls: [...new Set(
          harvest.entities.map((entity) => entity.evidence.officialUrl),
        )].sort((left, right) => left.localeCompare(right, 'en')),
        harvestPath,
        error: baseline.error,
      })
    } catch (error) {
      sources.push(failedSource({
        sourceId: source.id,
        kind: 'tsinghua_catalog',
        officialUrls: [source.officialUrl, TSINGHUA_CATALOG_QUERY_URL],
        sourceArtifacts,
        error,
      }))
    }
  }
  return { sources, projects }
}

async function runZjuSources(input: {
  client: OfficialHttpClient
  store: HarvestArtifactStore
  checkedAt: string
  pdftotextPath: string
}): Promise<{ sources: HarvestSourceRun[]; projects: number }> {
  const sources: HarvestSourceRun[] = []
  let projects = 0
  for (const source of ZJU_PRIORITY_PDF_SOURCES) {
    const sourceArtifacts: RegisteredAsset[] = []
    try {
      const downloaded = await input.client.download(source.officialUrl, source.allowedHosts, 'pdf')
      const asset = await input.store.saveAsset({
        assetId: `${source.id}:pdf`,
        officialUrl: downloaded.officialUrl,
        finalUrl: downloaded.finalUrl,
        httpStatus: downloaded.httpStatus,
        relativePath: join('raw', 'zju', `${source.id}.pdf`),
        contentType: downloaded.contentType,
        bytes: downloaded.bytes,
      })
      sourceArtifacts.push(asset)
      const harvest = harvestZjuPdfCatalog({
        pdfPath: input.store.absoluteArtifactPath(asset.localPath),
        officialUrl: source.officialUrl,
        institutionId: ZJU_INSTITUTION_ID,
        checkedAt: input.checkedAt,
        degreeLevel: source.degreeLevel,
        instructionLanguage: source.instructionLanguage,
        pdftotextPath: input.pdftotextPath,
      })
      const harvestPath = await input.store.writeJson(
        join('harvests', `${source.id}.json`),
        harvest,
      )
      const baseline = evaluateSourceCountBaseline({
        sourceId: source.id,
        actual: harvest.entities.length,
        expected: source.auditedVerifiedCount,
      })
      const status: HarvestSourceStatus = baseline.status
      projects += harvest.entities.length
      sources.push({
        sourceId: source.id,
        kind: 'zju_pdf',
        required: true,
        officialUrls: [source.officialUrl],
        status,
        contentState: contentStateOf(sourceArtifacts),
        verified: harvest.entities.length,
        quarantined: harvest.quarantined.length,
        sourceArtifacts,
        primaryEvidenceOfficialUrls: [...new Set(
          harvest.entities.map((entity) => entity.evidence.officialUrl),
        )].sort((left, right) => left.localeCompare(right, 'en')),
        harvestPath,
        error: baseline.error,
      })
    } catch (error) {
      sources.push(failedSource({
        sourceId: source.id,
        kind: 'zju_pdf',
        officialUrls: [source.officialUrl],
        sourceArtifacts,
        error,
      }))
    }
  }
  return { sources, projects }
}

async function runPkuSource(input: {
  client: OfficialHttpClient
  store: HarvestArtifactStore
  checkedAt: string
  pdftotextPath: string
}): Promise<{ source: HarvestSourceRun; projects: number }> {
  const source = PKU_MASTER_CHINESE_2026_SOURCE
  const sourceArtifacts: RegisteredAsset[] = []
  const officialUrls: string[] = [source.indexUrl]
  let harvestPath: string | null = null
  try {
    const indexDownload = await input.client.download(source.indexUrl, source.allowedHosts, 'html')
    const indexAsset = await input.store.saveAsset({
      assetId: `${source.id}:index-html`,
      officialUrl: indexDownload.officialUrl,
      finalUrl: indexDownload.finalUrl,
      httpStatus: indexDownload.httpStatus,
      relativePath: join('raw', 'pku', basename(new URL(source.indexUrl).pathname)),
      contentType: indexDownload.contentType,
      bytes: indexDownload.bytes,
    })
    sourceArtifacts.push(indexAsset)
    const indexHtml = new TextDecoder('utf-8', { fatal: false }).decode(indexDownload.bytes)
    const index = parsePkuCatalogIndexHtml(indexHtml, {
      indexUrl: source.indexUrl,
      degreeLevel: source.degreeLevel,
      instructionLanguage: source.instructionLanguage,
    })
    const structuralIssues: string[] = []
    if (index.documents.length !== source.expectedDocuments) {
      structuralIssues.push(
        `accepted_documents:${index.documents.length}!=${source.expectedDocuments}`,
      )
    }
    if (index.quarantined.length !== source.expectedQuarantinedIndexAnchors) {
      structuralIssues.push(
        `quarantined_index_anchors:${index.quarantined.length}!=${source.expectedQuarantinedIndexAnchors}`,
      )
    }
    const downloadFailures: string[] = []
    for (const document of index.documents) {
      officialUrls.push(document.officialUrl)
      try {
        const downloaded = await input.client.download(
          document.officialUrl,
          source.allowedHosts,
          'pdf',
        )
        sourceArtifacts.push(await input.store.saveAsset({
          assetId: `${source.id}:${document.fileName}`,
          officialUrl: downloaded.officialUrl,
          finalUrl: downloaded.finalUrl,
          httpStatus: downloaded.httpStatus,
          relativePath: join('raw', 'pku', document.fileName),
          contentType: downloaded.contentType,
          bytes: downloaded.bytes,
        }))
      } catch (error) {
        downloadFailures.push(`${document.fileName}:${errorMessage(error)}`)
      }
    }
    const harvest = harvestPkuCatalogDirectory({
      indexHtml,
      pdfDirectory: input.store.absoluteArtifactPath(join('raw', 'pku')),
      indexUrl: source.indexUrl,
      institutionId: source.institutionId,
      degreeLevel: source.degreeLevel,
      instructionLanguage: source.instructionLanguage,
      checkedAt: input.checkedAt,
      pdftotextPath: input.pdftotextPath,
    })
    harvestPath = await input.store.writeJson(join('harvests', `${source.id}.json`), harvest)
    if (downloadFailures.length > 0) structuralIssues.push(...downloadFailures)
    if (harvest.reconciliation.loadedDocuments !== source.expectedDocuments) {
      structuralIssues.push(
        `loaded_documents:${harvest.reconciliation.loadedDocuments}!=${source.expectedDocuments}`,
      )
    }
    if (harvest.reconciliation.missingDocuments > 0) {
      structuralIssues.push(`missing_documents:${harvest.reconciliation.missingDocuments}`)
    }
    if (harvest.reconciliation.quarantinedDocuments > 0) {
      structuralIssues.push(`quarantined_documents:${harvest.reconciliation.quarantinedDocuments}`)
    }
    const baseline = evaluateSourceCountBaseline({
      sourceId: source.id,
      actual: harvest.entities.length,
      expected: source.expectedPrograms,
    })
    if (baseline.error) structuralIssues.push(baseline.error)
    const primaryEvidenceOfficialUrls = [...new Set(
      harvest.entities.map((entity) => entity.evidence.officialUrl),
    )].sort((left, right) => left.localeCompare(right, 'en'))
    const status: HarvestSourceStatus = structuralIssues.length === 0 && harvest.entities.length > 0
      ? 'verified'
      : structuralIssues.length > 0
        ? 'failed'
        : 'quarantined'
    return {
      source: {
        sourceId: source.id,
        kind: 'pku_pdf_directory',
        required: true,
        officialUrls,
        status,
        contentState: contentStateOf(sourceArtifacts),
        verified: harvest.entities.length,
        quarantined: harvest.quarantined.length,
        sourceArtifacts,
        primaryEvidenceOfficialUrls,
        harvestPath,
        error: structuralIssues.length > 0
          ? structuralIssues.join(';').slice(0, 2_000)
          : status === 'quarantined'
            ? 'directory_returned_no_verified_programs'
            : null,
      },
      projects: harvest.entities.length,
    }
  } catch (error) {
    return {
      source: failedSource({
        sourceId: source.id,
        kind: 'pku_pdf_directory',
        officialUrls,
        sourceArtifacts,
        harvestPath,
        error,
      }),
      projects: 0,
    }
  }
}

async function runScholarshipSources(input: {
  client: OfficialHttpClient
  store: HarvestArtifactStore
  checkedAt: string
  delayMs: number
  maxAttempts: number
}): Promise<{ sources: HarvestSourceRun[]; scholarships: number }> {
  const sources: HarvestSourceRun[] = []
  const sourceStatuses: ScholarshipSourceHarvest[] = []
  const uniqueScholarships = new Map<string, ScholarshipEntity>()
  for (const source of DEFAULT_SCHOLARSHIP_INDEX_SOURCES) {
    const sourceArtifacts: RegisteredAsset[] = []
    try {
      const baseFetcher = input.client.fetcherFor(source.allowedHosts, false)
      const harvest = await harvestScholarshipIndexes({
        sources: [source],
        checkedAt: input.checkedAt,
        delayMs: input.delayMs,
        maxAttempts: input.maxAttempts,
        fetchImpl: capturingHtmlFetcher({
          source,
          baseFetcher,
          store: input.store,
          captured: sourceArtifacts,
        }),
      })
      const sourceResult = harvest.sources[0]
      if (!sourceResult || sourceResult.sourceId !== source.id) {
        throw new Error('Scholarship harvester omitted the requested source status')
      }
      sourceStatuses.push(sourceResult)
      for (const entity of harvest.entities) {
        if (!uniqueScholarships.has(entity.entityKey)) {
          uniqueScholarships.set(entity.entityKey, entity)
        }
      }
      const verified = sourceResult.status === 'ok' && sourceArtifacts.length === 1
      sources.push({
        sourceId: source.id,
        kind: 'scholarship_index',
        required: true,
        officialUrls: [source.officialUrl],
        status: verified ? 'verified' : 'failed',
        contentState: contentStateOf(sourceArtifacts),
        verified: harvest.entities.length,
        quarantined: verified ? 0 : 1,
        sourceArtifacts,
        harvestPath: null,
        error: verified
          ? null
          : sourceResult.reason ?? `scholarship_source_status:${sourceResult.status}`,
      })
    } catch (error) {
      const reason = errorMessage(error)
      sourceStatuses.push({
        sourceId: source.id,
        institutionId: source.institutionId,
        officialUrl: source.officialUrl,
        status: 'fetch_failed',
        candidateCount: 0,
        reason,
      })
      sources.push(failedSource({
        sourceId: source.id,
        kind: 'scholarship_index',
        officialUrls: [source.officialUrl],
        sourceArtifacts,
        error: reason,
      }))
    }
  }
  const entities = [...uniqueScholarships.values()]
    .sort((left, right) => left.entityKey.localeCompare(right.entityKey, 'en'))
  const aggregate: ScholarshipIndexHarvest = {
    checkedAt: input.checkedAt,
    sourceMode: 'live',
    requestDelayMs: input.delayMs,
    institutionsCovered: [...new Set(entities.map((entity) => entity.institutionId))].sort(),
    verifiedCandidateCount: entities.length,
    sources: sourceStatuses,
    entities,
  }
  const harvestPath = await input.store.writeJson(
    join('harvests', 'scholarship-indexes.json'),
    aggregate,
  )
  const primaryEvidenceUrls = new Set(
    entities.map((entity) => entity.evidence.officialUrl),
  )
  for (const sourceRun of sources) {
    sourceRun.primaryEvidenceOfficialUrls = sourceRun.sourceArtifacts
      .map((artifact) => artifact.officialUrl)
      .filter((officialUrl) => primaryEvidenceUrls.has(officialUrl))
      .sort((left, right) => left.localeCompare(right, 'en'))
    sourceRun.harvestPath = harvestPath
  }
  return { sources, scholarships: entities.length }
}

async function runDependencySources(input: {
  client: OfficialHttpClient
  store: HarvestArtifactStore
}): Promise<HarvestSourceRun[]> {
  const sources: HarvestSourceRun[] = []
  for (const source of OFFICIAL_DEPENDENCY_SOURCES) {
    const sourceArtifacts: RegisteredAsset[] = []
    try {
      const downloaded = await input.client.download(
        source.officialUrl,
        source.allowedHosts,
        'html',
      )
      const leadingText = new TextDecoder()
        .decode(downloaded.bytes.slice(0, 64 * 1_024))
        .toLowerCase()
      if (!/<(?:!doctype\s+html|html|head|body)\b/u.test(leadingText)) {
        throw new Error('Dependency source response does not contain an HTML document marker')
      }
      sourceArtifacts.push(await input.store.saveAsset({
        assetId: `${source.id}:html`,
        officialUrl: downloaded.officialUrl,
        finalUrl: downloaded.finalUrl,
        httpStatus: downloaded.httpStatus,
        relativePath: join('raw', 'dependencies', `${source.id}.html`),
        contentType: downloaded.contentType,
        bytes: downloaded.bytes,
      }))
      sources.push({
        sourceId: source.id,
        kind: 'dependency',
        required: true,
        officialUrls: [source.officialUrl],
        status: 'verified',
        contentState: contentStateOf(sourceArtifacts),
        verified: 0,
        quarantined: 0,
        sourceArtifacts,
        harvestPath: null,
        error: null,
      })
    } catch (error) {
      sources.push(failedSource({
        sourceId: source.id,
        kind: 'dependency',
        officialUrls: [source.officialUrl],
        sourceArtifacts,
        error,
      }))
    }
  }
  return sources
}

export function validatePriorityHarvestConfig(): void {
  if (TSINGHUA_PRIORITY_SOURCES.length !== 2) {
    throw new Error('Priority harvest must register exactly two Tsinghua catalogs')
  }
  if (ZJU_PRIORITY_PDF_SOURCES.length !== 6) {
    throw new Error('Priority harvest must register exactly six Zhejiang University PDFs')
  }
  if (PKU_MASTER_CHINESE_2026_SOURCE.expectedDocuments !== 36) {
    throw new Error('PKU 2026 Chinese master catalog must reconcile exactly 36 accepted PDFs')
  }
  if (OFFICIAL_DEPENDENCY_SOURCES.length !== 10) {
    throw new Error('Priority harvest must register exactly ten dependency pages')
  }
  const auditedProgramBaseline = TSINGHUA_PRIORITY_SOURCES.reduce(
    (total, source) => total + source.expectedVerifiedCount,
    0,
  ) + ZJU_PRIORITY_PDF_SOURCES.reduce(
    (total, source) => total + source.auditedVerifiedCount,
    0,
  ) + PKU_MASTER_CHINESE_2026_SOURCE.expectedPrograms
  if (auditedProgramBaseline !== PRIORITY_HARVEST_THRESHOLDS.programs) {
    throw new Error('Per-source audited program baselines must equal the global program gate')
  }
  const sourceIds: string[] = []
  for (const source of TSINGHUA_PRIORITY_SOURCES) {
    assertRegisteredOfficialUrl(source.officialUrl, source.allowedHosts)
    sourceIds.push(source.id)
  }
  for (const source of ZJU_PRIORITY_PDF_SOURCES) {
    const url = assertRegisteredOfficialUrl(source.officialUrl, source.allowedHosts)
    if (!url.pathname.toLowerCase().endsWith('.pdf')) {
      throw new Error(`ZJU source is not a PDF: ${source.id}`)
    }
    sourceIds.push(source.id)
  }
  assertRegisteredOfficialUrl(
    PKU_MASTER_CHINESE_2026_SOURCE.indexUrl,
    PKU_MASTER_CHINESE_2026_SOURCE.allowedHosts,
  )
  sourceIds.push(PKU_MASTER_CHINESE_2026_SOURCE.id)
  const scholarshipInstitutions = new Set<string>()
  for (const source of DEFAULT_SCHOLARSHIP_INDEX_SOURCES) {
    assertRegisteredOfficialUrl(source.officialUrl, source.allowedHosts)
    sourceIds.push(source.id)
    scholarshipInstitutions.add(source.institutionId)
  }
  for (const source of OFFICIAL_DEPENDENCY_SOURCES) {
    assertRegisteredOfficialUrl(source.officialUrl, source.allowedHosts)
    sourceIds.push(source.id)
  }
  if (scholarshipInstitutions.size !== 6) {
    throw new Error('Scholarship priority harvest must cover exactly six institutions')
  }
  if (new Set(sourceIds).size !== sourceIds.length) {
    throw new Error('Priority harvest source IDs must be unique')
  }
}

export function buildPriorityHarvestRunManifest(input: {
  startedAt: string
  completedAt: string
  checkedAt: string
  delayMs: number
  maxAttempts: number
  sources: HarvestSourceRun[]
  projects: number
  scholarships: number
}): PriorityHarvestRunManifest {
  const sourceArtifacts = buildMaterializationSourceArtifacts(input.sources)
  const dependencyArtifacts = buildDependencySourceArtifacts(input.sources)
  const gate = evaluateHarvestGate({
    sources: input.sources,
    projects: input.projects,
    scholarships: input.scholarships,
    sourceArtifacts: sourceArtifacts.length,
  })
  const quarantined = input.sources.reduce((total, source) => total + source.quarantined, 0)
  return {
    format: RUN_MANIFEST_FORMAT,
    formatVersion: 2,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    checkedAt: input.checkedAt,
    aiUsed: false,
    policy: {
      officialHttpsOnly: true,
      serialRequests: true,
      minimumDomainIntervalMs: input.delayMs,
      maxAttempts: input.maxAttempts,
      robotsEnforced: true,
    },
    thresholds: { ...PRIORITY_HARVEST_THRESHOLDS },
    totals: {
      projects: input.projects,
      scholarships: input.scholarships,
      verified: input.projects + input.scholarships,
      quarantined,
      sources: input.sources.length,
      verifiedSources: input.sources.filter((source) => source.status === 'verified').length,
      sourceArtifacts: sourceArtifacts.length,
      dependencies: dependencyArtifacts.length,
    },
    provenanceStatus: gate.passed ? 'complete' : 'incomplete',
    sourceArtifacts,
    dependencyArtifacts,
    sources: [...input.sources],
    gate,
    status: gate.passed ? 'passed' : 'failed',
  }
}

export type RunPriorityOfficialHarvestOptions = {
  outputDirectory: string
  stateFile?: string
  checkedAt?: string
  delayMs?: number
  maxAttempts?: number
  pdftotextPath?: string
  fetchImpl?: FetchLike
  sleep?: Sleep
}

export async function runPriorityOfficialHarvest(
  options: RunPriorityOfficialHarvestOptions,
): Promise<{ manifest: PriorityHarvestRunManifest; manifestPath: string }> {
  validatePriorityHarvestConfig()
  const outputDirectory = resolve(options.outputDirectory)
  const stateFile = resolve(options.stateFile ?? join(outputDirectory, 'state', 'source-hashes.json'))
  const checkedAt = new Date(options.checkedAt ?? new Date().toISOString())
  if (Number.isNaN(checkedAt.getTime())) throw new Error('checkedAt must be an ISO timestamp')
  const delayMs = validateInteger(
    options.delayMs ?? MINIMUM_DOMAIN_INTERVAL_MS,
    'delayMs',
    MINIMUM_DOMAIN_INTERVAL_MS,
    60_000,
  )
  const maxAttempts = validateInteger(
    options.maxAttempts ?? DEFAULT_MAX_HARVEST_ATTEMPTS,
    'maxAttempts',
    1,
    5,
  )
  const pdftotextPath = options.pdftotextPath?.trim() || 'pdftotext'
  const startedAt = new Date().toISOString()
  const store = await HarvestArtifactStore.create(
    outputDirectory,
    stateFile,
    checkedAt.toISOString(),
  )
  await store.resetOutputDirectory()
  const client = new OfficialHttpClient(
    delayMs,
    maxAttempts,
    options.fetchImpl,
    options.sleep,
  )

  const tsinghua = await runTsinghuaSources({
    client,
    store,
    checkedAt: checkedAt.toISOString(),
    delayMs,
    maxAttempts,
  })
  const zju = await runZjuSources({
    client,
    store,
    checkedAt: checkedAt.toISOString(),
    pdftotextPath,
  })
  const pku = await runPkuSource({
    client,
    store,
    checkedAt: checkedAt.toISOString(),
    pdftotextPath,
  })
  const scholarships = await runScholarshipSources({
    client,
    store,
    checkedAt: checkedAt.toISOString(),
    delayMs,
    maxAttempts,
  })
  const dependencies = await runDependencySources({
    client,
    store,
  })
  const sources = [
    ...tsinghua.sources,
    ...zju.sources,
    pku.source,
    ...scholarships.sources,
    ...dependencies,
  ]
  const manifest = buildPriorityHarvestRunManifest({
    startedAt,
    completedAt: new Date().toISOString(),
    checkedAt: checkedAt.toISOString(),
    delayMs,
    maxAttempts,
    sources,
    projects: tsinghua.projects + zju.projects + pku.projects,
    scholarships: scholarships.scholarships,
  })
  const manifestRelativePath = await store.writeJson('run-manifest.json', manifest)
  await store.flushHashState(manifest.completedAt)
  return {
    manifest,
    manifestPath: store.absoluteArtifactPath(manifestRelativePath),
  }
}

function argument(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

function integerArgument(
  args: readonly string[],
  name: string,
  fallback: number,
): number {
  const value = argument(args, name)
  if (value === undefined) return fallback
  return Number(value)
}

function help(): string {
  return [
    'Usage: npx tsx scripts/ingestion/run-priority-official-harvest.ts [options]',
    '',
    'Options:',
    '  --output <dir>         Output root (default .official-harvest)',
    '  --state-file <path>    Persistent content-hash state file',
    '  --checked-at <iso>     Shared source check timestamp',
    '  --delay-ms <n>         Per-domain interval, minimum 5000',
    '  --max-attempts <n>     Request attempts, 1-5',
    '  --pdftotext <path>     Poppler pdftotext executable',
    '  --help                 Show this help',
  ].join('\n')
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.includes('--help')) {
    process.stdout.write(`${help()}\n`)
    return
  }
  const outputDirectory = resolve(argument(args, '--output') ?? '.official-harvest')
  const result = await runPriorityOfficialHarvest({
    outputDirectory,
    stateFile: argument(args, '--state-file'),
    checkedAt: argument(args, '--checked-at'),
    delayMs: integerArgument(
      args,
      '--delay-ms',
      MINIMUM_DOMAIN_INTERVAL_MS,
    ),
    maxAttempts: integerArgument(
      args,
      '--max-attempts',
      DEFAULT_MAX_HARVEST_ATTEMPTS,
    ),
    pdftotextPath: argument(args, '--pdftotext'),
  })
  process.stdout.write(`${JSON.stringify({
    manifestPath: result.manifestPath,
    status: result.manifest.status,
    totals: result.manifest.totals,
    gate: result.manifest.gate,
  })}\n`)
  if (!result.manifest.gate.passed) process.exitCode = 1
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) {
  main().catch((error: unknown) => {
    process.stderr.write(`${errorMessage(error)}\n`)
    process.exitCode = 1
  })
}
