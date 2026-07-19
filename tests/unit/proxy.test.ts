import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'

import { proxy } from '@/proxy'

function createRequest(path: string, headers: HeadersInit = {}) {
  return new NextRequest(`https://studyinchina.example${path}`, { headers })
}

describe('locale proxy', () => {
  it('passes public locale routes through unchanged', () => {
    const response = proxy(createRequest('/zh/programs'))

    expect(response.headers.get('x-middleware-next')).toBe('1')
  })

  it('redirects preview locale paths directly to the equivalent English path', () => {
    const response = proxy(createRequest('/es/programs?degree=master'))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://studyinchina.example/en/programs?degree=master')
  })

  it('does not nest a bare preview locale beneath English', () => {
    const response = proxy(createRequest('/de'))

    expect(response.headers.get('location')).toBe('https://studyinchina.example/en')
  })

  it('ignores preview language preferences and chooses the next public language', () => {
    const response = proxy(createRequest('/programs', {
      'accept-language': 'de-DE,de;q=0.9,zh-CN;q=0.8',
    }))

    expect(response.headers.get('location')).toBe('https://studyinchina.example/zh/programs')
  })

  it('honors a saved public locale for unlocalized paths', () => {
    const response = proxy(createRequest('/cities', {
      cookie: 'studycn-locale=ru',
    }))

    expect(response.headers.get('location')).toBe('https://studyinchina.example/ru/cities')
  })
})
