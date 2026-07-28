import { describe, expect, it } from 'vitest'
import sources from '../../content/data/sources.json'
import cities from '../../content/data/cities.json'
import universities from '../../content/data/universities.json'
import programs from '../../content/data/programs.json'
import admissionCycles from '../../content/data/admission-cycles.json'
import scholarships from '../../content/data/scholarships.json'
import { selectCatalogApiData } from '@/lib/catalog-api/projection'
import { isWithinPostDeadlineGrace } from '@/lib/data/freshness'
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
  it('keeps day-30 opportunities and removes scholarships after the grace window', () => {
    const projected = selectCatalogApiData(data, TODAY)

    expect(
      projected.scholarships.every((item) =>
        isWithinPostDeadlineGrace(item.deadline, TODAY),
      ),
    ).toBe(true)
    expect(
      projected.scholarships.some((item) => item.id === 'scholarship-wku-freshman-2026'),
    ).toBe(true)
    expect(
      projected.scholarships.some(
        (item) => item.id === 'scholarship-xisu-new-sinology-translation-2026',
      ),
    ).toBe(false)
  })
})
