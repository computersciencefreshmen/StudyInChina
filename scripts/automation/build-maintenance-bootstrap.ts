import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join, dirname, relative, isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { DataBundle, Program, AdmissionCycle, Scholarship } from '../../src/lib/data/types'
import { fieldRecordScopeSha256 } from '../../src/lib/data/field-verification'
import { loadMaintenanceBundle, catalogSha256 } from '../maintenance/build-scope'
import { maintenanceScopeSchema, canonicalJson, scopeContentSha256, type MaintenanceScope } from '../maintenance/contracts'
import { maintainedFieldPaths, maintenanceRecordTargetSchema, type MaintenanceRecordTarget } from '../maintenance/field-contracts'

type LegacyGuard = { id: string; universityId: string | null; sourceId: string | null; recordId: string | null; fields: '*' | string[];
  state: 'stop'; artifactSha256: string; reason: string; snapshotSha256?: string | null }
export const bootstrapHash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
function getField(record: unknown, path: string): unknown {
  let value = record
  for (const part of path.split('.')) value = value && typeof value === 'object' && Object.hasOwn(value, part) ? (value as Record<string, unknown>)[part] : undefined
  return value
}
export function buildMaintenanceTargets(bundle: DataBundle, scope: MaintenanceScope): MaintenanceRecordTarget[] {
  const enabledUrls = new Set(scope.schools.flatMap(school => school.sourceSeeds.filter(seed => seed.enabled).map(seed => seed.url)))
  const sourceById = new Map(bundle.sources.filter(source => source.official).map(source => [source.id, source]))
  const targets: MaintenanceRecordTarget[] = []
  const add = (record: Program | AdmissionCycle | Scholarship, entityType: MaintenanceRecordTarget['entityType'], universityId: string | undefined) => {
    if (!universityId || record.status === 'draft' || record.status === 'archived') return
    const school = scope.schools.find(school => school.universityId === universityId)
    if (!school) return
    const disabledUrls = new Set(school.sourceSeeds.filter(seed => !seed.enabled).map(seed => seed.url))
    const urls = [...new Set(record.sourceIds.flatMap(id => {
      const source = sourceById.get(id)
      if (!source) return []
      if (enabledUrls.has(source.url)) return [source.url]
      // A verified import can add a newly discovered page on an already approved
      // school host. Keep it maintainable without widening the fixed school scope
      // or silently activating an explicitly withheld discovery candidate.
      if (!/^src-maintenance-(?:identity|scholarship|field|cycle)-[a-f0-9]{24}$/u.test(id) || disabledUrls.has(source.url)) return []
      try {
        const url = new URL(source.url)
        return url.protocol === 'https:' && !url.username && !url.password && !url.port
          && school.officialHosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`)) ? [source.url] : []
      } catch { return [] }
    }))]
    if (!urls.length) return
    const cycle = entityType === 'admission-cycle' ? record as AdmissionCycle : undefined
    const program = entityType === 'program' ? record as Program : cycle ? bundle.programs.find(row => row.id === cycle.programId) : undefined
    const name = program?.name ?? (record as Scholarship).name
    const years = entityType === 'scholarship' ? [...new Set(Object.values(name).flatMap(text => text?.match(/(?<!\d)20\d{2}(?!\d)/gu) ?? []))] : []
    const labels = Object.values(name).join(' ')
    const intake = cycle?.intake ?? (entityType === 'scholarship' && /spring|春|March|3月/iu.test(labels) ? 'spring'
      : entityType === 'scholarship' && /autumn|fall|秋|September|9月/iu.test(labels) ? 'autumn' : null)
    // Cloud extraction receives field names, not legacy prose to copy as "evidence".
    // Keep small scalars only for scheduling; canonical values remain in Git.
    const fields = Object.fromEntries(maintainedFieldPaths(entityType).flatMap(path => {
      const value = getField(record, path)
      return value === undefined ? [] : [[path, value !== null && typeof value === 'object' ? null : typeof value === 'string' && value.length > 256 ? null : value]]
    }))
    targets.push(maintenanceRecordTargetSchema.parse({ recordId: record.id, entityType, universityId, sourceIds: urls.map(bootstrapHash),
      recordScopeSha256: fieldRecordScopeSha256(entityType === 'admission-cycle' ? 'admissionCycle' : entityType, record),
      identity: { name, ...(program ? { degreeLevel: program.degreeLevel, universityId: program.universityId, ...(cycle ? { programId: program.id } : {}) } : {}) },
      year: cycle?.academicYear ?? (years.length === 1 ? years[0] : null), intake, fields, reviewAfter: record.reviewAfter }))
  }
  for (const program of bundle.programs) add(program, 'program', program.universityId)
  for (const cycle of bundle.admissionCycles) add(cycle, 'admission-cycle', bundle.programs.find(row => row.id === cycle.programId)?.universityId)
  for (const award of bundle.scholarships) {
    // A school-wide relation identifies an owner for maintenance, never programme eligibility.
    add(award, 'scholarship', award.universityIds.find(id => scope.schools.some(school => school.universityId === id)))
  }
  return targets.sort((a, b) => `${a.entityType}:${a.recordId}`.localeCompare(`${b.entityType}:${b.recordId}`))
}

/** Read exact durable reservation artifacts. No credentials, prompts or original claim values are exported. */
export function buildLegacyGuards(legacyRoot: string, bundle: DataBundle): { artifactSha256: string; entries: LegacyGuard[]; inventory: { files: number; attributed: number; globalStops: number } } {
  const entries: LegacyGuard[] = [], artifacts: Array<{ file: string; sha256: string }> = []
  const lookup = new Map<string, Program | AdmissionCycle | Scholarship>([...bundle.programs, ...bundle.admissionCycles, ...bundle.scholarships].map(record => [record.id, record]))
  let attributed = 0, globalStops = 0
  for (const relativeDirectory of ['.tmp/minimax-verification/full-record-request-reservations', '.tmp/minimax-enrichment/request-reservations']) {
    const directory = resolve(legacyRoot, relativeDirectory)
    if (!existsSync(directory)) throw new Error('Legacy reservation directory is missing; do not infer an empty paid history')
    for (const filename of readdirSync(directory).filter(name => /^[a-f0-9]{64}\.json$/u.test(name)).sort()) {
      const bytes = readFileSync(join(directory, filename)), artifactSha256 = bootstrapHash(bytes)
      artifacts.push({ file: `${relativeDirectory}/${filename}`, sha256: artifactSha256 })
      const record = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>, scope = record.scope as Record<string, unknown> | undefined
      const taskId = String(scope?.taskId ?? record.taskId ?? ''), match = /^(?:programs|admission-cycles|scholarships|full-admissions|universities|cities|sources):(.+)$/u.exec(taskId)
      const recordId = match?.[1] ?? null, target = recordId ? lookup.get(recordId) : undefined
      const owner = target && 'universityId' in target ? target.universityId : target && 'programId' in target ? bundle.programs.find(row => row.id === target.programId)?.universityId : target ? target.universityIds[0] : null
      const base = { universityId: owner ?? null, recordId, fields: '*' as const, state: 'stop' as const, artifactSha256, reason: 'Prior admitted semantic scope remains reserved; never replay by changing model, date or prompt.' }
      let oldSources = Array.isArray(scope?.sources) ? scope.sources as Array<Record<string, unknown>> : []
      if (!oldSources.length && !recordId && typeof record.runDirectory === 'string') {
        const run = resolve(legacyRoot, record.runDirectory), inside = relative(resolve(legacyRoot), run)
        if (inside && !inside.startsWith('..') && !isAbsolute(inside)) {
          const sourceDirectory = join(run, 'sources')
          if (existsSync(sourceDirectory)) oldSources = readdirSync(sourceDirectory).filter(name => /^[a-f0-9]{64}\.json$/u.test(name)).flatMap(name => {
            const capturedBytes = readFileSync(join(sourceDirectory, name)), source = JSON.parse(capturedBytes.toString('utf8')) as Record<string, unknown>
            if (source.status !== 'captured' || source.official !== true || typeof source.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(source.sha256) || typeof source.url !== 'string') return []
            artifacts.push({ file: `${inside.replaceAll('\\', '/')}/sources/${name}`, sha256: bootstrapHash(capturedBytes) })
            return [source]
          })
        }
      }
      if (oldSources.length) {
        attributed++
        for (const source of oldSources) for (const url of new Set([source.url, source.finalUrl].filter((value): value is string => typeof value === 'string' && value.length > 0))) {
          const sourceId = bootstrapHash(url), snapshotSha256 = typeof source.sha256 === 'string' && /^[a-f0-9]{64}$/u.test(source.sha256) ? source.sha256 : null
          entries.push({ ...base, id: `legacy-${bootstrapHash(`${artifactSha256}:${sourceId}`)}`, sourceId, snapshotSha256 })
        }
      } else if (recordId) {
        attributed++
        entries.push({ ...base, id: `legacy-${artifactSha256}`, sourceId: null })
      } else {
        globalStops++
        entries.push({ ...base, universityId: null, recordId: null, id: `legacy-${artifactSha256}`, sourceId: null })
      }
    }
  }
  if (!artifacts.length) throw new Error('Legacy reservation history is empty; independent reconciliation is required')
  const unique = [...new Map(entries.map(entry => [entry.id, entry])).values()]
  return { artifactSha256: bootstrapHash(canonicalJson(artifacts)), entries: unique, inventory: { files: artifacts.length, attributed, globalStops } }
}

export async function buildMaintenanceBootstrap(root: string, legacyRoot: string, scopeValue: unknown) {
  const scope = maintenanceScopeSchema.parse(scopeValue), bundle = loadMaintenanceBundle(root)
  if (scope.sha256 !== await scopeContentSha256(scope)) throw new Error('Maintenance scope hash changed')
  const legacy = buildLegacyGuards(legacyRoot, bundle)
  return { scopeRegistrySha256: scope.sha256, inputCatalogSha256: await catalogSha256(bundle), schools: scope.schools,
    legacyGuards: { artifactSha256: legacy.artifactSha256, entries: legacy.entries }, recordTargets: buildMaintenanceTargets(bundle, scope),
    inventory: legacy.inventory }
}
async function main() {
  const args = process.argv.slice(2), value = (name: string) => args[args.indexOf(name) + 1]
  if (!args.includes('--legacy-root') || !args.includes('--output')) throw new Error('Usage: build-maintenance-bootstrap.ts --legacy-root <old-workspace> --output <private-seed.json>')
  const root = process.cwd(), scope = JSON.parse(readFileSync(resolve(root, 'content/maintenance/scope-272.v1.json'), 'utf8'))
  const result = await buildMaintenanceBootstrap(root, value('--legacy-root'), scope), output = resolve(value('--output'))
  if (output.includes(`${join(root, 'content', 'data')}`)) throw new Error('Bootstrap output must not replace public data')
  mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, `${JSON.stringify(result)}\n`, { flag: 'wx' })
  console.log(JSON.stringify({ scopeSha256: result.scopeRegistrySha256, schools: result.schools.length,
    targets: result.recordTargets.length, legacyGuards: result.legacyGuards.entries.length, inventory: result.inventory }))
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { console.error(error instanceof Error ? error.message : 'maintenance_bootstrap_failed'); process.exitCode = 1 })
