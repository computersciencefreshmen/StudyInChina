import { getThirdPartyProgram } from '@/lib/third-party-programs'
import { publicThirdPartyProgram } from '@/lib/third-party-public'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const program = getThirdPartyProgram((await params).id)
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
  if (!program || program.status !== 'extracted') {
    return Response.json({ error: { code: 'not_found', message: 'Captured program details were not found.' } }, { status: 404, headers })
  }
  return Response.json({ program: publicThirdPartyProgram(program, true) }, { headers })
}
