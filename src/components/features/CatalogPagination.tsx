import { LinkButton } from '@/components/ui'
import type { CatalogExplorerText } from './CatalogFilterSummary'
import styles from './CatalogExplorerControls.module.css'

export function CatalogPagination({
  ariaLabel,
  nextHref,
  nextLabel,
  page,
  pageCount,
  position,
  previousHref,
  previousLabel,
  text,
}: {
  ariaLabel: string
  nextHref: string | undefined
  nextLabel: string
  page: number
  pageCount: number
  position: 'top' | 'bottom'
  previousHref: string | undefined
  previousLabel: string
  text: CatalogExplorerText
}) {
  if (pageCount <= 1) return null

  return <nav
    className={`${styles.pagination} ${position === 'top' ? styles.paginationTop : styles.paginationBottom}`}
    aria-label={`${ariaLabel} · ${position === 'top' ? text.topPagination : text.bottomPagination}`}
  >
    {previousHref
      ? <LinkButton variant="ghost" rel="prev" href={previousHref}>{previousLabel}</LinkButton>
      : <span className={styles.placeholder} aria-hidden="true" />}
    <strong className={styles.page}>{text.page} {page} / {pageCount}</strong>
    {nextHref
      ? <LinkButton variant="ghost" rel="next" href={nextHref}>{nextLabel}</LinkButton>
      : <span className={styles.placeholder} aria-hidden="true" />}
  </nav>
}
