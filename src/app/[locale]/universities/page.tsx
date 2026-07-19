import { notFound } from 'next/navigation'
import { UniversityExplorer } from '@/components/features/UniversityExplorer'
import { PageHero } from '@/components/ui'
import { getMessages } from '@/i18n/messages'
import { getData } from '@/lib/data/load'
import { pageMetadata, requireLocale } from '@/lib/site'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) { const locale = requireLocale((await params).locale) || 'en'; const m = getMessages(locale); return pageMetadata(locale, m.universities.title, m.universities.intro, 'universities') }
export default async function UniversitiesPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = requireLocale((await params).locale); if (!locale) notFound(); const messages = getMessages(locale); const data = getData()
  return <><PageHero variant="compact" eyebrow={`${data.universities.length} ${messages.nav.universities}`} title={messages.universities.title} description={messages.universities.intro} meta={<><span>{messages.common.authoritativeNotice}</span></>} /><section className="atlas-container atlas-section"><UniversityExplorer universities={data.universities} programs={data.programs} cities={data.cities} locale={locale} messages={messages} /></section></>
}
