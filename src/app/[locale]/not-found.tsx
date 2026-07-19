'use client'

import { usePathname } from 'next/navigation'
import { EmptyState, LinkButton } from '@/components/ui'
import { isLaunchLocale, type LaunchLocale } from '@/i18n/config'

export default function NotFoundPage() {
  const code = usePathname().split('/')[1] || 'en'; const locale: LaunchLocale = isLaunchLocale(code) ? code : 'en'
  const copy = locale === 'zh' ? { title: '没有找到这个页面', description: '链接可能已更改，或该资料尚未发布。', action: '返回首页' } : locale === 'ru' ? { title: 'Страница не найдена', description: 'Ссылка могла измениться или материал ещё не опубликован.', action: 'На главную' } : { title: 'Page not found', description: 'The link may have changed, or this record has not been published.', action: 'Back to home' }
  return <section className="atlas-container atlas-section"><EmptyState title={copy.title} description={copy.description} action={<LinkButton href={`/${locale}`}>{copy.action}</LinkButton>} /></section>
}
