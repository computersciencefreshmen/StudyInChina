import { notFound } from 'next/navigation'
import { PolicyPage } from '@/components/features/PolicyPage'
import { getMessages } from '@/i18n/messages'
import { pageMetadata, requireLocale } from '@/lib/site'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const locale = requireLocale((await params).locale) || 'en'
  const copy = getMessages(locale).legal.disclaimer
  return pageMetadata(locale, copy.title, copy.intro, 'disclaimer')
}

export default async function DisclaimerPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = requireLocale((await params).locale)
  if (!locale) notFound()
  const copy = getMessages(locale).legal.disclaimer
  return <PolicyPage locale={locale} eyebrow={copy.eyebrow} title={copy.title} intro={copy.intro} sections={copy.sections} />
}
