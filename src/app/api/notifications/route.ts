import { getCatalogRepository } from '@/lib/catalog/runtime'
import { observePublishedCatalog } from '@/lib/notifications/catalog'
import { meaningfulFingerprint } from '@/lib/notifications/changes'
import { readIdentityAcceptances } from '@/lib/data/identity-acceptance-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const headers = { 'Cache-Control': 'no-store' }
  try {
    const observedAt = Date.now()
    const repository = getCatalogRepository()
    const current = observePublishedCatalog(await repository.getBundle(), observedAt,
      repository.mode === 'json' ? readIdentityAcceptances(undefined, { strictProjection: true }) : [])
    // Already-public stale identities establish a baseline without creating an
    // alert. An unchanged re-verification must not look like a new listing.
    const observations = Object.entries(current).map(([observationKey, item]) => ({ observationKey, ...item }))
    return Response.json({ available: true, observations, observedAt, revision: meaningfulFingerprint(observations) }, { headers })
  } catch { return Response.json({ available: false, observations: [] }, { status: 503, headers }) }
}
