import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ADMIN_COOKIE, createAdminSession } from '../../src/lib/admin/auth'
const mocked = vi.hoisted(() => ({ read: vi.fn(), snapshot: vi.fn(), local: false }))
vi.mock('../../src/lib/admin/remote-executor', () => ({ readRemoteExecutorCommand: mocked.read, submitRemoteExecutorCommand: vi.fn() }))
vi.mock('../../src/lib/admin/snapshot', () => ({ getAdminSnapshot: mocked.snapshot }))
vi.mock('../../src/lib/admin/verification', () => ({ getVerificationCapabilities: () => ({ localMonitoring: mocked.local }) }))
import { GET } from '../../src/app/api/admin/automation/route'
const commandId = 'bca14973-d37e-4b4d-8742-4ad95a64a90c'
const receipt = { commandId, action: 'pause', status: 'expired', updatedAt: '2026-10-02T10:00:00Z', error: 'command_expired' }
beforeEach(() => { vi.clearAllMocks(); mocked.local = false; vi.stubEnv('ADMIN_ACCESS_TOKEN', 'synthetic-admin-password-'.repeat(2)); vi.stubEnv('ADMIN_SESSION_SECRET', 'synthetic-admin-session-'.repeat(2)) })
afterEach(() => vi.unstubAllEnvs())
function request(query = commandId) { return new Request(`https://example.test/api/admin/automation?commandId=${query}`, { headers: { cookie: `${ADMIN_COOKIE}=${createAdminSession()}` } }) }
describe('administrator command receipt route', () => {
  it('requires a signed administrator session and one valid UUID before private transport', async () => {
    expect((await GET(new Request('https://example.test/api/admin/automation?commandId=' + commandId))).status).toBe(401)
    expect((await GET(request('../invalid'))).status).toBe(400)
    expect((await GET(request(commandId + '&commandId=' + commandId))).status).toBe(400)
    expect(mocked.read).not.toHaveBeenCalled(); expect(mocked.snapshot).not.toHaveBeenCalled()
  })
  it('returns only the requested remote receipt with private no-store headers', async () => {
    mocked.read.mockResolvedValueOnce(receipt)
    const response = await GET(request())
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ command: receipt })
    expect(response.headers.get('cache-control')).toBe('no-store, private')
    expect(mocked.read).toHaveBeenCalledExactlyOnceWith(commandId)
    expect(mocked.snapshot).not.toHaveBeenCalled()
  })
  it('does not infer a terminal state from missing history, another command, or transport failure', async () => {
    mocked.read.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...receipt, commandId: '7ed8c4ed-32ac-4b11-b548-e59f10cb6b6c' }).mockRejectedValueOnce(new Error('private-token'))
    expect(await (await GET(request())).json()).toEqual({ command: null })
    expect(await (await GET(request())).json()).toEqual({ command: null })
    const response = await GET(request())
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: 'executor_unavailable' })
  })
  it('uses the existing local observation without a remote request when locally hosted', async () => {
    mocked.local = true; mocked.snapshot.mockResolvedValueOnce({ automation: { latestCommand: receipt } })
    expect(await (await GET(request())).json()).toEqual({ command: receipt })
    expect(mocked.read).not.toHaveBeenCalled()
  })
})
