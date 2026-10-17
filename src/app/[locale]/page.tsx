import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CityConstellation } from '@/components/features/CityConstellation'
import { CraftHomeVisual } from '@/components/features/CraftHomeVisual'
import { UniversityCard } from '@/components/features/RecordCards'
import styles from '@/components/features/CraftHomeVisual.module.css'
import { formatStudentCityTitle, getHomeExperienceCopy } from '@/i18n/home-experience'
import { getMessages } from '@/i18n/messages'
import { localize } from '@/lib/data/format'
import { classifyProgramField, programFieldTaxonomy } from '@/lib/data/fields'
import { getCatalogData } from '@/lib/data/load'
import { guides } from '@/lib/guides'
import { pageMetadata, requireLocale } from '@/lib/site'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const locale = requireLocale((await params).locale) || 'en'
  const messages = getMessages(locale)
  return pageMetadata(locale, messages.brand, messages.home.intro)
}

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = requireLocale((await params).locale)
  if (!locale) notFound()
  const messages = getMessages(locale), experience = getHomeExperienceCopy(locale), data = await getCatalogData()
  const featured = data.universities.filter(item => item.featured).slice(0, 6)
  const fieldsByUniversity = Object.fromEntries(data.universities.map(university => [university.id, [...new Set(data.programs.filter(program => program.universityId === university.id).map(classifyProgramField))]]))
  const fields = programFieldTaxonomy(locale)
  const fieldCounts = Object.fromEntries(fields.map(({ key }) => [key, data.programs.filter(program => classifyProgramField(program) === key).length]))
  const officialSourceCount = data.sources.filter(source => source.official).length
  const latestSourceCheck = data.sources.reduce<string | null>((latest, source) => !latest || source.accessedAt > latest ? source.accessedAt : latest, null)
  const sourceCheckLabel = latestSourceCheck ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${latestSourceCheck}T00:00:00Z`)) : null
  const pathwayHrefs = ['universities', 'programs', 'guides/verify-admissions-data', 'programs?applicationState=open'] as const

  return <div className={styles.home}>
    <section className={styles.hero} aria-labelledby="home-title">
      <p className={styles.eyebrow}>{messages.home.eyebrow}</p>
      <h1 id="home-title">{messages.home.title}</h1>
      <p className={styles.intro}>{messages.home.intro}</p>
      <div className={styles.actions}><Link href={`/${locale}/universities`}>{messages.home.findUniversity}<span aria-hidden="true">↗</span></Link><Link href={`/${locale}/programs`}>{messages.home.explorePrograms}</Link></div>
      <CraftHomeVisual locale={locale} labels={{ ...messages.nav, search: messages.common.search, searchPlaceholder: messages.programs.searchPlaceholder }} counts={{ universities: data.universities.length, programs: data.programs.length, cities: data.cities.length, guides: guides.length }} />
    </section>

    <section className={styles.ledger} aria-label={experience.catalogEyebrow}>
      <dl className={styles.metrics}><div><dt>{messages.nav.universities}</dt><dd>{data.universities.length.toLocaleString(locale)}</dd></div><div><dt>{messages.nav.programs}</dt><dd>{data.programs.length.toLocaleString(locale)}</dd></div><div><dt>{messages.nav.scholarships}</dt><dd>{data.scholarships.length.toLocaleString(locale)}</dd></div><div><dt>{experience.officialSources}</dt><dd>{officialSourceCount.toLocaleString(locale)}</dd></div></dl>
      <div className={styles.sourceLine}>{sourceCheckLabel ? <span>{experience.latestSourceCheck}: <time dateTime={latestSourceCheck!}>{sourceCheckLabel}</time></span> : null}<Link href={`/${locale}/data-policy`}>{experience.policyLink} ↗</Link></div>
      <p className={styles.principle}>{experience.noGuessing}</p>
    </section>

    <section className={styles.section} aria-labelledby="applicant-pathway-title">
      <header className={styles.sectionHeading}><span className={styles.eyebrow}>{experience.pathwayEyebrow}</span><h2 id="applicant-pathway-title">{experience.pathwayTitle}</h2><p>{experience.pathwayIntro}</p></header>
      <ol className={styles.pathway}>{experience.steps.map((step, index) => <li key={step.title}><Link href={`/${locale}/${pathwayHrefs[index]}`}><div className={styles.stepTop}><span>0{index + 1}</span><span aria-hidden="true">↗</span></div><h3>{step.title}</h3><p>{step.description}</p></Link></li>)}</ol>
    </section>

    <section className={styles.section} aria-labelledby="featured-schools-title">
      <header className={styles.sectionHeading}><span className={styles.eyebrow}>{messages.nav.universities}</span><h2 id="featured-schools-title">{messages.home.featured}</h2><p>{messages.home.featuredIntro}</p><Link href={`/${locale}/universities`}>{messages.common.explore} ↗</Link></header>
      <div className="content-grid">{featured.map(university => <UniversityCard key={university.id} university={university} city={data.cities.find(city => city.id === university.cityId)} fields={fieldsByUniversity[university.id] || []} locale={locale} messages={messages} />)}</div>
    </section>

    <section className={styles.section} aria-labelledby="study-fields-title">
      <header className={styles.sectionHeading}><span className={styles.eyebrow}>{messages.nav.programs}</span><h2 id="study-fields-title">{messages.home.disciplines}</h2></header>
      {data.programs.length ? <div className={styles.fieldGrid}>{fields.map(({ key, label, description }) => <Link className={styles.field} href={`/${locale}/programs?discipline=${key}`} key={key}><b>{label}</b><small>{description}</small><span>{fieldCounts[key].toLocaleString(locale)} {messages.nav.programs}<span aria-hidden="true">↗</span></span></Link>)}</div> : <div className="notice" data-testid="program-publication-note">{messages.home.programVerificationNote}</div>}
    </section>

    <section className={styles.section} aria-labelledby="student-cities-title">
      <header className={styles.sectionHeading}><span className={styles.eyebrow}>{messages.nav.cities}</span><h2 id="student-cities-title">{formatStudentCityTitle(data.cities.length, locale)}</h2><p>{messages.cities.intro}</p><Link href={`/${locale}/cities`}>{messages.common.explore} ↗</Link></header>
      <div className={styles.cityFrame}><CityConstellation cities={data.cities} locale={locale} /></div>
    </section>

    <section className={styles.section} aria-labelledby="application-guides-title">
      <header className={styles.sectionHeading}><span className={styles.eyebrow}>{messages.nav.guides}</span><h2 id="application-guides-title">{messages.home.guideTitle}</h2><p>{messages.guide.intro}</p><Link href={`/${locale}/guides`}>{messages.common.explore} ↗</Link></header>
      <div className={styles.guideGrid}>{guides.slice(0, 3).map((guide, index) => <Link className={styles.guideCard} href={`/${locale}/guides/${guide.slug}`} key={guide.slug}><span className={styles.guideNumber}>0{index + 1}</span><h3>{localize(guide.title, locale)}</h3><p>{localize(guide.summary, locale)}</p><span>{messages.common.viewDetails}<span aria-hidden="true">↗</span></span></Link>)}</div>
    </section>
  </div>
}
