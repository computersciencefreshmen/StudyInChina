import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { DataBundle, Source } from '../../src/lib/data/types'
import { bundleSchema } from '../../src/lib/data/schema'
import { loadSourceManifestFiles, validateSourceManifests, type SourceManifestRecord } from '../source-manifest-registry'
import {
  canonicalJson, maintenanceScopeSchema, scopeContentSha256, sha256Text,
  type MaintenanceScope, type SourceSeed,
} from './contracts'

export const FIXED_SCHOOL_COUNT = 272

/** Deliberately covers the raw fixed cohort, including stale/archived public identities. */
export async function buildMaintenanceScope(bundle: DataBundle, options: {
  scopeId: string; createdAt: string; manifests?: SourceManifestRecord[]
}): Promise<MaintenanceScope> {
  if (bundle.universities.length !== FIXED_SCHOOL_COUNT) {
    throw new Error(`Fixed scope requires exactly ${FIXED_SCHOOL_COUNT} raw schools; found ${bundle.universities.length}`)
  }
  const ids = new Set(bundle.universities.map(university => university.id))
  if (ids.size !== FIXED_SCHOOL_COUNT) throw new Error('Fixed scope contains duplicate school IDs')
  const sources = new Map(bundle.sources.map(source => [source.id, source]))
  const schools = bundle.universities.map(university => {
    const hostFamily = (value: string) => {
      const hostname = new URL(value).hostname.toLowerCase().replace(/^www\./u, '')
      return /\.(?:edu|ac)\.cn$/u.test(hostname) ? hostname.split('.').slice(-3).join('.') : hostname
    }
    const officialHosts = [...new Set([university.officialUrl, university.admissionsUrl]
      .filter((url): url is string => Boolean(url)).map(hostFamily))].sort()
    const isSchoolHost = (url: string) => {
      const hostname = new URL(url).hostname.toLowerCase()
      return officialHosts.some(host => hostname === host || hostname.endsWith(`.${host}`))
    }
    const seeds = new Map<string, SourceSeed>()
    const addSeed = (url: string, category: SourceSeed['sourceCategory'], sourceId: string,
      entityType: SourceSeed['entityType'], reviewedOfficial: boolean) => {
      const enabled = reviewedOfficial && isSchoolHost(url)
      const key = `${url}\u0000${category}`
      const existing = seeds.get(key)
      if (existing?.enabled && !enabled) return
      seeds.set(key, {
        id: `maintenance-${university.id}-${createHash('sha256').update(key).digest('hex').slice(0, 20)}`,
        universityId: university.id, url, sourceCategory: category, entityType,
        allowedHosts: enabled ? officialHosts : [new URL(url).hostname], enabled,
        registration: enabled ? 'catalogue_official' : 'candidate',
      })
      // sourceId is deliberately not represented as a claim of a successful current fetch.
      void sourceId
    }
    addSeed(university.officialUrl, 'catalog_anchor', university.id, 'university', true)
    if (university.admissionsUrl) addSeed(university.admissionsUrl, 'international_admissions_home', university.id, 'university', true)
    const sourceCategories = new Map<string, Set<SourceSeed['sourceCategory']>>()
    const reference = (sourceIds: string[], category: SourceSeed['sourceCategory']) => {
      for (const id of sourceIds) {
        const categories = sourceCategories.get(id) ?? new Set()
        categories.add(category); sourceCategories.set(id, categories)
      }
    }
    reference(university.sourceIds, 'international_admissions_home')
    const schoolPrograms = bundle.programs.filter(program => program.universityId === university.id)
    const programIds = new Set(schoolPrograms.map(program => program.id))
    for (const program of schoolPrograms) reference(program.sourceIds, 'program_detail')
    for (const cycle of bundle.admissionCycles.filter(cycle => programIds.has(cycle.programId))) reference(cycle.sourceIds, 'current_guide')
    for (const scholarship of bundle.scholarships.filter(scholarship => scholarship.universityIds.includes(university.id))) {
      reference(scholarship.sourceIds, scholarship.providerType === 'csc' ? 'government_scholarship' : 'university_scholarship')
    }
    for (const [sourceId, categories] of sourceCategories) {
      const source = sources.get(sourceId)
      if (!source) continue
      for (const category of categories) addSeed(source.url, category, source.id,
        category.includes('scholarship') ? 'scholarship' : category === 'current_guide' ? 'program-cycle' : 'program', source.official)
    }
    // Exact declared source categories take precedence over inferred compatibility categories.
    for (const manifest of options.manifests ?? []) {
      if (manifest.institutionId !== university.id) continue
      for (const source of manifest.sources) addSeed(source.officialUrl, source.sourceCategory,
        source.id, source.entityType, source.enabled && isSchoolHost(source.officialUrl))
    }
    return {
      universityId: university.id, name: university.name as Record<string, string>,
      originalStatus: university.status, officialHosts,
      sourceSeeds: [...seeds.values()].sort((left, right) => left.id.localeCompare(right.id)),
    }
  }).sort((left, right) => left.universityId.localeCompare(right.universityId))
  const content = {
    format: 'studyinchina.maintenance-scope' as const, formatVersion: 1 as const,
    scopeId: options.scopeId, createdAt: options.createdAt, expectedSchoolCount: 272 as const,
    inputCatalogSha256: await catalogSha256(bundle), schools,
  }
  return maintenanceScopeSchema.parse({ ...content, sha256: await scopeContentSha256(content) })
}

export function catalogSha256(bundle: DataBundle): Promise<string> {
  return sha256Text(canonicalJson(bundle))
}

export function loadMaintenanceBundle(root: string): DataBundle {
  const read = (name: string) => JSON.parse(readFileSync(join(root, 'content', 'data', `${name}.json`), 'utf8')) as unknown
  return bundleSchema.parse({ sources: read('sources'), cities: read('cities'), universities: read('universities'),
    programs: read('programs'), admissionCycles: read('admission-cycles'), scholarships: read('scholarships') })
}

export function sourceCategoryFor(source: Source): SourceSeed['sourceCategory'] {
  return source.kind === 'scholarship' ? 'university_scholarship'
    : source.kind === 'program' ? 'program_detail' : 'international_admissions_home'
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const argument = (name: string) => args[args.indexOf(name) + 1]
  if (!args.includes('--output') || !args.includes('--scope-id')) {
    throw new Error('Usage: build-scope.ts --scope-id <stable-id> --output <candidate.json> [--root <repository>] [--created-at <ISO timestamp>]')
  }
  const root = resolve(args.includes('--root') ? argument('--root') : process.cwd())
  const manifests = validateSourceManifests(loadSourceManifestFiles(join(root, 'content', 'source-manifests')),
    join(root, 'content', 'data', 'universities.json'))
  const scope = await buildMaintenanceScope(loadMaintenanceBundle(root), {
    scopeId: argument('--scope-id'), createdAt: args.includes('--created-at') ? argument('--created-at') : new Date().toISOString(), manifests,
  })
  const output = resolve(argument('--output'))
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, `${JSON.stringify(scope, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ output, scopeId: scope.scopeId, sha256: scope.sha256, schools: scope.schools.length,
    enabledSourceSeeds: scope.schools.flatMap(school => school.sourceSeeds).filter(seed => seed.enabled).length,
    candidateSourceSeeds: scope.schools.flatMap(school => school.sourceSeeds).filter(seed => !seed.enabled).length }))
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 })
}
