import { notFound } from 'next/navigation'
import { Badge, Card, PageHero } from '@/components/ui'
import { getMessages } from '@/i18n/messages'
import { pageMetadata, requireLocale } from '@/lib/site'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const locale = requireLocale((await params).locale) || 'en'
  const copy = getMessages(locale).updates
  return pageMetadata(locale, copy.title, copy.description, 'updates')
}

export default async function UpdatesPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = requireLocale((await params).locale)
  if (!locale) notFound()
  const copy = getMessages(locale).updates
  return <>
    <PageHero variant="compact" eyebrow={copy.eyebrow} title={copy.title} description={copy.description} />
    <section className="atlas-container atlas-section">
      <div className="update-timeline">
        <Card accent="vermilion">
          <div className="record-card__top"><Badge tone="vermilion">2026-07-20</Badge><Badge tone="jade">{copy.badge}</Badge></div>
          <h2 className="atlas-card__title">{copy.releaseTitle}</h2>
          <ul>{copy.items.map((item) => <li key={item}>{item}</li>)}</ul>
        </Card>
      </div>
    </section>
  </>
}
