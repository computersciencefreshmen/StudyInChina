import { notFound } from 'next/navigation'
import { UniversityExplorer } from '@/components/features/UniversityExplorer'
import { PageHero } from '@/components/ui'
import { getMessages } from '@/i18n/messages'
import { getCatalogData } from '@/lib/data/load'
import { pageMetadata, requireLocale } from '@/lib/site'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) { const locale = requireLocale((await params).locale) || 'en'; const m = getMessages(locale); return pageMetadata(locale, m.universities.title, m.universities.intro, 'universities') }
export default async function UniversitiesPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = requireLocale((await params).locale); if (!locale) notFound(); const messages = getMessages(locale); const data = await getCatalogData()
  const coverageLabel = {
    zh: '查看 147 所双一流高校数据表',
    en: 'View all 147 Double First-Class universities',
    ru: 'Все 147 университетов Double First-Class',
    de: 'Alle 147 Double-First-Class-Hochschulen',
    fr: 'Voir les 147 établissements Double First-Class',
    es: 'Ver las 147 universidades Double First-Class',
  }[locale]
  return <><PageHero variant="compact" eyebrow={`${data.universities.length} ${messages.nav.universities}`} title={messages.universities.title} description={messages.universities.intro} actions={<a className="atlas-button atlas-button--primary atlas-button--medium" href={`/${locale}/double-first-class`}>{coverageLabel} →</a>} meta={<><span>{messages.common.authoritativeNotice}</span></>} /><section className="atlas-container atlas-section"><UniversityExplorer universities={data.universities} programs={data.programs} cities={data.cities} locale={locale} messages={messages} /></section></>
}
