import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import { ApplicationSummaryCard } from '@/components/features/ApplicationSummaryCard'
import { DataFreshnessPanel } from '@/components/features/DataFreshnessPanel'
import { FavoriteButton } from '@/components/features/FavoriteButton'
import { FollowUpdates } from '@/components/features/FollowUpdates'
import { ProgramCard } from '@/components/features/RecordCards'
import { ScholarshipCard } from '@/components/features/ScholarshipCard'
import { SourceTransparency } from '@/components/features/SourceTransparency'
import { Badge, Card, PageHero, SectionHeading, VerificationBadge } from '@/components/ui'
import { indexedLocales } from '@/i18n/config'
import { getDecisionExperienceCopy } from '@/i18n/decision-experience'
import { officialReferenceTuitionCopy } from '@/i18n/tuition-reference'
import { getMessages } from '@/i18n/messages'
import { getApplicationState, isCurrentOfficialReferenceTuition, selectAdmissionCycle } from '@/lib/data/admission'
import { selectProgramPrebuildSlugs } from '@/lib/data/detail-prebuild'
import { formatProgramDuration, hasConfirmedProgramDuration, programIsoDuration } from '@/lib/data/duration'
import { formatCny, formatDate, formatTuition, localize, localizeProgramText } from '@/lib/data/format'
import { getTodayDate, isCurrentVerifiedRecord } from '@/lib/data/freshness'
import { degreeLabels, disciplineLabels, languageLabel } from '@/lib/data/labels'
import { getCatalogData, getData } from '@/lib/data/load'
import { getProgramDisplayDetails } from '@/lib/data/program-details'
import { localizeProgramSource, programSourceHref } from '@/lib/data/program-source-labels'
import { scholarshipAppliesToProgram } from '@/lib/data/scholarship-scope'
import { isIndexableProgram } from '@/lib/seo/indexability'
import { serializeJsonLd } from '@/lib/seo/json-ld'
import { pageMetadata, requireLocale } from '@/lib/site'
import styles from './ProgramDetail.module.css'

export const dynamicParams = true

export function generateStaticParams() {
  const data = getData()
  const slugs = selectProgramPrebuildSlugs(data, getTodayDate())
  return indexedLocales.flatMap((locale) => slugs.map((slug) => ({ locale, slug })))
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  // Evaluate publication and admission dates for this request, not a cached build day.
  await connection()
  const { locale: raw, slug } = await params
  const locale = requireLocale(raw) || 'en'
  const data = await getCatalogData()
  const program = data.programs.find((item) => item.slug === slug)
  if (!program) return {}
  const university = data.universities.find((item) => item.id === program.universityId)
  const title = university
    ? `${localize(program.name, locale)} — ${localize(university.name, locale)}`
    : localize(program.name, locale)

  return pageMetadata(
    locale,
    title,
    `${degreeLabels(locale)[program.degreeLevel]} · ${disciplineLabels(locale)[program.discipline]}`,
    `programs/${slug}`,
    { indexable: isIndexableProgram(program, data.admissionCycles, getTodayDate()) },
  )
}

export default async function ProgramDetailPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  // Evaluate publication and admission dates for this request, not a cached build day.
  await connection()
  const { locale: raw, slug } = await params
  const locale = requireLocale(raw)
  if (!locale) notFound()

  const data = await getCatalogData()
  const program = data.programs.find((item) => item.slug === slug)
  if (!program) notFound()
  const details = getProgramDisplayDetails(program)

  const messages = getMessages(locale)
  const decisionCopy = getDecisionExperienceCopy(locale)
  const university = data.universities.find((item) => item.id === program.universityId)
  if (!university) notFound()

  const city = data.cities.find((item) => item.id === university.cityId)
  const today = getTodayDate()
  const cycle = selectAdmissionCycle(data.admissionCycles, program.id, today)
  if (!details || !hasConfirmedProgramDuration(program) || !cycle) {
    const partialSourceIds = new Set([...program.sourceIds, ...(cycle?.sourceIds ?? [])])
    const sources = data.sources.filter((source) => partialSourceIds.has(source.id))
    const lastSourceCheckedAt = sources.map((source) => source.accessedAt).sort().at(-1)
      ?? program.verifiedAt
    const partialApplicationState = cycle
      ? getApplicationState(cycle, today)
      : 'not-announced'
    const partialApplicationStateLabels = {
      open: messages.common.openNow,
      upcoming: messages.programs.upcoming,
      closed: messages.programs.applicationsClosed,
      rolling: messages.programs.rolling,
      'dates-published': messages.programs.datePublished,
      'not-announced': messages.programs.notAnnounced,
      'previous-cycle': messages.programs.previousCycle,
    }
    const partialApplicationStateTones = {
      open: 'jade',
      upcoming: 'gold',
      closed: 'neutral',
      rolling: 'jade',
      'dates-published': 'blue',
      'not-announced': 'warning',
      'previous-cycle': 'neutral',
    } as const
    const partialApplicationStateLabel = program.status === 'stale'
      ? messages.common.stale
      : partialApplicationStateLabels[partialApplicationState]
    const partialApplicationStateTone = program.status === 'stale' ? 'warning' as const : partialApplicationStateTones[partialApplicationState]
    const partialTuitionPeriodLabels = {
      program: messages.programs.tuitionProgram,
      semester: messages.programs.tuitionSemester,
      'academic-year': messages.programs.tuitionAcademicYear,
      month: messages.programs.tuitionMonth,
      other: messages.programs.tuitionOther,
    }
    const partialDuration = formatProgramDuration(program, locale, messages.common.months)
    const partialReferenceTuition = isCurrentOfficialReferenceTuition(cycle, today)
    const partialTuition = cycle?.tuitionCny == null || cycle.tuitionStatus === 'reference' && !partialReferenceTuition
      ? null
      : formatTuition(cycle, locale, partialTuitionPeriodLabels[cycle.tuitionPeriod || 'other'], messages.common.unknown)
    const partialApplicationFee = cycle?.applicationFeeCny == null
      ? null
      : formatCny(cycle.applicationFeeCny, locale, messages.common.unknown)
    const partialCanApply = isCurrentVerifiedRecord(program, today) && Boolean(cycle && isCurrentVerifiedRecord(cycle, today)) && (partialApplicationState === 'open' || partialApplicationState === 'rolling')
      && Boolean(program.applyUrl)
    return <>
      <PageHero
        variant="compact"
        eyebrow={`${degreeLabels(locale)[program.degreeLevel]} \u00b7 ${disciplineLabels(locale)[program.discipline]}`}
        title={localize(program.name, locale)}
        description={<>
          <span>{localize(university.name, locale)}</span>
          {city ? <span> {'\u00b7'} {localize(city.name, locale)}</span> : null}
        </>}
        actions={partialCanApply && program.applyUrl
          ? <a className="atlas-button atlas-button--primary atlas-button--medium" href={program.applyUrl} target="_blank" rel="noreferrer">{messages.common.applyOfficial} ↗</a>
          : <a className="atlas-button atlas-button--secondary atlas-button--medium" href={program.programUrl} target="_blank" rel="noreferrer">
              {messages.common.officialSource} ↗
            </a>}
        meta={<VerificationBadge collection="programs" recordId={program.id}
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
      <div className="atlas-container">
        <DataFreshnessPanel record={program} cycle={cycle} locale={locale} today={today} />
      </div>
      <section className={`atlas-container atlas-section ${styles.layout}`} data-program-detail>
        <div className={styles.main}>
          <article className={styles.panel}>
            <h2>{messages.programs.overview}</h2>
            <div className="notice">{messages.common.authoritativeNotice}</div>
            {details?.overview ? <p className={styles.lead}>{localize(details.overview, locale)}</p> : null}
            <dl className={styles.facts}>
              <div><dt>{messages.programs.university}</dt><dd><a href={`/${locale}/universities/${university.slug}`}>{localize(university.name, locale)}</a></dd></div>
              {details?.faculty ? <div><dt>{messages.programs.faculty}</dt><dd>{localize(details.faculty, locale)}</dd></div> : null}
              {details?.qualification ? <div><dt>{messages.programs.qualification}</dt><dd>{localize(details.qualification, locale)}</dd></div> : null}
              {details?.studyMode ? <div><dt>{messages.programs.studyMode}</dt><dd>{messages.programs[details.studyMode === 'full-time' ? 'fullTime' : details.studyMode === 'part-time' ? 'partTime' : 'hybrid']}</dd></div> : null}
              {partialDuration !== null ? <div><dt>{messages.common.duration}</dt><dd>{partialDuration}</dd></div> : null}
              {program.teachingLanguages.length ? <div><dt>{messages.common.language}</dt><dd>{program.teachingLanguages.map((item) => languageLabel(item, locale)).join(', ')}</dd></div> : null}
              {program.status === 'stale' || partialApplicationState !== 'not-announced' ? <div><dt>{messages.programs.applicationStatus}</dt><dd>{partialApplicationStateLabel}</dd></div> : null}
              {cycle?.opensOn ? <div><dt>{messages.programs.opens}</dt><dd>{formatDate(cycle.opensOn, locale, '')}</dd></div> : null}
              {cycle?.closesOn ? <div><dt>{messages.common.deadline}</dt><dd>{formatDate(cycle.closesOn, locale, '')}</dd></div> : null}
              {partialTuition !== null ? <div><dt>{partialReferenceTuition ? officialReferenceTuitionCopy(locale).label : messages.common.tuition}</dt><dd>{partialTuition}</dd></div> : null}
              {details?.campus ? <div><dt>{messages.programs.campus}</dt><dd>{localize(details.campus, locale)}</dd></div> : null}
            </dl>
            {details?.languagePolicy ? <><h3>{messages.programs.languagePolicy}</h3><p>{localize(details.languagePolicy, locale)}</p></> : null}
            {partialReferenceTuition ? <p data-fact-status="reference"><strong>{officialReferenceTuitionCopy(locale).notice}</strong></p> : null}
            {cycle?.notes ? <p className={styles.cycleNotes}>{localize(cycle.notes, locale)}</p> : null}
          </article>
          {details && (details.curriculumHighlights.length || details.eligibility.length || details.applicationMaterials.length) ? <article className={`${styles.panel} ${styles.sections}`}>
            {details.curriculumHighlights.length ? <section><h2>{messages.programs.curriculum}</h2><ul>{details.curriculumHighlights.map((item, index) => <li key={index}>{localize(item, locale)}</li>)}</ul></section> : null}
            {details.eligibility.length ? <section><h2>{messages.programs.eligibility}</h2><ul>{details.eligibility.map((item, index) => <li key={index}>{localize(item, locale)}</li>)}</ul></section> : null}
            {details.applicationMaterials.length ? <section><h2>{messages.programs.materials}</h2><ul>{details.applicationMaterials.map((item, index) => <li key={index}>{localize(item, locale)}</li>)}</ul></section> : null}
          </article> : null}
        </div>
        <aside className={styles.aside}>
          <ApplicationSummaryCard
            eyebrow={degreeLabels(locale)[program.degreeLevel]}
            title={decisionCopy.applicationSnapshot}
            status={program.status === 'stale' || partialApplicationState !== 'not-announced' ? <Badge tone={partialApplicationStateTone} dot>{partialApplicationStateLabel}</Badge> : undefined}
            accent={partialCanApply ? 'jade' : 'none'}
            facts={[
              { label: decisionCopy.currentCycle, value: cycle?.academicYear },
              { label: messages.common.deadline, value: cycle?.closesOn
                ? <time dateTime={cycle.closesOn}>{formatDate(cycle.closesOn, locale, messages.common.unknown)}</time>
                : null },
              { label: partialReferenceTuition ? officialReferenceTuitionCopy(locale).label : messages.common.tuition, value: partialTuition && cycle?.tuitionSchedule ? <span className={styles.variableTuitionSummary}>{partialTuition}</span> : partialTuition },
              { label: decisionCopy.applicationFee, value: partialApplicationFee },
              { label: messages.common.lastVerified, value: formatDate(program.verifiedAt, locale, '—') },
            ]}
            notice={partialReferenceTuition ? officialReferenceTuitionCopy(locale).notice : messages.common.authoritativeNotice}
            actions={partialCanApply && program.applyUrl
              ? <a className="atlas-button atlas-button--primary atlas-button--small" href={program.applyUrl} target="_blank" rel="noreferrer">{messages.common.applyOfficial} ↗</a>
              : <a className="atlas-button atlas-button--secondary atlas-button--small" href={program.programUrl} target="_blank" rel="noreferrer">{messages.common.officialSource} ↗</a>}
          />
          <FollowUpdates locale={locale} targets={[{ kind: 'program', id: program.id, label: localize(program.name, locale) }]} />
          <Card accent="jade" id="official-evidence">
            <h2 className="atlas-card__title">{messages.programs.sources}</h2>
            <ul className="source-list">
              {sources.map((source) => {
                const label = localizeProgramSource(source, university, locale)
                return <li key={source.id}>
                  <a href={programSourceHref(source, program)} target="_blank" rel="noreferrer">{label.title}{' \u2197'}</a>
                  <small>{label.publisher} {'\u00b7'} {formatDate(source.accessedAt, locale, '\u2014')}</small>
                </li>
              })}
            </ul>
            <SourceTransparency
              locale={locale}
              lastCheckedAt={lastSourceCheckedAt}
              lastCheckedLabel={messages.common.sourcesLastChecked}
              notice={messages.common.automatedCollectionNotice}
              reportErrorLabel={messages.common.reportInformationError}
              officialLink={{ href: program.programUrl, label: messages.common.officialSource }}
            />
          </Card>
        </aside>
      </section>
    </>
  }

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
  const isAcceptingApplications = isCurrentVerifiedRecord(program, today) && isCurrentVerifiedRecord(cycle, today) && (applicationState === 'open' || applicationState === 'rolling')

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
  const referenceTuition = isCurrentOfficialReferenceTuition(cycle, today)
  const tuition = cycle.tuitionCny === null || cycle.tuitionStatus === 'reference' && !referenceTuition
    ? null
    : formatTuition(cycle, locale, tuitionPeriodLabels[cycle.tuitionPeriod || 'other'], messages.common.unknown)
  const duration = formatProgramDuration(program, locale, messages.common.months)
  const evidenceBasis = cycle.evidenceBasis === 'recurring-official-rule'
    ? messages.programs.recurringRule
    : messages.programs.cycleSpecific
  const requirements = program.languageRequirements.filter((item) => item.test !== 'other').map((item) => (
    `${item.test}${item.minimum ? `: ${localizeProgramText(item.minimum, locale)}` : ''}`
  ))
  const sourceIds = new Set([...program.sourceIds, ...cycle.sourceIds])
  const sources = data.sources.filter((source) => sourceIds.has(source.id))
  const lastSourceCheckedAt = sources.map((source) => source.accessedAt).sort().at(-1)
    ?? program.verifiedAt
  const related = data.programs
    .filter((item) => item.universityId === university.id && item.id !== program.id)
    .slice(0, 3)
  const scholarships = data.scholarships.filter((item) => scholarshipAppliesToProgram(item, program))

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'EducationalOccupationalProgram',
    name: localize(program.name, locale),
    description: details.overview ? localize(details.overview, locale) : undefined,
    provider: {
      '@type': 'CollegeOrUniversity',
      name: localize(university.name, locale),
      url: university.officialUrl,
    },
    url: program.programUrl,
    applicationStartDate: cycle.opensOn || undefined,
    applicationDeadline: cycle.closesOn || undefined,
    educationalCredentialAwarded: details.qualification ? localize(details.qualification, locale) : undefined,
    timeToComplete: programIsoDuration(program),
  }

  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }} />
    <PageHero
      variant="compact"
      eyebrow={`${degreeLabels(locale)[program.degreeLevel]} · ${disciplineLabels(locale)[program.discipline]}`}
      title={localize(program.name, locale)}
      description={<>
        <span>{localize(university.name, locale)}</span>
        {details.campus ? <span> · {localize(details.campus, locale)}</span> : city ? <span> · {localize(city.name, locale)}</span> : null}
      </>}
      actions={<>
        {isAcceptingApplications && program.applyUrl
          ? <a className="atlas-button atlas-button--primary atlas-button--medium" href={program.applyUrl} target="_blank" rel="noreferrer">{messages.common.applyOfficial} ↗</a>
          : <a className="atlas-button atlas-button--secondary atlas-button--medium" href={program.programUrl} target="_blank" rel="noreferrer">
          {messages.common.officialSource}{' \u2197'}
          </a>}
        <FavoriteButton programId={program.id} saveLabel={messages.common.save} savedLabel={messages.common.saved} />
      </>}
      meta={<VerificationBadge collection="programs" recordId={program.id}
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

    <div className="atlas-container">
      <DataFreshnessPanel record={program} cycle={cycle} locale={locale} today={today} />
    </div>
    <section className={`atlas-container atlas-section ${styles.layout}`} data-program-detail>
      <div className={styles.main}>
        <article className={styles.panel}>
          <h2>{messages.programs.overview}</h2>
          {details.overview ? <p className={styles.lead}>{localize(details.overview, locale)}</p> : null}
          <dl className={styles.facts}>
            <div><dt>{messages.programs.university}</dt><dd><a href={`/${locale}/universities/${university.slug}`}>{localize(university.name, locale)}</a></dd></div>
            {details.faculty ? <div><dt>{messages.programs.faculty}</dt><dd>{localize(details.faculty, locale)}</dd></div> : null}
            {details.qualification ? <div><dt>{messages.programs.qualification}</dt><dd>{localize(details.qualification, locale)}</dd></div> : null}
            {details.studyMode ? <div><dt>{messages.programs.studyMode}</dt><dd>{studyModeLabels[details.studyMode]}</dd></div> : null}
            <div><dt>{messages.common.duration}</dt><dd>{duration}</dd></div>
            {program.teachingLanguages.length ? <div><dt>{messages.common.language}</dt><dd>{program.teachingLanguages.map((item) => languageLabel(item, locale)).join(', ')}</dd></div> : null}
            {details.campus ? <div><dt>{messages.programs.campus}</dt><dd>{localize(details.campus, locale)}</dd></div> : null}
            {requirements.length ? <div><dt>{messages.common.requirements}</dt><dd>{requirements.join(' · ')}</dd></div> : null}
          </dl>
          {details.languagePolicy ? <><h3>{messages.programs.languagePolicy}</h3>
          <p>{localize(details.languagePolicy, locale)}</p></> : null}
        </article>

        {details.curriculumHighlights.length || details.eligibility.length || details.applicationMaterials.length ? <article className={`${styles.panel} ${styles.sections}`}>
          {details.curriculumHighlights.length ? <section>
            <h2>{messages.programs.curriculum}</h2>
            <ul>{details.curriculumHighlights.map((item, index) => <li key={index}>{localize(item, locale)}</li>)}</ul>
          </section> : null}
          {details.eligibility.length ? <section>
            <h2>{messages.programs.eligibility}</h2>
            <ul>{details.eligibility.map((item, index) => <li key={index}>{localize(item, locale)}</li>)}</ul>
          </section> : null}
          {details.applicationMaterials.length ? <section>
            <h2>{messages.programs.materials}</h2>
            <ul>{details.applicationMaterials.map((item, index) => <li key={index}>{localize(item, locale)}</li>)}</ul>
          </section> : null}
        </article> : null}

        <article className={styles.panel}>
          <div className={styles.sectionHeader}>
            <h2>{messages.programs.cycle}</h2>
            {applicationState !== 'not-announced' ? <Badge tone={applicationStateTones[applicationState]} dot>{applicationStateLabel}</Badge> : null}
          </div>
          <dl className={styles.facts}>
            <div><dt>{messages.programs.year}</dt><dd>{cycle.academicYear}</dd></div>
            <div><dt>{messages.programs.intake}</dt><dd>{intakeLabels[cycle.intake]}</dd></div>
            {applicationState !== 'not-announced' ? <div><dt>{messages.programs.applicationStatus}</dt><dd>{applicationStateLabel}</dd></div> : null}
            {cycle.dateStatus !== 'not-announced' ? <div><dt>{messages.programs.datePublished}</dt><dd>{messages.programs[cycle.dateStatus === 'published' ? 'datePublished' : cycle.dateStatus === 'rolling' ? 'rolling' : 'previousCycle']}</dd></div> : null}
            {cycle.evidenceBasis ? <div><dt>{messages.programs.evidenceBasis}</dt><dd>{evidenceBasis}</dd></div> : null}
            {cycle.opensOn ? <div><dt>{messages.programs.opens}</dt><dd>{formatDate(cycle.opensOn, locale, '')}</dd></div> : null}
            {cycle.closesOn ? <div><dt>{messages.common.deadline}</dt><dd>{formatDate(cycle.closesOn, locale, '')}</dd></div> : null}
            {tuition !== null ? <div><dt>{referenceTuition ? officialReferenceTuitionCopy(locale).label : messages.common.tuition}</dt><dd>{tuition}</dd></div> : null}
            {cycle.applicationFeeCny !== null ? <div><dt>{messages.programs.fee}</dt><dd>{formatCny(cycle.applicationFeeCny, locale, '')}</dd></div> : null}
          </dl>
          {referenceTuition ? <p data-fact-status="reference"><strong>{officialReferenceTuitionCopy(locale).notice}</strong></p> : null}
          {cycle.notes ? <p className={styles.cycleNotes}>{localize(cycle.notes, locale)}</p> : null}
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
              today={today}
            />)}
          </div>
        </div> : null}
      </div>

      <aside className={styles.aside}>
        <ApplicationSummaryCard
          eyebrow={degreeLabels(locale)[program.degreeLevel]}
          title={decisionCopy.applicationSnapshot}
          status={applicationState !== 'not-announced' ? <Badge tone={applicationStateTones[applicationState]} dot>{applicationStateLabel}</Badge> : undefined}
          accent={isAcceptingApplications ? 'jade' : 'none'}
          facts={[
            { label: decisionCopy.currentCycle, value: cycle.academicYear },
            { label: messages.common.deadline, value: cycle.closesOn
              ? <time dateTime={cycle.closesOn}>{formatDate(cycle.closesOn, locale, messages.common.unknown)}</time>
              : null },
            { label: referenceTuition ? officialReferenceTuitionCopy(locale).label : messages.common.tuition, value: tuition && cycle.tuitionSchedule ? <span className={styles.variableTuitionSummary}>{tuition}</span> : tuition },
            { label: decisionCopy.applicationFee, value: cycle.applicationFeeCny === null ? null : formatCny(cycle.applicationFeeCny, locale, '') },
            { label: messages.common.lastVerified, value: formatDate(program.verifiedAt, locale, '—') },
          ]}
          notice={referenceTuition ? officialReferenceTuitionCopy(locale).notice : messages.common.authoritativeNotice}
          actions={isAcceptingApplications && program.applyUrl
            ? <a className="atlas-button atlas-button--primary atlas-button--small" href={program.applyUrl} target="_blank" rel="noreferrer">{messages.common.applyOfficial} ↗</a>
            : <a className="atlas-button atlas-button--secondary atlas-button--small" href={program.programUrl} target="_blank" rel="noreferrer">{messages.common.officialSource} ↗</a>}
        />
        <FollowUpdates locale={locale} targets={[{ kind: 'program', id: program.id, label: localize(program.name, locale) }]} />
        <Card accent="jade" id="official-evidence">
          <h2 className="atlas-card__title">{messages.programs.sources}</h2>
          <dl className="record-facts">
            <div><dt>{messages.common.lastVerified}</dt><dd>{formatDate(program.verifiedAt, locale, '—')}</dd></div>
            <div><dt>{messages.common.status}</dt><dd><VerificationBadge collection="programs" recordId={program.id} status={program.status} locale={locale} showDate={false} labels={{ verified: messages.common.verified, stale: messages.common.stale, draft: messages.common.draft, archived: messages.common.archived }} /></dd></div>
          </dl>
          <ul className="source-list">
            {sources.map((source) => {
              const label = localizeProgramSource(source, university, locale)
              return <li key={source.id}>
                <a href={programSourceHref(source, program)} target="_blank" rel="noreferrer">{label.title} ↗</a>
                <small>{label.publisher} · {formatDate(source.accessedAt, locale, '—')}</small>
              </li>
            })}
          </ul>
          <SourceTransparency
            locale={locale}
            lastCheckedAt={lastSourceCheckedAt}
            lastCheckedLabel={messages.common.sourcesLastChecked}
            notice={messages.common.automatedCollectionNotice}
            reportErrorLabel={messages.common.reportInformationError}
            officialLink={{ href: program.programUrl, label: messages.common.officialSource }}
          />
        </Card>
      </aside>
    </section>
  </>
}
