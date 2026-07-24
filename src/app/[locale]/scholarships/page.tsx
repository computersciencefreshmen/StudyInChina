import { notFound } from 'next/navigation'
import { ScholarshipCard } from '@/components/features/ScholarshipCard'
import { PageHero } from '@/components/ui'
import { getMessages } from '@/i18n/messages'
import { getCatalogData } from '@/lib/data/load'
import { pageMetadata, requireLocale } from '@/lib/site'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) { const locale = requireLocale((await params).locale) || 'en'; const m = getMessages(locale); return pageMetadata(locale, m.scholarships.title, m.scholarships.intro, 'scholarships') }
export default async function ScholarshipsPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = requireLocale((await params).locale); if (!locale) notFound(); const messages = getMessages(locale); const data = await getCatalogData()
  return <><PageHero variant="compact" eyebrow={`${data.scholarships.length} ${messages.nav.scholarships}`} title={messages.scholarships.title} description={messages.scholarships.intro} meta={<><span>{messages.common.authoritativeNotice}</span></>} /><section className="atlas-container atlas-section"><div className="notice scholarship-notice">{messages.scholarships.catalogueNotice}</div><div className="content-grid">{data.scholarships.map((scholarship) => <ScholarshipCard key={scholarship.id} scholarship={scholarship} locale={locale} messages={messages} />)}</div></section></>
}
