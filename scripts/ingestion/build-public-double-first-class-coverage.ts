import {
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

type JsonRecord = Record<string, unknown>

type Target = {
  targetId: string
  ordinal: number
  officialNameZh: string
  catalogInstitutionId?: string
}

type Source = {
  targetId: string
  institutionId: string
  institutionNameEn: string
  institutionNameZh: string
  region: string
  province: string
  sourceCategory:
    | 'international_admissions_home'
    | 'catalog_anchor'
    | 'university_scholarship'
  officialUrl: string
  verificationMethod: string
}

const REQUIRED_CATEGORIES = [
  'international_admissions_home',
  'catalog_anchor',
  'university_scholarship',
] as const

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const targetPath = join(
  rootDirectory,
  'content',
  'source-manifests',
  'double-first-class',
  'targets.v1.json',
)
const cohortDirectory = join(
  rootDirectory,
  'content',
  'source-registry',
  'cohorts',
)
const outputPath = join(
  rootDirectory,
  'src',
  'data',
  'generated',
  'double-first-class-coverage.json',
)

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as JsonRecord
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value.trim()
}

function readJson(path: string): JsonRecord {
  return record(JSON.parse(readFileSync(path, 'utf8')) as unknown, path)
}

export function buildPublicDoubleFirstClassCoverage(): JsonRecord {
  const registry = readJson(targetPath)
  const targets = registry.targets as Target[]
  if (!Array.isArray(targets) || targets.length !== 147) {
    throw new Error('Double First-Class target registry must contain exactly 147 institutions')
  }
  const officialSource = record(registry.officialSource, 'registry.officialSource')
  const sourcesByName = new Map<string, { checkedAt: string; sources: Source[] }>()
  const sourceIds = new Set<string>()
  for (const fileName of readdirSync(cohortDirectory)
    .filter((name) => name.endsWith('.official-sources.v1.json'))
    .sort((left, right) => left.localeCompare(right, 'en'))) {
    const cohort = readJson(join(cohortDirectory, fileName))
    const checkedAt = nonEmptyString(cohort.checkedAt, `${fileName}.checkedAt`)
    if (!Array.isArray(cohort.sources)) throw new Error(`${fileName}.sources must be an array`)
    for (const [index, rawSource] of cohort.sources.entries()) {
      const source = record(rawSource, `${fileName}.sources[${index}]`) as Source
      const sourceId = nonEmptyString(source.targetId, `${fileName}.sources[${index}].targetId`)
      if (sourceIds.has(sourceId)) throw new Error(`Duplicate source target ID ${sourceId}`)
      sourceIds.add(sourceId)
      const nameZh = nonEmptyString(
        source.institutionNameZh,
        `${fileName}.sources[${index}].institutionNameZh`,
      )
      const current = sourcesByName.get(nameZh) ?? { checkedAt, sources: [] }
      if (current.checkedAt !== checkedAt) {
        throw new Error(`${nameZh} has conflicting source check dates`)
      }
      current.sources.push(source)
      sourcesByName.set(nameZh, current)
    }
  }
  const targetNames = new Set(targets.map((target) => target.officialNameZh))
  for (const name of sourcesByName.keys()) {
    if (!targetNames.has(name)) throw new Error(`${name} is not in the official 147-school registry`)
  }
  const institutions = [...targets]
    .sort((left, right) => left.ordinal - right.ordinal)
    .map((target) => {
      const coverage = sourcesByName.get(target.officialNameZh)
      const sources = [...(coverage?.sources ?? [])].sort((left, right) => (
        REQUIRED_CATEGORIES.indexOf(left.sourceCategory)
        - REQUIRED_CATEGORIES.indexOf(right.sourceCategory)
      ))
      const categorySet = new Set(sources.map((source) => source.sourceCategory))
      if (
        sources.length !== 0
        && (
          sources.length !== REQUIRED_CATEGORIES.length
          || REQUIRED_CATEGORIES.some((category) => !categorySet.has(category))
        )
      ) {
        throw new Error(`${target.officialNameZh} does not have exactly the three required sources`)
      }
      const identity = sources[0]
      if (sources.some((source) => (
        source.institutionId !== identity?.institutionId
        || source.institutionNameEn !== identity?.institutionNameEn
        || source.region !== identity?.region
        || source.province !== identity?.province
      ))) {
        throw new Error(`${target.officialNameZh} has conflicting source identity metadata`)
      }
      return {
        ordinal: target.ordinal,
        targetId: target.targetId,
        institutionId: identity?.institutionId ?? target.catalogInstitutionId ?? null,
        nameZh: target.officialNameZh,
        nameEn: identity?.institutionNameEn ?? null,
        region: identity?.region ?? null,
        province: identity?.province ?? null,
        status: sources.length === REQUIRED_CATEGORIES.length
          ? 'source_manifest_complete'
          : 'collecting',
        checkedAt: coverage?.checkedAt ?? null,
        sourceCount: sources.length,
        sources: sources.map((source) => ({
          category: source.sourceCategory,
          officialUrl: source.officialUrl,
          verificationMethod: source.verificationMethod,
        })),
      }
    })
  const verifiedInstitutionCount = institutions.filter(
    (institution) => institution.status === 'source_manifest_complete',
  ).length
  const checkedDates = institutions
    .map((institution) => institution.checkedAt)
    .filter((value): value is string => value !== null)
    .sort()
  return {
    format: 'studyinchina.public-double-first-class-coverage',
    formatVersion: 1,
    generatedAt: `${checkedDates.at(-1) ?? officialSource.checkedAt}T00:00:00.000Z`,
    officialRegistry: {
      titleZh: officialSource.titleZh,
      pageUrl: officialSource.pageUrl,
      attachmentUrl: officialSource.attachmentUrl,
      publishedAt: officialSource.publishedAt,
      checkedAt: officialSource.checkedAt,
    },
    totals: {
      institutionTargets: institutions.length,
      sourceManifestComplete: verifiedInstitutionCount,
      collecting: institutions.length - verifiedInstitutionCount,
      verifiedOfficialSources: institutions.reduce(
        (total, institution) => total + institution.sourceCount,
        0,
      ),
    },
    institutions,
  }
}

export function writePublicDoubleFirstClassCoverage(): JsonRecord {
  const output = buildPublicDoubleFirstClassCoverage()
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
  return output
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) {
  const output = writePublicDoubleFirstClassCoverage()
  process.stdout.write(`${JSON.stringify({
    outputPath,
    totals: output.totals,
  })}\n`)
}
