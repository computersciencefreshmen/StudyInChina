import { getPublicCatalogSnapshot } from '../../src/lib/catalog/public-snapshot'
import { getTodayDate } from '../../src/lib/data/freshness'
import { findReviewedProgramTranslation } from '../../src/lib/data/format'
import { readValidatedCatalogBundle } from '../../src/lib/data/raw-snapshot'
import { officialTitleSource } from '../../src/lib/program-translation-review'

/** Reuse the exact official discovery projection used by Programs. */
export function publicOfficialTitles() {
  const directory = getPublicCatalogSnapshot(readValidatedCatalogBundle(), getTodayDate()).directory
  const schools = new Map(directory.universities.map(school => [school.id, school]))
  return directory.programs.flatMap(program => {
    const school = schools.get(program.universityId)
    if (!school) return []
    const row = officialTitleSource(program, school)
    const hasEnglishTitle = Boolean(program.name.en && !/\p{Script=Han}/u.test(program.name.en) ||
      row && findReviewedProgramTranslation(row.name, 'en'))
    return row ? [{ ...row, hasEnglishTitle }] : []
  })
}

export function needsEnglishTitle(name: string) {
  return /\p{Script=Han}/u.test(name) && !findReviewedProgramTranslation(name, 'en')
}
