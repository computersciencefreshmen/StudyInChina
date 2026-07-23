import { notFound } from 'next/navigation'
import { FavoritesView } from '@/components/features/FavoritesView'
import { PageHero } from '@/components/ui'
import { getMessages } from '@/i18n/messages'
import { getTodayDate } from '@/lib/data/freshness'
import { getCatalogData } from '@/lib/data/load'
import { pageMetadata, requireLocale } from '@/lib/site'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) { const locale = requireLocale((await params).locale) || 'en'; const m = getMessages(locale); return pageMetadata(locale, m.favorites.title, m.favorites.intro, 'favorites') }
export default async function FavoritesPage({ params }: { params: Promise<{ locale: string }> }) { const locale = requireLocale((await params).locale); if (!locale) notFound(); const messages = getMessages(locale); const data = await getCatalogData(); return <><PageHero variant="compact" eyebrow={messages.common.compare} title={messages.favorites.title} description={messages.favorites.intro} /><section className="atlas-container atlas-section"><FavoritesView programs={data.programs} universities={data.universities} cycles={data.admissionCycles} locale={locale} messages={messages} today={getTodayDate()} /></section></> }
