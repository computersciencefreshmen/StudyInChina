'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { SiteHeader } from '@/components/layout'
import { useFavorites } from '@/components/features/useFavorites'
import { cx } from '@/components/ui/cx'
import { localeNames, localizePathname, publicLocales, type LaunchLocale } from '@/i18n/config'
import { getMessages } from '@/i18n/messages'

function ShortlistLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  const { favorites, ready } = useFavorites()
  const count = ready ? favorites.length : 0

  return (
    <Link
      className={cx('atlas-site-header__shortlist', active && 'is-active')}
      href={href}
      aria-current={active ? 'page' : undefined}
    >
      <span aria-hidden="true">☆</span>
      <span>{label}</span>
      {count > 0 ? <strong aria-label={`${count}`}>{count}</strong> : null}
    </Link>
  )
}

export function AppHeader({ locale }: { locale: LaunchLocale }) {
  const pathname = usePathname()
  const messages = getMessages(locale)

  useEffect(() => {
    document.cookie = `studycn-locale=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`
  }, [locale])

  const nav = [
    ['', messages.nav.home],
    ['universities', messages.nav.universities],
    ['programs', messages.nav.programs],
    ['scholarships', messages.nav.scholarships],
    ['cities', messages.nav.cities],
    ['guides', messages.nav.guides],
  ] as const
  const favoritesHref = `/${locale}/favorites`
  const favoritesActive = pathname.startsWith(favoritesHref)

  return <SiteHeader
    locale={locale}
    homeHref={`/${locale}`}
    brandName={messages.brand}
    brandTagline={messages.shell.brandTagline}
    navLabel={messages.shell.navLabel}
    languageLabel={messages.common.language}
    mobileMenuLabel={messages.shell.mobileMenuLabel}
    skipLinkLabel={messages.shell.skipLinkLabel}
    navItems={nav.map(([segment, label]) => ({
      label,
      href: segment ? `/${locale}/${segment}` : `/${locale}`,
      active: segment ? pathname.startsWith(`/${locale}/${segment}`) : pathname === `/${locale}`,
    }))}
    languages={publicLocales.map((code) => ({
      code,
      label: localeNames[code],
      href: localizePathname(pathname, code),
      active: code === locale,
    }))}
    actions={<ShortlistLink href={favoritesHref} label={messages.nav.favorites} active={favoritesActive} />}
  />
}
