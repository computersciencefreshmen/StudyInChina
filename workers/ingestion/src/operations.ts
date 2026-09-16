import { OPERATIONS_QUERIES, operationsParameters } from '../../shared/operations-queries'
import { constantTimeEqual } from './security'
import type { IngestionEnv } from './types'

/** Credential-protected, fixed aggregate observations. No source body, SQL, or arbitrary queries are exposed. */
export async function handleOperations(request: Request, environment: IngestionEnv, now = new Date()): Promise<Response> {
  const header = request.headers.get('authorization') ?? ''
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : ''
  const configured = environment.INGESTION_ADMIN_TOKEN
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
  if (!configured || !constantTimeEqual(supplied, configured)) return Response.json({ error: 'forbidden' }, { status: 403, headers })
  const parameters = operationsParameters(now)
  const observations = Object.fromEntries(await Promise.all(Object.entries(OPERATIONS_QUERIES).map(async ([key, sql]) => {
    try {
      const result = await environment.INGESTION_DB.prepare(sql).bind(...parameters[key as keyof typeof parameters]).all()
      return [key, result.success ? { state: 'observed', rows: result.results ?? [] } : { state: 'unavailable' }]
    } catch { return [key, { state: 'unavailable' }] }
  })))
  return Response.json({ format: 'studyinchina.operations-observations', observedAt: now.toISOString(), observations }, { headers })
}
