import type { Metadata } from 'next'
import '../themes.css'
import '../craft.css'
export const metadata: Metadata = { title: '主题实验室 · Study in China', robots: { index: false, follow: false }, icons: { icon: '/atlas-icon.svg', apple: '/atlas-apple-icon.png' } }
export default function ThemesLayout({ children }: { children: React.ReactNode }) {
  return <html lang="zh-CN" data-theme="craft" data-design="craft"><body style={{ margin: 0 }}>{children}</body></html>
}
