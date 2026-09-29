import { describe, expect, it } from 'vitest'
import { serializeJsonLd } from '@/lib/seo/json-ld'

describe('JSON-LD serialization', () => {
  it('preserves multilingual source values while keeping nested text inside a single script', () => {
    const value = {
      '@type': 'FAQPage',
      name: '研究 <script> & scholarship "guide"',
      mainEntity: [{ acceptedAnswer: { text: '</script><img id="injected" src=x><!--' } }],
    }
    const html = `<script type="application/ld+json">${serializeJsonLd(value)}</script><p id="after">Content</p>`
    const document = new DOMParser().parseFromString(html, 'text/html')
    const script = document.querySelector('script')!

    expect(document.querySelectorAll('script')).toHaveLength(1)
    expect(document.querySelector('#injected')).toBeNull()
    expect(document.querySelector('#after')?.textContent).toBe('Content')
    expect(JSON.parse(script.textContent ?? '')).toEqual(value)
  })
})
