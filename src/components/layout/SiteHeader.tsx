import Link from 'next/link'
import type { ReactNode } from 'react'

import { LanguageSwitcher, type LanguageOption } from '../ui/LanguageSwitcher'
import { cx } from '../ui/cx'

export interface HeaderNavItem {
  label: string
  href: string
  active?: boolean
  badge?: string
}

export interface SiteHeaderProps {
  locale: string
  navItems: HeaderNavItem[]
  languages: LanguageOption[]
  homeHref?: string
  brandName?: string
  brandTagline?: string
  brandMark?: string
  navLabel?: string
  languageLabel?: string
  mobileMenuLabel?: string
  skipLinkLabel?: string
  mainContentId?: string
  actions?: ReactNode
  className?: string
}

function Navigation({ items, label, mobile = false }: {
  items: HeaderNavItem[]
  label: string
  mobile?: boolean
}) {
  return (
    <nav className={mobile ? 'atlas-site-header__mobile-links' : 'atlas-site-header__nav'} aria-label={label}>
      <ul>
        {items.map((item) => (
          <li key={`${item.href}-${item.label}`}>
            <Link
              href={item.href}
              aria-current={item.active ? 'page' : undefined}
              className={cx(item.active && 'is-active')}
            >
              <span>{item.label}</span>
              {item.badge ? <small>{item.badge}</small> : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}

export function SiteHeader({
  locale,
  navItems,
  languages,
  homeHref = '/',
  brandName = 'Study in China',
  brandTagline = 'Independent student atlas',
  brandMark = '中',
  navLabel = 'Primary navigation',
  languageLabel = 'Language',
  mobileMenuLabel = 'Open menu',
  skipLinkLabel = 'Skip to main content',
  mainContentId = 'main-content',
  actions,
  className,
}: SiteHeaderProps) {
  return (
    <>
      <a className="atlas-skip-link" href={`#${mainContentId}`}>{skipLinkLabel}</a>
      <header className={cx('atlas-site-header', className)} lang={locale}>
        <div className="atlas-site-header__rule" aria-hidden="true" />
        <div className="atlas-container atlas-site-header__inner">
          <Link className="atlas-site-header__brand" href={homeHref} aria-label={brandName}>
            <span className="atlas-site-header__seal" aria-hidden="true">{brandMark}</span>
            <span className="atlas-site-header__brand-copy">
              <strong>{brandName}</strong>
              <small>{brandTagline}</small>
            </span>
          </Link>

          <Navigation items={navItems} label={navLabel} />

          <div className="atlas-site-header__tools">
            <LanguageSwitcher languages={languages} label={languageLabel} compact />
            {actions ? <div className="atlas-site-header__actions">{actions}</div> : null}
          </div>

          <details className="atlas-site-header__mobile-menu">
            <summary aria-label={mobileMenuLabel}>
              <span className="atlas-site-header__menu-lines" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              <span className="atlas-site-header__menu-label">{mobileMenuLabel}</span>
            </summary>
            <div className="atlas-site-header__mobile-panel">
              <Navigation items={navItems} label={navLabel} mobile />
              <div className="atlas-site-header__mobile-footer">
                <LanguageSwitcher languages={languages} label={languageLabel} />
                {actions ? <div className="atlas-site-header__mobile-actions">{actions}</div> : null}
              </div>
            </div>
          </details>
        </div>
      </header>
    </>
  )
}
