import { describe, expect, it } from 'vitest'
import sources from '../../content/data/sources.json'
import cities from '../../content/data/cities.json'
import universities from '../../content/data/universities.json'
import programs from '../../content/data/programs.json'
import admissionCycles from '../../content/data/admission-cycles.json'
import scholarships from '../../content/data/scholarships.json'
import { selectCatalogApiData } from '@/lib/catalog-api/projection'
import { isUnexpiredApplicationDeadline } from '@/lib/data/publication'
import { bundleSchema } from '@/lib/data/schema'

const TODAY = '2026-07-28'
const data = bundleSchema.parse({
  sources,
  cities,
  universities,
  programs,
  admissionCycles,
  scholarships,
})

describe('Catalog API scholarship deadline gate', () => {
  it('includes the confirmed deadline day and withholds the following day', () => {
    const fixture = structuredClone(data)
    fixture.sources.push({ id: 'scholarship-deadline-source', url: 'https://example.edu/scholarships', title: 'Official scholarship fixture', publisher: 'Test university', kind: 'admissions', language: 'en', official: true, accessedAt: TODAY })
    const scholarship = {
      ...fixture.scholarships[0]!, universityIds: [], programIds: [],
      sourceIds: ['scholarship-deadline-source'], status: 'verified' as const,
      verifiedAt: TODAY, reviewAfter: '2026-08-28',
    }
    fixture.scholarships = [
      { ...scholarship, id: 'scholarship-deadline-today', slug: 'deadline-today', deadline: TODAY },
      { ...scholarship, id: 'scholarship-deadline-yesterday', slug: 'deadline-yesterday', deadline: '2026-07-27' },
    ]
    const projected = selectCatalogApiData(bundleSchema.parse(fixture), TODAY)

    expect(
      projected.scholarships.every((item) =>
        isUnexpiredApplicationDeadline(item.deadline, TODAY),
      ),
    ).toBe(true)
    expect(
      projected.scholarships.some((item) => item.id === 'scholarship-deadline-today'),
    ).toBe(true)
    expect(
      projected.scholarships.some(
        (item) => item.id === 'scholarship-deadline-yesterday',
      ),
    ).toBe(false)
  })
})
