import { describe, expect, it } from 'vitest'
import { generateMetadata as citiesMetadata } from '@/app/[locale]/cities/page'
import { generateMetadata as programsMetadata } from '@/app/[locale]/programs/page'
import { generateMetadata as scholarshipsMetadata } from '@/app/[locale]/scholarships/page'
import { generateMetadata as universitiesMetadata } from '@/app/[locale]/universities/page'
import { hasSearchParameters } from '@/lib/site'

const catalogues = [
  ['cities', citiesMetadata],
  ['programs', programsMetadata],
  ['scholarships', scholarshipsMetadata],
  ['universities', universitiesMetadata],
] as const

const campaign = {
  utm_source: 'linkedin',
  utm_medium: 'organic_social',
  utm_campaign: 'first_cohort',
  utm_content: 'shortlist_demo',
  utm_term: 'graduate_programs',
  utm_id: 'pilot_01',
  utm_source_platform: 'linkedin',
}

describe('promotion-link catalogue metadata', () => {
  it.each(catalogues)('keeps campaign-only %s URLs indexable with a clean canonical', async (path, metadataFor) => {
    const metadata = await metadataFor({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve(campaign),
    })

    expect(metadata.robots).toBeUndefined()
    expect(metadata.alternates?.canonical).toBe(`/en/${path}`)
    expect(metadata.openGraph?.url).toBe(`/en/${path}`)
  })

  it.each(catalogues)('keeps filtered %s URLs noindex even with campaign labels', async (path, metadataFor) => {
    const metadata = await metadataFor({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({ ...campaign, q: 'engineering' }),
    })

    expect(metadata.robots).toEqual({ index: false, follow: true })
    expect(metadata.alternates?.canonical).toBe(`/en/${path}`)
  })

  it.each(catalogues)('keeps beta %s pages noindex with campaign-only URLs', async (path, metadataFor) => {
    const metadata = await metadataFor({
      params: Promise.resolve({ locale: 'de' }),
      searchParams: Promise.resolve(campaign),
    })

    expect(metadata.robots).toEqual({ index: false, follow: true })
    expect(metadata.alternates?.canonical).toBe(`/de/${path}`)
  })

  it.each(['utm_custom_filter', 'page', 'sort', 'cursor', 'unknown', 'UTM_SOURCE'])(
    'does not exempt the unrecognized or content-changing parameter %s',
    key => expect(hasSearchParameters({ ...campaign, [key]: 'value' })).toBe(true),
  )

  it('accepts empty, repeated and absent campaign values without broadening the allowlist', () => {
    expect(hasSearchParameters({})).toBe(false)
    expect(hasSearchParameters({ utm_source: ['linkedin', 'student_community'], utm_medium: '', utm_content: undefined })).toBe(false)
  })
})
