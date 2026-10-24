import { beforeEach, describe, expect, it, vi } from 'vitest'
import { publishMaintenanceProof, verifyMaintenancePublication } from '../../scripts/automation/verify-maintenance-publication'
import type { CanonicalMaintenanceReceipt } from '../../scripts/automation/prepare-maintenance-catalog'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { canonicalJson } from '../../scripts/maintenance/contracts'

const ledgers = vi.hoisted(() => ({ identities: vi.fn(() => []), fields: vi.fn(() => []), revision: vi.fn(() => '7'.repeat(64)),
  raw: { admissionCycles: [] as Array<{ id: string; programId: string }> }, programs: [] as Array<{ id: string; slug: string }> }))
vi.mock('../../scripts/maintenance/build-scope', () => ({ loadMaintenanceBundle: () => ledgers.raw }))
vi.mock('../../src/lib/data/discovery', () => ({ selectDiscoveryData: () => ({ universities: [{ id: 'uni-proof', slug: 'uni-proof' }], programs: ledgers.programs, scholarships: [] }) }))
vi.mock('../../src/lib/data/identity-acceptance-store', () => ({ readIdentityAcceptances: ledgers.identities }))
vi.mock('../../src/lib/data/field-verification-store', () => ({ readFieldVerifications: ledgers.fields }))
vi.mock('../../src/lib/catalog/directory-revision', () => ({ directoryRevision: ledgers.revision }))
vi.mock('../../src/lib/data/freshness', () => ({ getTodayDate: () => '2026-10-24' }))
const local = vi.hoisted(() => ({ files: new Map<string, string>() }))
vi.mock('node:fs', async importOriginal => {
  const mock = { ...await importOriginal<typeof import('node:fs')>(),
    readFileSync: (path: unknown) => { const value = local.files.get(String(path)); if (value !== undefined) return value
      const error = new Error('Fixture has no changed identities') as NodeJS.ErrnoException; error.code = 'ENOENT'; throw error },
    existsSync: (path: unknown) => local.files.has(String(path)), mkdirSync: vi.fn(),
    writeFileSync: (path: unknown, value: unknown) => { if (local.files.has(String(path))) { const error = new Error('Exists') as NodeJS.ErrnoException; error.code = 'EEXIST'; throw error }; local.files.set(String(path), String(value)) },
  }
  return { ...mock, default: mock }
})
beforeEach(() => { local.files.clear(); ledgers.raw.admissionCycles.length = 0; ledgers.programs.length = 0
  ledgers.identities.mockClear(); ledgers.fields.mockClear(); ledgers.revision.mockClear() })

const commit = 'a'.repeat(40), project = 'prj_AgYJcsuat4kmLiinlvcBbZsYY3cg', owner = 'team_o5qghzfTOk24QwoYANzJ8hNH'
const token = 'fixture-provider-token-never-real'
const receipt: CanonicalMaintenanceReceipt = {
  format: 'studyinchina.canonical-maintenance-receipt', formatVersion: 1,
  batchId: 'proof-batch', sha256: 'b'.repeat(64), batchSha256: 'c'.repeat(64), scopeRegistrySha256: 'd'.repeat(64),
  inputCatalogSha256: 'e'.repeat(64), outputCatalogSha256: 'f'.repeat(64), acceptedAt: '2026-10-24T00:00:00.000Z',
  acceptedProposalIds: ['proposal-one'], held: [], identityReceiptSha256: '1'.repeat(64),
  scholarshipReceiptSha256: '2'.repeat(64), fieldReceiptSha256: '3'.repeat(64),
}
function fixture(options: { wrongCommit?: boolean; duplicate?: boolean; wrongDate?: boolean; wrongRevision?: boolean; revisionChangesOnPageTwo?: boolean } = {}) {
  return vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const url = new URL(String(input))
    expect(init?.redirect).toBe('error')
    if (url.hostname === 'api.vercel.com') {
      expect(init?.headers).toMatchObject({ Authorization: `Bearer ${token}` })
      return Response.json(url.pathname.startsWith('/v4/aliases/') ? { projectId: project, deploymentId: 'dpl_proof' }
        : { projectId: project, ownerId: owner, id: 'dpl_proof', readyState: 'READY', target: 'production', meta: { githubCommitSha: options.wrongCommit ? 'c'.repeat(40) : commit } })
    }
    expect(url.origin).toBe('https://studyinchina.vercel.app')
    expect(init?.headers).toBeUndefined() // provider credentials never accompany a public readback
    if (url.pathname === '/api/v1/releases/current') return Response.json({ data: { evaluatedForDate: '2026-10-24', catalogBackend: 'json', directoryRevision: '7'.repeat(64) } })
    if (/^\/(?:en|zh|ru|de|fr|es)\/programs\//u.test(url.pathname)) return new Response('<h1>Program</h1><div data-discovery-notice>Official source</div>')
    return Response.json({ data: url.pathname.endsWith('/institutions') ? options.duplicate ? [{ id: 'uni-proof' }, { id: 'uni-proof' }] : [{ id: 'uni-proof' }] : [],
      ...(!url.pathname.endsWith('/institutions') && url.pathname.endsWith('/programs') ? { data: ledgers.programs.map(program => ({ id: program.id })) } : {}),
      meta: { release: { evaluatedForDate: options.wrongDate ? '2026-10-23' : '2026-10-24',
        directoryRevision: options.wrongRevision || options.revisionChangesOnPageTwo && url.searchParams.has('cursor') ? '8'.repeat(64) : '7'.repeat(64) },
        nextCursor: options.revisionChangesOnPageTwo && url.pathname.endsWith('/institutions') && !url.searchParams.has('cursor') ? 'page-two' : null } })
  })
}

describe('production publication proof before acknowledgement', () => {
  it('pins native owner/project and exact production commit then checks every directory identity', async () => {
    const fetcher = fixture()
    const result = await verifyMaintenancePublication({ root: process.cwd(), sourceCommit: commit, receipt, vercelToken: token, fetcher })
    expect(result).toMatchObject({ pass: true, sourceCommit: commit, deploymentId: 'dpl_proof', directoryCounts: { institutions: 1, programs: 0, scholarships: 0 } })
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/u)
    expect(JSON.stringify(result)).not.toContain(token)
    expect(fetcher.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true)
  })
  it('never accepts a stable alias pointing to another commit', async () => {
    const fetcher = fixture({ wrongCommit: true })
    await expect(verifyMaintenancePublication({ root: process.cwd(), sourceCommit: commit, receipt, vercelToken: token, fetcher }))
      .rejects.toThrow('publication_exact_commit_not_stable')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('rejects duplicate identities and previous-day runtime evaluation', async () => {
    await expect(verifyMaintenancePublication({ root: process.cwd(), sourceCommit: commit, receipt, vercelToken: token, fetcher: fixture({ duplicate: true }) }))
      .rejects.toThrow('publication_duplicate_or_missing_id')
    await expect(verifyMaintenancePublication({ root: process.cwd(), sourceCommit: commit, receipt, vercelToken: token, fetcher: fixture({ wrongDate: true }) }))
      .rejects.toThrow('publication_directory_contract_mismatch')
  })
  it('retries identical published acknowledgement after a lost reply without changing its proof hash', async () => {
    const firstAck = vi.fn().mockRejectedValue(new Error('Reply lost after acceptance'))
    const output = 'fixture-stable-proof.json'
    await expect(publishMaintenanceProof({ root: process.cwd(), sourceCommit: commit, receipt, vercelToken: token, output,
      fetcher: fixture(), acknowledge: firstAck })).rejects.toThrow('Reply lost')
    const secondAck = vi.fn().mockResolvedValue({ ok: true, reused: true }), noNetwork = vi.fn<typeof fetch>()
    const result = await publishMaintenanceProof({ root: process.cwd(), sourceCommit: commit, receipt, vercelToken: token, output,
      fetcher: noNetwork, acknowledge: secondAck })
    expect(noNetwork).not.toHaveBeenCalled()
    expect(secondAck.mock.calls[0][0]).toEqual(firstAck.mock.calls[0][0])
    expect(secondAck.mock.calls[0][0].stableProofSha256).toBe(result.sha256)
    await expect(publishMaintenanceProof({ root: process.cwd(), sourceCommit: 'c'.repeat(40), receipt, vercelToken: token,
      output, fetcher: noNetwork })).rejects.toThrow('publication_saved_proof_changed')
  })
  it('rejects old facts with identical record IDs, including a revision change on a later page', async () => {
    await expect(verifyMaintenancePublication({ root: process.cwd(), sourceCommit: commit, receipt, vercelToken: token,
      fetcher: fixture({ wrongRevision: true }) })).rejects.toThrow('publication_projection_revision_mismatch')
    await expect(verifyMaintenancePublication({ root: process.cwd(), sourceCommit: commit, receipt, vercelToken: token,
      fetcher: fixture({ revisionChangesOnPageTwo: true }) })).rejects.toThrow('publication_projection_revision_mismatch')
  })
  it('reads sidecars from the requested root and binds their exact projection revision', async () => {
    const root = resolve(process.cwd(), 'fixture-repository-root')
    const result = await verifyMaintenancePublication({ root, sourceCommit: commit, receipt, vercelToken: token, fetcher: fixture() })
    expect(ledgers.identities).toHaveBeenCalledWith(resolve(root, 'content', 'data'))
    expect(ledgers.fields).toHaveBeenCalledWith(resolve(root, 'content', 'data'))
    expect(ledgers.revision).toHaveBeenCalledWith(ledgers.raw, '2026-10-24', [], [])
    expect(result.checks).toContain('projection-revision')
    expect(result.directoryRevision).toBe('7'.repeat(64))
  })
  it('checks the parent programme detail in all six languages after an admission-cycle field patch', async () => {
    ledgers.raw.admissionCycles.push({ id: 'cycle-proof', programId: 'program-proof' })
    ledgers.programs.push({ id: 'program-proof', slug: 'program-proof-slug' })
    local.files.set(resolve(process.cwd(), 'quality', 'maintenance', 'batches', receipt.batchId, 'field-receipt.json'), JSON.stringify({ accepted: [{ recordId: 'cycle-proof', fieldPaths: ['closesOn'] }] }))
    const fetcher = fixture(), result = await verifyMaintenancePublication({ root: process.cwd(), sourceCommit: commit, receipt, vercelToken: token, fetcher })
    expect(result.detailsChecked).toBe(6)
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes('/programs/program-proof-slug'))).toHaveLength(6)
  })
  it('refuses a saved old proof that never validated the projection revision', async () => {
    const output = 'old-revision-proof.json'
    await publishMaintenanceProof({ root: process.cwd(), sourceCommit: commit, receipt, vercelToken: token, output, fetcher: fixture() })
    const key = resolve(output), proof = JSON.parse(local.files.get(key)!)
    proof.checks = proof.checks.filter((check: string) => check !== 'projection-revision')
    delete proof.sha256; proof.sha256 = createHash('sha256').update(canonicalJson(proof)).digest('hex')
    local.files.set(key, JSON.stringify(proof))
    const acknowledge = vi.fn()
    await expect(publishMaintenanceProof({ root: process.cwd(), sourceCommit: commit, receipt, vercelToken: token,
      output, acknowledge })).rejects.toThrow('publication_saved_proof_changed')
    expect(acknowledge).not.toHaveBeenCalled()
  })
})
