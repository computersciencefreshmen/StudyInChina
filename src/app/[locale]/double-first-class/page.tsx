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
    title: '144 所双一流高校公开数据表',
    description: '公开表格中的 144/144 所高校已完成首轮官方来源对账；教育部原始 147 所名单继续保留审计，3 所军事院校不在公开表格和 API 快照中展示。',
    eyebrow: '教育部第二轮“双一流”建设高校 · 公开 144 所 / 原始 147 所审计',
    reconciled: '已完成首轮对账',
    complete: '三类来源完整',
    limited: '官网有限公开',
    sources: '已核验官方来源',
    tableTitle: '高校与官方来源',
    tableDescription: '表内仅展示 144 所非军事院校，链接只指向学校官方 HTTPS 网站；官网未提供或来源暂不可用时仅显示核验状态，不用历史页面补齐当前申请入口。',
    officialList: '教育部官方名单',
    api: '查看 JSON API',
    notice: '项目名称、费用、奖学金金额和截止日期只有通过字段级证据校验后才会进入正式项目页；未知值不会猜测。',
  },
  en: {
    title: '144 Public Double First-Class Universities',
    description: 'All 144/144 universities in the public table have completed first-pass official-source reconciliation. The original 147-school MOE registry remains available for audit, while three military universities are omitted from the public table and API snapshot.',
    eyebrow: 'MOE second-round Double First-Class list · 144 public / 147 registry targets audited',
    reconciled: 'First-pass reconciled',
    complete: 'All three sources complete',
    limited: 'Limited official disclosure',
    sources: 'Verified official sources',
    tableTitle: 'Universities and official sources',
    tableDescription: 'The table contains 144 non-military universities and links only to official HTTPS sites. Missing or unavailable sources remain explicit verification states and are never replaced with historical pages as current application links.',
    officialList: 'Official MOE list',
    api: 'View JSON API',
    notice: 'Program names, fees, funding amounts, and deadlines enter program pages only after field-level evidence checks. Unknown values are never guessed.',
  },
  ru: {
    title: '144 открытых вуза программы Double First-Class',
    description: 'Первичная сверка официальных источников завершена для всех 144/144 вузов открытой таблицы. Исходный реестр Министерства образования из 147 вузов сохранён для аудита; три военных вуза исключены из открытой таблицы и снимка API.',
    eyebrow: 'Второй раунд Министерства образования · 144 открытых / 147 в аудиторском реестре',
    reconciled: 'Первичная сверка завершена',
    complete: 'Все три источника проверены',
    limited: 'Ограниченная публикация',
    sources: 'Проверенные источники',
    tableTitle: 'Университеты и официальные источники',
    tableDescription: 'В таблице представлены 144 невоенных вуза, а ссылки ведут только на официальные HTTPS-сайты. Отсутствующие или недоступные источники явно отмечаются и не заменяются историческими страницами.',
    officialList: 'Официальный список',
    api: 'JSON API',
    notice: 'Названия программ, стоимость, суммы финансирования и сроки публикуются только после проверки доказательств по каждому полю.',
  },
  de: {
    title: '144 öffentliche Double-First-Class-Hochschulen',
    description: 'Die erste Prüfung offizieller Quellen ist für alle 144/144 Hochschulen der öffentlichen Tabelle abgeschlossen. Das ursprüngliche MOE-Register mit 147 Hochschulen bleibt zur Prüfung erhalten; drei Militärhochschulen fehlen in Tabelle und API-Snapshot.',
    eyebrow: 'Zweite MOE-Runde · 144 öffentlich / 147 Registerziele geprüft',
    reconciled: 'Erste Prüfung abgeschlossen',
    complete: 'Alle drei Quellen vollständig',
    limited: 'Begrenzte Veröffentlichung',
    sources: 'Geprüfte offizielle Quellen',
    tableTitle: 'Hochschulen und offizielle Quellen',
    tableDescription: 'Die Tabelle enthält 144 nichtmilitärische Hochschulen und verlinkt nur offizielle HTTPS-Seiten. Fehlende oder nicht verfügbare Quellen bleiben als Prüfstatus sichtbar und werden nicht durch historische Seiten ersetzt.',
    officialList: 'Offizielle MOE-Liste',
    api: 'JSON API',
    notice: 'Programme, Gebühren, Förderbeträge und Fristen erscheinen erst nach einer feldbezogenen Quellenprüfung.',
  },
  fr: {
    title: '144 établissements publics Double First-Class',
    description: 'Le premier rapprochement des sources officielles est terminé pour les 144/144 établissements du tableau public. Le registre ministériel d’origine de 147 établissements reste auditable ; trois universités militaires sont exclues du tableau et de l’instantané API.',
    eyebrow: 'Deuxième cycle du ministère · 144 publics / 147 cibles auditées',
    reconciled: 'Premier rapprochement terminé',
    complete: 'Trois sources complètes',
    limited: 'Publication officielle limitée',
    sources: 'Sources officielles vérifiées',
    tableTitle: 'Établissements et sources officielles',
    tableDescription: 'Le tableau contient 144 établissements non militaires et ne renvoie qu’aux sites HTTPS officiels. Les sources absentes ou indisponibles restent des états de vérification explicites, sans substitution par des pages historiques.',
    officialList: 'Liste officielle',
    api: 'API JSON',
    notice: 'Les programmes, frais, financements et échéances ne sont publiés qu’après validation des preuves pour chaque champ.',
  },
  es: {
    title: '144 universidades públicas Double First-Class',
    description: 'La primera conciliación de fuentes oficiales está completa para las 144/144 universidades de la tabla pública. El registro original de 147 universidades se conserva para auditoría; tres universidades militares se omiten de la tabla y del snapshot de la API.',
    eyebrow: 'Segunda ronda del Ministerio de Educación · 144 públicas / 147 objetivos auditados',
    reconciled: 'Primera conciliación completa',
    complete: 'Tres fuentes completas',
    limited: 'Publicación oficial limitada',
    sources: 'Fuentes oficiales verificadas',
    tableTitle: 'Universidades y fuentes oficiales',
    tableDescription: 'La tabla contiene 144 universidades no militares y solo enlaza sitios HTTPS oficiales. Las fuentes ausentes o no disponibles siguen visibles como estados de verificación y no se sustituyen por páginas históricas.',
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
