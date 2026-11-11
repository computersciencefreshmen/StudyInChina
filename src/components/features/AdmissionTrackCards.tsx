import type { LaunchLocale } from '@/i18n/config'
import { officialReferenceTuitionCopy } from '@/i18n/tuition-reference'
import { getMessages } from '@/i18n/messages'
import { formatDate, formatCny, localize } from '@/lib/data/format'
import { languageLabel } from '@/lib/data/labels'
import { hasCurrentDirectoryField } from '@/lib/data/discovery-state'
import type { AdmissionCycle, Program, Source } from '@/lib/data/types'

/** Each card reads one projected, separately evidenced annual language/round. */
export function AdmissionTrackCards({ program, cycles, sources, locale, today }: {
  program: Program; cycles: AdmissionCycle[]; sources: Source[]; locale: LaunchLocale; today: string
}) {
  const tracks = cycles.filter(cycle => cycle.programId === program.id && (cycle.teachingLanguage || cycle.applicationRound))
  if (!tracks.length) return null
  const messages = getMessages(locale)
  const referenceCopy = officialReferenceTuitionCopy(locale)
  const periodLabels = { program: messages.programs.tuitionProgram, semester: messages.programs.tuitionSemester, 'academic-year': messages.programs.tuitionAcademicYear, month: messages.programs.tuitionMonth, other: messages.programs.tuitionOther }
  return <section className="atlas-section" aria-label={messages.programs.applicationStatus} data-admission-tracks>
    {tracks.map(cycle => {
      const known = (path: string) => hasCurrentDirectoryField(cycle, path, today)
      return <article className="atlas-card" key={cycle.id} data-track-cycle={cycle.id}>
        <h2>{cycle.academicYear} · {cycle.intake === 'spring' ? messages.programs.springIntake : cycle.intake === 'autumn' ? messages.programs.autumnIntake : messages.programs.otherIntake} · {cycle.teachingLanguage ? languageLabel(cycle.teachingLanguage, locale) : messages.common.language}{cycle.applicationRound ? ` · ${cycle.applicationRound}` : ''}</h2>
        <dl>
          {known('opensOn') && cycle.opensOn ? <div><dt>{messages.programs.opens}</dt><dd>{formatDate(cycle.opensOn, locale, '')}</dd></div> : null}
          {known('closesOn') && cycle.closesOn ? <div><dt>{messages.common.deadline}</dt><dd>{formatDate(cycle.closesOn, locale, '')}</dd></div> : null}
          {known('tuitionCny') && cycle.tuitionCny !== null && known('tuitionStatus') && known('tuitionPeriod') && cycle.tuitionPeriod ? <div><dt>{cycle.tuitionStatus === 'reference' ? referenceCopy.label : messages.common.tuition}</dt><dd>{formatCny(cycle.tuitionCny, locale, '')} · {periodLabels[cycle.tuitionPeriod]}</dd></div> : null}
          {known('applicationFeeCny') && cycle.applicationFeeCny !== null ? <div><dt>{messages.programs.fee}</dt><dd>{formatCny(cycle.applicationFeeCny, locale, '')}</dd></div> : null}
          {known('languageRequirements') && cycle.languageRequirements?.length ? <div><dt>{messages.common.requirements}</dt><dd>{cycle.languageRequirements.map(requirement => `${requirement.test}${requirement.minimum ? `: ${requirement.minimum}` : ''}`).join(' · ')}</dd></div> : null}
        </dl>
        {known('tuitionStatus') && cycle.tuitionStatus === 'reference' && known('tuitionCny') ? <p>{referenceCopy.notice}</p> : null}
        {known('tuitionSchedule') && cycle.tuitionSchedule ? <p>{localize(cycle.tuitionSchedule, locale)}</p> : null}
        {known('eligibility') && cycle.eligibility?.length ? <section><h3>{messages.programs.eligibility}</h3><ul>{cycle.eligibility.map((item, index) => <li key={index}>{localize(item, locale)}</li>)}</ul></section> : null}
        {known('applicationMaterials') && cycle.applicationMaterials?.length ? <section><h3>{messages.programs.materials}</h3><ul>{cycle.applicationMaterials.map((item, index) => <li key={index}>{localize(item, locale)}</li>)}</ul></section> : null}
        {known('applyUrl') && cycle.applyUrl ? <a href={cycle.applyUrl} target="_blank" rel="noreferrer">{messages.common.applyOfficial} ↗</a> : null}
        {sources.filter(source => cycle.sourceIds.includes(source.id)).map(source => <p key={source.id}><a href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a></p>)}
      </article>
    })}
  </section>
}
