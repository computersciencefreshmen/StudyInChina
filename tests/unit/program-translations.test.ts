import { createHash } from 'node:crypto'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { translationKey, translationPath, type ProgramTranslationLocale, type ProgramTranslationRecord } from '@/lib/program-translation-contract'
import type { ThirdPartyProgram } from '@/lib/third-party-programs'
import type { CollectedProgramItem } from '@/lib/unified-programs'

const mocked = vi.hoisted(() => ({ resolve: vi.fn(), legacy: vi.fn() }))
vi.mock('@/lib/unified-programs', () => ({
  resolveUnifiedProgram: mocked.resolve,
  unifiedProgramSlug: (item: { collected?: { id: string }; program?: { slug: string } }) => item.collected?.id || item.program?.slug,
}))
vi.mock('@/lib/catalog-api/runtime', () => ({ getCatalogApiService: async () => ({ getProgram: mocked.legacy }) }))
vi.mock('@/lib/catalog-api/http', () => ({
  handleCatalogRequest: (operation: () => Promise<Response>) => operation(),
  ok: (value: unknown) => Response.json(value),
  notFound: () => Response.json({ error: 'not_found' }, { status: 404 }),
}))
vi.mock('@/components/ui', () => ({
  Badge: ({ children }: { children: ReactNode }) => createElement('span', null, children),
  Card: ({ children }: { children: ReactNode }) => createElement('article', null, children),
  LinkButton: ({ children, href }: { children: ReactNode; href: string }) => createElement('a', { href }, children),
  PageHero: ({ title, description }: { title: string; description: string }) => createElement('header', null,
    createElement('h1', null, title), createElement('p', null, description)),
}))

const requirement = 'Please submit a personal statement explaining your motivation for studying this subject. HSK 4 is required.'
const translatedRequirement = '请提交一份个人陈述，说明你学习该专业的动机。 HSK 4 is required.'
const materials = 'Please submit a personal statement explaining your interests and a copy of your passport.'
const description = 'Explore the subject through independent research and collaborative projects.'
const translatedText = new Map([[requirement, translatedRequirement], [materials, '请提交说明个人兴趣的陈述和护照复印件。'], [description, '通过独立研究和合作项目探索该学科。']])
const base = 'https://raw.githubusercontent.com/computersciencefreshmen/StudyInChina/catalog-program-feed/'
const profile: ThirdPartyProgram = {
  id: 'cucas-1', sourceId: '1', provider: 'CUCAS', schoolId: 'cucas-example', schoolName: 'Example University', name: 'Example Programme',
  sourceUrl: 'https://example.cucas.cn/program/Example-1.html', status: 'extracted', official: false, admissionYear: null,
  fetchedAt: '2026-11-17T00:00:00Z', evidenceHash: 'a'.repeat(64),
  fields: { requirements: requirement, materials, description, fees: 'Service fee USD 100', tuition: 'RMB 20,000 per year', duration: '4 Years',
    startDate: 'Sep 1, 2027', deadline: 'May 31, 2027', degree: 'Bachelor', language: 'Chinese' },
}
function translated(source: string, locale: ProgramTranslationLocale = 'zh', overrides: Partial<ProgramTranslationRecord> = {}): ProgramTranslationRecord {
  return { schemaVersion: 1, version: 'v1', key: translationKey(source, locale), sourceHash: createHash('sha256').update(source).digest('hex'),
    targetLocale: locale, text: translatedText.get(source) || source, method: 'minimax', model: 'MiniMax-M3',
    translatedAt: '2026-11-17T06:00:00.000Z', validation: 'passed', ...overrides }
}
function validFetch() {
  const records = new Map([requirement, materials, description].map(source => [base + translationPath(source, 'zh'), translated(source)]))
  return vi.fn(async (input: RequestInfo | URL) => {
    const record = records.get(String(input))
    return record ? Response.json(record) : new Response(null, { status: 404 })
  })
}
const item = (): CollectedProgramItem => ({ collected: structuredClone(profile), languages: ['Chinese'], degree: 'bachelor', sources: [structuredClone(profile)] })

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime('2026-11-17T06:00:00Z')
  vi.stubEnv('PROGRAM_FEED_ENABLED', 'true'); vi.stubEnv('VERCEL_ENV', '')
  mocked.resolve.mockResolvedValue({ item: item(), canonical: profile.id })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('source-bound programme translation reader', () => {
  it('loads validated fields from deterministic own-repository paths and caches them without altering source facts', async () => {
    const network = validFetch(); vi.stubGlobal('fetch', network)
    const { getProgramTranslations } = await import('@/lib/program-translations')
    const source = structuredClone(profile), originalFields = structuredClone(source.fields)
    const result = await getProgramTranslations(source, 'zh')
    expect(Object.keys(result).sort()).toEqual(['description', 'materials', 'requirements'])
    expect(result.requirements?.text).toBe(translatedRequirement)
    expect(network.mock.calls.map(([url]) => String(url)).sort()).toEqual([requirement, materials, description].map(source => base + translationPath(source, 'zh')).sort())
    expect(await getProgramTranslations(source, 'zh')).toEqual(result)
    expect(network).toHaveBeenCalledTimes(3)
    expect(source.fields).toEqual(originalFields)
  })

  it('rejects a stale source hash and retries a negative cache entry only after 60 seconds', async () => {
    const network = vi.fn(async () => Response.json(translated(requirement, 'zh', { sourceHash: '0'.repeat(64) })))
    vi.stubGlobal('fetch', network)
    const { getProgramTranslations } = await import('@/lib/program-translations')
    const source = { fields: { requirements: requirement } }
    expect(await getProgramTranslations(source, 'zh')).toEqual({})
    expect(await getProgramTranslations(source, 'zh')).toEqual({})
    expect(network).toHaveBeenCalledTimes(1)
    vi.setSystemTime(Date.now() + 60_001)
    network.mockImplementation(async () => Response.json(translated(requirement)))
    expect((await getProgramTranslations(source, 'zh')).requirements?.text).toBe(translatedRequirement)
    expect(network).toHaveBeenCalledTimes(2)
  })

  it.each([
    { targetLocale: 'ru' as const },
    { text: translatedRequirement.replace('HSK 4', 'HSK 3') },
    { key: 'f'.repeat(64) },
  ])('falls back when locale, key or a critical source clause changes: %j', async override => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(translated(requirement, 'zh', override))))
    const { getProgramTranslations } = await import('@/lib/program-translations')
    expect(await getProgramTranslations({ fields: { requirements: requirement } }, 'zh')).toEqual({})
  })

  it.each(['missing', 'network', 'large-header', 'large-body'] as const)('falls back safely for %s responses', async kind => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      if (kind === 'network') throw new Error('private provider credentials must not escape')
      if (kind === 'missing') return new Response(null, { status: 404 })
      if (kind === 'large-header') return new Response('{}', { headers: { 'content-length': '1000001' } })
      return new Response('x'.repeat(1_000_001))
    }))
    const { getProgramTranslations } = await import('@/lib/program-translations')
    expect(await getProgramTranslations({ fields: { requirements: requirement } }, 'zh')).toEqual({})
  })

  it('does not fetch locally, for unsupported locales, empty fields or unsupported source text', async () => {
    const network = vi.fn(); vi.stubGlobal('fetch', network)
    const { getProgramTranslations } = await import('@/lib/program-translations')
    vi.stubEnv('PROGRAM_FEED_ENABLED', '')
    expect(await getProgramTranslations(profile, 'zh')).toEqual({})
    vi.stubEnv('PROGRAM_FEED_ENABLED', 'true')
    expect(await getProgramTranslations(profile, 'xx' as ProgramTranslationLocale)).toEqual({})
    expect(await getProgramTranslations({ fields: {} }, 'zh')).toEqual({})
    expect(await getProgramTranslations({ fields: { requirements: '__SC_invalid_source' } }, 'zh')).toEqual({})
    expect(network).not.toHaveBeenCalled()
  })

  it('deduplicates pending keys and keeps concurrent requests across details at three', async () => {
    const other = [requirement, materials, description].map(source => source + ' Additional background for this section.')
    const sources = [requirement, materials, description, ...other]
    const urls = new Map(sources.map(source => [base + translationPath(source, 'en'), source]))
    let active = 0, maximum = 0
    const network = vi.fn(async (url: RequestInfo | URL) => {
      active++; maximum = Math.max(maximum, active)
      await new Promise(resolve => setTimeout(resolve, 10)); active--
      const source = urls.get(String(url))!
      return Response.json(translated(source, 'en', { text: source, method: 'source', model: null }))
    })
    vi.stubGlobal('fetch', network)
    const { getProgramTranslations } = await import('@/lib/program-translations')
    await Promise.all([getProgramTranslations(profile, 'en'), getProgramTranslations(profile, 'en'),
      getProgramTranslations({ fields: { requirements: other[0], materials: other[1], description: other[2] } }, 'en')])
    expect(maximum).toBe(3)
    expect(network).toHaveBeenCalledTimes(6)
  })
})

describe('translated detail presentation and locale API overlay', () => {
  it('shows translated sections with native expandable originals while all critical overview fields remain raw', async () => {
    vi.stubGlobal('fetch', validFetch())
    const { CollectedProgramDetail } = await import('@/components/features/CollectedProgram')
    const container = document.createElement('div')
    container.innerHTML = renderToStaticMarkup(await CollectedProgramDetail({ item: item(), locale: 'zh' }))
    const section = container.querySelector('[data-program-section="requirements"]')!
    expect(section.querySelector('p[lang="zh"]')?.textContent).toBe(translatedRequirement)
    expect(section.querySelector('details p')?.textContent).toBe(requirement)
    expect(section.querySelector('summary')?.textContent).toBe('查看来源原文')
    expect(section.querySelector('details')?.hasAttribute('open')).toBe(false)
    expect(section.textContent).toContain('自动翻译')
    expect(section.textContent).toContain('数字、日期及关键条件保留来源原文。')
    const overview = [...container.querySelectorAll('dd')].map(node => node.textContent)
    for (const field of ['tuition', 'duration', 'startDate', 'deadline'] as const) expect(overview).toContain(profile.fields[field])
    expect(container.querySelector('[data-program-section="fees"]')?.textContent).toContain(profile.fields.fees)
  })

  it('keeps pending sections in their original wording and provides all six label languages', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))
    const { CollectedProgramDetail, programSourceText } = await import('@/components/features/CollectedProgram')
    const container = document.createElement('div')
    container.innerHTML = renderToStaticMarkup(await CollectedProgramDetail({ item: item(), locale: 'fr' }))
    const section = container.querySelector('[data-program-section="requirements"]')!
    expect(section.textContent).toContain(requirement)
    expect(section.textContent).toContain('La traduction n’est pas encore disponible.')
    expect(section.getAttribute('data-translation-status')).toBe('pending')
    expect(section.querySelector('details')).toBeNull()
    expect(new Set(['zh', 'en', 'ru', 'de', 'fr', 'es'].map(locale => programSourceText(locale as ProgramTranslationLocale).requirements)).size).toBe(6)
  })

  it('labels source-language records accurately and renders source markup as text rather than HTML', async () => {
    const sourceItem = item()
    sourceItem.collected.fields.description = '<em>Explore creative practice</em>'
    const sources = [sourceItem.collected.fields.requirements!, sourceItem.collected.fields.materials!, sourceItem.collected.fields.description]
    const records = new Map(sources.map(source => [base + translationPath(source, 'en'), translated(source, 'en', { text: source, method: 'source', model: null })]))
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => Response.json(records.get(String(url)))))
    const { CollectedProgramDetail } = await import('@/components/features/CollectedProgram')
    const container = document.createElement('div')
    container.innerHTML = renderToStaticMarkup(await CollectedProgramDetail({ item: sourceItem, locale: 'en' }))
    const section = container.querySelector('[data-program-section="description"]')!
    expect(section.getAttribute('data-translation-status')).toBe('source')
    expect(section.textContent).toContain('Source text')
    expect(section.textContent).not.toContain('Machine translation')
    expect(section.textContent).toContain('<em>Explore creative practice</em>')
    expect(section.querySelector('em')).toBeNull()
  })

  it('adds validated locale metadata while preserving every original API field and omitting model internals', async () => {
    vi.stubGlobal('fetch', validFetch())
    const { GET } = await import('@/app/api/v1/programs/[slug]/route')
    const response = await GET(new Request(`https://example.test/api/v1/programs/${profile.id}?view=all&locale=zh`), { params: Promise.resolve({ slug: profile.id }) })
    const payload = await response.json()
    expect(payload.data.fields).toEqual(profile.fields)
    expect(payload.data.admissionYear).toBeNull(); expect(payload.data.official).toBe(false)
    expect(payload.translations).toEqual({ locale: 'zh', fields: Object.fromEntries([requirement, materials, description].map((source, index) =>
      [['requirements', 'materials', 'description'][index], { text: translatedText.get(source), method: 'minimax', translatedAt: '2026-11-17T06:00:00.000Z' }])) })
    expect(JSON.stringify(payload.translations)).not.toContain('MiniMax-M3')
    expect(payload.meta.canonicalSlug).toBe(profile.id)
  })

  it('keeps requests without a supported locale compatible and makes no translation requests', async () => {
    const network = vi.fn(); vi.stubGlobal('fetch', network)
    const { GET } = await import('@/app/api/v1/programs/[slug]/route')
    for (const suffix of ['', '&locale=xx']) {
      const payload = await (await GET(new Request(`https://example.test/api/v1/programs/${profile.id}?view=all${suffix}`), { params: Promise.resolve({ slug: profile.id }) })).json()
      expect(payload.data.fields).toEqual(profile.fields)
      expect(payload).not.toHaveProperty('translations')
    }
    expect(network).not.toHaveBeenCalled()
  })
})
