import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { bundleSchema } from '../../src/lib/data/schema'
import { selectDiscoveryData } from '../../src/lib/data/discovery'
import { directoryCoverage } from '../../src/lib/data/directory-coverage'
import { getApplicationState } from '../../src/lib/data/admission'
import { getTodayDate, isCurrentVerifiedRecord } from '../../src/lib/data/freshness'
import { readIdentityAcceptances } from '../../src/lib/data/identity-acceptance-store'
import { identityAcceptanceLedgerSchema, type IdentityAcceptance } from '../../src/lib/data/identity-acceptance'
import { readFieldVerifications } from '../../src/lib/data/field-verification-store'
import { fieldVerificationLedgerSchema, type FieldVerification } from '../../src/lib/data/field-verification'
import type { DataBundle } from '../../src/lib/data/types'
import { canonicalJson, maintenanceScopeSchema, scopeContentSha256 } from './contracts'
import { catalogSha256, loadMaintenanceBundle } from './build-scope'

export const CURRENT_PILOT_IDS = ['uni-peking-university', 'uni-tsinghua-university', 'uni-zhejiang-university', 'uni-northwestern-polytechnical-university', 'uni-beijing-language-and-culture-university'] as const
const categoryOrder = ['undergraduate_catalog', 'masters_catalog', 'doctoral_catalog', 'non_degree_catalog', 'program_detail', 'current_guide', 'international_admissions_home', 'catalog_anchor']
const read = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'))
type NationalRegistry = { format?: string; sourceYear?: number; asOf?: string; institutions?: Array<{ educationCategory?: string; catalogueMatch?: { universityId?: string } | null }> }

/** Rank the fixed cohort by actual safe school coverage; source registration is not evidence of completeness. */
export async function buildSchoolExpansionQueue(options: { bundle: DataBundle; scope: unknown; today: string;
  identities?: IdentityAcceptance[]; fields?: FieldVerification[]; excludeUniversityIds?: readonly string[]; nationalRegistry?: unknown; preview?: boolean }) {
  const bundle = bundleSchema.parse(options.bundle), scope = maintenanceScopeSchema.parse(options.scope), today = options.today
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(today) || !Number.isFinite(Date.parse(`${today}T00:00:00Z`)) || new Date(`${today}T00:00:00Z`).toISOString().slice(0, 10) !== today) throw new Error('school_expansion_date_invalid')
  const cohortIds = new Set(scope.schools.map(school => school.universityId))
  if (scope.sha256 !== await scopeContentSha256(scope) || bundle.universities.length !== 272 || cohortIds.size !== 272
    || bundle.universities.some(school => !cohortIds.has(school.id))) throw new Error('school_expansion_fixed_cohort_changed')
  const identities = options.identities ?? [], directory = selectDiscoveryData(bundle, today, identities, options.fields ?? [])
  const safeSchools = new Set(directory.universities.map(school => school.id))
  const opportunityPrograms = new Set(directory.admissionCycles.filter(cycle => ['open', 'upcoming', 'rolling'].includes(getApplicationState(cycle, today))).map(cycle => cycle.programId))
  const excluded = new Set(options.excludeUniversityIds ?? CURRENT_PILOT_IDS)
  const rows = scope.schools.map(school => {
    const rawPrograms = bundle.programs.filter(program => program.universityId === school.universityId)
    const acceptedPrograms = directory.programs.filter(program => program.universityId === school.universityId)
    const rawIds = new Set(rawPrograms.map(program => program.id))
    const sources = new Map<string, { url: string; categories: string[]; priority: number; languageHints: string[]; title: string | null; formatHint: string }>()
    for (const seed of school.sourceSeeds.filter(seed => seed.enabled && seed.registration === 'catalogue_official')) {
      const hostname = new URL(seed.url).hostname
      if (!school.officialHosts.some(host => hostname === host || hostname.endsWith(`.${host}`))) continue
      const priority = categoryOrder.includes(seed.sourceCategory) ? categoryOrder.indexOf(seed.sourceCategory) : 8
      const existing = sources.get(seed.url), evidence = bundle.sources.filter(source => source.official && source.url === seed.url)
      sources.set(seed.url, { url: seed.url, categories: [...new Set([...(existing?.categories ?? []), seed.sourceCategory])],
        priority: Math.min(existing?.priority ?? Infinity, priority), languageHints: [...new Set(evidence.map(source => source.language))],
        title: evidence[0]?.title ?? null, formatHint: /\.pdf(?:$|[?#])/iu.test(seed.url) ? 'pdf' : /\.(?:xlsx?|csv)(?:$|[?#])/iu.test(seed.url) ? 'spreadsheet' : 'html-or-dynamic' })
    }
    const officialSources = [...sources.values()].sort((a, b) => a.priority - b.priority || a.url.localeCompare(b.url))
    return { universityId: school.universityId, name: school.name, universityIdentityAccepted: safeSchools.has(school.universityId),
      rawProgramCount: rawPrograms.length, rawProgrammeStatusCounts: Object.fromEntries(['verified', 'stale', 'draft', 'archived'].map(status => [status, rawPrograms.filter(program => program.status === status).length])),
      identityAcceptanceLedgerEntryCount: identities.filter(entry => entry.entityType === 'program' && rawIds.has(entry.recordId)).length,
      directoryProgramCount: acceptedPrograms.length, currentFactProgramCount: acceptedPrograms.filter(program => isCurrentVerifiedRecord(program, today)).length,
      currentOpportunityProgramCount: acceptedPrograms.filter(program => opportunityPrograms.has(program.id)).length,
      rawScholarshipCount: bundle.scholarships.filter(award => award.universityIds.includes(school.universityId)).length,
      directoryScholarshipCount: directory.scholarships.filter(award => award.universityIds.includes(school.universityId)).length,
      classification: acceptedPrograms.length ? 'has_accepted_programmes' : !safeSchools.has(school.universityId) ? 'parent_identity_pending'
        : rawPrograms.some(program => !['draft', 'archived'].includes(program.status)) ? 'programme_acceptance_or_expansion_needed' : 'catalogue_discovery_needed',
      officialSourceCount: officialSources.length, officialCatalogueSourceCount: officialSources.filter(source => source.categories.some(category => category.endsWith('_catalog'))).length,
      sourcePriority: officialSources[0]?.priority ?? 9, sourceCandidates: officialSources, excludedFromNextCohort: excluded.has(school.universityId),
      scopeCoversFullCatalogue: false, priorStopOrUnknownChecked: false }
  }).sort((a, b) => Number(a.directoryProgramCount > 0) - Number(b.directoryProgramCount > 0)
    || a.directoryProgramCount - b.directoryProgramCount || a.sourcePriority - b.sourcePriority
    || Number(b.universityIdentityAccepted) - Number(a.universityIdentityAccepted) || b.rawProgramCount - a.rawProgramCount || a.universityId.localeCompare(b.universityId))
    .map((row, index) => ({ rank: index + 1, ...row }))
  let nationalBacklog: { registryAvailable: boolean; registryAsOf?: string; sourceYear?: number; totalNationalIdentities?: number; matchedFixedCohort?: number; beyondFixedScopeCandidates?: number; categories?: Record<string, number>; addedToFixedScope: number } = { registryAvailable: false, addedToFixedScope: 0 }
  if (options.nationalRegistry !== undefined) {
    const national = options.nationalRegistry as NationalRegistry
    if (national?.format !== 'studyinchina.national-university-target-registry' || !Array.isArray(national.institutions)) throw new Error('school_expansion_national_registry_invalid')
    const beyond = national.institutions.filter(record => !record.catalogueMatch?.universityId || !cohortIds.has(record.catalogueMatch.universityId))
    nationalBacklog = { registryAvailable: true, registryAsOf: national.asOf, sourceYear: national.sourceYear, totalNationalIdentities: national.institutions.length,
      matchedFixedCohort: national.institutions.length - beyond.length, beyondFixedScopeCandidates: beyond.length,
      categories: Object.fromEntries([...new Set(beyond.map(record => record.educationCategory ?? 'unknown'))].sort().map(category => [category, beyond.filter(record => (record.educationCategory ?? 'unknown') === category).length])), addedToFixedScope: 0 }
  }
  const coverage = directoryCoverage(directory, 272, today)
  const content = { format: 'studyinchina.school-expansion-queue', version: 1, evaluatedForDate: today, mode: options.preview ? 'accepted-preview' : 'current-canonical',
    scopeRegistrySha256: scope.sha256, inputCatalogSha256: await catalogSha256(bundle),
    summary: { ...coverage.schoolCoverageCounts, withoutDirectoryPrograms: rows.filter(row => row.directoryProgramCount === 0).length,
      parentIdentityPending: rows.filter(row => !row.universityIdentityAccepted).length, directoryProgrammes: directory.programs.length,
      directoryScholarships: directory.scholarships.length, ...coverage.currentOpportunityCounts },
    nextCohort: rows.filter(row => !row.excludedFromNextCohort).slice(0, 20).map(row => row.universityId), rows, nationalBacklog,
    policy: { fixedScopeSchools: 272, cohortSize: 20, excludedCurrentPilotIds: [...excluded].filter(id => cohortIds.has(id)), canonicalDataWritten: false,
      modelRequestsPerformed: false, sourceRegistrationIsNotCurrentEvidence: true, stopOrUnknownMustBeCheckedBeforeExecution: true,
      coverageComplete: false, nationalCandidatesRemainOutsideFixedScope: true } }
  return { ...content, sha256: createHash('sha256').update(canonicalJson(content)).digest('hex') }
}

export function schoolExpansionReport(queue: Awaited<ReturnType<typeof buildSchoolExpansionQueue>>): string {
  const summary = queue.summary, selected = new Set(queue.nextCohort)
  const lines = [`# School expansion queue — ${queue.evaluatedForDate}`, '', `Mode: ${queue.mode}. Fixed cohort: 272 schools.`, '',
    `${summary.withDirectoryPrograms}/272 schools have accepted directory programmes; ${summary.withoutDirectoryPrograms} have none. ${summary.directory} school identities are accepted; ${summary.parentIdentityPending} still need identity evidence.`,
    `${summary.directoryProgrammes} directory programmes and ${summary.directoryScholarships} directory scholarships are distinct from ${summary.withCurrentOpportunities} schools with current opportunities.`, '',
    'The next 20 exclude the separately listed current pilot schools. Registered official URLs are collection leads; STOP/unknown history must still be checked before any model request. No new school is added to the fixed cohort.', '',
    '| Rank | School | Accepted programmes | Raw programmes | Official catalogue URLs | First collection lead |', '|---:|---|---:|---:|---:|---|']
  for (const row of queue.rows.filter(row => selected.has(row.universityId))) lines.push(`| ${row.rank} | ${row.name.en ?? row.name.zh ?? row.universityId} | ${row.directoryProgramCount} | ${row.rawProgramCount} | ${row.officialCatalogueSourceCount} | ${row.sourceCandidates[0]?.url ?? 'Discovery needed'} |`)
  lines.push('', `Separate national discovery backlog: ${queue.nationalBacklog.beyondFixedScopeCandidates ?? 'unavailable'} identities outside this fixed cohort; added to this queue: 0.`, '', `Queue SHA256: ${queue.sha256}`, '')
  return lines.join('\n')
}

async function main() {
  const args = process.argv.slice(2), allowed = new Set(['--root', '--output', '--candidate-bundle', '--acceptances', '--fields', '--today'])
  if (args.length % 2 || args.some((value, index) => index % 2 === 0 && !allowed.has(value))) throw new Error('Usage: build-school-expansion-queue.ts [--root repository] [--output .pipeline-build/queue.json] [--candidate-bundle bundle.json] [--acceptances ledger.json] [--fields ledger.json] [--today YYYY-MM-DD]')
  const option = (name: string) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined
  const root = resolve(option('--root') ?? process.cwd()), dataDirectory = join(root, 'content/data')
  const output = resolve(option('--output') ?? join(root, '.pipeline-build/maintenance-validation/expansion-queue.json')), report = output.replace(/\.json$/u, '') + '.md'
  const allowedRoot = join(root, '.pipeline-build'), inside = relative(allowedRoot, output)
  if (!inside || inside.startsWith('..') || isAbsolute(inside) || existsSync(output) || existsSync(report)) throw new Error('school_expansion_output_must_be_new_pipeline_artifact')
  let ancestor = dirname(output)
  while (!existsSync(ancestor)) ancestor = dirname(ancestor)
  let cursor = root
  for (const part of relative(root, ancestor).split(sep).filter(Boolean)) { cursor = join(cursor, part); if (lstatSync(cursor).isSymbolicLink()) throw new Error('school_expansion_output_path_invalid') }
  if (relative(realpathSync(root), realpathSync(ancestor)).startsWith('..')) throw new Error('school_expansion_output_path_invalid')
  const bundle = option('--candidate-bundle') ? bundleSchema.parse(read(resolve(option('--candidate-bundle')!))) : loadMaintenanceBundle(root)
  const identities = option('--acceptances') ? identityAcceptanceLedgerSchema.parse(read(resolve(option('--acceptances')!))).entries : readIdentityAcceptances(dataDirectory)
  const fields = option('--fields') ? fieldVerificationLedgerSchema.parse(read(resolve(option('--fields')!))).entries : readFieldVerifications(dataDirectory)
  const national = join(root, 'content/targets/national-university-registry.json')
  const queue = await buildSchoolExpansionQueue({ bundle, scope: read(join(root, 'content/maintenance/scope-272.v1.json')), today: option('--today') ?? getTodayDate(),
    identities, fields, preview: Boolean(option('--candidate-bundle') || option('--acceptances') || option('--fields')), nationalRegistry: existsSync(national) ? read(national) : undefined })
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, `${JSON.stringify(queue, null, 2)}\n`, { flag: 'wx' }); writeFileSync(report, schoolExpansionReport(queue), { flag: 'wx' })
  console.log(JSON.stringify({ output, report, summary: queue.summary, nextCohort: queue.nextCohort, nationalBacklog: queue.nationalBacklog }))
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error instanceof Error ? error.message : 'school_expansion_queue_failed'); process.exitCode = 1 })
