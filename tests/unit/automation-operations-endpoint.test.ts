import { describe, expect, it } from 'vitest'
import { handleOperations } from '../../workers/ingestion/src/operations'
import type { IngestionEnv } from '../../workers/ingestion/src/types'
import { collectOperationsHealth, parseOperationsArguments, OPERATIONS_QUERIES } from '../../scripts/automation/operations-health'

const now = new Date('2026-09-16T10:00:00Z')
const data = { sources: [], cities: [], universities: [], programs: [], admissionCycles: [], scholarships: [] }
const options = { root: process.cwd(), remote: true, operationsUrl: 'https://studyinchina-ingestion.13022037121.workers.dev', expectedBackend: 'd1' as const, reportOnly: true, workflows: [] }

describe('authenticated automation observations', () => {
  it('rejects unauthenticated calls before querying D1', async () => {
    let queried = false
    const env = { INGESTION_ADMIN_TOKEN: 'secret', INGESTION_DB: { prepare: () => { queried = true; throw new Error('unexpected query') } } } as unknown as IngestionEnv
    const response = await handleOperations(new Request('https://example.test/operations'), env, now)
    expect(response.status).toBe(403)
    expect(queried).toBe(false)
  })
  it('exposes only fixed aggregates and hides storage failure text', async () => {
    const env = { INGESTION_ADMIN_TOKEN: 'secret', INGESTION_DB: { prepare: () => ({ bind: () => ({ all: async () => { throw new Error('private details') } }) }) } } as unknown as IngestionEnv
    const response = await handleOperations(new Request('https://example.test/operations?sql=DROP', { headers: { Authorization: 'Bearer secret' } }), env, now)
    const body = await response.text()
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(body).not.toMatch(/secret|private details|DROP/)
    expect(JSON.parse(body).observations.jobs.state).toBe('unavailable')
  })
  it('uses existing Worker credentials without a Cloudflare account token', async () => {
    const observations = Object.fromEntries(Object.keys(OPERATIONS_QUERIES).map(key => [key, { state: 'observed', rows: [] }]))
    let calls = 0
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      calls++
      expect(String(url)).toBe(options.operationsUrl + '/operations')
      expect(init?.headers).toEqual({ Authorization: 'Bearer secret' })
      expect(init?.redirect).toBe('error')
      return Response.json({ format: 'studyinchina.operations-observations', observedAt: now.toISOString(), observations })
    }) as typeof fetch
    const report = await collectOperationsHealth(options, { now, data, env: { INGESTION_ADMIN_TOKEN: 'secret' }, fetch: fetcher })
    expect(calls).toBe(1)
    expect(report.scope.observationTransport).toBe('authenticated-worker')
    expect(report.checks.find(row => row.id === 'pipeline.heartbeats.observation')?.status).toBe('pass')
    expect(JSON.stringify(report)).not.toContain('secret')
  })
  it('never sends the secret to a different host and requires a CLI value', async () => {
    const fetcher = (async () => { throw new Error('must not fetch') }) as typeof fetch
    const report = await collectOperationsHealth({ ...options, operationsUrl: 'https://attacker.example/' }, { now, data, env: { INGESTION_ADMIN_TOKEN: 'secret' }, fetch: fetcher })
    expect(report.scope.pipelineObserved).toBe(false)
    expect(() => parseOperationsArguments(['--operations-url'])).toThrow()
  })
})
