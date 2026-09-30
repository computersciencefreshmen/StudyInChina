import { ADMIN_RESPONSE_HEADERS, requestAdminSession } from '@/lib/admin/auth'
import { getAdminSnapshot } from '@/lib/admin/snapshot'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export function GET(request: Request) {
  const session = requestAdminSession(request)
  if (!session.authenticated) return Response.json({ error: 'unauthorized' }, { status: 401, headers: ADMIN_RESPONSE_HEADERS })
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  let detachAbort: (() => void) | undefined
  const encoder = new TextEncoder()
  const openedAt = Date.now()
  const stream = new ReadableStream({
    start(controller) {
      const stop = () => {
        if (stopped) return
        stopped = true
        clearTimeout(timer)
        request.signal.removeEventListener('abort', stop)
        controller.close()
      }
      request.signal.addEventListener('abort', stop, { once: true })
      detachAbort = () => request.signal.removeEventListener('abort', stop)
      if (request.signal.aborted) { stop(); return }
      const send = async () => {
        if (stopped) return
        if (Date.now() - openedAt > 50_000 || Date.parse(session.expiresAt!) <= Date.now()) { stop(); return }
        try {
          const snapshot = await getAdminSnapshot()
          if (!stopped) controller.enqueue(encoder.encode(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`))
        } catch {
          if (!stopped) controller.enqueue(encoder.encode('event: status-error\ndata: {"error":"status_unavailable"}\n\n'))
        }
        if (!stopped) {
          controller.enqueue(encoder.encode(': heartbeat\n\n'))
          timer = setTimeout(send, 3_000)
        }
      }
      void send()
    },
    cancel() { stopped = true; clearTimeout(timer); detachAbort?.() },
  })
  return new Response(stream, { headers: { ...ADMIN_RESPONSE_HEADERS, 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' } })
}
