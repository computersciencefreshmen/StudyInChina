import type { Metadata } from 'next'
import { THEME_INIT_SCRIPT } from '@/lib/site-themes'
import '../themes.css'
import '../craft.css'
import './admin.css'
export const metadata: Metadata = { title: '管理员工作台 · Study in China', robots: { index: false, follow: false }, icons: { icon: '/atlas-icon.svg', apple: '/atlas-apple-icon.png' } }
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <html lang="zh-CN" data-theme="craft" data-design="craft" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} /></head><body className="atlas-admin">{children}</body></html>
}
