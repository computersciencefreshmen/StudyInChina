import { describe, expect, it } from 'vitest'

import { generateMetadata as generateCitiesMetadata } from '@/app/[locale]/cities/page'
import { generateMetadata as generateProgramDetailMetadata } from '@/app/[locale]/programs/[slug]/page'
import { generateMetadata as generateProgramsMetadata } from '@/app/[locale]/programs/page'
import { generateMetadata as generateScholarshipsMetadata } from '@/app/[locale]/scholarships/page'
import { generateMetadata as generateUniversitiesMetadata } from '@/app/[locale]/universities/page'

const localeParams = Promise.resolve({ locale: 'en' })

describe('catalogue metadata indexability', () => {
  it('indexes base catalogues and marks every parameterized catalogue noindex,follow', async () => {
    const pages = [
      generateProgramsMetadata,
      generateUniversitiesMetadata,
      generateScholarshipsMetadata,
      generateCitiesMetadata,
    ]

    for (const generateMetadata of pages) {
      const base = await generateMetadata({ params: localeParams })
      const parameterized = await generateMetadata({
        params: localeParams,
        searchParams: Promise.resolve({ q: 'engineering' }),
      })

      expect(base.robots).toBeUndefined()
      expect(parameterized.robots).toEqual({ index: false, follow: true })
    }
  })

  it('adds the university name to a program title to disambiguate repeated names', async () => {
    const metadata = await generateProgramDetailMetadata({
      params: Promise.resolve({
        locale: 'en',
        slug: 'tsinghua-university-computer-science-bachelor',
      }),
    })

    expect(metadata.title).toContain('Computer Science and Technology')
    expect(metadata.title).toContain('Tsinghua University')
  })
})
