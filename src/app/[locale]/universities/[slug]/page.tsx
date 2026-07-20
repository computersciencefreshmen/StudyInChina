import { notFound } from 'next/navigation'
import { Badge, Card, LinkButton, PageHero, SectionHeading, VerificationBadge } from '@/components/ui'
import { ProgramCard } from '@/components/features/RecordCards'
import { launchLocales } from '@/i18n/config'
import { getMessages } from '@/i18n/messages'
import { selectAdmissionCycle } from '@/lib/data/admission'
import { formatDate, localize } from '@/lib/data/format'
import { getTodayDate } from '@/lib/data/freshness'
import { disciplineLabels, regionLabels } from '@/lib/data/labels'
import { getData, getUniversityBySlug } from '@/lib/data/load'
import { pageMetadata, requireLocale } from '@/lib/site'

export function generateStaticParams() { const data = getData(); return launchLocales.flatMap((locale) => data.universities.map(({ slug }) => ({ locale, slug }))) }
export async function generateMetadata({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale: raw, slug } = await params; const locale = requireLocale(raw) || 'en'; const university = getUniversityBySlug(slug)
  if (!university) return {}; return pageMetadata(locale, localize(university.name, locale), localize(university.summary, locale), `universities/${slug}`)
}

export default async function UniversityDetailPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale: raw, slug } = await params; const locale = requireLocale(raw); if (!locale) notFound()
  const university = getUniversityBySlug(slug); if (!university) notFound()
  const messages = getMessages(locale); const data = getData(); const city = data.cities.find((item) => item.id === university.cityId)
  const programs = data.programs.filter((item) => item.universityId === university.id); const fields = [...new Set(programs.map((item) => item.discipline))]
  const scholarships = data.scholarships.filter((item) => item.universityIds.includes(university.id))
  const today = getTodayDate()
  const sources = data.sources.filter((source) => university.sourceIds.includes(source.id) || programs.some((program) => program.sourceIds.includes(source.id)))
  const copy = messages.universities
  const jsonLd = { '@context': 'https://schema.org', '@type': 'CollegeOrUniversity', name: localize(university.name, locale), url: university.officialUrl, address: city ? { '@type': 'PostalAddress', addressLocality: localize(city.name, locale), addressCountry: 'CN' } : undefined }

  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
    <PageHero variant="compact" eyebrow={city ? `${localize(city.name, locale)} · ${regionLabels(locale)[university.region]}` : regionLabels(locale)[university.region]} title={localize(university.name, locale)} description={localize(university.summary, locale)} actions={<><a className="atlas-button atlas-button--primary atlas-button--medium" href={university.admissionsUrl} target="_blank" rel="noreferrer">{copy.admission} ↗</a><a className="atlas-button atlas-button--ghost atlas-button--medium" href={university.officialUrl} target="_blank" rel="noreferrer">{copy.official} ↗</a></>} meta={<VerificationBadge status={university.status} verifiedAt={university.verifiedAt} locale={locale} verifiedDateLabel={messages.common.lastVerified} labels={{ verified: messages.common.verified, stale: messages.common.stale, draft: messages.common.draft, archived: messages.common.archived }} />} />
    <section className="atlas-container atlas-section">
      <div className="stat-strip">
        <div className="stat"><strong>{programs.length}</strong><span>{copy.programs}</span></div>
        <div className="stat"><strong>{scholarships.length}</strong><span>{copy.funding}</span></div>
        <div className="stat"><strong>{fields.length}</strong><span>{messages.programs.discipline}</span></div>
        <div className="stat"><strong>{city ? localize(city.name, locale) : '—'}</strong><span>{messages.common.city}</span></div>
      </div>
    </section>
    <section className="atlas-container section-block--tight detail-layout">
      <div className="detail-main">
        <div className="prose-panel"><h2>{copy.facts}</h2><p>{localize(university.summary, locale)}</p><div className="tag-list">{fields.map((field) => <Badge key={field} tone="neutral">{disciplineLabels(locale)[field]}</Badge>)}</div></div>
        <div><SectionHeading title={copy.programs} description={messages.common.authoritativeNotice} level={2} />{programs.length ? <div className="content-grid content-grid--two">{programs.map((program) => <ProgramCard key={program.id} program={program} university={university} cycle={selectAdmissionCycle(data.admissionCycles, program.id, today)} locale={locale} messages={messages} today={today} />)}</div> : null}</div>
        {scholarships.length ? <div><SectionHeading title={copy.funding} level={2} /><div className="content-grid content-grid--two">{scholarships.map((scholarship) => <Card key={scholarship.id}><Badge tone="gold">{scholarship.providerType.toUpperCase()}</Badge><h3 className="atlas-card__title">{localize(scholarship.name, locale)}</h3><p className="atlas-card__description">{localize(scholarship.summary, locale)}</p><div className="atlas-card__footer"><LinkButton href={`/${locale}/scholarships/${scholarship.slug}`} variant="quiet">{messages.common.viewDetails} →</LinkButton></div></Card>)}</div></div> : null}
      </div>
      <aside className="detail-aside">
        <Card accent="jade"><h2 className="atlas-card__title">{copy.sources}</h2><dl className="record-facts"><div><dt>{messages.common.lastVerified}</dt><dd>{formatDate(university.verifiedAt, locale, '—')}</dd></div><div><dt>{copy.review}</dt><dd>{formatDate(university.reviewAfter, locale, '—')}</dd></div></dl><ul className="source-list">{sources.map((source) => <li key={source.id}><a href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a><small>{source.publisher}</small></li>)}</ul></Card>
        <div className="notice">{messages.common.authoritativeNotice}</div>
      </aside>
    </section>
  </>
}
