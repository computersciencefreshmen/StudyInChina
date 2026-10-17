import { selectPublishedData } from '@/lib/data/publication'
import type { DataBundle } from '@/lib/data/types'

/** Public APIs apply the same evidence, freshness and relationship gates as pages. */
export function selectCatalogApiData(data: DataBundle, today: string): DataBundle {
  return selectPublishedData(data, today)
}
