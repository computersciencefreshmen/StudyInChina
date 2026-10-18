import { NextResponse, type NextRequest } from 'next/server'
import {
  defaultLocale,
  isPreviewLocale,
  isPublicLocale,
  localizePathname,
  pathnameLocale,
} from './i18n/config'

function preferredLocale(request: NextRequest) {
  const saved = request.cookies.get('studycn-locale')?.value
  if (saved && isPublicLocale(saved)) return saved

  const accepted = request.headers.get('accept-language') || ''
  for (const entry of accepted.split(',')) {
    const language = entry.trim().split(';')[0]?.split('-')[0]?.toLowerCase()
    if (language && isPublicLocale(language)) return language
  }
  return defaultLocale
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const pathLocale = pathnameLocale(pathname)

  if (pathLocale && isPublicLocale(pathLocale)) return NextResponse.next()

  const url = request.nextUrl.clone()
  // The public landing address always opens English, including returning visitors.
  // Explicit language URLs and preferences on other unlocalized paths still work.
  // Preview routes are not public yet. Redirect directly to the same English
  // path so /pt/programs never becomes the misleading /en/pt/programs.
  const locale = pathname === '/' || (pathLocale && isPreviewLocale(pathLocale))
    ? defaultLocale
    : preferredLocale(request)
  url.pathname = localizePathname(pathname, locale)
  return NextResponse.redirect(url)
}

export const config = { matcher: ['/((?!api|admin(?:/|$)|themes(?:/|$)|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\..*).*)'] }
