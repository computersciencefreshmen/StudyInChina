import { createHash } from 'node:crypto'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { AdmissionCycle, AuditMeta, DataBundle, Program, Scholarship } from '../../src/lib/data/types'
import { selectDiscoveryData, type DiscoveryMeta } from '../../src/lib/data/discovery'
import { readIdentityAcceptances } from '../../src/lib/data/identity-acceptance-store'
import { readFieldVerifications } from '../../src/lib/data/field-verification-store'
import type { IdentityAcceptance } from '../../src/lib/data/identity-acceptance'
import type { FieldVerification } from '../../src/lib/data/field-verification'
import { getTodayDate } from '../../src/lib/data/freshness'
import { maintenanceScopeSchema, scopeContentSha256, canonicalJson, type MaintenanceScope } from './contracts'
import { maintenanceClientFromEnvironment, type MaintenanceClient } from '../automation/catalog-maintenance-client'
import { readMaintenanceScope } from './scope-registry'
import { catalogSha256, loadMaintenanceBundle } from './build-scope'
import { coverageBand, coverageSnapshotSchema, type CoverageSnapshot } from '../../workers/catalog-maintenance/src/coverage'
import { EXISTING_SCHOOLS_V2_SHA256 } from '../../workers/catalog-maintenance/src/scope-config'

/** Language tracks and admission rounds do not create another concrete major. */
export function concreteProgramKeys(program: Program): string[] {
  const names = [program.name.zh, program.name.en].filter((name): name is string => Boolean(name))
  const generic = /^(?:(?:international\s+)?(?:undergraduate|graduate|postgraduate|bachelor(?:'?s)?|master(?:'?s)?|doctoral|degree)\s+(?:program(?:me)?s?|admissions?)(?:\s+guide)?|(?:国际学生|留学生)?(?:本科|硕士|博士|研究生|学历)(?:招生|项目|专业|目录|指南)(?:简章|目录|指南)?)$/iu
  if (!names.length || names.every(name => generic.test(name.trim()))) return []
  const normalize = (name: string) => name.normalize('NFKC').toLowerCase()
    .replace(/\((?:english|chinese)(?:[- ](?:taught|medium))?\)|(?:english|chinese)[- ](?:taught|medium)|[（(](?:中文|英文|汉语|英语)(?:授课|教学)?[）)]/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
  return [...new Set(names.map(normalize).filter(Boolean))].map(name => `${program.degreeLevel}:${name}`)
}

function distinctPrograms(programs: Program[]): string[] {
  const groups: Array<{ ids: string[]; keys: Set<string> }> = []
  for (const program of [...programs].sort((a, b) => a.id.localeCompare(b.id))) {
    const keys = concreteProgramKeys(program)
    if (!keys.length) continue
    const matches = groups.filter(group => keys.some(key => group.keys.has(key)))
    const group = matches[0] ?? { ids: [], keys: new Set<string>() }
    if (!matches.length) groups.push(group)
    group.ids.push(program.id); keys.forEach(key => group.keys.add(key))
    for (const other of matches.slice(1)) {
      group.ids.push(...other.ids); other.keys.forEach(key => group.keys.add(key)); groups.splice(groups.indexOf(other), 1)
    }
  }
  return groups.map(group => group.ids.sort()[0]).sort()
}

type WithDiscovery = AuditMeta & { discovery?: DiscoveryMeta }
/** A whole-current record or a fresh leaf can prove a value. Explicit unknown
 * overrides whole-record freshness; only a real not-applicable receipt grants
 * an exemption, never an absent/empty field by itself. */
function supportsField(record: WithDiscovery, path: string, meaningful: boolean, today: string, allowExemption = false): boolean {
  const meta = record.discovery
  const current = meta ? meta.currentFacts : record.status === 'verified' && record.verifiedAt <= today && record.reviewAfter >= today
  if (!current && !meta?.currentFieldPaths.includes(path)) return false
  const state = meta?.fieldStates?.[path]
  if (state === 'not_applicable') return allowExemption
  if (state !== undefined && state !== 'known') return false
  return meaningful
}
const hasList = (value: unknown): boolean => Array.isArray(value) && value.length > 0
function applicationRoute(value: unknown): boolean {
  if (typeof value !== 'string') return false
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password }
  catch { return false }
}
function completeScholarship(award: Scholarship & { discovery: DiscoveryMeta }, today: string): boolean {
  const known = (path: string, meaningful: boolean, exemption = false) => supportsField(award, path, meaningful, today, exemption)
  const deadline = typeof award.deadline === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(award.deadline) && award.deadline >= today
  return known('deadline', deadline, award.deadline === null) && known('applicationUrl', applicationRoute(award.applicationUrl))
    && known('eligibility', hasList(award.eligibility), true)
    && known('coverage.tuition', ['full', 'partial', 'none'].includes(award.coverage.tuition))
    && known('coverage.accommodation', ['full', 'partial', 'none'].includes(award.coverage.accommodation))
    && known('coverage.insurance', typeof award.coverage.insurance === 'boolean')
    && known('coverage.stipendCnyPerMonth', typeof award.coverage.stipendCnyPerMonth === 'number' && award.coverage.stipendCnyPerMonth >= 0, award.coverage.stipendCnyPerMonth === null)
}

export async function buildProgramCoverage(bundle: DataBundle, scope: MaintenanceScope, today: string, identities: IdentityAcceptance[] = [], fields: FieldVerification[] = []): Promise<CoverageSnapshot> {
  const directory = selectDiscoveryData(bundle, today, identities, fields)
  const projectedPrograms = directory.programs as Array<Program & { discovery: DiscoveryMeta }>
  const projectedAwards = directory.scholarships as Array<Scholarship & { discovery: DiscoveryMeta }>
  const projectedCycles = directory.admissionCycles as Array<AdmissionCycle & { discovery?: DiscoveryMeta }>
  const complete = projectedPrograms.filter(program => {
    const known = (path: string, meaningful: boolean, exemption = false) => supportsField(program, path, meaningful, today, exemption)
    const usableCycle = projectedCycles.some(cycle => {
      if (cycle.programId !== program.id || !/^20\d{2}-20\d{2}$/u.test(cycle.academicYear) || cycle.closesOn && cycle.closesOn < today) return false
      const cycleField = (path: string, meaningful: boolean, exemption = false) => supportsField(cycle, path, meaningful, today, exemption)
      // Without common-applicability evidence, a language/round-specific route
      // and conditions must come from that exact annual scope.
      const scoped = Boolean(cycle.teachingLanguage || cycle.applicationRound) || program.teachingLanguages.length > 1
      const hasAnnualRoute = Object.hasOwn(cycle, 'applyUrl') || cycle.discovery?.currentFieldPaths.includes('applyUrl')
      const route = hasAnnualRoute ? cycleField('applyUrl', applicationRoute(cycle.applyUrl))
        : !scoped && known('applyUrl', applicationRoute(program.applyUrl))
      const annualRequirements = cycleField('languageRequirements', hasList(cycle.languageRequirements), true)
        && cycleField('eligibility', hasList(cycle.eligibility), true)
      const hasAnnualConditions = ['languageRequirements', 'eligibility'].some(path => Object.hasOwn(cycle, path)
        || cycle.discovery?.currentFieldPaths.includes(path))
      const legacyRequirements = !scoped && !hasAnnualConditions
        && known('languageRequirements', hasList(program.languageRequirements), true)
        && (known('details.eligibility', hasList(program.details?.eligibility ?? program.supplementaryDetails?.eligibility), true)
          || known('supplementaryDetails.eligibility', hasList(program.supplementaryDetails?.eligibility), true))
      return route && (annualRequirements || legacyRequirements)
    })
    return usableCycle && concreteProgramKeys(program).length > 0
      && known('teachingLanguages', program.teachingLanguages.length > 0)
      && known('durationMonths', program.durationMonths !== null)
  })
  const completeAwards = projectedAwards.filter(award => completeScholarship(award, today))
  const content = {
    format: 'studyinchina.school-program-coverage' as const, version: 1 as const, scopeRegistrySha256: scope.sha256,
    inputCatalogSha256: await catalogSha256(bundle), evaluatedOn: today,
    schools: scope.schools.map(school => {
      const programs = complete.filter(program => program.universityId === school.universityId), ids = distinctPrograms(programs)
      const reviewDates = programs.flatMap(program => {
        const raw = bundle.programs.find(row => row.id === program.id)
        return [raw?.reviewAfter, ...directory.admissionCycles.filter(cycle => cycle.programId === program.id).map(cycle => cycle.reviewAfter)]
          .filter((date): date is string => Boolean(date && date >= today))
      }).sort()
      return { universityId: school.universityId, rawProgramCount: bundle.programs.filter(program => program.universityId === school.universityId).length,
        directoryProgramCount: distinctPrograms(directory.programs.filter(program => program.universityId === school.universityId)).length,
        currentProgramCount: ids.length, minimumProgramCount: 5 as const, gap: Math.max(0, 5 - ids.length), coverageBand: coverageBand(ids.length),
        countedProgramIds: ids, directoryScholarshipCount: projectedAwards.filter(award => award.universityIds.includes(school.universityId)).length,
        currentScholarshipCount: completeAwards.filter(award => award.universityIds.includes(school.universityId)).length,
        reviewAfter: reviewDates[0] ?? null }
    }).sort((a, b) => a.universityId.localeCompare(b.universityId)),
  }
  return coverageSnapshotSchema.parse({ ...content, sha256: createHash('sha256').update(canonicalJson(content)).digest('hex') })
}

export function coverageSummary(snapshot: CoverageSnapshot) {
  return { schoolCount: snapshot.schools.length, minimumProgramCount: 5,
    bands: Object.fromEntries(['zero', 'one', 'two-to-four', 'five-plus'].map(band => [band, snapshot.schools.filter(school => school.coverageBand === band).length])),
    directoryPrograms: snapshot.schools.reduce((sum, row) => sum + row.directoryProgramCount, 0),
    currentConcretePrograms: snapshot.schools.reduce((sum, row) => sum + row.currentProgramCount, 0),
    currentScholarshipOpportunities: snapshot.schools.reduce((sum, row) => sum + row.currentScholarshipCount, 0),
    schoolsMeetingMinimum: snapshot.schools.filter(row => row.gap === 0).length, totalProgramGap: snapshot.schools.reduce((sum, row) => sum + row.gap, 0) }
}
export function renderCoverageReport(snapshot: CoverageSnapshot): string {
  const summary = coverageSummary(snapshot)
  return `# School programme coverage — ${snapshot.evaluatedOn}\n\nScope: ${snapshot.scopeRegistrySha256}\n\nCatalog: ${snapshot.inputCatalogSha256}\n\n${summary.schoolCount} schools; minimum 5 concrete current programmes per school. Bands 0 / 1 / 2–4 / ≥5: ${Object.values(summary.bands).join(' / ')}.\n\nCurrent means a discoverable, source-backed specific programme with a current admission cycle, application route, teaching language, duration and both language requirements and eligibility. Explicit annual language/round scopes require their own application route and both conditions; absent or unknown facts do not count as complete. Exemptions count only with current official not-applicable leaf evidence. Scholarship opportunities require a current deadline (or an explicit no-deadline receipt), application route, eligibility, and all four funding leaves; unknown benefits do not count. Exact bilingual identities are merged; teaching-language tracks and application rounds do not count separately. Directory identities and raw stored rows are reported separately. No official sites were fetched to generate this report.\n\n| School ID | Raw rows | Directory majors | Current majors | Gap to 5 | Review after |\n|---|---:|---:|---:|---:|---|\n${snapshot.schools.map(row => `| ${row.universityId} | ${row.rawProgramCount} | ${row.directoryProgramCount} | ${row.currentProgramCount} | ${row.gap} | ${row.reviewAfter ?? 'unknown'} |`).join('\n')}\n`
}
export async function refreshCloudProgramCoverage(options: { root: string; client: Pick<MaintenanceClient, 'json'>; today?: string; onSnapshot?: (snapshot: CoverageSnapshot) => void }) {
  const today = options.today ?? getTodayDate(), status = await options.client.json('/status') as {
    format?: string; backend?: { state?: string }; enabled?: boolean;
    control?: { seed_complete?: number; targets_complete?: number; scope_sha256?: string; input_catalog_sha256?: string };
    coverage?: { snapshotSha256?: string; evaluatedOn?: string; inputCatalogSha256?: string; scopeRegistrySha256?: string };
  }
  if (status.format !== 'studyinchina.cloud-maintenance-status') throw new Error('coverage_status_invalid')
  const skipped = (reason: string) => ({ refreshed: false as const, reason })
  if (status.backend?.state !== 'ready') return skipped(status.backend?.state === 'quota_wait' ? 'quota_wait' : 'backend_wait')
  const cfg = status.control
  if (cfg?.seed_complete !== 1 || cfg.targets_complete !== 1 || !cfg.scope_sha256 || !cfg.input_catalog_sha256) return skipped('targets_not_ready')
  if (status.enabled === false) return skipped('operator_pause')
  const scope = readMaintenanceScope(options.root, cfg.scope_sha256), currentScope = readMaintenanceScope(options.root)
  if (scope.sha256 !== await scopeContentSha256(scope)) throw new Error('coverage_scope_checksum_mismatch')
  if (currentScope.sha256 !== await scopeContentSha256(currentScope)) throw new Error('coverage_scope_checksum_mismatch')
  if (scope.sha256 !== currentScope.sha256) {
    // The Worker accepts coverage only after the approved additive upgrade.
    // Leave that upgrade and any prior publication to their existing fences.
    if (currentScope.sha256 === EXISTING_SCHOOLS_V2_SHA256 && currentScope.formatVersion === 2
      && currentScope.expectedSchoolCount === 295 && currentScope.parentScopeSha256 === scope.sha256
      && scope.formatVersion === 1 && scope.expectedSchoolCount === 272) return skipped('scope_upgrade_wait')
    throw new Error('coverage_scope_not_current')
  }
  const bundle = loadMaintenanceBundle(options.root)
  if (await catalogSha256(bundle) !== cfg.input_catalog_sha256) return skipped('head_wait')
  if (status.coverage?.snapshotSha256 && status.coverage.evaluatedOn === today && status.coverage.inputCatalogSha256 === cfg.input_catalog_sha256
    && status.coverage.scopeRegistrySha256 === cfg.scope_sha256) return skipped('coverage_current')
  const data = join(options.root, 'content/data'), snapshot = await buildProgramCoverage(bundle, scope, today,
    readIdentityAcceptances(data, { strictProjection: true }), readFieldVerifications(data))
  options.onSnapshot?.(snapshot)
  await options.client.json('/coverage', 'POST', snapshot)
  return { refreshed: true as const, reason: 'coverage_refreshed', sha256: snapshot.sha256, evaluatedOn: snapshot.evaluatedOn, ...coverageSummary(snapshot) }
}
async function main() {
  const args = process.argv.slice(2), value = (name: string) => args[args.indexOf(name) + 1], root = process.cwd()
  const writeSnapshot = (snapshot: CoverageSnapshot) => {
    if (args.includes('--output')) { const path = resolve(value('--output')); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`) }
    if (args.includes('--markdown')) { const path = resolve(value('--markdown')); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, renderCoverageReport(snapshot)) }
  }
  if (args.includes('--cloud-refresh')) {
    console.log(JSON.stringify(await refreshCloudProgramCoverage({ root, client: maintenanceClientFromEnvironment(process.env), onSnapshot: writeSnapshot }))); return
  }
  if (!args.includes('--scope') || !args.includes('--output')) throw new Error('Usage: program-coverage.ts --scope <registry.json> --output <snapshot.json> [--today YYYY-MM-DD] [--markdown <report.md>]')
  const scope = maintenanceScopeSchema.parse(JSON.parse(readFileSync(resolve(value('--scope')), 'utf8'))), data = join(root, 'content/data')
  if (scope.sha256 !== await scopeContentSha256(scope)) throw new Error('coverage_scope_checksum_mismatch')
  const bundle = loadMaintenanceBundle(root)
  const snapshot = await buildProgramCoverage(bundle, scope, args.includes('--today') ? value('--today') : getTodayDate(),
    readIdentityAcceptances(data, { strictProjection: true }), readFieldVerifications(data))
  writeSnapshot(snapshot)
  if (args.includes('--upload')) await maintenanceClientFromEnvironment(process.env).json('/coverage','POST',snapshot)
  console.log(JSON.stringify({ ...coverageSummary(snapshot), sha256: snapshot.sha256, evaluatedOn: snapshot.evaluatedOn }))
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error instanceof Error ? error.message : 'coverage_failed'); process.exitCode = 1 })
