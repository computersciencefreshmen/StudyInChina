import { describe, expect, it } from 'vitest'
import { checkPublishingAuthentication } from '../../scripts/operations/check-publishing-auth.mjs'

const project = 'prj_AgYJcsuat4kmLiinlvcBbZsYY3cg', team = 'team_o5qghzfTOk24QwoYANzJ8hNH'
const environment = { ADMIN_TELEMETRY_URL: 'https://studyinchina-catalog-api.13022037121.workers.dev/internal/v1/admin-telemetry', ADMIN_TELEMETRY_TOKEN: 'test-only-admin-credential-xxxxxxxxxxxxxxxx', VERCEL_TOKEN: 'test-only-vercel-credential-xxxxxxxx' }
const writer = { controlEnabled: true, state: { registry: { projectId: project, alias: 'studyinchina.vercel.app', currentId: 'dpl_testDeployment', revision: 1 }, command: null } }

describe('read-only publishing authentication', () => {
  it('checks fixed origins using GET with redirects rejected and emits only safe metadata', async () => {
    const calls: { url: string; options: RequestInit }[] = []
    const values = [{ id: project, accountId: team, protectionBypass: { privateCredential: {} } }, { projectId: project, deploymentId: 'dpl_testDeployment' }, writer]
    const result = await checkPublishingAuthentication(environment, async (url, options) => {
      calls.push({ url: String(url), options: options ?? {} }); return Response.json(values.shift())
    })
    expect(calls).toHaveLength(3)
    expect(calls.every(c => c.options.method === 'GET' && c.options.redirect === 'error')).toBe(true)
    expect(calls.map(c => new URL(c.url).origin)).toEqual(['https://api.vercel.com', 'https://api.vercel.com', 'https://studyinchina-catalog-api.13022037121.workers.dev'])
    expect(result.cloudMutations).toBe(0)
    expect(JSON.stringify(result)).not.toMatch(/test-only|privateCredential|protectionBypass/u)
  })
  it('rejects a different telemetry destination before any network request', async () => {
    let calls = 0
    await expect(checkPublishingAuthentication({ ...environment, ADMIN_TELEMETRY_URL: 'https://external.invalid' }, async () => { calls++; return Response.json({}) })).rejects.toThrow('target_invalid')
    expect(calls).toBe(0)
  })
  it('accepts an explicitly pinned migrated Worker without changing the Vercel project', async () => {
    const host = 'studyinchina-catalog-api.yanghanyu2023.workers.dev'
    const calls: { url: string; options?: RequestInit }[] = []
    const values = [{ id: project, accountId: team }, { projectId: project, deploymentId: 'dpl_testDeployment' }, writer]
    const result = await checkPublishingAuthentication({ ...environment, ADMIN_TELEMETRY_TOKEN_HOST: host,
      ADMIN_TELEMETRY_URL: `https://${host}/internal/v1/admin-telemetry` }, async (url, options) => {
      calls.push({ url: String(url), options }); return Response.json(values.shift())
    })
    expect(calls.map(call => call.url)).toEqual([
      `https://api.vercel.com/v9/projects/${project}?teamId=${team}`,
      `https://api.vercel.com/v4/aliases/studyinchina.vercel.app?teamId=${team}`,
      `https://${host}/internal/v1/admin-releases?writer=1`,
    ])
    expect(calls.every(call => call.options?.method === 'GET' && call.options.redirect === 'error')).toBe(true)
    expect(result.cloudMutations).toBe(0)
  })
  it.each([
    { ADMIN_TELEMETRY_URL: 'https://studyinchina-catalog-api.yanghanyu2023.workers.dev/internal/v1/admin-telemetry' },
    { ADMIN_TELEMETRY_TOKEN_HOST: 'studyinchina-catalog-api.yanghanyu2023.workers.dev' },
    { ADMIN_TELEMETRY_TOKEN_HOST: 'studyinchina-catalog-api.yanghanyu2023.workers.dev.evil.invalid' },
    { ADMIN_TELEMETRY_TOKEN_HOST: 'external.invalid' },
    { ADMIN_TELEMETRY_URL: environment.ADMIN_TELEMETRY_URL + '?other=1' },
    { ADMIN_TELEMETRY_URL: environment.ADMIN_TELEMETRY_URL + '#other' },
    { ADMIN_TELEMETRY_URL: environment.ADMIN_TELEMETRY_URL.replace('https://', 'https://user:password@') },
    { ADMIN_TELEMETRY_URL: environment.ADMIN_TELEMETRY_URL.replace('.dev/', '.dev:8443/') },
  ])('rejects an unpaired or unsafe host pin before sending either credential: %j', async overrides => {
    let calls = 0
    await expect(checkPublishingAuthentication({ ...environment, ...overrides }, async () => {
      calls++; return Response.json({})
    })).rejects.toThrow('target_invalid')
    expect(calls).toBe(0)
  })
  it('stops on ownership mismatch', async () => {
    await expect(checkPublishingAuthentication(environment, async () => Response.json({ id: project, accountId: 'other-team' }))).rejects.toThrow('ownership_mismatch')
  })
  it('does not propagate provider errors that contain credentials', async () => {
    await expect(checkPublishingAuthentication(environment, async () => { throw new Error(environment.VERCEL_TOKEN) })).rejects.toThrow(/^publishing_authenticated_read_failed$/u)
  })
  it('rejects a disabled or mismatched common writer', async () => {
    const values = [{ id: project, accountId: team }, { projectId: project, deploymentId: 'dpl_testDeployment' }, { ...writer, controlEnabled: false }]
    await expect(checkPublishingAuthentication(environment, async () => Response.json(values.shift()))).rejects.toThrow('registry_or_live_alias_mismatch')
  })
})
