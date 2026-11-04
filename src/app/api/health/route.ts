import { JsonCatalogRepository } from '@/lib/catalog/json'
import { getPublicCatalogSnapshot } from '@/lib/catalog/public-snapshot'
import { getTodayDate } from '@/lib/data/freshness'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const repository = new JsonCatalogRepository()
const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' }

/** Probes verify this process can serve the strict public catalogue. Warm
 * requests reuse snapshots; a new data/evidence generation or China date still
 * triggers the same validation and expiry decisions as ordinary public reads. */
export async function GET() {
  try {
    getPublicCatalogSnapshot(await repository.getBundle(), getTodayDate())
    return Response.json({ status: 'ok' }, { headers })
  } catch {
    return Response.json({ status: 'unavailable' }, { status: 503, headers })
  }
}
