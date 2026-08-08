import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Badge, Card, PageHero } from '@/components/ui'
import { launchLocales } from '@/i18n/config'
import { getCityGuideExperience } from '@/i18n/city-guide-experience'
import { getMessages } from '@/i18n/messages'
import { formatDate, localize } from '@/lib/data/format'
import { getGuideEnhancement } from '@/lib/guide-experience'
import { getGuide, guides } from '@/lib/guides'
import { pageMetadata, requireLocale, siteUrl } from '@/lib/site'

export function generateStaticParams() {
  return launchLocales.flatMap((locale) => guides.map(({ slug }) => ({ locale, slug })))
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale: raw, slug } = await params
  const locale = requireLocale(raw) || 'en'
  const guide = getGuide(slug)
  if (!guide) return {}
  return pageMetadata(locale, localize(guide.title, locale), localize(guide.summary, locale), `guides/${slug}`)
}

function jsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

export default async function GuideDetail({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale: raw, slug } = await params
  const locale = requireLocale(raw)
  if (!locale) notFound()

  const guide = getGuide(slug)
  if (!guide) notFound()

  const messages = getMessages(locale)
  const experience = getCityGuideExperience(locale).guides
  const enhancement = getGuideEnhancement(guide.slug)
  const updatedAt = enhancement?.updatedAt ?? guide.updatedAt
  const readTime = enhancement?.readTimeMinutes ?? Math.max(4, guide.sections.length * 2)
  const chapters = enhancement?.chapters ?? guide.sections.map((section, index) => ({
    id: `step-${index + 1}`,
    title: section.title,
    introduction: null,
    items: section.items,
  }))
  const canonicalUrl = new URL(`/${locale}/guides/${guide.slug}`, siteUrl).toString()
  const articleStructuredData = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: localize(guide.title, locale),
    description: localize(guide.summary, locale),
    datePublished: guide.updatedAt,
    dateModified: updatedAt,
    inLanguage: locale,
    mainEntityOfPage: canonicalUrl,
    author: { '@type': 'Organization', name: messages.brand },
    publisher: { '@type': 'Organization', name: messages.brand },
    articleSection: chapters.map((chapter) => localize(chapter.title, locale)),
  }
  const faqStructuredData = enhancement?.faq.length ? {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: enhancement.faq.map((item) => ({
      '@type': 'Question',
      name: localize(item.question, locale),
      acceptedAnswer: { '@type': 'Answer', text: localize(item.answer, locale) },
    })),
  } : null

  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(articleStructuredData) }} />
    {faqStructuredData && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(faqStructuredData) }} />}
    <PageHero
      variant="compact"
      eyebrow={`${messages.common.lastVerified}: ${formatDate(updatedAt, locale, updatedAt)}`}
      title={localize(guide.title, locale)}
      description={localize(guide.summary, locale)}
      meta={<><span>{chapters.length} {experience.chapters}</span><span>{readTime} {experience.minuteRead}</span></>}
    />
    <article className="atlas-container atlas-section guide-article">
      <div className="guide-article__body">
        <div className="guide-steps">
          {chapters.map((chapter, chapterIndex) => <section className="prose-panel guide-chapter" id={chapter.id} key={chapter.id}>
            <Badge tone={chapterIndex === 0 ? 'vermilion' : 'jade'}>{String(chapterIndex + 1).padStart(2, '0')}</Badge>
            <h2>{localize(chapter.title, locale)}</h2>
            {chapter.introduction && <p className="guide-chapter__intro">{localize(chapter.introduction, locale)}</p>}
            <ol>{chapter.items.map((item, index) => <li key={index}>{localize(item, locale)}</li>)}</ol>
          </section>)}
        </div>

        {enhancement?.sources.length ? <section className="prose-panel guide-sources" id="official-sources">
          <Badge tone="jade">{experience.officialSources}</Badge>
          <h2>{experience.officialSources}</h2>
          <p>{experience.sourcesIntro}</p>
          <ul className="source-list">
            {enhancement.sources.map((source) => <li key={source.url}>
              <a href={source.url} target="_blank" rel="noreferrer">{localize(source.title, locale)} ↗</a>
              <span>{localize(source.publisher, locale)}</span>
              <small>{experience.checkedOn}: {formatDate(source.checkedAt, locale, source.checkedAt)}</small>
            </li>)}
          </ul>
        </section> : null}

        {enhancement?.faq.length ? <section className="prose-panel guide-faq" id="frequently-asked-questions">
          <Badge tone="neutral">FAQ</Badge>
          <h2>{experience.faq}</h2>
          <div className="guide-faq__list">
            {enhancement.faq.map((item, index) => <details key={index}>
              <summary>{localize(item.question, locale)}</summary>
              <p>{localize(item.answer, locale)}</p>
            </details>)}
          </div>
        </section> : null}

        {enhancement?.relatedLinks.length ? <section className="guide-related" aria-labelledby="guide-related-title">
          <h2 id="guide-related-title">{experience.related}</h2>
          <div className="guide-related__grid">
            {enhancement.relatedLinks.map((item) => <Link href={`/${locale}/${item.path}`} key={item.path}>
              <strong>{localize(item.title, locale)}</strong>
              <span>{localize(item.description, locale)}</span>
              <i aria-hidden="true">→</i>
            </Link>)}
          </div>
        </section> : null}
      </div>

      <aside className="guide-aside">
        <Card>
          <nav className="guide-toc" aria-labelledby="guide-toc-title">
            <h2 className="atlas-card__title" id="guide-toc-title">{experience.contents}</h2>
            <ol>
              {chapters.map((chapter, index) => <li key={chapter.id}>
                <a href={`#${chapter.id}`}><span>{String(index + 1).padStart(2, '0')}</span>{localize(chapter.title, locale)}</a>
              </li>)}
              {enhancement?.sources.length ? <li><a href="#official-sources"><span>↗</span>{experience.officialSources}</a></li> : null}
              {enhancement?.faq.length ? <li><a href="#frequently-asked-questions"><span>?</span>{experience.faq}</a></li> : null}
            </ol>
          </nav>
        </Card>
        <Card accent="jade">
          <h2 className="atlas-card__title">{messages.guide.usingTitle}</h2>
          <p>{messages.common.authoritativeNotice}</p>
          <p className="atlas-card__description">{messages.guide.disclaimer}</p>
        </Card>
      </aside>
    </article>
  </>
}
