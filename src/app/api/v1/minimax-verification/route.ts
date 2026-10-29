import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getAllData } from '@/lib/data/load'
import { createCatalogRepository } from '@/lib/catalog'
import { MINIMAX_PUBLIC_MAX_BYTES, minimaxPublicSnapshotSchema, type MiniMaxPublicSnapshot } from '@/lib/verification/minimax-contract'
import { selectPublicMiniMaxLabels } from '@/lib/verification/publication'
import { readIdentityAcceptances } from '@/lib/data/identity-acceptance-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const target = 'https://studyinchina-catalog-api.13022037121.workers.dev/api/v1/minimax-verification'
let cached: { until: number; pending: Promise<MiniMaxPublicSnapshot | null> } | null = null
async function publication(): Promise<MiniMaxPublicSnapshot | null> {
  if (cached && cached.until > Date.now()) return cached.pending
  const pending = (async () => {
    try {
      const response = await fetch(target, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(5_000) })
      if (!response.ok || !response.body || Number(response.headers.get('content-length')) > MINIMAX_PUBLIC_MAX_BYTES) throw Error('unavailable')
      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let length = 0
      try {
        for (;;) {
          const part = await reader.read()
          if (part.done) break
          length += part.value.byteLength
          if (length > MINIMAX_PUBLIC_MAX_BYTES) { await reader.cancel(); throw Error('oversize') }
          chunks.push(part.value)
        }
      } finally { reader.releaseLock() }
      return minimaxPublicSnapshotSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
    } catch {
      try {
        const raw = await readFile(join(process.cwd(), 'content', 'verification', 'minimax.json'), 'utf8')
        if (Buffer.byteLength(raw) > MINIMAX_PUBLIC_MAX_BYTES) return null
        return minimaxPublicSnapshotSchema.parse(JSON.parse(raw))
      } catch { return null }
    }
  })()
  cached = { until: Date.now() + 30_000, pending }
  return pending
}

/** A comparison badge is valid only for the exact facts and official sources currently shown. */
export async function GET() {
  const [snapshot, bundle] = await Promise.all([publication(), process.env.CATALOG_BACKEND === 'd1' ? createCatalogRepository().getBundle() : Promise.resolve(getAllData())])
  if (!snapshot) return Response.json({ error: 'verification_unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  return Response.json(selectPublicMiniMaxLabels(snapshot, bundle, undefined,
    process.env.CATALOG_BACKEND === 'd1' ? [] : readIdentityAcceptances(undefined, { strictProjection: true })),
  { headers: { 'Cache-Control': 'public, max-age=30, s-maxage=30', 'X-Content-Type-Options': 'nosniff' } })
}
