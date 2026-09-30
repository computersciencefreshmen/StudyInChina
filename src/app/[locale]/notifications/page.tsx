import { notFound } from 'next/navigation'
import { NotificationCenter } from '@/components/features/NotificationCenter'
import { PageHero } from '@/components/ui'
import { getSiteNotificationCopy } from '@/lib/site-notifications'
import { pageMetadata, requireLocale } from '@/lib/site'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const locale = requireLocale((await params).locale) || 'en'
  const copy = getSiteNotificationCopy(locale)
  return { ...pageMetadata(locale, copy.title, copy.intro, 'notifications'), robots: { index: false, follow: true } }
}

export default async function NotificationsPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = requireLocale((await params).locale)
  if (!locale) notFound()
  const copy = getSiteNotificationCopy(locale)
  return <><PageHero variant="compact" eyebrow={copy.eyebrow} title={copy.title} description={copy.intro} />
    <section className="atlas-container atlas-section"><NotificationCenter locale={locale} /></section></>
}
