import coverage from '@/data/generated/double-first-class-coverage.json'

export const revalidate = 86_400

export function GET() {
  return Response.json(coverage, {
    headers: {
      'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
