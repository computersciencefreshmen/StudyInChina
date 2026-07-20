'use client'

import { usePathname } from 'next/navigation'
import { EmptyState, LinkButton } from '@/components/ui'
import { isLaunchLocale, type LaunchLocale } from '@/i18n/config'
import { getMessages } from '@/i18n/messages'

export default function NotFoundPage() {
  const code = usePathname().split('/')[1] || 'en'; const locale: LaunchLocale = isLaunchLocale(code) ? code : 'en'
  const copy = getMessages(locale).notFound
  return <section className="atlas-container atlas-section"><EmptyState title={copy.title} description={copy.description} action={<LinkButton href={`/${locale}`}>{copy.action}</LinkButton>} /></section>
}
