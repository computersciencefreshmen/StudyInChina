import { notFound } from 'next/navigation'
import { Badge, Card, PageHero, SectionHeading, VerificationBadge } from '@/components/ui'
import { FavoriteButton } from '@/components/features/FavoriteButton'
import { ProgramCard } from '@/components/features/RecordCards'
import { launchLocales } from '@/i18n/config'
import { getMessages } from '@/i18n/messages'
import { formatCny, formatDate, localize } from '@/lib/data/format'
import { degreeLabels, disciplineLabels, languageLabel } from '@/lib/data/labels'
import { getData, getProgramBySlug } from '@/lib/data/load'
import { pageMetadata, requireLocale } from '@/lib/site'

export function generateStaticParams() { const data = getData(); return launchLocales.flatMap((locale) => data.programs.map(({ slug }) => ({ locale, slug }))) }
export async function generateMetadata({ params }: { params: Promise<{ locale: string; slug: string }> }) { const { locale: raw, slug } = await params; const locale = requireLocale(raw) || 'en'; const program = getProgramBySlug(slug); if (!program) return {}; return pageMetadata(locale, localize(program.name, locale), `${degreeLabels(locale)[program.degreeLevel]} · ${disciplineLabels(locale)[program.discipline]}`, `programs/${slug}`) }

export default async function ProgramDetailPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale: raw, slug } = await params; const locale = requireLocale(raw); if (!locale) notFound(); const program = getProgramBySlug(slug); if (!program) notFound()
  const messages = getMessages(locale); const data = getData(); const university = data.universities.find((item) => item.id === program.universityId); if (!university) notFound()
  const city = data.cities.find((item) => item.id === university.cityId); const cycle = data.admissionCycles.find((item) => item.programId === program.id)
  const sources = data.sources.filter((source) => program.sourceIds.includes(source.id) || cycle?.sourceIds.includes(source.id)); const related = data.programs.filter((item) => item.universityId === university.id && item.id !== program.id).slice(0, 3)
  const copy = locale === 'zh' ? { overview: '项目信息', cycle: '招生周期', year: '适用学年', intake: '入学季', fee: '申请费', open: '开放日期', source: '官方来源与核验', related: '同校其他项目', university: '开设学校' } : locale === 'ru' ? { overview: 'О программе', cycle: 'Цикл приёма', year: 'Учебный год', intake: 'Набор', fee: 'Сбор', open: 'Открытие', source: 'Источники и проверка', related: 'Другие программы вуза', university: 'Университет' } : { overview: 'Program facts', cycle: 'Admissions cycle', year: 'Academic year', intake: 'Intake', fee: 'Application fee', open: 'Opens', source: 'Official sources and review', related: 'Other programs at this university', university: 'University' }
  const jsonLd = { '@context': 'https://schema.org', '@type': 'EducationalOccupationalProgram', name: localize(program.name, locale), provider: { '@type': 'CollegeOrUniversity', name: localize(university.name, locale), url: university.officialUrl }, url: program.programUrl, timeToComplete: program.durationMonths ? `P${program.durationMonths}M` : undefined }

  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
    <PageHero variant="compact" eyebrow={`${degreeLabels(locale)[program.degreeLevel]} · ${disciplineLabels(locale)[program.discipline]}`} title={localize(program.name, locale)} description={<><span>{localize(university.name, locale)}</span>{city ? <span> · {localize(city.name, locale)}</span> : null}</>} actions={<><a className="atlas-button atlas-button--primary atlas-button--medium" href={program.applyUrl} target="_blank" rel="noreferrer">{messages.common.applyOfficial} ↗</a><FavoriteButton programId={program.id} saveLabel={messages.common.save} savedLabel={messages.common.saved} /></>} meta={<VerificationBadge status={program.status} verifiedAt={program.verifiedAt} locale={locale} verifiedDateLabel={messages.common.lastVerified} labels={{ verified: messages.common.verified, stale: messages.common.stale, draft: messages.common.draft, archived: messages.common.archived }} />} />
    <section className="atlas-container atlas-section detail-layout">
      <div className="detail-main">
        <div className="prose-panel"><h2>{copy.overview}</h2><dl className="detail-facts"><div><dt>{copy.university}</dt><dd><a href={`/${locale}/universities/${university.slug}`}>{localize(university.name, locale)}</a></dd></div><div><dt>{messages.common.duration}</dt><dd>{program.durationMonths ? `${program.durationMonths} ${messages.common.months}` : messages.common.unknown}</dd></div><div><dt>{messages.common.language}</dt><dd>{program.teachingLanguages.map((item) => languageLabel(item, locale)).join(', ')}</dd></div><div><dt>{messages.common.requirements}</dt><dd>{program.languageRequirements.length ? program.languageRequirements.map((item) => `${item.test}: ${item.minimum || messages.common.unknown}`).join(' · ') : messages.common.unknown}</dd></div></dl></div>
        <div className="prose-panel"><h2>{copy.cycle}</h2>{cycle ? <dl className="detail-facts"><div><dt>{copy.year}</dt><dd>{cycle.academicYear}</dd></div><div><dt>{copy.intake}</dt><dd>{cycle.intake}</dd></div><div><dt>{copy.open}</dt><dd>{formatDate(cycle.opensOn, locale, messages.common.unknown)}</dd></div><div><dt>{messages.common.deadline}</dt><dd>{formatDate(cycle.closesOn, locale, messages.common.unknown)}</dd></div><div><dt>{messages.common.tuition}</dt><dd>{formatCny(cycle.tuitionCny, locale, messages.common.unknown)}</dd></div><div><dt>{copy.fee}</dt><dd>{formatCny(cycle.applicationFeeCny, locale, messages.common.unknown)}</dd></div></dl> : <p>{messages.common.unknown}</p>}<div className="notice">{messages.common.authoritativeNotice}</div></div>
        {related.length ? <div><SectionHeading title={copy.related} level={2} /><div className="content-grid">{related.map((item) => <ProgramCard key={item.id} program={item} university={university} cycle={data.admissionCycles.find((admission) => admission.programId === item.id)} locale={locale} messages={messages} />)}</div></div> : null}
      </div>
      <aside className="detail-aside"><Card accent="jade"><h2 className="atlas-card__title">{copy.source}</h2><dl className="record-facts"><div><dt>{messages.common.lastVerified}</dt><dd>{formatDate(program.verifiedAt, locale, '—')}</dd></div><div><dt>Status</dt><dd><Badge tone={program.status === 'verified' ? 'jade' : 'warning'}>{program.status}</Badge></dd></div></dl><ul className="source-list">{sources.map((source) => <li key={source.id}><a href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a><small>{source.publisher}</small></li>)}</ul><div className="atlas-card__footer"><a className="text-link" href={program.programUrl} target="_blank" rel="noreferrer">{messages.common.officialSource} ↗</a></div></Card></aside>
    </section>
  </>
}
