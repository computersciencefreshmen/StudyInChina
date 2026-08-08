import Link from 'next/link'
import type { LaunchLocale } from '@/i18n/config'
import styles from './CatalogExplorerControls.module.css'

export type CatalogFilterChip = {
  key: string
  label: string
  value: string
  href: string
}

export type CatalogExplorerText = {
  activeFilters: string
  advancedFilters: string
  bottomPagination: string
  page: string
  removeFilter: string
  resultsRange: string
  topPagination: string
}

const explorerText: Record<LaunchLocale, CatalogExplorerText> = {
  en: { activeFilters: 'Active filters', advancedFilters: 'More filters', bottomPagination: 'Bottom pagination', page: 'Page', removeFilter: 'Remove filter', resultsRange: 'Results range', topPagination: 'Top pagination' },
  zh: { activeFilters: '当前筛选', advancedFilters: '更多筛选', bottomPagination: '底部翻页', page: '第', removeFilter: '移除筛选', resultsRange: '结果范围', topPagination: '顶部翻页' },
  ru: { activeFilters: 'Активные фильтры', advancedFilters: 'Другие фильтры', bottomPagination: 'Нижняя навигация', page: 'Страница', removeFilter: 'Удалить фильтр', resultsRange: 'Диапазон результатов', topPagination: 'Верхняя навигация' },
  de: { activeFilters: 'Aktive Filter', advancedFilters: 'Weitere Filter', bottomPagination: 'Untere Seitennavigation', page: 'Seite', removeFilter: 'Filter entfernen', resultsRange: 'Ergebnisbereich', topPagination: 'Obere Seitennavigation' },
  fr: { activeFilters: 'Filtres actifs', advancedFilters: 'Plus de filtres', bottomPagination: 'Pagination inférieure', page: 'Page', removeFilter: 'Supprimer le filtre', resultsRange: 'Plage de résultats', topPagination: 'Pagination supérieure' },
  es: { activeFilters: 'Filtros activos', advancedFilters: 'Más filtros', bottomPagination: 'Paginación inferior', page: 'Página', removeFilter: 'Quitar filtro', resultsRange: 'Rango de resultados', topPagination: 'Paginación superior' },
}

export function catalogExplorerText(locale: LaunchLocale): CatalogExplorerText {
  return explorerText[locale]
}

export function CatalogFilterSummary({
  activeFilters,
  clearAllHref,
  clearAllLabel,
  itemCount,
  page,
  pageSize,
  resultLabel,
  text,
  total,
  totalExact,
}: {
  activeFilters: CatalogFilterChip[]
  clearAllHref: string
  clearAllLabel: string
  itemCount: number
  page: number
  pageSize: number
  resultLabel: string
  text: CatalogExplorerText
  total: number
  totalExact: boolean
}) {
  const start = itemCount > 0 ? ((page - 1) * pageSize) + 1 : 0
  const end = itemCount > 0 ? start + itemCount - 1 : 0
  const visibleRange = start === end ? String(start) : `${start}–${end}`

  return <section className={styles.summary} aria-label={text.resultsRange}>
    <p className={styles.range} aria-live="polite">
      <strong>{visibleRange}</strong>
      <span aria-hidden="true">/</span>
      <span>{total}{totalExact ? '' : '+'} {resultLabel}</span>
    </p>
    {activeFilters.length ? (
      <div className={styles.filterRow}>
        <span className={styles.filterTitle}>{text.activeFilters}</span>
        <ul className={styles.chipList}>
          {activeFilters.map((filter) => <li key={filter.key}>
            <Link
              className={styles.chip}
              href={filter.href}
              aria-label={`${text.removeFilter}: ${filter.label}, ${filter.value}`}
            >
              {filter.label}: {filter.value} <span aria-hidden="true">×</span>
            </Link>
          </li>)}
        </ul>
        <Link className={styles.clear} href={clearAllHref}>{clearAllLabel}</Link>
      </div>
    ) : null}
  </section>
}
