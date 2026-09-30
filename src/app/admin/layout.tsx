import type { Metadata } from 'next'
import { THEME_INIT_SCRIPT } from '@/lib/site-themes'
export const metadata: Metadata = { title: '管理员工作台 · Study in China', robots: { index: false, follow: false } }
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <html lang="zh-CN" data-theme="cloud" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} /></head><body style={{ margin: 0 }}>{children}</body></html>
}
