import { notFound } from 'next/navigation'
import { Card, PageHero } from '@/components/ui'
import { ContactForm } from '@/components/features/ContactForm'
import { getMessages } from '@/i18n/messages'
import { pageMetadata, requireLocale } from '@/lib/site'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) { const locale = requireLocale((await params).locale) || 'en'; const m = getMessages(locale); return pageMetadata(locale, m.contact.title, m.contact.intro, 'contact') }
export default async function ContactPage({ params }: { params: Promise<{ locale: string }> }) { const locale = requireLocale((await params).locale); if (!locale) notFound(); const messages = getMessages(locale); return <><PageHero variant="compact" eyebrow={messages.nav.contact} title={messages.contact.title} description={messages.contact.intro} /><section className="atlas-container atlas-section contact-layout"><Card accent="vermilion"><ContactForm messages={messages} siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY} /></Card><aside className="detail-aside"><Card accent="jade"><h2 className="atlas-card__title">{messages.contact.privacyTitle}</h2><p>{messages.contact.sensitiveNotice}</p><p className="atlas-card__description">{messages.contact.sourceSuggestion}</p></Card><Card><h2 className="atlas-card__title">Henry Yang</h2><p>{messages.about.creatorText}</p><a className="text-link" href="https://yanghanyu2023.wixsite.com/henry" target="_blank" rel="noreferrer">{messages.contact.creatorWebsite} ↗</a></Card></aside></section></> }
