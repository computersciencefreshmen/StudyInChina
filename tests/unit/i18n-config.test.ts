import { describe, expect, it } from 'vitest'

import {
  allLocales,
  betaLocales,
  getLocaleConfig,
  indexedLocales,
  isLocale,
  isPreviewLocale,
  isPublicLocale,
  launchLocales,
  localeDirection,
  localizePathname,
  pathnameLocale,
  previewLocales,
  publicLocales,
} from '@/i18n/config'
import { pageMetadata, requireLocale } from '@/lib/site'

describe('locale registry', () => {
  it('derives public and preview locale sets from one registry', () => {
    expect(allLocales).toEqual(['en', 'zh', 'ru', 'de', 'fr', 'es', 'pt', 'ar'])
    expect(indexedLocales).toEqual(['en', 'zh', 'ru'])
    expect(betaLocales).toEqual(['de', 'fr', 'es'])
    expect(publicLocales).toEqual(['en', 'zh', 'ru', 'de', 'fr', 'es'])
    expect(previewLocales).toEqual(['pt', 'ar'])
    expect(launchLocales).toBe(publicLocales)
  })

  it('publishes German, French and Spanish while keeping later locales in preview', () => {
    expect(isLocale('de')).toBe(true)
    expect(isPreviewLocale('de')).toBe(false)
    expect(isPublicLocale('de')).toBe(true)
    expect(requireLocale('de')).toBe('de')
    expect(requireLocale('fr')).toBe('fr')
    expect(requireLocale('es')).toBe('es')
    expect(isPreviewLocale('pt')).toBe(true)
    expect(requireLocale('pt')).toBeNull()
    expect(getLocaleConfig('de')).toMatchObject({ intlLocale: 'de-DE', releaseState: 'beta' })
  })

  it('keeps direction and path handling registry-driven', () => {
    expect(localeDirection('ar')).toBe('rtl')
    expect(pathnameLocale('/es/programs/software-engineering')).toBe('es')
    expect(localizePathname('/es/programs/software-engineering', 'zh')).toBe('/zh/programs/software-engineering')
    expect(localizePathname('/programs', 'ru')).toBe('/ru/programs')
    expect(localizePathname('/', 'en')).toBe('/en')
  })

  it('publishes alternates and Open Graph metadata for public locales only', () => {
    const metadata = pageMetadata('zh', '项目', '项目介绍', 'programs')

    expect(metadata.alternates?.languages).toEqual({
      en: '/en/programs',
      zh: '/zh/programs',
      ru: '/ru/programs',
      'x-default': '/en/programs',
    })
    expect(metadata.openGraph).toMatchObject({ locale: 'zh_CN' })
  })

  it('keeps beta routes accessible but out of search indexing until content coverage is ready', () => {
    const metadata = pageMetadata('de', 'Programme', 'Programmbeschreibung', 'programs')

    expect(requireLocale('de')).toBe('de')
    expect(metadata.robots).toEqual({ index: false, follow: true })
    expect(metadata.alternates?.languages).not.toHaveProperty('de')
  })
})
