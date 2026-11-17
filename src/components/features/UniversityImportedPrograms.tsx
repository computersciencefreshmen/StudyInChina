import Link from 'next/link'
import type { LaunchLocale } from '@/i18n/config'
import { getThirdPartySchoolLinks } from '@/lib/third-party-school-links'
import { importedProgramsHref, importedProgramText } from './ImportedPrograms'
import styles from './ImportedPrograms.module.css'

export function UniversityImportedPrograms({ englishSchoolName, locale }: { englishSchoolName: string; locale: LaunchLocale }) {
  const schools = getThirdPartySchoolLinks(englishSchoolName)
  if (!schools.length) return null
  const text = importedProgramText(locale)
  const nf = new Intl.NumberFormat(locale)
  return <aside className={styles.schoolPanel} data-testid="university-imported-programs">
    <h2>{locale === 'zh' ? '第三方平台收录的项目' : 'Programs listed by third-party platforms'}</h2>
    <p>{text.sourceNotice}</p>
    <div className={styles.schoolLinks}>
      {schools.map(school => <Link key={school.id} prefetch={false} className={styles.schoolLink}
        href={importedProgramsHref(locale, { school: school.id, provider: school.provider.toLowerCase(), view: school.view })}>
        <span className={styles.provider}>{school.provider.toUpperCase()}</span>
        <span className={styles.schoolLinkMeta}>
          {school.extractedCount > 0 ? <span>{nf.format(school.extractedCount)} {text.extracted}</span> : null}
          <span>{nf.format(school.programCount)} {text.programs}</span>
        </span>
        <span aria-hidden="true">→</span>
      </Link>)}
    </div>
  </aside>
}
