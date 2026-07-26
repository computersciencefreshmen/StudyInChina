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
  reconciled: string
  complete: string
  limited: string
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
    description: '147/147 所高校已完成首轮官方来源对账：135 所已核验国际招生主页、项目目录和奖学金三类来源，12 所因官网有限公开保留核验记录和缺失状态。',
    eyebrow: '教育部第二轮“双一流”建设高校 · 全量目标库',
    reconciled: '已完成首轮对账',
    complete: '三类来源完整',
    limited: '官网有限公开',
    sources: '已核验官方来源',
    tableTitle: '高校与官方来源',
    tableDescription: '表内链接只指向学校官方 HTTPS 网站。135 所三类来源完整；其余 12 所明确显示官网未提供或来源暂不可用，不用历史页面补齐当前申请入口。',
    officialList: '教育部官方名单',
    api: '查看 JSON API',
    notice: '项目名称、费用、奖学金金额和截止日期只有通过字段级证据校验后才会进入正式项目页；未知值不会猜测。',
  },
  en: {
    title: '147 Double First-Class Universities',
    description: 'The first official-source reconciliation is complete for all 147/147 universities: 135 have all three source categories verified, while 12 retain audited missing or unavailable states because their official websites publish limited information.',
    eyebrow: 'MOE second-round Double First-Class list · complete target registry',
    reconciled: 'First-pass reconciled',
    complete: 'All three sources complete',
    limited: 'Limited official disclosure',
    sources: 'Verified official sources',
    tableTitle: 'Universities and official sources',
    tableDescription: 'Every link points to an official university HTTPS site. All three categories are complete for 135 universities; the other 12 explicitly show officially missing or temporarily unavailable sources instead of using historical pages as current application links.',
    officialList: 'Official MOE list',
    api: 'View JSON API',
    notice: 'Program names, fees, funding amounts, and deadlines enter program pages only after field-level evidence checks. Unknown values are never guessed.',
  },
  ru: {
    title: '147 университетов программы Double First-Class',
    description: 'Первичная сверка официальных источников завершена для всех 147/147 вузов: у 135 проверены все три категории, а у 12 зафиксированы отсутствующие или недоступные источники из-за ограниченной публикации на официальных сайтах.',
    eyebrow: 'Полный перечень второго раунда Министерства образования КНР',
    reconciled: 'Первичная сверка завершена',
    complete: 'Все три источника проверены',
    limited: 'Ограниченная публикация',
    sources: 'Проверенные источники',
    tableTitle: 'Университеты и официальные источники',
    tableDescription: 'Все ссылки ведут на официальные HTTPS-сайты вузов. Для 135 вузов заполнены все три категории; для остальных 12 явно указано отсутствие или временная недоступность источника, без подмены текущих заявок историческими страницами.',
    officialList: 'Официальный список',
    api: 'JSON API',
    notice: 'Названия программ, стоимость, суммы финансирования и сроки публикуются только после проверки доказательств по каждому полю.',
  },
  de: {
    title: '147 Double-First-Class-Hochschulen',
    description: 'Die erste Prüfung offizieller Quellen ist für alle 147/147 Hochschulen abgeschlossen: Bei 135 sind alle drei Quellenarten verifiziert, bei 12 sind fehlende oder nicht verfügbare Quellen wegen begrenzter Veröffentlichung der offiziellen Website dokumentiert.',
    eyebrow: 'Vollständige Zielliste der zweiten MOE-Runde',
    reconciled: 'Erste Prüfung abgeschlossen',
    complete: 'Alle drei Quellen vollständig',
    limited: 'Begrenzte Veröffentlichung',
    sources: 'Geprüfte offizielle Quellen',
    tableTitle: 'Hochschulen und offizielle Quellen',
    tableDescription: 'Alle Links führen zu offiziellen HTTPS-Seiten. Für 135 Hochschulen sind alle drei Kategorien vollständig; bei den übrigen 12 werden offiziell fehlende oder vorübergehend nicht verfügbare Quellen ausdrücklich ausgewiesen.',
    officialList: 'Offizielle MOE-Liste',
    api: 'JSON API',
    notice: 'Programme, Gebühren, Förderbeträge und Fristen erscheinen erst nach einer feldbezogenen Quellenprüfung.',
  },
  fr: {
    title: '147 établissements Double First-Class',
    description: 'Le premier rapprochement des sources officielles est terminé pour les 147/147 établissements : 135 disposent des trois catégories vérifiées et 12 conservent des états manquants ou indisponibles en raison d’une publication officielle limitée.',
    eyebrow: 'Liste cible complète du deuxième cycle du ministère',
    reconciled: 'Premier rapprochement terminé',
    complete: 'Trois sources complètes',
    limited: 'Publication officielle limitée',
    sources: 'Sources officielles vérifiées',
    tableTitle: 'Établissements et sources officielles',
    tableDescription: 'Tous les liens pointent vers des sites HTTPS officiels. Les trois catégories sont complètes pour 135 établissements ; pour les 12 autres, les sources officiellement absentes ou temporairement indisponibles sont indiquées sans remplacer les candidatures actuelles par des pages historiques.',
    officialList: 'Liste officielle',
    api: 'API JSON',
    notice: 'Les programmes, frais, financements et échéances ne sont publiés qu’après validation des preuves pour chaque champ.',
  },
  es: {
    title: '147 universidades Double First-Class',
    description: 'La primera conciliación de fuentes oficiales está completa para las 147/147 universidades: 135 tienen verificadas las tres categorías y 12 conservan estados ausentes o no disponibles por la publicación limitada de sus sitios oficiales.',
    eyebrow: 'Registro completo de la segunda ronda del Ministerio de Educación',
    reconciled: 'Primera conciliación completa',
    complete: 'Tres fuentes completas',
    limited: 'Publicación oficial limitada',
    sources: 'Fuentes oficiales verificadas',
    tableTitle: 'Universidades y fuentes oficiales',
    tableDescription: 'Todos los enlaces apuntan a sitios HTTPS oficiales. Las tres categorías están completas para 135 universidades; en las otras 12 se indican explícitamente las fuentes no publicadas o temporalmente no disponibles, sin sustituir solicitudes actuales por páginas históricas.',
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
            <span>
              {totals.reconciledInstitutionTargets}/{totals.institutionTargets}
            </span>
          </>
        )}
      />
      <section className="atlas-container atlas-section section-block--tight">
        <div className="stat-strip">
          <div className="stat">
            <strong>
              {totals.reconciledInstitutionTargets}/{totals.institutionTargets}
            </strong>
            <span>{copy.reconciled}</span>
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
            <strong>{totals.reconciledLimited}</strong>
            <span>{copy.limited}</span>
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
