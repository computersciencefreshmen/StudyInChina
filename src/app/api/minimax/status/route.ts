import { readPublicMiniMax } from '@/lib/minimax/public-monitor-server'
import { publicMonitorCacheSeconds } from '@/lib/minimax/public-monitor'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function GET() {
  const value = await readPublicMiniMax()
  return Response.json(value, { headers: {
    'Cache-Control': `public, max-age=0, s-maxage=${publicMonitorCacheSeconds(value)}`,
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  } })
}
