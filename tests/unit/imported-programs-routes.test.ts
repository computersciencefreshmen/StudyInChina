import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocked = vi.hoisted(() => ({ query: vi.fn(), summary: vi.fn(), program: vi.fn() }))
vi.mock('@/lib/third-party-programs', () => ({ queryThirdPartyPrograms: mocked.query, getThirdPartySummary: mocked.summary, getThirdPartyProgram: mocked.program }))
import { GET as list } from '@/app/api/v1/imported-programs/route'
import { GET as detail } from '@/app/api/v1/imported-programs/[id]/route'

beforeEach(() => {
  vi.clearAllMocks()
  mocked.query.mockReturnValue({ items: [], total: 0, page: 1, pageSize: 40, totalPages: 1, schools: [] })
  mocked.summary.mockReturnValue({ programCount: 1000, extractedCount: 10, schoolCount: 20, generatedAt: '2026-11-17' })
})

describe('third-party directory endpoints', () => {
  it('defaults to extracted details and bounds the response even if the backing service returns too many rows', async () => {
    mocked.query.mockReturnValue({ items: Array.from({ length: 80 }, (_, id) => ({ id })), total: 80, page: 1, pageSize: 40, totalPages: 2, schools: [] })
    const response = list(new Request('https://example.test/api/v1/imported-programs'))
    expect(mocked.query).toHaveBeenCalledWith(expect.objectContaining({ view: 'extracted', page: 1 }))
    expect((await response.json()).items).toHaveLength(40)
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('rejects unbounded queries and invalid pages before reading program data', () => {
    for (const query of ['page=-1', 'page=Infinity', 'page=9007199254740992', 'view=private', `query=${'x'.repeat(201)}`]) {
      expect(list(new Request(`https://example.test/api/v1/imported-programs?${query}`)).status).toBe(400)
    }
    expect(mocked.query).not.toHaveBeenCalled()
  })

  it('returns no detail resource for a link-only discovery', async () => {
    mocked.program.mockReturnValue({ id: 'sicas-123', status: 'link_only' })
    expect((await detail(new Request('https://example.test/api/v1/imported-programs/sicas-123'), { params: Promise.resolve({ id: 'sicas-123' }) })).status).toBe(404)
  })

  it('serves a captured source record with its third-party provenance', async () => {
    const program = { id: 'cucas-1', status: 'extracted', official: false, admissionYear: null, fields: { tuition: '4000 CNY / course' } }
    mocked.program.mockReturnValue(program)
    const response = await detail(new Request('https://example.test/api/v1/imported-programs/cucas-1'), { params: Promise.resolve({ id: 'cucas-1' }) })
    expect(await response.json()).toEqual({ program })
  })

  it('projects list and detail records explicitly so private evidence stays private and long text stays on details', async () => {
    const program = {
      id: 'cucas-1', status: 'extracted', official: false, admissionYear: null,
      evidence: { rawPath: 'C:/private/source.html', body: 'x'.repeat(10000) },
      evidenceHash: 'a'.repeat(64),
      fields: { tuition: '4000 CNY / course', requirements: 'Source entry requirements', description: 'Source program description' },
    }
    mocked.query.mockReturnValue({ items: [program], total: 1, page: 1, pageSize: 40, totalPages: 1, schools: [] })
    mocked.program.mockReturnValue(program)
    const listed = (await list(new Request('https://example.test/api/v1/imported-programs')).json()).items[0]
    expect(listed).not.toHaveProperty('evidence')
    expect(listed).not.toHaveProperty('evidenceHash')
    expect(listed.fields).not.toHaveProperty('requirements')
    expect(listed.fields).not.toHaveProperty('description')
    const detailed = (await (await detail(new Request('https://example.test/api/v1/imported-programs/cucas-1'), { params: Promise.resolve({ id: 'cucas-1' }) })).json()).program
    expect(detailed).not.toHaveProperty('evidence')
    expect(detailed.evidenceHash).toBe(program.evidenceHash)
    expect(detailed.fields.requirements).toBe(program.fields.requirements)
    expect(detailed.fields.description).toBe(program.fields.description)
  })
})
