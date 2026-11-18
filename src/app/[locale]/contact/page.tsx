import { resolveUnifiedProgram } from '@/lib/unified-programs'
import { getTodayDate } from '@/lib/data/freshness'
import { localize } from '@/lib/data/format'
import { consultationLabels } from '@/i18n/program-consultation'
import { notFound } from 'next/navigation'
import { Card, PageHero } from '@/components/ui'
import { ContactForm } from '@/components/features/ContactForm'
import { getMessages } from '@/i18n/messages'
import { pageMetadata, requireLocale } from '@/lib/site'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) { const locale = requireLocale((await params).locale) || 'en'; const m = getMessages(locale); return pageMetadata(locale, m.contact.title, m.contact.intro, 'contact') }
export default async function ContactPage({ params, searchParams }: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ program?: string | string[] }>
}) {
  const locale = requireLocale((await params).locale)
  if (!locale) notFound()
  const messages = getMessages(locale), ref = (await searchParams).program
  let program: { id: string; name: string } | undefined
  if (ref !== undefined) {
    if (typeof ref !== 'string' || !/^[a-z0-9][a-z0-9:_-]{0,199}$/.test(ref)) notFound()
    const result = await resolveUnifiedProgram(ref, getTodayDate())
    if (!result) notFound()
    program = 'collected' in result.item ? { id: result.item.collected.id, name: result.item.collected.name }
      : { id: result.item.program.id, name: localize(result.item.program.name, locale) }
  }
  return <>
    <PageHero variant="compact" eyebrow={messages.nav.contact} title={program ? consultationLabels[locale] : messages.contact.title}
      description={program?.name || messages.contact.intro} />
    <section className="atlas-container atlas-section contact-layout">
      <Card accent="vermilion"><ContactForm messages={messages} program={program} siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY} /></Card>
      <aside className="detail-aside"><Card accent="jade"><h2 className="atlas-card__title">{messages.contact.privacyTitle}</h2>
        <p>{messages.contact.sensitiveNotice}</p>{!program && <p className="atlas-card__description">{messages.contact.sourceSuggestion}</p>}</Card>
        <Card><h2 className="atlas-card__title">Henry Yang</h2><p>{messages.about.creatorText}</p>
          <a className="text-link" href="https://yanghanyu2023.wixsite.com/henry" target="_blank" rel="noreferrer">{messages.contact.creatorWebsite} ↗</a></Card>
      </aside>
    </section>
  </>
}
