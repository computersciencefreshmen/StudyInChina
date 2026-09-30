import type { Metadata } from 'next'
export const metadata: Metadata = { title: '主题实验室 · Study in China', robots: { index: false, follow: false } }
export default function ThemesLayout({ children }: { children: React.ReactNode }) {
  return <html lang="zh-CN"><body style={{ margin: 0 }}>{children}</body></html>
}
