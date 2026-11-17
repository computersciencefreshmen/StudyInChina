import { beforeEach, describe, expect, it, vi } from 'vitest'
const redirects = vi.hoisted(() => ({ redirect: vi.fn((href: string) => { throw new Error(`REDIRECT:${href}`) }) }))
vi.mock('next/navigation', () => ({ permanentRedirect: redirects.redirect, notFound: () => { throw new Error('NOT_FOUND') } }))
import ImportedProgramsPage from '@/app/[locale]/programs/imported/page'
beforeEach(() => vi.clearAllMocks())
describe('legacy program directory filter aliases', () => {
  it('maps the selected school and search into the normal catalogue and resets obsolete source pagination', async () => {
    await expect(ImportedProgramsPage({ params: Promise.resolve({ locale: 'en' }), searchParams: Promise.resolve({ school: 'cucas-alpha', query: 'Medicine', page: '3', view: 'links', provider: 'cucas' }) })).rejects.toThrow('REDIRECT:')
    expect(redirects.redirect).toHaveBeenCalledWith('/en/programs?q=Medicine&institution=cucas-alpha')
  })
  it('retains Chinese navigation and safely URL-encodes unknown school identifiers', async () => {
    const unsafe = '\"><img src=x onerror=alert(1)>' + 'z'.repeat(180)
    await expect(ImportedProgramsPage({ params: Promise.resolve({ locale: 'zh' }), searchParams: Promise.resolve({ school: unsafe }) })).rejects.toThrow('REDIRECT:')
    const target = new URL(redirects.redirect.mock.calls[0][0], 'https://example.test')
    expect(target.pathname).toBe('/zh/programs')
    expect(target.searchParams.get('institution')).toBe(unsafe.slice(0,160))
    expect(target.href).not.toContain('<img')
  })
  it('redirects the former default directory to the single normal catalogue', async () => {
    await expect(ImportedProgramsPage({ params: Promise.resolve({ locale: 'en' }), searchParams: Promise.resolve({}) })).rejects.toThrow('REDIRECT:/en/programs')
  })
  it('rejects unsupported locales before redirecting', async () => {
    await expect(ImportedProgramsPage({ params: Promise.resolve({ locale: 'invalid' }), searchParams: Promise.resolve({}) })).rejects.toThrow('NOT_FOUND')
    expect(redirects.redirect).not.toHaveBeenCalled()
  })
})
