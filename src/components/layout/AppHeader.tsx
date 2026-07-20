'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { SiteHeader } from '@/components/layout'
import { localeNames, localizePathname, publicLocales, type LaunchLocale } from '@/i18n/config'
import { getMessages } from '@/i18n/messages'

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
    ['favorites', messages.nav.favorites],
  ] as const
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
  />
}
