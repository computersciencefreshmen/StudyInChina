import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageHero } from '@/components/ui'
import { importedProgramsHref, importedProgramText, publicSourceHref, sourceValue } from '@/components/features/ImportedPrograms'
import styles from '@/components/features/ImportedPrograms.module.css'
import { getThirdPartyProgram } from '@/lib/third-party-programs'
import { pageMetadata, requireLocale } from '@/lib/site'

type Props = { params: Promise<{ locale: string; id: string }> }

export async function generateMetadata({ params }: Props) {
  const { locale: rawLocale, id } = await params
  const locale = requireLocale(rawLocale) || 'en'
  const program = await getThirdPartyProgram(id)
  if (!program || program.status !== 'extracted') notFound()
  const t = importedProgramText(locale)
  return pageMetadata(locale, `${program.name} · ${program.schoolName}`, t.intro, `programs/imported/${encodeURIComponent(program.id)}`)
}

export default async function ImportedProgramPage({ params }: Props) {
  const { locale: rawLocale, id } = await params
  const locale = requireLocale(rawLocale)
  if (!locale) notFound()
  const program = await getThirdPartyProgram(id)
  // A discovered URL cannot support a useful local detail page.
  if (!program || program.status !== 'extracted') notFound()
  const t = importedProgramText(locale)
  const fields = program.fields
  const facts = [
    [t.degree, fields.degree], [t.language, fields.language], [t.duration, fields.duration],
    [t.startDate, fields.startDate], [t.deadline, fields.deadline], [t.tuition, fields.tuition],
    [t.applicationFee, fields.applicationFee], [t.providerServiceFee, fields.providerServiceFee],
  ].map(([label, value]) => [label as string, sourceValue(value)])
  const sections = [
    [t.about, fields.description], [t.requirements, fields.requirements],
    [t.materials, fields.materials], [t.fees, fields.fees],
  ].map(([label, value]) => [label as string, sourceValue(value)]).filter(([, value]) => value)
  const sourceHref = publicSourceHref(program.sourceUrl)

  return <>
    <PageHero variant="compact" eyebrow={`${program.provider.toUpperCase()} · ${t.sourceLabel}`}
      title={program.name} description={program.schoolName}
      meta={<span className={styles.capturedBadge}>{t.extracted}</span>}
      actions={<Link className={styles.textLink} href={importedProgramsHref(locale)}>← {t.back}</Link>}
    />
    <section className={`atlas-container atlas-section ${styles.workspace}`}>
      <p className={styles.notice}>{t.sourceNotice}</p>
      <div className={styles.detailLayout}>
        <div className={styles.detailMain}>
          <section className={styles.detailSection}>
            <h2>{t.facts}</h2>
            <dl className={styles.detailFacts}>
              {facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || t.unknown}</dd></div>)}
            </dl>
          </section>
          {sections.map(([title, value]) => <section key={title} className={styles.detailSection}>
            <h2>{title}</h2><p className={styles.sourceText}>{value}</p>
          </section>)}
        </div>
        <aside className={styles.provenance}>
          <h2>{t.provenance}</h2>
          <span className={styles.provider}>{program.provider.toUpperCase()}</span>
          <dl>
            {program.fetchedAt ? <div><dt>{t.capturedAt}</dt><dd>{program.fetchedAt}</dd></div> : null}
            {program.sourceUpdatedAt ? <div><dt>{t.sourceUpdatedAt}</dt><dd>{program.sourceUpdatedAt}</dd></div> : null}
          </dl>
          {sourceHref ? <>
            <a className={styles.textLink} href={sourceHref} target="_blank" rel="noopener noreferrer">{t.source} ↗</a>
            <p className={styles.sourceUrl}>{program.sourceUrl}</p>
          </> : null}
          <p>{t.sourceNotice}</p>
        </aside>
      </div>
    </section>
  </>
}
