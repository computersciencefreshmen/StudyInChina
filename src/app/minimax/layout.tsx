import type { Metadata } from 'next'
import '../themes.css'
import '../craft.css'

export const metadata: Metadata = {
  title: 'MiniMax 只读用量看板 · Study in China',
  description: '查看云端模型调用、订阅额度与项目覆盖的最近观测。',
  robots: { index: false, follow: false, noarchive: true },
  referrer: 'no-referrer',
  icons: { icon: '/atlas-icon.svg', apple: '/atlas-apple-icon.png' },
}
export default function MiniMaxLayout({ children }: { children: React.ReactNode }) {
  return <html lang="zh-CN" data-theme="craft" data-design="craft"><body style={{ margin: 0 }}>{children}</body></html>
}
