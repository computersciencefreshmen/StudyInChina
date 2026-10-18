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
