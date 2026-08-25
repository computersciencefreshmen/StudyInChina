import { describe, expect, it } from 'vitest'
import admissionCycles from '../../content/data/admission-cycles.json'
import cities from '../../content/data/cities.json'
import programs from '../../content/data/programs.json'
import scholarships from '../../content/data/scholarships.json'
import sources from '../../content/data/sources.json'
import universities from '../../content/data/universities.json'
import { selectCatalogApiData } from '@/lib/catalog-api/projection'
import { selectPublishedData } from '@/lib/data/publication'
import { bundleSchema } from '@/lib/data/schema'

const data = bundleSchema.parse({
  admissionCycles,
  cities,
  programs,
  scholarships,
  sources,
  universities,
})

describe('web and Catalog API identity projections', () => {
  it('keep program and scholarship identity counts aligned for the same date', () => {
    const today = '2026-08-25'
    const web = selectPublishedData(data, today)
    const api = selectCatalogApiData(data, today)

    expect(web.programs).toHaveLength(api.programs.length)
    expect(web.scholarships).toHaveLength(api.scholarships.length)
  })
})
