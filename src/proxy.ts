import { NextResponse, type NextRequest } from 'next/server'
import { defaultLocale, isLaunchLocale, launchLocales } from './i18n/config'

function preferredLocale(request: NextRequest) {
  const saved = request.cookies.get('studycn-locale')?.value
  if (saved && isLaunchLocale(saved)) return saved

  const accepted = request.headers.get('accept-language') || ''
  for (const entry of accepted.split(',')) {
    const language = entry.trim().split(';')[0]?.split('-')[0]?.toLowerCase()
    if (language && isLaunchLocale(language)) return language
  }
  return defaultLocale
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const hasLocale = launchLocales.some((locale) => pathname === `/${locale}` || pathname.startsWith(`/${locale}/`))
  if (hasLocale) return NextResponse.next()

  const locale = preferredLocale(request)
  const url = request.nextUrl.clone()
  url.pathname = `/${locale}${pathname === '/' ? '' : pathname}`
  return NextResponse.redirect(url)
}

export const config = { matcher: ['/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\..*).*)'] }
