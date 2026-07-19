import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Badge, Card, LinkButton, PageHero, SectionHeading } from '@/components/ui'
import { CityConstellation } from '@/components/features/CityConstellation'
import { UniversityCard } from '@/components/features/RecordCards'
import { getMessages } from '@/i18n/messages'
import { localize } from '@/lib/data/format'
import { disciplineLabels } from '@/lib/data/labels'
import { getData } from '@/lib/data/load'
import { guides } from '@/lib/guides'
import { pageMetadata, requireLocale } from '@/lib/site'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const locale = requireLocale((await params).locale) || 'en'; const m = getMessages(locale)
  return pageMetadata(locale, m.brand, m.home.intro)
}

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = requireLocale((await params).locale); if (!locale) notFound()
  const messages = getMessages(locale); const data = getData()
  const featured = data.universities.filter((item) => item.featured).slice(0, 6)
  const fieldsByUniversity = Object.fromEntries(data.universities.map((university) => [university.id, [...new Set(data.programs.filter((program) => program.universityId === university.id).map((program) => program.discipline))]]))
  const programVerificationNote = locale === 'zh' ? '项目资料正在逐项核验。未经官方项目页确认的草稿不会出现在公开目录或搜索引擎中。' : locale === 'ru' ? 'Программы проходят проверку. Черновики без официальной страницы программы не публикуются и не индексируются.' : 'Program records are being verified one by one. Drafts without an official program page are not published or indexed.'

  return <>
    <PageHero variant="feature" eyebrow={messages.home.eyebrow} title={messages.home.title} description={messages.home.intro}
      actions={<><LinkButton href={`/${locale}/universities`} size="large" iconEnd="→">{messages.home.findUniversity}</LinkButton><LinkButton href={`/${locale}/programs`} variant="ghost" size="large">{messages.home.explorePrograms}</LinkButton></>}
      meta={<><span>{data.universities.length} {messages.nav.universities}</span><span>{data.programs.length} {messages.nav.programs}</span><span>{data.cities.length} {messages.nav.cities}</span><span>{data.scholarships.length} {messages.nav.scholarships}</span></>}
      aside={<div className="atlas-stack"><Badge tone="jade" dot>{messages.common.officialSource}</Badge><h2>{locale === 'zh' ? '每条事实都应能回到来源' : locale === 'ru' ? 'Каждый факт ведёт к источнику' : 'Every fact should lead back to a source'}</h2><p>{messages.common.authoritativeNotice}</p><Link className="text-link" href={`/${locale}/data-policy`}>{messages.footer.dataPolicy} →</Link></div>} />

    <section className="atlas-container atlas-section">
      <SectionHeading eyebrow="01" title={messages.home.featured} description={messages.home.featuredIntro} action={<LinkButton href={`/${locale}/universities`} variant="quiet">{messages.common.explore} →</LinkButton>} />
      <div className="content-grid">{featured.map((university) => <UniversityCard key={university.id} university={university} city={data.cities.find((city) => city.id === university.cityId)} fields={fieldsByUniversity[university.id] || []} locale={locale} messages={messages} />)}</div>
    </section>

    <section className="atlas-section home-band">
      <div className="atlas-container">
        <SectionHeading eyebrow="02" title={messages.home.disciplines} />
        {data.programs.length ? <div className="discipline-grid">{Object.entries(disciplineLabels(locale)).map(([key, label]) => <Link className="discipline-tile" href={`/${locale}/programs?discipline=${key}`} key={key}><b>{label}</b><span>{data.programs.filter((program) => program.discipline === key).length} {messages.nav.programs} →</span></Link>)}</div> : <div className="notice" data-testid="program-publication-note">{programVerificationNote}</div>}
      </div>
    </section>

    <section className="atlas-container atlas-section">
      <SectionHeading eyebrow="03" title={messages.home.cityTitle} description={messages.cities.intro} action={<LinkButton href={`/${locale}/cities`} variant="quiet">{messages.common.explore} →</LinkButton>} />
      <CityConstellation cities={data.cities} locale={locale} />
    </section>

    <section className="atlas-container atlas-section">
      <SectionHeading eyebrow="04" title={messages.home.guideTitle} description={messages.guide.intro} action={<LinkButton href={`/${locale}/guides`} variant="quiet">{messages.common.explore} →</LinkButton>} />
      <div className="content-grid">{guides.slice(0, 3).map((guide, index) => <Card key={guide.slug} accent={index === 0 ? 'vermilion' : 'none'}><Badge tone="neutral">0{index + 1}</Badge><h3 className="atlas-card__title">{localize(guide.title, locale)}</h3><p className="atlas-card__description">{localize(guide.summary, locale)}</p><div className="atlas-card__footer"><LinkButton href={`/${locale}/guides/${guide.slug}`} variant="quiet">{messages.common.viewDetails} →</LinkButton></div></Card>)}</div>
    </section>
  </>
}
