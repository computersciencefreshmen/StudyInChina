import { ImageResponse } from 'next/og'

import { isPublicLocale } from '@/i18n/config'
import { getMessages } from '@/i18n/messages'

export const alt = 'Study in China Atlas — source-led university and program discovery'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function OpenGraphImage({ params }: { params: Promise<{ locale: string }> }) {
  const value = (await params).locale
  const locale = isPublicLocale(value) ? value : 'en'
  const messages = getMessages(locale)

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        position: 'relative',
        overflow: 'hidden',
        background: '#f5efe2',
        color: '#10283d',
        padding: '72px 80px',
        fontFamily: 'Georgia, Times New Roman, serif',
      }}
    >
      <div style={{ position: 'absolute', inset: 0, display: 'flex', opacity: 0.18, backgroundImage: 'linear-gradient(90deg, #b8a789 1px, transparent 1px), linear-gradient(#b8a789 1px, transparent 1px)', backgroundSize: '72px 72px' }} />
      <div style={{ position: 'absolute', top: 66, right: 84, width: 222, height: 222, display: 'flex', borderRadius: '999px', background: '#c7442d', opacity: 0.94 }} />
      <div style={{ position: 'absolute', right: 0, bottom: 0, width: 460, height: 190, display: 'flex', borderTop: '2px dashed rgba(16,40,61,.32)', borderRadius: '50%', transform: 'rotate(-12deg)' }} />

      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
          <div style={{ width: 72, height: 72, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#10283d', color: '#f5efe2', fontSize: 42, fontWeight: 700 }}>中</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 25, fontWeight: 800, letterSpacing: '-0.02em' }}>{messages.brand}</div>
            <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 15, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#62717c' }}>{messages.shell.brandTagline}</div>
          </div>
        </div>

        <div style={{ maxWidth: 850, display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontFamily: 'Arial, sans-serif', color: '#9d3324', fontSize: 17, fontWeight: 800, letterSpacing: '0.13em', textTransform: 'uppercase' }}>
            <span style={{ width: 42, height: 2, display: 'flex', background: '#9d3324' }} />
            {messages.home.eyebrow}
          </div>
          <div style={{ fontSize: 66, fontWeight: 700, letterSpacing: '-0.045em', lineHeight: 1.02 }}>{messages.home.title}</div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', fontFamily: 'Arial, sans-serif', fontSize: 17, color: '#536570' }}>
          <span>{messages.common.officialSource} · {messages.common.lastVerified}</span>
          <span style={{ color: '#10283d', fontWeight: 800 }}>studyinchina.vercel.app</span>
        </div>
      </div>
    </div>,
    size,
  )
}
