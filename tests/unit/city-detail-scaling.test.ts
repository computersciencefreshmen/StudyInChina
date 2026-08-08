import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync('src/app/[locale]/cities/[slug]/page.tsx', 'utf8')

describe('city detail scaling contract', () => {
  it('keeps runtime data on the catalog repository and indexes disciplines once', () => {
    expect(source).toContain('const data = await getCatalogData()')
    expect(source).toContain('const disciplinesByUniversityId = indexUniversityDisciplines(data.programs)')
    expect(source).toContain('new Map<string, Set<string>>()')
    expect(source).not.toContain('data.programs.filter((item) => item.universityId === id)')
  })

  it('bounds the first render to 36 stable university cards', () => {
    expect(source).toContain('export const CITY_DETAIL_UNIVERSITY_LIMIT = 36')
    expect(source).toContain('Number(right.featured) - Number(left.featured)')
    expect(source).toContain('localize(left.name, locale).localeCompare(')
    expect(source).toContain('universities.slice(0, CITY_DETAIL_UNIVERSITY_LIMIT)')
    expect(source).toContain('visibleUniversities.map((university)')
  })

  it('keeps overflow universities reachable through the localized filtered directory', () => {
    expect(source).toContain('universities.length > visibleUniversities.length')
    expect(source).toContain('`/${locale}/universities?city=${encodeURIComponent(city.slug)}`')
    expect(source).toContain('{messages.common.explore} {messages.nav.universities}')
  })
})
