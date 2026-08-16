import { notFound } from 'next/navigation'
import { FavoritesView } from '@/components/features/FavoritesView'
import { PageHero } from '@/components/ui'
import { getMessages } from '@/i18n/messages'
import { pageMetadata, requireLocale } from '@/lib/site'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const locale = requireLocale((await params).locale) || 'en'
  const messages = getMessages(locale)
  return {
    ...pageMetadata(locale, messages.favorites.title, messages.favorites.intro, 'favorites'),
    robots: { index: false, follow: true },
  }
}

export default async function FavoritesPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const locale = requireLocale((await params).locale)
  if (!locale) notFound()
  const messages = getMessages(locale)

  return <>
    <PageHero
      variant="compact"
      eyebrow={messages.common.compare}
      title={messages.favorites.title}
      description={messages.favorites.intro}
    />
    <section className="atlas-container atlas-section">
      <FavoritesView locale={locale} messages={messages} />
    </section>
  </>
}
