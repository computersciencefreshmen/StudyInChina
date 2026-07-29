import { describe, expect, it } from 'vitest'
import sources from '../../content/data/sources.json'
import cities from '../../content/data/cities.json'
import universities from '../../content/data/universities.json'
import programs from '../../content/data/programs.json'
import admissionCycles from '../../content/data/admission-cycles.json'
import scholarships from '../../content/data/scholarships.json'
import { CatalogApiService, releaseFromBundle } from '@/lib/catalog-api/service'
import { bundleSchema } from '@/lib/data/schema'
import { selectPublishedData } from '@/lib/data/publication'

describe('institution slug compatibility', () => {
  it('resolves the retired BLCU slug through the public Catalog API service', () => {
    const data = selectPublishedData(bundleSchema.parse({
      sources,
      cities,
      universities,
      programs,
      admissionCycles,
      scholarships,
    }), '2026-07-29')
    const service = new CatalogApiService(
      data,
      releaseFromBundle(data, '2026-07-29'),
      '2026-07-29',
    )

    expect(service.getInstitution('beijing-language-university')?.data.slug)
      .toBe('beijing-language-and-culture-university')
  })
})
