import Link from 'next/link'
import { notFound } from 'next/navigation'

import {
  DoubleFirstClassCoverageTable,
  type CoverageInstitution,
} from '@/components/features/DoubleFirstClassCoverageTable'
import { PageHero, SectionHeading } from '@/components/ui'
import coverage from '@/data/generated/double-first-class-coverage.json'
import type { LaunchLocale } from '@/i18n/config'
import { pageMetadata, requireLocale } from '@/lib/site'

type PageCopy = {
  title: string
  description: string
  eyebrow: string
  complete: string
  collecting: string
  sources: string
  tableTitle: string
  tableDescription: string
  officialList: string
  api: string
  notice: string
}

const copyByLocale: Record<LaunchLocale, PageCopy> = {
  zh: {
    title: '147 所双一流高校数据表',
    description: '直接查看每所高校的国际招生主页、官方项目目录和校级奖学金入口。已核验来源立即展示，其余学校持续采集中。',
    eyebrow: '教育部第二轮“双一流”建设高校 · 全量目标库',
    complete: '三类来源已完成',
    collecting: '仍在采集',
    sources: '已核验官方来源',
    tableTitle: '高校与官方来源',
    tableDescription: '表内链接只指向学校官方 HTTPS 网站。历史或已截止页面只作为目录发现锚点，不代表当前开放申请。',
    officialList: '教育部官方名单',
    api: '查看 JSON API',
    notice: '项目名称、费用、奖学金金额和截止日期只有通过字段级证据校验后才会进入正式项目页；未知值不会猜测。',
  },
  en: {
    title: '147 Double First-Class Universities',
    description: 'Browse each university’s official international admissions, program catalog, and university scholarship sources. Verified links are published immediately while the remaining schools stay in collection.',
    eyebrow: 'MOE second-round Double First-Class list · complete target registry',
    complete: 'Three sources complete',
    collecting: 'Still collecting',
    sources: 'Verified official sources',
    tableTitle: 'Universities and official sources',
    tableDescription: 'Every link points to an official university HTTPS site. Historical or closed pages are discovery anchors and do not imply that applications are open.',
    officialList: 'Official MOE list',
    api: 'View JSON API',
    notice: 'Program names, fees, funding amounts, and deadlines enter program pages only after field-level evidence checks. Unknown values are never guessed.',
  },
  ru: {
    title: '147 университетов программы Double First-Class',
    description: 'Официальные страницы международного приёма, каталоги программ и университетские стипендии по каждому вузу.',
    eyebrow: 'Полный перечень второго раунда Министерства образования КНР',
    complete: 'Три источника готовы',
    collecting: 'Сбор продолжается',
    sources: 'Проверенные источники',
    tableTitle: 'Университеты и официальные источники',
    tableDescription: 'Все ссылки ведут на официальные HTTPS-сайты вузов. Историческая страница не означает, что приём открыт.',
    officialList: 'Официальный список',
    api: 'JSON API',
    notice: 'Названия программ, стоимость, суммы финансирования и сроки публикуются только после проверки доказательств по каждому полю.',
  },
  de: {
    title: '147 Double-First-Class-Hochschulen',
    description: 'Offizielle internationale Zulassung, Programmkataloge und Hochschulstipendien für jede Zielhochschule.',
    eyebrow: 'Vollständige Zielliste der zweiten MOE-Runde',
    complete: 'Drei Quellen vollständig',
    collecting: 'Noch in Erfassung',
    sources: 'Geprüfte offizielle Quellen',
    tableTitle: 'Hochschulen und offizielle Quellen',
    tableDescription: 'Alle Links führen zu offiziellen HTTPS-Seiten. Historische Seiten bedeuten nicht, dass Bewerbungen geöffnet sind.',
    officialList: 'Offizielle MOE-Liste',
    api: 'JSON API',
    notice: 'Programme, Gebühren, Förderbeträge und Fristen erscheinen erst nach einer feldbezogenen Quellenprüfung.',
  },
  fr: {
    title: '147 établissements Double First-Class',
    description: 'Admissions internationales, catalogues de programmes et bourses universitaires officielles pour chaque établissement.',
    eyebrow: 'Liste cible complète du deuxième cycle du ministère',
    complete: 'Trois sources complètes',
    collecting: 'Collecte en cours',
    sources: 'Sources officielles vérifiées',
    tableTitle: 'Établissements et sources officielles',
    tableDescription: 'Tous les liens pointent vers des sites HTTPS officiels. Une page historique ne signifie pas que les candidatures sont ouvertes.',
    officialList: 'Liste officielle',
    api: 'API JSON',
    notice: 'Les programmes, frais, financements et échéances ne sont publiés qu’après validation des preuves pour chaque champ.',
  },
  es: {
    title: '147 universidades Double First-Class',
    description: 'Admisiones internacionales, catálogos de programas y becas universitarias oficiales para cada institución.',
    eyebrow: 'Registro completo de la segunda ronda del Ministerio de Educación',
    complete: 'Tres fuentes completas',
    collecting: 'Aún recopilando',
    sources: 'Fuentes oficiales verificadas',
    tableTitle: 'Universidades y fuentes oficiales',
    tableDescription: 'Todos los enlaces apuntan a sitios HTTPS oficiales. Una página histórica no implica que las solicitudes estén abiertas.',
    officialList: 'Lista oficial',
    api: 'API JSON',
    notice: 'Los programas, tasas, importes de becas y fechas límite solo se publican tras validar evidencias por campo.',
  },
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const locale = requireLocale((await params).locale) || 'en'
  const copy = copyByLocale[locale]
  return pageMetadata(locale, copy.title, copy.description, 'double-first-class')
}

export default async function DoubleFirstClassPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const locale = requireLocale((await params).locale)
  if (!locale) notFound()
  const copy = copyByLocale[locale]
  const totals = coverage.totals
  return (
    <>
      <PageHero
        variant="compact"
        eyebrow={copy.eyebrow}
        title={copy.title}
        description={copy.description}
        actions={(
          <>
            <a
              className="atlas-button atlas-button--primary atlas-button--medium"
              href={coverage.officialRegistry.pageUrl}
              target="_blank"
              rel="noreferrer"
            >
              {copy.officialList} ↗
            </a>
            <Link
              className="atlas-button atlas-button--ghost atlas-button--medium"
              href="/api/v1/double-first-class"
            >
              {copy.api}
            </Link>
          </>
        )}
        meta={(
          <>
            <span>{coverage.generatedAt.slice(0, 10)}</span>
            <span>{totals.institutionTargets}/147</span>
          </>
        )}
      />
      <section className="atlas-container atlas-section section-block--tight">
        <div className="stat-strip">
          <div className="stat">
            <strong>{totals.institutionTargets}</strong>
            <span>{copy.title}</span>
          </div>
          <div className="stat">
            <strong>{totals.sourceManifestComplete}</strong>
            <span>{copy.complete}</span>
          </div>
          <div className="stat">
            <strong>{totals.verifiedOfficialSources}</strong>
            <span>{copy.sources}</span>
          </div>
          <div className="stat">
            <strong>{totals.collecting}</strong>
            <span>{copy.collecting}</span>
          </div>
        </div>
      </section>
      <section className="atlas-container atlas-section section-block--tight">
        <div className="notice">{copy.notice}</div>
      </section>
      <section className="atlas-container atlas-section">
        <SectionHeading
          title={copy.tableTitle}
          description={copy.tableDescription}
          level={2}
        />
        <DoubleFirstClassCoverageTable
          institutions={coverage.institutions as CoverageInstitution[]}
          locale={locale}
        />
      </section>
    </>
  )
}
