import { notFound } from 'next/navigation'
import { SourceTransparency } from '@/components/features/SourceTransparency'
import { Badge, Card, PageHero, VerificationBadge } from '@/components/ui'
import { launchLocales } from '@/i18n/config'
import { getMessages } from '@/i18n/messages'
import { formatCny, formatDate, localize } from '@/lib/data/format'
import { getData, getScholarshipBySlug } from '@/lib/data/load'
import { coverageLabel, providerLabel } from '@/lib/data/scholarship'
import { pageMetadata, requireLocale } from '@/lib/site'

export function generateStaticParams() {
  const data = getData()
  return launchLocales.flatMap((locale) => (
    data.scholarships.map(({ slug }) => ({ locale, slug }))
  ))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>
}) {
  const { locale: raw, slug } = await params
  const locale = requireLocale(raw) || 'en'
  const item = getScholarshipBySlug(slug)
  if (!item) return {}

  return pageMetadata(
    locale,
    localize(item.name, locale),
    localize(item.summary, locale),
    `scholarships/${slug}`,
  )
}

export default async function ScholarshipDetail({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>
}) {
  const { locale: raw, slug } = await params
  const locale = requireLocale(raw)
  if (!locale) notFound()

  const item = getScholarshipBySlug(slug)
  if (!item) notFound()

  const messages = getMessages(locale)
  const data = getData()
  const universities = data.universities.filter((university) => (
    item.universityIds.includes(university.id)
  ))
  const sources = data.sources.filter((source) => item.sourceIds.includes(source.id))
  const lastSourceCheckedAt = sources.map((source) => source.accessedAt).sort().at(-1)
    ?? item.verifiedAt
  const copy = messages.scholarships

  return <>
    <PageHero
      variant="compact"
      eyebrow={providerLabel(item.providerType, locale)}
      title={localize(item.name, locale)}
      description={localize(item.summary, locale)}
      actions={(
        <a
          className="atlas-button atlas-button--primary atlas-button--medium"
          href={item.applicationUrl}
          target="_blank"
          rel="noreferrer"
        >
          {messages.common.applyOfficial} ↗
        </a>
      )}
      meta={(
        <VerificationBadge
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
    <section className="atlas-container atlas-section detail-layout">
      <div className="detail-main">
        <div className="prose-panel">
          <h2>{copy.coverage}</h2>
          <dl className="detail-facts">
            <div><dt>{copy.tuition}</dt><dd>{coverageLabel(item.coverage.tuition, locale)}</dd></div>
            <div><dt>{copy.accommodation}</dt><dd>{coverageLabel(item.coverage.accommodation, locale)}</dd></div>
            <div>
              <dt>{copy.insurance}</dt>
              <dd>{item.coverage.insurance === 'unknown'
                ? messages.common.unknown
                : item.coverage.insurance ? copy.included : copy.notIncluded}</dd>
            </div>
            <div>
              <dt>{copy.stipend}</dt>
              <dd>{formatCny(
                item.coverage.stipendCnyPerMonth,
                locale,
                messages.common.unknown,
              )}</dd>
            </div>
            <div>
              <dt>{messages.common.deadline}</dt>
              <dd>{formatDate(item.deadline, locale, messages.common.unknown)}</dd>
            </div>
          </dl>
        </div>
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
        <Card accent="jade">
          <h2 className="atlas-card__title">{copy.sources}</h2>
          <div className="tag-list">
            <Badge tone={item.status === 'verified' ? 'jade' : 'warning'}>{item.status}</Badge>
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
