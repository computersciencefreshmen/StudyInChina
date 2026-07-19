'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { SiteHeader } from '@/components/layout'
import { localeNames, launchLocales, type LaunchLocale } from '@/i18n/config'
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
  const remainder = pathname.replace(/^\/(en|zh|ru)(?=\/|$)/, '') || ''

  return <SiteHeader
    locale={locale}
    homeHref={`/${locale}`}
    brandName={messages.brand}
    brandTagline={locale === 'zh' ? '独立留学资料地图' : locale === 'ru' ? 'Независимый атлас' : 'Independent student atlas'}
    navLabel={locale === 'zh' ? '主导航' : locale === 'ru' ? 'Основная навигация' : 'Primary navigation'}
    languageLabel={messages.common.language}
    mobileMenuLabel={locale === 'zh' ? '打开菜单' : locale === 'ru' ? 'Открыть меню' : 'Open menu'}
    skipLinkLabel={locale === 'zh' ? '跳到主要内容' : locale === 'ru' ? 'К основному содержанию' : 'Skip to main content'}
    navItems={nav.map(([segment, label]) => ({
      label,
      href: segment ? `/${locale}/${segment}` : `/${locale}`,
      active: segment ? pathname.startsWith(`/${locale}/${segment}`) : pathname === `/${locale}`,
    }))}
    languages={launchLocales.map((code) => ({
      code,
      label: localeNames[code],
      href: `/${code}${remainder}`,
      active: code === locale,
    }))}
  />
}
