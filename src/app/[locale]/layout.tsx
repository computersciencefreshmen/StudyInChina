import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { SiteFooter } from '@/components/layout'
import { AppHeader } from '@/components/layout/AppHeader'
import { localeDirection, launchLocales } from '@/i18n/config'
import { getMessages } from '@/i18n/messages'
import { formatDate } from '@/lib/data/format'
import { getData } from '@/lib/data/load'
import { getDataReleaseDate } from '@/lib/data/release'
import { requireLocale, siteUrl } from '@/lib/site'
import '../globals.css'
import '../feature-styles.css'

export const metadata: Metadata = {
  metadataBase: siteUrl,
  applicationName: 'Study in China Atlas',
  formatDetection: { email: false, address: false, telephone: false },
  icons: { icon: '/icon.svg' },
}

export const revalidate = 86_400

export function generateStaticParams() {
  return launchLocales.map((locale) => ({ locale }))
}

export default async function LocaleLayout({ children, params }: Readonly<{ children: React.ReactNode; params: Promise<{ locale: string }> }>) {
  const locale = requireLocale((await params).locale)
  if (!locale) notFound()
  const messages = getMessages(locale)
  const releaseDate = formatDate(getDataReleaseDate(getData()), locale, '—')
  const releaseLabel = `${messages.shell.dataRelease}: ${releaseDate}`

  return <html lang={locale} dir={localeDirection(locale)}>
    <body>
      <AppHeader locale={locale} />
      <main id="main-content" className="atlas-main">{children}</main>
      <SiteFooter
        locale={locale}
        homeHref={`/${locale}`}
        brandName={messages.brand}
        description={messages.footer.project}
        creator={{ prefix: messages.shell.creatorPrefix, label: 'Henry Yang', href: 'https://yanghanyu2023.wixsite.com/henry' }}
        columns={[
          { title: messages.shell.footerExplore, links: [
            { label: messages.nav.universities, href: `/${locale}/universities` },
            { label: messages.nav.programs, href: `/${locale}/programs` },
            { label: messages.nav.scholarships, href: `/${locale}/scholarships` },
            { label: messages.nav.cities, href: `/${locale}/cities` },
          ] },
          { title: messages.shell.footerProject, links: [
            { label: messages.nav.guides, href: `/${locale}/guides` },
            { label: messages.nav.about, href: `/${locale}/about` },
            { label: messages.nav.contact, href: `/${locale}/contact` },
            { label: 'GitHub', href: 'https://github.com/computersciencefreshmen/StudyInChina', external: true },
          ] },
        ]}
        legalLinks={[
          { label: messages.footer.privacy, href: `/${locale}/privacy` },
          { label: messages.footer.disclaimer, href: `/${locale}/disclaimer` },
          { label: messages.footer.dataPolicy, href: `/${locale}/data-policy` },
          { label: messages.footer.updates, href: `/${locale}/updates` },
        ]}
        disclaimer={messages.common.authoritativeNotice}
        updatedLabel={releaseLabel}
      />
      <Analytics />
      <SpeedInsights />
    </body>
  </html>
}
