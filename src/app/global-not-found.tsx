import type { Metadata } from 'next'
import Link from 'next/link'
import { LinkButton } from '@/components/ui'
import './globals.css'
import './feature-styles.css'

export const metadata: Metadata = {
  title: 'Page not found | Study in China Atlas',
  description: 'The requested Study in China Atlas page does not exist.',
}

export default function GlobalNotFound() {
  return <html lang="en">
    <body>
      <main id="main-content" className="atlas-main global-not-found">
        <section className="atlas-container atlas-section">
          <div className="atlas-empty-state">
            <div className="atlas-empty-state__mark" aria-hidden="true">404</div>
            <div className="atlas-empty-state__content">
              <p className="atlas-kicker">Lost route · 页面不存在 · Страница не найдена</p>
              <h1 className="atlas-empty-state__title">This page could not be found</h1>
              <p className="atlas-empty-state__description">The link may have changed, or the record has not been published yet.</p>
              <div className="atlas-empty-state__action atlas-cluster">
                <LinkButton href="/en">English home</LinkButton>
                <Link href="/zh" className="text-link">中文首页</Link>
                <Link href="/ru" className="text-link">Русская главная</Link>
              </div>
            </div>
          </div>
        </section>
      </main>
    </body>
  </html>
}
