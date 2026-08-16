import { describe, expect, it } from 'vitest'

import { publicLocales } from '@/i18n/config'
import { formatStudentCityTitle, getHomeExperienceCopy } from '@/i18n/home-experience'

describe('homepage experience copy', () => {
  it('keeps the four-step decision path complete in every public locale', () => {
    for (const locale of publicLocales) {
      const copy = getHomeExperienceCopy(locale)

      expect(copy.catalogTitle.trim()).not.toBe('')
      expect(copy.latestSourceCheck.trim()).not.toBe('')
      expect(copy.steps).toHaveLength(4)
      for (const step of copy.steps) {
        expect(step.title.trim()).not.toBe('')
        expect(step.description.trim()).not.toBe('')
      }
    }
  })

  it('derives the student-city heading from the current catalogue count in every locale', () => {
    for (const locale of publicLocales) {
      expect(formatStudentCityTitle(62, locale)).toContain('62')
    }
  })
})
