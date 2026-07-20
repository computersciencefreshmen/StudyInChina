import { notFound } from 'next/navigation'
import { ProgramExplorer } from '@/components/features/ProgramExplorer'
import { PageHero } from '@/components/ui'
import { getMessages } from '@/i18n/messages'
import { getTodayDate } from '@/lib/data/freshness'
import { getData } from '@/lib/data/load'
import { pageMetadata, requireLocale } from '@/lib/site'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) { const locale = requireLocale((await params).locale) || 'en'; const m = getMessages(locale); return pageMetadata(locale, m.programs.title, m.programs.intro, 'programs') }
export default async function ProgramsPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ discipline?: string | string[] }> }) {
  const locale = requireLocale((await params).locale); if (!locale) notFound(); const messages = getMessages(locale); const data = getData()
  const requestedDiscipline = (await searchParams).discipline
  const initialDiscipline = typeof requestedDiscipline === 'string' && data.programs.some((program) => program.discipline === requestedDiscipline) ? requestedDiscipline : ''
  return <><PageHero variant="compact" eyebrow={`${data.programs.length} ${messages.nav.programs}`} title={messages.programs.title} description={messages.programs.intro} meta={<><span>{messages.common.authoritativeNotice}</span></>} /><section className="atlas-container atlas-section">{data.programs.length === 0 ? <div className="notice" data-testid="program-publication-note">{messages.programs.verificationNote}</div> : null}<ProgramExplorer programs={data.programs} universities={data.universities} cycles={data.admissionCycles} locale={locale} messages={messages} initialDiscipline={initialDiscipline} today={getTodayDate()} /></section></>
}
