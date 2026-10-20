import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import { ApplicationSummaryCard } from '@/components/features/ApplicationSummaryCard'
import { DataFreshnessPanel } from '@/components/features/DataFreshnessPanel'
import { SourceTransparency } from '@/components/features/SourceTransparency'
import { Badge, Card, PageHero, VerificationBadge } from '@/components/ui'
import { indexedLocales } from '@/i18n/config'
import { formatUniversityCoverage, getDecisionExperienceCopy } from '@/i18n/decision-experience'
import { getMessages } from '@/i18n/messages'
import { selectScholarshipPrebuildSlugs } from '@/lib/data/detail-prebuild'
import { formatCny, formatDate, localize } from '@/lib/data/format'
import { getTodayDate } from '@/lib/data/freshness'
import { getCatalogData, getData } from '@/lib/data/load'
import { coverageLabel, providerLabel } from '@/lib/data/scholarship'
import { isIndexableScholarship } from '@/lib/seo/indexability'
import { selectScholarshipCurrentCycle } from '@/lib/scholarship-catalog'
import { pageMetadata, requireLocale } from '@/lib/site'

export const dynamicParams = true

export function generateStaticParams() {
  const data = getData()
  const slugs = selectScholarshipPrebuildSlugs(data, getTodayDate())
  return indexedLocales.flatMap((locale) => slugs.map((slug) => ({ locale, slug })))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>
}) {
  // Evaluate publication and admission dates for this request, not a cached build day.
  await connection()
  const { locale: raw, slug } = await params
  const locale = requireLocale(raw) || 'en'
  const data = await getCatalogData()
  const item = data.scholarships.find((scholarship) => scholarship.slug === slug)
  if (!item) return {}

  return pageMetadata(
    locale,
    localize(item.name, locale),
    localize(item.summary, locale),
    `scholarships/${slug}`,
    { indexable: isIndexableScholarship(item) },
  )
}

export default async function ScholarshipDetail({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>
}) {
  // Evaluate publication and admission dates for this request, not a cached build day.
  await connection()
  const { locale: raw, slug } = await params
  const locale = requireLocale(raw)
  if (!locale) notFound()

  const data = await getCatalogData()
  const item = data.scholarships.find((scholarship) => scholarship.slug === slug)
  if (!item) notFound()

  const messages = getMessages(locale)
  const decisionCopy = getDecisionExperienceCopy(locale)
  const universities = data.universities.filter((university) => (
    item.universityIds.includes(university.id)
  ))
  const sources = data.sources.filter((source) => item.sourceIds.includes(source.id))
  const lastSourceCheckedAt = sources.map((source) => source.accessedAt).sort().at(-1)
    ?? item.verifiedAt
  const copy = messages.scholarships
  const universityCoverage = formatUniversityCoverage(item.universityIds.length, locale, messages.common.all)
  const fundingHighlights = [
    item.coverage.tuition !== 'unknown' ? coverageLabel(item.coverage.tuition, locale) : null,
    item.coverage.stipendCnyPerMonth !== null ? formatCny(item.coverage.stipendCnyPerMonth, locale, '') : null,
  ].filter(value => value !== null).join(' · ')
  const isStaleIdentity = item.status === 'stale'
  const today = getTodayDate()
  const currentCycle = selectScholarshipCurrentCycle(item, today)
  const deadlineLabels = {
    future: decisionCopy.deadlineAhead,
    closed: decisionCopy.deadlineClosed,
    'not-announced': messages.programs.notAnnounced,
  }
  const deadlineTones = {
    future: 'jade',
    closed: 'neutral',
    'not-announced': 'warning',
  } as const
  const deadlineLabel = isStaleIdentity ? messages.common.stale : deadlineLabels[currentCycle.deadlineState]
  const deadlineTone = isStaleIdentity ? 'warning' as const : deadlineTones[currentCycle.deadlineState]

  return <>
    <PageHero
      variant="compact"
      eyebrow={providerLabel(item.providerType, locale)}
      title={localize(item.name, locale)}
      description={item.summary ? localize(item.summary, locale) : undefined}
      actions={item.status === 'verified' && item.applicationUrl ? (
        <a
          className="atlas-button atlas-button--secondary atlas-button--medium"
          href={item.applicationUrl}
          target="_blank"
          rel="noreferrer"
        >
          {decisionCopy.officialApplicationRoute} ↗
        </a>
      ) : undefined}
      meta={(
        <VerificationBadge collection="scholarships" recordId={item.id}
          status={item.status}
          verifiedAt={item.verifiedAt}
          locale={locale}
          verifiedDateLabel={messages.common.lastVerified}
          labels={{
            verified: messages.common.verified,
            stale: messages.common.stale,
            draft: messages.common.draft,
            archived: messages.common.archived,
          }}
        />
      )}
    />
    <div className="atlas-container">
      <DataFreshnessPanel record={item} locale={locale} today={today} />
    </div>
    <section className="atlas-container atlas-section detail-layout" data-scholarship-detail>
      <div className="detail-main">
        {item.coverage.tuition !== 'unknown' || item.coverage.accommodation !== 'unknown' || item.coverage.insurance !== 'unknown' || item.coverage.stipendCnyPerMonth !== null || currentCycle.deadline ? <div className="prose-panel">
          <h2>{copy.coverage}</h2>
          <dl className="detail-facts">
            {item.coverage.tuition !== 'unknown' ? <div><dt>{copy.tuition}</dt><dd>{coverageLabel(item.coverage.tuition, locale)}</dd></div> : null}
            {item.coverage.accommodation !== 'unknown' ? <div><dt>{copy.accommodation}</dt><dd>{coverageLabel(item.coverage.accommodation, locale)}</dd></div> : null}
            {item.coverage.insurance !== 'unknown' ? <div>
              <dt>{copy.insurance}</dt>
              <dd>{item.coverage.insurance ? copy.included : copy.notIncluded}</dd>
            </div> : null}
            {item.coverage.stipendCnyPerMonth !== null ? <div>
              <dt>{copy.stipend}</dt>
              <dd>{formatCny(
                item.coverage.stipendCnyPerMonth,
                locale,
                messages.common.unknown,
              )}</dd>
            </div> : null}
            {currentCycle.deadline ? <div>
              <dt>{messages.common.deadline}</dt>
              <dd>{formatDate(currentCycle.deadline, locale, messages.common.unknown)}</dd>
            </div> : null}
          </dl>
        </div> : null}
        {item.eligibility?.length ? <section className="prose-panel" data-scholarship-eligibility>
          <h2>{messages.programs.eligibility}</h2>
          <ul>{item.eligibility.map((condition, index) => <li key={index}>{localize(condition, locale)}</li>)}</ul>
        </section> : null}
        <div className="prose-panel">
          <h2>{copy.scope}</h2>
          {universities.length ? (
            <ul className="link-list">
              {universities.map((university) => (
                <li key={university.id}>
                  <a href={`/${locale}/universities/${university.slug}`}>
                    {localize(university.name, locale)} →
                  </a>
                </li>
              ))}
            </ul>
          ) : <p>{messages.common.all}</p>}
        </div>
      </div>
      <aside className="detail-aside">
        <ApplicationSummaryCard
          eyebrow={providerLabel(item.providerType, locale)}
          title={decisionCopy.fundingSnapshot}
          status={isStaleIdentity || currentCycle.deadline ? <Badge tone={deadlineTone} dot>{deadlineLabel}</Badge> : undefined}
          accent="none"
          facts={[
            { label: messages.common.deadline, value: currentCycle.deadline
              ? <time dateTime={currentCycle.deadline}>{formatDate(currentCycle.deadline, locale, messages.common.unknown)}</time>
              : null },
            { label: decisionCopy.fundingHighlights, value: fundingHighlights },
            { label: copy.accommodation, value: item.coverage.accommodation !== 'unknown' ? coverageLabel(item.coverage.accommodation, locale) : null },
            { label: messages.common.university, value: universityCoverage },
            { label: messages.common.lastVerified, value: formatDate(item.verifiedAt, locale, '—') },
          ]}
          notice={messages.common.authoritativeNotice}
          actions={item.status === 'verified' && item.applicationUrl
            ? <a className="atlas-button atlas-button--secondary atlas-button--small" href={item.applicationUrl} target="_blank" rel="noreferrer">
                {decisionCopy.officialApplicationRoute} ↗
              </a>
            : sources[0]
              ? <a className="atlas-button atlas-button--secondary atlas-button--small" href={sources[0].url} target="_blank" rel="noreferrer">{messages.common.officialSource} ↗</a>
              : undefined}
        />
        <Card accent="jade" id="official-evidence">
          <h2 className="atlas-card__title">{copy.sources}</h2>
          <div className="tag-list">
            <VerificationBadge collection="scholarships" recordId={item.id}
              status={item.status}
              locale={locale}
              labels={{
                verified: messages.common.verified,
                stale: messages.common.stale,
                draft: messages.common.draft,
                archived: messages.common.archived,
              }}
              showDate={false}
            />
            <Badge tone="neutral">{formatDate(item.verifiedAt, locale, '—')}</Badge>
          </div>
          <ul className="source-list">
            {sources.map((source) => (
              <li key={source.id}>
                <a href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a>
                <small>{source.publisher} · {formatDate(source.accessedAt, locale, '—')}</small>
              </li>
            ))}
          </ul>
          <SourceTransparency
            locale={locale}
            lastCheckedAt={lastSourceCheckedAt}
            lastCheckedLabel={messages.common.sourcesLastChecked}
            notice={messages.common.automatedCollectionNotice}
            reportErrorLabel={messages.common.reportInformationError}
          />
        </Card>
      </aside>
    </section>
  </>
}
