import { describe, expect, it } from 'vitest'

import {
  allLocales,
  getLocaleConfig,
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
    expect(publicLocales).toEqual(['en', 'zh', 'ru'])
    expect(previewLocales).toEqual(['de', 'fr', 'es', 'pt', 'ar'])
    expect(launchLocales).toBe(publicLocales)
  })

  it('recognizes German as preview data without publishing its route', () => {
    expect(isLocale('de')).toBe(true)
    expect(isPreviewLocale('de')).toBe(true)
    expect(isPublicLocale('de')).toBe(false)
    expect(requireLocale('de')).toBeNull()
    expect(getLocaleConfig('de').intlLocale).toBe('de-DE')
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
})
