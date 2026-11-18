import 'server-only'
import type { LaunchLocale } from '@/i18n/config'
import { localize } from './data/format'
import { hasDetailedPublicProgram } from './data/public-program-quality'
import { admissionIntakeYear } from './data/cycle-scope'
import type { AuditMeta, DataBundle } from './data/types'
import type { DiscoveryMeta } from './data/discovery'
import { isCurrentVerifiedRecord } from './data/freshness'
import type { MatchOpportunity, MatchSignal } from './student-matching'

export function studentMatchCatalog(data: DataBundle, locale: LaunchLocale, today: string): MatchOpportunity[] {
  const schools = new Map(data.universities.map(s => [s.id, s])), programs = new Map(data.programs.map(p => [p.id, p]))
  const sources = new Map(data.sources.filter(s => s.official && /^https:\/\//.test(s.url)).map(s => [s.id, s.url]))
  const evidence = <T>(record: AuditMeta & { discovery?: DiscoveryMeta }, field: string, value: T | null): MatchSignal<T> => {
    const meta = record.discovery, state = meta?.fieldStates?.[field]
    if (value == null || (state && state !== 'known') || (meta?.fieldMeta?.[field] && meta.fieldMeta[field].status !== 'known')) return null
    if (!(meta?.currentFacts ?? (isCurrentVerifiedRecord(record, today) && record.verifiedAt <= today)) && !meta?.currentFieldPaths.includes(field)) return null
    const url = meta?.fieldMeta?.[field]?.officialUrl || record.sourceIds.map(id => sources.get(id)).find(Boolean)
    return url && /^https:\/\//.test(url) ? { value, url } : null
  }
  return data.admissionCycles.flatMap(cycle => {
    const p = programs.get(cycle.programId), school = p && schools.get(p.universityId)
    if (!p || !school || !p.sourceIds.length || !cycle.sourceIds.length || [...p.sourceIds, ...cycle.sourceIds].some(id => !sources.has(id))
      || !hasDetailedPublicProgram(p, [cycle], today)) return []
    const scoped = !!(cycle.applicationRound || cycle.teachingLanguage || p.teachingLanguages.length > 1 || cycle.eligibility || cycle.languageRequirements)
    const clauses = (cycle.eligibility || (!scoped && (p.details?.eligibility || p.supplementaryDetails?.eligibility)) || []).map(t => localize(t, locale))
    const languageConditions = (cycle.languageRequirements || (!scoped && p.languageRequirements) || []).map(r => [r.test, r.minimum].filter(Boolean).join(' '))
    const year = admissionIntakeYear(cycle.academicYear, cycle.intake)
    return [{ id: p.id, slug: p.slug, cycleId: cycle.id, name: localize(p.name, locale), university: localize(school.name, locale),
      year: cycle.academicYear, track: cycle.teachingLanguage || '', round: cycle.applicationRound || '',
      languageConditions: languageConditions.length ? evidence(cycle.languageRequirements ? cycle : p, 'languageRequirements', languageConditions) : null,
      education: clauses.length ? cycle.eligibility ? evidence(cycle, 'eligibility', clauses)
        : evidence(p, p.details?.eligibility ? 'details.eligibility' : 'supplementaryDetails.eligibility', clauses) : null,
      language: cycle.teachingLanguage ? evidence(cycle, 'teachingLanguage', [cycle.teachingLanguage]) : evidence(p, 'teachingLanguages', p.teachingLanguages),
      budget: !cycle.tuitionSchedule && evidence(cycle, 'tuitionPeriod', cycle.tuitionPeriod)?.value === 'academic-year'
        && evidence(cycle, 'tuitionStatus', cycle.tuitionStatus)?.value === 'confirmed' ? evidence(cycle, 'tuitionCny', cycle.tuitionCny) : null,
      intake: year && evidence(cycle, 'academicYear', cycle.academicYear) && ['spring', 'autumn'].includes(cycle.intake)
        ? evidence(cycle, 'intake', year + '-' + cycle.intake) : null }]
  })
}
