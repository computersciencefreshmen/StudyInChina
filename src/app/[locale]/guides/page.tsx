import { notFound } from 'next/navigation'
import { Badge, Card, LinkButton, PageHero, SectionHeading } from '@/components/ui'
import { getCityGuideExperience } from '@/i18n/city-guide-experience'
import { getMessages } from '@/i18n/messages'
import { formatDate, localize } from '@/lib/data/format'
import { getGuideEnhancement } from '@/lib/guide-experience'
import { guides } from '@/lib/guides'
import { pageMetadata, requireLocale } from '@/lib/site'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const locale = requireLocale((await params).locale) || 'en'
  const messages = getMessages(locale)
  return pageMetadata(locale, messages.guide.title, messages.guide.intro, 'guides')
}

export default async function GuidesPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = requireLocale((await params).locale)
  if (!locale) notFound()

  const messages = getMessages(locale)
  const experience = getCityGuideExperience(locale).guides
  const flagshipGuides = guides.filter((guide) => getGuideEnhancement(guide.slug))
  const checklistGuides = guides.filter((guide) => !getGuideEnhancement(guide.slug))

  const renderGuide = (guide: (typeof guides)[number], index: number, flagship: boolean) => {
    const enhancement = getGuideEnhancement(guide.slug)
    const chapterCount = enhancement?.chapters.length ?? guide.sections.length
    const updatedAt = enhancement?.updatedAt ?? guide.updatedAt
    const readTime = enhancement?.readTimeMinutes ?? Math.max(4, chapterCount * 2)

    return <Card
      key={guide.slug}
      accent={flagship ? 'vermilion' : index === 0 ? 'jade' : 'none'}
      className={`record-card guide-library-card${flagship ? ' guide-library-card--flagship' : ''}`}
    >
      <div className="record-card__top">
        <Badge tone={flagship ? 'vermilion' : 'neutral'}>{flagship ? experience.flagship : experience.checklist}</Badge>
        <time className="atlas-muted" dateTime={updatedAt}>{formatDate(updatedAt, locale, updatedAt)}</time>
      </div>
      <h2 className="record-card__title">{localize(guide.title, locale)}</h2>
      <p className="record-card__summary">{localize(guide.summary, locale)}</p>
      <div className="guide-library-card__meta" aria-label={`${chapterCount} ${experience.chapters}, ${readTime} ${experience.minuteRead}`}>
        <span><b>{chapterCount}</b> {experience.chapters}</span>
        <span><b>{readTime}</b> {experience.minuteRead}</span>
      </div>
      <div className="atlas-card__footer">
        <LinkButton href={`/${locale}/guides/${guide.slug}`} variant={flagship ? 'primary' : 'quiet'}>
          {experience.openGuide} →
        </LinkButton>
      </div>
    </Card>
  }

  return <>
    <PageHero variant="compact" eyebrow={messages.guide.eyebrow} title={messages.guide.title} description={messages.guide.intro} />
    <section className="atlas-container atlas-section guide-library">
      <SectionHeading eyebrow="01" title={experience.flagship} description={messages.guide.intro} />
      <div className="guide-library__flagships">
        {flagshipGuides.map((guide, index) => renderGuide(guide, index, true))}
      </div>
      <SectionHeading eyebrow="02" title={experience.checklist} />
      <div className="content-grid">
        {checklistGuides.map((guide, index) => renderGuide(guide, index, false))}
      </div>
    </section>
  </>
}
