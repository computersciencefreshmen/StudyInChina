import { notFound } from 'next/navigation'
import { FavoriteButton } from '@/components/features/FavoriteButton'
import { ProgramCard } from '@/components/features/RecordCards'
import { ScholarshipCard } from '@/components/features/ScholarshipCard'
import { Badge, Card, PageHero, SectionHeading, VerificationBadge } from '@/components/ui'
import { launchLocales } from '@/i18n/config'
import { getMessages } from '@/i18n/messages'
import { getApplicationState, selectAdmissionCycle } from '@/lib/data/admission'
import { formatCny, formatDate, localize } from '@/lib/data/format'
import { getTodayDate } from '@/lib/data/freshness'
import { degreeLabels, disciplineLabels, languageLabel } from '@/lib/data/labels'
import { getData, getProgramBySlug } from '@/lib/data/load'
import type { AdmissionCycle } from '@/lib/data/types'
import { pageMetadata, requireLocale } from '@/lib/site'

export function generateStaticParams() {
  const data = getData()
  return launchLocales.flatMap((locale) => data.programs.map(({ slug }) => ({ locale, slug })))
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale: raw, slug } = await params
  const locale = requireLocale(raw) || 'en'
  const program = getProgramBySlug(slug)
  if (!program) return {}

  return pageMetadata(
    locale,
    localize(program.name, locale),
    `${degreeLabels(locale)[program.degreeLevel]} · ${disciplineLabels(locale)[program.discipline]}`,
    `programs/${slug}`,
  )
}

function cycleRecency(cycle: AdmissionCycle): string {
  return cycle.closesOn || cycle.opensOn || cycle.academicYear
}

export default async function ProgramDetailPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale: raw, slug } = await params
  const locale = requireLocale(raw)
  if (!locale) notFound()

  const program = getProgramBySlug(slug)
  if (!program?.details || program.durationMonths === null) notFound()
  const details = program.details

  const messages = getMessages(locale)
  const data = getData()
  const university = data.universities.find((item) => item.id === program.universityId)
  if (!university) notFound()

  const city = data.cities.find((item) => item.id === university.cityId)
  const cycles = data.admissionCycles
    .filter((item) => item.programId === program.id)
    .sort((left, right) => cycleRecency(right).localeCompare(cycleRecency(left)))
  const cycle = cycles[0]
  if (!cycle) notFound()

  const today = getTodayDate()
  const applicationState = getApplicationState(cycle, today)
  const applicationStateLabels = {
    open: messages.common.openNow,
    upcoming: messages.programs.upcoming,
    closed: messages.programs.applicationsClosed,
    rolling: messages.programs.rolling,
    'dates-published': messages.programs.datePublished,
    'not-announced': messages.programs.notAnnounced,
    'previous-cycle': messages.programs.previousCycle,
  }
  const applicationStateTones = {
    open: 'jade',
    upcoming: 'gold',
    closed: 'neutral',
    rolling: 'jade',
    'dates-published': 'blue',
    'not-announced': 'warning',
    'previous-cycle': 'neutral',
  } as const
  const applicationStateLabel = applicationStateLabels[applicationState]
  const isAcceptingApplications = applicationState === 'open' || applicationState === 'rolling'

  const intakeLabels = {
    spring: messages.programs.springIntake,
    autumn: messages.programs.autumnIntake,
    other: messages.programs.otherIntake,
  }
  const studyModeLabels = {
    'full-time': messages.programs.fullTime,
    'part-time': messages.programs.partTime,
    hybrid: messages.programs.hybrid,
  }
  const tuitionPeriodLabels = {
    program: messages.programs.tuitionProgram,
    semester: messages.programs.tuitionSemester,
    'academic-year': messages.programs.tuitionAcademicYear,
    month: messages.programs.tuitionMonth,
    other: messages.programs.tuitionOther,
  }
  const tuition = cycle.tuitionCny === null
    ? messages.common.unknown
    : `${formatCny(cycle.tuitionCny, locale, messages.common.unknown)} / ${tuitionPeriodLabels[cycle.tuitionPeriod || 'other']}${cycle.tuitionStatus === 'reference' ? ` · ${messages.programs.tuitionReference}` : ''}`
  const duration = program.durationMonthsMax && program.durationMonthsMax !== program.durationMonths
    ? `${program.durationMonths}–${program.durationMonthsMax} ${messages.common.months}`
    : `${program.durationMonths} ${messages.common.months}`
  const evidenceBasis = cycle.evidenceBasis === 'recurring-official-rule'
    ? messages.programs.recurringRule
    : messages.programs.cycleSpecific
  const requirements = program.languageRequirements.map((item) => (
    item.test === 'other'
      ? localize(details.languagePolicy, locale)
      : `${item.test}: ${item.minimum || messages.common.unknown}`
  ))
  const sourceIds = new Set([...program.sourceIds, ...cycle.sourceIds])
  const sources = data.sources.filter((source) => sourceIds.has(source.id))
  const related = data.programs
    .filter((item) => item.universityId === university.id && item.id !== program.id)
    .slice(0, 3)
  const scholarships = data.scholarships.filter((item) => (
    item.programIds.includes(program.id)
    || item.universityIds.includes(university.id)
    || (item.programIds.length === 0 && item.universityIds.length === 0)
  ))

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'EducationalOccupationalProgram',
    name: localize(program.name, locale),
    description: localize(details.overview, locale),
    provider: {
      '@type': 'CollegeOrUniversity',
      name: localize(university.name, locale),
      url: university.officialUrl,
    },
    url: program.programUrl,
    applicationStartDate: cycle.opensOn || undefined,
    applicationDeadline: cycle.closesOn || undefined,
    educationalCredentialAwarded: localize(details.qualification, locale),
    timeToComplete: program.durationMonthsMax && program.durationMonthsMax !== program.durationMonths
      ? undefined
      : `P${program.durationMonths}M`,
  }

  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
    <PageHero
      variant="compact"
      eyebrow={`${degreeLabels(locale)[program.degreeLevel]} · ${disciplineLabels(locale)[program.discipline]}`}
      title={localize(program.name, locale)}
      description={<>
        <span>{localize(university.name, locale)}</span>
        {city ? <span> · {localize(city.name, locale)}</span> : null}
      </>}
      actions={<>
        <a className={`atlas-button atlas-button--${isAcceptingApplications ? 'primary' : 'secondary'} atlas-button--medium`} href={program.applyUrl} target="_blank" rel="noreferrer">
          {isAcceptingApplications ? messages.common.applyOfficial : messages.programs.viewApplicationPortal} ↗
        </a>
        <FavoriteButton programId={program.id} saveLabel={messages.common.save} savedLabel={messages.common.saved} />
      </>}
      meta={<VerificationBadge
        status={program.status}
        verifiedAt={program.verifiedAt}
        locale={locale}
        verifiedDateLabel={messages.common.lastVerified}
        labels={{
          verified: messages.common.verified,
          stale: messages.common.stale,
          draft: messages.common.draft,
          archived: messages.common.archived,
        }}
      />}
    />

    <section className="atlas-container atlas-section detail-layout">
      <div className="detail-main">
        <article className="prose-panel">
          <h2>{messages.programs.overview}</h2>
          <p className="detail-lead">{localize(details.overview, locale)}</p>
          <dl className="detail-facts">
            <div><dt>{messages.programs.university}</dt><dd><a href={`/${locale}/universities/${university.slug}`}>{localize(university.name, locale)}</a></dd></div>
            <div><dt>{messages.programs.faculty}</dt><dd>{localize(details.faculty, locale)}</dd></div>
            <div><dt>{messages.programs.qualification}</dt><dd>{localize(details.qualification, locale)}</dd></div>
            <div><dt>{messages.programs.studyMode}</dt><dd>{studyModeLabels[details.studyMode]}</dd></div>
            <div><dt>{messages.common.duration}</dt><dd>{duration}</dd></div>
            <div><dt>{messages.common.language}</dt><dd>{program.teachingLanguages.map((item) => languageLabel(item, locale)).join(', ')}</dd></div>
            {details.campus ? <div><dt>{messages.programs.campus}</dt><dd>{localize(details.campus, locale)}</dd></div> : null}
            <div><dt>{messages.common.requirements}</dt><dd>{requirements.join(' · ')}</dd></div>
          </dl>
          <h3>{messages.programs.languagePolicy}</h3>
          <p>{localize(details.languagePolicy, locale)}</p>
        </article>

        <article className="prose-panel program-detail-sections">
          <section>
            <h2>{messages.programs.curriculum}</h2>
            <ul>{details.curriculumHighlights.map((item, index) => <li key={index}>{localize(item, locale)}</li>)}</ul>
          </section>
          <section>
            <h2>{messages.programs.eligibility}</h2>
            <ul>{details.eligibility.map((item, index) => <li key={index}>{localize(item, locale)}</li>)}</ul>
          </section>
          <section>
            <h2>{messages.programs.materials}</h2>
            <ul>{details.applicationMaterials.map((item, index) => <li key={index}>{localize(item, locale)}</li>)}</ul>
          </section>
        </article>

        <article className="prose-panel">
          <div className="record-card__top">
            <h2>{messages.programs.cycle}</h2>
            <Badge tone={applicationStateTones[applicationState]} dot>{applicationStateLabel}</Badge>
          </div>
          <dl className="detail-facts">
            <div><dt>{messages.programs.year}</dt><dd>{cycle.academicYear}</dd></div>
            <div><dt>{messages.programs.intake}</dt><dd>{intakeLabels[cycle.intake]}</dd></div>
            <div><dt>{messages.programs.applicationStatus}</dt><dd>{applicationStateLabel}</dd></div>
            <div><dt>{messages.programs.datePublished}</dt><dd>{messages.programs[cycle.dateStatus === 'published' ? 'datePublished' : cycle.dateStatus === 'rolling' ? 'rolling' : cycle.dateStatus === 'not-announced' ? 'notAnnounced' : 'previousCycle']}</dd></div>
            <div><dt>{messages.programs.evidenceBasis}</dt><dd>{evidenceBasis}</dd></div>
            <div><dt>{messages.programs.opens}</dt><dd>{formatDate(cycle.opensOn, locale, messages.common.unknown)}</dd></div>
            <div><dt>{messages.common.deadline}</dt><dd>{formatDate(cycle.closesOn, locale, messages.common.unknown)}</dd></div>
            <div><dt>{messages.common.tuition}</dt><dd>{tuition}</dd></div>
            <div><dt>{messages.programs.fee}</dt><dd>{formatCny(cycle.applicationFeeCny, locale, messages.common.unknown)}</dd></div>
          </dl>
          <div className="notice">{messages.common.authoritativeNotice}</div>
        </article>

        {related.length ? <div>
          <SectionHeading title={messages.programs.related} level={2} />
          <div className="content-grid">
            {related.map((item) => <ProgramCard
              key={item.id}
              program={item}
              university={university}
              cycle={selectAdmissionCycle(data.admissionCycles, item.id, today)}
              locale={locale}
              messages={messages}
              today={today}
            />)}
          </div>
        </div> : null}

        {scholarships.length ? <div>
          <SectionHeading
            title={messages.universities.funding}
            description={messages.scholarships.catalogueNotice}
            level={2}
          />
          <div className="content-grid">
            {scholarships.map((scholarship) => <ScholarshipCard
              key={scholarship.id}
              scholarship={scholarship}
              locale={locale}
              messages={messages}
            />)}
          </div>
        </div> : null}
      </div>

      <aside className="detail-aside">
        <Card accent="jade">
          <h2 className="atlas-card__title">{messages.programs.sources}</h2>
          <dl className="record-facts">
            <div><dt>{messages.common.lastVerified}</dt><dd>{formatDate(program.verifiedAt, locale, '—')}</dd></div>
            <div><dt>{messages.common.status}</dt><dd><Badge tone="jade">{messages.common.verified}</Badge></dd></div>
          </dl>
          <ul className="source-list">
            {sources.map((source) => <li key={source.id}>
              <a href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a>
              <small>{source.publisher} · {formatDate(source.accessedAt, locale, '—')}</small>
            </li>)}
          </ul>
          <div className="atlas-card__footer">
            <a className="text-link" href={program.programUrl} target="_blank" rel="noreferrer">{messages.common.officialSource} ↗</a>
          </div>
        </Card>
      </aside>
    </section>
  </>
}
