import { concreteProgramKeys } from './concrete-majors'
import { supportsField as supports, applicationRoute as route, hasList } from './decision-evidence'
import { isCurrentAdmissionYear } from './cycle-scope'
import type { AdmissionCycle, AuditMeta, DataBundle, Program } from './types'
import type { DiscoveryMeta } from './discovery'

/** A public policy version, not an edit to the raw catalogue or maintenance scope. */
export const PUBLIC_PROGRAM_QUALITY_POLICY = 'studyinchina.public-program-core.v2'
/** Core facts must be known in one usable annual/language/round scope. Tuition
 * and marketing descriptions are deliberately not prerequisites for this gate. */
export function hasDetailedPublicProgram(program: Program & { discovery?: DiscoveryMeta }, cycles: AdmissionCycle[], today: string): boolean {
  const known = (path: string, value: boolean, exemption = false) => supports(program, path, value, today, exemption)
  if (concreteProgramKeys(program).length === 0 || !route(program.programUrl) || program.degreeLevel === 'other' || !known('teachingLanguages', program.teachingLanguages.length > 0)
    || !known('durationMonths', typeof program.durationMonths === 'number' && program.durationMonths > 0)) return false
  return cycles.some(input => {
    const cycle = input as AdmissionCycle & { discovery?: DiscoveryMeta }
    if (cycle.programId !== program.id || !isCurrentAdmissionYear(cycle.academicYear, today) || cycle.dateStatus === 'previous-cycle-reference'
      || cycle.closesOn !== null && cycle.closesOn < today
      || cycle.teachingLanguage && !program.teachingLanguages.includes(cycle.teachingLanguage)) return false
    const field = (path: string, value: boolean, exemption = false) => supports(cycle, path, value, today, exemption)
    // Annual field receipts already bind academicYear/intake/language/round in
    // fieldRecordScopeSha256. The raw year alone proves no current schedule.
    const schedule = field('dateStatus', cycle.dateStatus === 'rolling')
      || cycle.dateStatus === 'published' && field('dateStatus', true)
        && field('closesOn', typeof cycle.closesOn === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(cycle.closesOn) && cycle.closesOn >= today)
    if (!schedule) return false
    const scoped = Boolean(cycle.teachingLanguage || cycle.applicationRound) || program.teachingLanguages.length > 1
    const annualRoute = Object.hasOwn(cycle, 'applyUrl') || cycle.discovery?.currentFieldPaths.includes('applyUrl')
    const usableRoute = annualRoute ? field('applyUrl', route(cycle.applyUrl)) : !scoped && known('applyUrl', route(program.applyUrl))
    const annualConditions = field('languageRequirements', hasList(cycle.languageRequirements), true)
      && field('eligibility', hasList(cycle.eligibility), true)
    const hasAnnualConditions = ['languageRequirements', 'eligibility'].some(path => Object.hasOwn(cycle, path)
      || cycle.discovery?.currentFieldPaths.includes(path))
    const legacyConditions = !scoped && !hasAnnualConditions
      && known('languageRequirements', hasList(program.languageRequirements), true)
      && (known('details.eligibility', hasList(program.details?.eligibility ?? program.supplementaryDetails?.eligibility), true)
        || known('supplementaryDetails.eligibility', hasList(program.supplementaryDetails?.eligibility), true))
    return Boolean(usableRoute && (annualConditions || legacyConditions))
  })
}

/** Call only after the existing official identity/fresh-leaf projection. Keep
 * raw selectors reusable by maintenance and never widen an award's scope. */
export function selectDetailedPublicPrograms<T extends DataBundle>(bundle: T, today: string, raw: DataBundle = bundle): T {
  const official = new Set(bundle.sources.filter(source => source.official).map(source => source.id))
  const proven = (record: AuditMeta) => record.sourceIds.length > 0 && record.sourceIds.every(id => official.has(id))
  const candidateCycles = bundle.admissionCycles.filter(proven)
  const programs = bundle.programs.filter(program => proven(program) && hasDetailedPublicProgram(program, candidateCycles, today))
  const ids = new Set(programs.map(program => program.id))
  const byId = new Map(programs.map(program => [program.id, program]))
  const rawAwards = new Map(raw.scholarships.map(award => [award.id, award]))
  return { ...bundle, programs, admissionCycles: candidateCycles.filter(cycle => ids.has(cycle.programId)
    && hasDetailedPublicProgram(byId.get(cycle.programId)!, [cycle], today)),
    scholarships: bundle.scholarships.flatMap(award => {
      const programIds = award.programIds.filter(id => ids.has(id))
      const originallyProgrammeSpecific = (rawAwards.get(award.id)?.programIds.length ?? award.programIds.length) > 0
      return originallyProgrammeSpecific && programIds.length === 0 ? [] : [{ ...award, programIds }]
    }) }
}
