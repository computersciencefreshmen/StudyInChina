import { selectPublishedData } from '@/lib/data/publication'
import type { DataBundle } from '@/lib/data/types'
import type { IdentityAcceptance } from '@/lib/data/identity-acceptance'

/** Public APIs apply the same evidence, freshness and relationship gates as pages. */
export function selectCatalogApiData(data: DataBundle, today: string, identities: IdentityAcceptance[] = []): DataBundle {
  return selectPublishedData(data, today, identities)
}
