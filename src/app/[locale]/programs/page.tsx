import { notFound } from 'next/navigation'
import { ProgramExplorer } from '@/components/features/ProgramExplorer'
import { PageHero } from '@/components/ui'
import { getMessages } from '@/i18n/messages'
import { getData } from '@/lib/data/load'
import { pageMetadata, requireLocale } from '@/lib/site'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) { const locale = requireLocale((await params).locale) || 'en'; const m = getMessages(locale); return pageMetadata(locale, m.programs.title, m.programs.intro, 'programs') }
export default async function ProgramsPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ discipline?: string | string[] }> }) {
  const locale = requireLocale((await params).locale); if (!locale) notFound(); const messages = getMessages(locale); const data = getData()
  const requestedDiscipline = (await searchParams).discipline
  const initialDiscipline = typeof requestedDiscipline === 'string' && data.programs.some((program) => program.discipline === requestedDiscipline) ? requestedDiscipline : ''
  const verificationNote = locale === 'zh' ? '公开目录目前只接受有项目级官方来源的核验记录。模板草稿已从生产页面、站点地图和结构化数据中隔离。' : locale === 'ru' ? 'В открытом каталоге публикуются только проверенные записи с официальным источником уровня программы. Черновики исключены из страниц, карты сайта и структурированных данных.' : 'The public catalogue only accepts verified records with a program-level official source. Draft templates are excluded from production pages, the sitemap and structured data.'
  return <><PageHero variant="compact" eyebrow={`${data.programs.length} ${messages.nav.programs}`} title={messages.programs.title} description={messages.programs.intro} meta={<><span>{messages.common.authoritativeNotice}</span></>} /><section className="atlas-container atlas-section">{data.programs.length === 0 ? <div className="notice" data-testid="program-publication-note">{verificationNote}</div> : null}<ProgramExplorer programs={data.programs} universities={data.universities} cycles={data.admissionCycles} locale={locale} messages={messages} initialDiscipline={initialDiscipline} /></section></>
}
