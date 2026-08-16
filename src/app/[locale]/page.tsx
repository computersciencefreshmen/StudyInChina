import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Badge, Card, LinkButton, PageHero, SectionHeading } from '@/components/ui'
import { CityConstellation } from '@/components/features/CityConstellation'
import { UniversityCard } from '@/components/features/RecordCards'
import { formatStudentCityTitle, getHomeExperienceCopy } from '@/i18n/home-experience'
import { getMessages } from '@/i18n/messages'
import { localize } from '@/lib/data/format'
import { classifyProgramField, programFieldTaxonomy } from '@/lib/data/fields'
import { getCatalogData } from '@/lib/data/load'
import { guides } from '@/lib/guides'
import { pageMetadata, requireLocale } from '@/lib/site'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const locale = requireLocale((await params).locale) || 'en'; const m = getMessages(locale)
  return pageMetadata(locale, m.brand, m.home.intro)
}

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = requireLocale((await params).locale); if (!locale) notFound()
  const messages = getMessages(locale); const experience = getHomeExperienceCopy(locale); const data = await getCatalogData()
  const featured = data.universities.filter((item) => item.featured).slice(0, 6)
  const fieldsByUniversity = Object.fromEntries(data.universities.map((university) => [university.id, [...new Set(data.programs.filter((program) => program.universityId === university.id).map(classifyProgramField))]]))
  const fields = programFieldTaxonomy(locale)
  const fieldCounts = Object.fromEntries(fields.map(({ key }) => [key, data.programs.filter((program) => classifyProgramField(program) === key).length]))
  const officialSourceCount = data.sources.filter((source) => source.official).length
  const latestSourceCheck = data.sources.reduce<string | null>((latest, source) => !latest || source.accessedAt > latest ? source.accessedAt : latest, null)
  const sourceCheckLabel = latestSourceCheck
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${latestSourceCheck}T00:00:00Z`))
    : messages.common.unknown
  const pathwayHrefs = [
    'universities',
    'programs',
    'guides/verify-admissions-data',
    'programs?applicationState=open',
  ] as const

  return <>
    <PageHero variant="feature" eyebrow={messages.home.eyebrow} title={messages.home.title} description={messages.home.intro}
      actions={<><LinkButton href={`/${locale}/universities`} size="large" iconEnd="→">{messages.home.findUniversity}</LinkButton><LinkButton href={`/${locale}/programs`} variant="ghost" size="large">{messages.home.explorePrograms}</LinkButton></>}
      meta={<><span>{data.universities.length} {messages.nav.universities}</span><span>{data.programs.length} {messages.nav.programs}</span><span>{data.cities.length} {messages.nav.cities}</span><span>{data.scholarships.length} {messages.nav.scholarships}</span></>}
      aside={<div className="atlas-stack"><Badge tone="jade" dot>{messages.common.officialSource}</Badge><h2>{messages.home.sourceHeading}</h2><p>{messages.common.authoritativeNotice}</p><Link className="text-link" href={`/${locale}/data-policy`}>{messages.footer.dataPolicy} →</Link></div>} />

    <section className="atlas-home-ledger" aria-labelledby="catalog-ledger-title">
      <div className="atlas-container atlas-home-ledger__grid">
        <div className="atlas-home-ledger__intro">
          <div className="atlas-kicker">{experience.catalogEyebrow}</div>
          <h2 id="catalog-ledger-title">{experience.catalogTitle}</h2>
          <p>{experience.catalogIntro}</p>
          <div className="atlas-home-ledger__freshness">
            <span><i aria-hidden="true" />{experience.latestSourceCheck}: <time dateTime={latestSourceCheck || undefined}>{sourceCheckLabel}</time></span>
            <Link href={`/${locale}/data-policy`}>{experience.policyLink} →</Link>
          </div>
        </div>
        <dl className="atlas-home-ledger__metrics">
          <div><dt>{messages.nav.universities}</dt><dd>{data.universities.length.toLocaleString(locale)}</dd></div>
          <div><dt>{messages.nav.programs}</dt><dd>{data.programs.length.toLocaleString(locale)}</dd></div>
          <div><dt>{messages.nav.scholarships}</dt><dd>{data.scholarships.length.toLocaleString(locale)}</dd></div>
          <div><dt>{experience.officialSources}</dt><dd>{officialSourceCount.toLocaleString(locale)}</dd></div>
        </dl>
        <p className="atlas-home-ledger__principle"><span aria-hidden="true">※</span>{experience.noGuessing}</p>
      </div>
    </section>

    <section className="atlas-container atlas-section atlas-home-pathway" aria-labelledby="applicant-pathway-title">
      <SectionHeading eyebrow={experience.pathwayEyebrow} title={<span id="applicant-pathway-title">{experience.pathwayTitle}</span>} description={experience.pathwayIntro} />
      <ol className="atlas-home-pathway__steps">
        {experience.steps.map((step, index) => <li key={step.title}>
          <Link href={`/${locale}/${pathwayHrefs[index]}`}>
            <span className="atlas-home-pathway__number" aria-hidden="true">0{index + 1}</span>
            <div><h3>{step.title}</h3><p>{step.description}</p></div>
            <span className="atlas-home-pathway__arrow" aria-hidden="true">↗</span>
          </Link>
        </li>)}
      </ol>
    </section>

    <section className="atlas-container atlas-section">
      <SectionHeading eyebrow="01" title={messages.home.featured} description={messages.home.featuredIntro} action={<LinkButton href={`/${locale}/universities`} variant="quiet">{messages.common.explore} →</LinkButton>} />
      <div className="content-grid">{featured.map((university) => <UniversityCard key={university.id} university={university} city={data.cities.find((city) => city.id === university.cityId)} fields={fieldsByUniversity[university.id] || []} locale={locale} messages={messages} />)}</div>
    </section>

    <section className="atlas-section home-band">
      <div className="atlas-container">
        <SectionHeading eyebrow="02" title={messages.home.disciplines} />
        {data.programs.length ? <div className="discipline-grid">{fields.map(({ key, label, description }) => <Link className="discipline-tile" href={`/${locale}/programs?discipline=${key}`} key={key}><b>{label}</b><small>{description}</small><span>{fieldCounts[key]} {messages.nav.programs} →</span></Link>)}</div> : <div className="notice" data-testid="program-publication-note">{messages.home.programVerificationNote}</div>}
      </div>
    </section>

    <section className="atlas-container atlas-section">
      <SectionHeading eyebrow="03" title={formatStudentCityTitle(data.cities.length, locale)} description={messages.cities.intro} action={<LinkButton href={`/${locale}/cities`} variant="quiet">{messages.common.explore} →</LinkButton>} />
      <CityConstellation cities={data.cities} locale={locale} />
    </section>

    <section className="atlas-container atlas-section">
      <SectionHeading eyebrow="04" title={messages.home.guideTitle} description={messages.guide.intro} action={<LinkButton href={`/${locale}/guides`} variant="quiet">{messages.common.explore} →</LinkButton>} />
      <div className="content-grid">{guides.slice(0, 3).map((guide, index) => <Card key={guide.slug} accent={index === 0 ? 'vermilion' : 'none'}><Badge tone="neutral">0{index + 1}</Badge><h3 className="atlas-card__title">{localize(guide.title, locale)}</h3><p className="atlas-card__description">{localize(guide.summary, locale)}</p><div className="atlas-card__footer"><LinkButton href={`/${locale}/guides/${guide.slug}`} variant="quiet">{messages.common.viewDetails} →</LinkButton></div></Card>)}</div>
    </section>
  </>
}
