import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_REQUEST_DELAY_MS,
  harvestTsinghuaCatalog,
  normalizeTsinghuaDepartmentResponse,
  parseTsinghuaDepartments,
  TSINGHUA_DOCTORATE_CATALOG_URL,
  TSINGHUA_MASTER_CATALOG_URL,
} from '../../scripts/ingestion/tsinghua-catalog-harvester'

const fixtureDirectory = join(process.cwd(), 'tests', 'fixtures', 'tsinghua-catalog')
const catalogHtml = readFileSync(join(fixtureDirectory, 'catalog.html'), 'utf8')
const response024 = JSON.parse(readFileSync(join(fixtureDirectory, '024.json'), 'utf8')) as unknown
const response025 = JSON.parse(readFileSync(join(fixtureDirectory, '025.json'), 'utf8')) as unknown
const checkedAt = '2026-07-23T10:00:00.000Z'

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('Tsinghua official catalog harvester', () => {
  it('parses and deduplicates official department codes and bilingual names', () => {
    expect(parseTsinghuaDepartments(catalogHtml)).toEqual([
      {
        code: '024',
        nameEn: 'Department of Computer Science & Technology',
        nameZh: '计算机科学与技术系',
      },
      {
        code: '025',
        nameEn: 'Department of Automation',
        nameZh: '自动化系',
      },
    ])
  })

  it('normalizes majors, not research directions, as stable program entities', () => {
    const entities = normalizeTsinghuaDepartmentResponse({
      payload: response024,
      requestedDepartment: parseTsinghuaDepartments(catalogHtml)[0]!,
      checkedAt,
    })

    expect(entities).toHaveLength(2)
    expect(entities.map((entity) => entity.entityKey)).toEqual([
      'tsinghua:master:024:081200',
      'tsinghua:master:024:085400',
    ])
    expect(entities[0]).toMatchObject({
      institutionId: 'uni-tsinghua-university',
      entityType: 'program',
      programType: 'degree',
      degreeLevel: 'master',
      majorCode: '081200',
      nameEn: 'Computer Science & Technology',
      department: {
        code: '024',
        nameEn: 'Department of Computer Science & Technology',
      },
      degreeAwardType: 'academic',
      academicYear: '2026',
      researchDirectionCount: 2,
      officialUrl: TSINGHUA_MASTER_CATALOG_URL,
      sourceCheckedAt: checkedAt,
      evidence: {
        locator: 'json:datas.zsmlYxs[zsyxsdm=024].exportZsmlYxZys[zszydm=081200]',
        officialUrl: TSINGHUA_MASTER_CATALOG_URL,
        checkedAt,
      },
    })
    expect(entities[0]!.evidence.quote).toContain('081200 Computer Science & Technology')
  })

  it('runs entirely from fixtures and never calls the network', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network must not be used in fixture mode')
    })
    const result = await harvestTsinghuaCatalog({
      checkedAt,
      detailHtml: catalogHtml,
      responsesByDepartment: {
        '024': response024,
        '025': response025,
      },
      fetchImpl,
    })

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(result.sourceMode).toBe('fixture')
    expect(result.requestsPlanned).toBe(2)
    expect(result.entities).toHaveLength(3)
    expect(new Set(result.entities.map((entity) => entity.entityKey)).size).toBe(3)
  })

  it('infers doctoral zslx and emits doctoral stable keys from an official /2 URL', async () => {
    const doctoral024 = structuredClone(response024) as {
      datas: Record<string, unknown>
    }
    doctoral024.datas.zslx = '2'
    doctoral024.datas.xxbm = '47028a21-4973-41c1-8426-4aab1af2b8c2'
    const fetchImpl = vi.fn(async () => {
      throw new Error('network must not be used in fixture mode')
    })
    const result = await harvestTsinghuaCatalog({
      catalogUrl: TSINGHUA_DOCTORATE_CATALOG_URL,
      degreeLevel: 'doctorate',
      checkedAt,
      detailHtml: catalogHtml,
      responsesByDepartment: {
        '024': doctoral024,
        '025': response025,
      },
      fetchImpl,
    })

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      degreeLevel: 'doctorate',
      admissionType: '2',
      catalogId: '47028a21-4973-41c1-8426-4aab1af2b8c2',
    })
    expect(result.entities.map((entity) => entity.entityKey)).toEqual([
      'tsinghua:doctorate:024:081200',
      'tsinghua:doctorate:024:085400',
      'tsinghua:doctorate:025:081100',
    ])
    expect(result.entities.every((entity) => entity.degreeLevel === 'doctorate')).toBe(true)
  })

  it('posts the UUID and zslx inferred from a doctoral URL sequentially', async () => {
    const oneDepartmentHtml = [
      '<ul id=zsyx>',
      '<li data-value=024>024 ',
      '<span lang=en>Department of Computer Science and Technology</span>',
      '<span lang=zh_CN>计算机科学与技术系</span>',
      '</li>',
      '</ul>',
    ].join('')
    const doctoral024 = structuredClone(response024) as {
      datas: Record<string, unknown>
    }
    doctoral024.datas.zslx = '2'
    doctoral024.datas.xxbm = '47028a21-4973-41c1-8426-4aab1af2b8c2'
    const requestBodies: URLSearchParams[] = []
    const fetchImpl = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      requestBodies.push(new URLSearchParams(String(init?.body)))
      return jsonResponse(doctoral024)
    })

    const result = await harvestTsinghuaCatalog({
      catalogUrl: TSINGHUA_DOCTORATE_CATALOG_URL,
      checkedAt,
      detailHtml: oneDepartmentHtml,
      fetchImpl,
      sleep: async () => undefined,
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(requestBodies[0]!.get('xxbm')).toBe('47028a21-4973-41c1-8426-4aab1af2b8c2')
    expect(requestBodies[0]!.get('zslx')).toBe('2')
    expect(requestBodies[0]!.get('yxsdm')).toBe('024')
    expect(result.degreeLevel).toBe('doctorate')
    expect(result.entities[0]!.entityKey).toBe('tsinghua:doctorate:024:081200')
  })

  it('rejects degree-level, URL, zslx, and xxbm inconsistencies before publication', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network must not be used')
    })
    await expect(harvestTsinghuaCatalog({
      catalogUrl: TSINGHUA_DOCTORATE_CATALOG_URL,
      degreeLevel: 'master',
      checkedAt,
      detailHtml: catalogHtml,
      dryRun: true,
      fetchImpl,
    })).rejects.toThrow('degreeLevel master conflicts with catalog URL admission type /2')
    expect(fetchImpl).not.toHaveBeenCalled()

    const mismatchedResponse = structuredClone(response024) as {
      datas: Record<string, unknown>
    }
    mismatchedResponse.datas.zslx = '1'
    mismatchedResponse.datas.xxbm = '2807549e-b29c-43a9-9be9-755383c88eb5'
    expect(() => normalizeTsinghuaDepartmentResponse({
      payload: mismatchedResponse,
      requestedDepartment: parseTsinghuaDepartments(catalogHtml)[0]!,
      catalogUrl: TSINGHUA_DOCTORATE_CATALOG_URL,
      degreeLevel: 'doctorate',
      checkedAt,
    })).toThrow('response zslx 1 conflicts with catalog URL /2')

    const mismatchedUuid = structuredClone(response024) as {
      datas: Record<string, unknown>
    }
    mismatchedUuid.datas.zslx = '2'
    mismatchedUuid.datas.xxbm = '2807549e-b29c-43a9-9be9-755383c88eb5'
    expect(() => normalizeTsinghuaDepartmentResponse({
      payload: mismatchedUuid,
      requestedDepartment: parseTsinghuaDepartments(catalogHtml)[0]!,
      catalogUrl: TSINGHUA_DOCTORATE_CATALOG_URL,
      degreeLevel: 'doctorate',
      checkedAt,
    })).toThrow('response xxbm conflicts with catalog URL UUID')

    await expect(harvestTsinghuaCatalog({
      catalogUrl: 'https://yzbm.tsinghua.edu.cn/publish/s05/s0503/detail/not-a-uuid/2',
      degreeLevel: 'doctorate',
      checkedAt,
      detailHtml: catalogHtml,
      dryRun: true,
      fetchImpl,
    })).rejects.toThrow('must contain an xxbm UUID')
  })

  it('supports a no-POST dry run from an input HTML fixture', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network must not be used for input dry run')
    })
    const result = await harvestTsinghuaCatalog({
      checkedAt,
      detailHtml: catalogHtml,
      dryRun: true,
      fetchImpl,
    })

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(result.sourceMode).toBe('dry-run')
    expect(result.departments).toHaveLength(2)
    expect(result.requestsPlanned).toBe(2)
    expect(result.entities).toEqual([])
  })

  it('fetches departments sequentially, rate limits requests, and retries within bounds', async () => {
    const requestedDepartments: string[] = []
    const sleeps: number[] = []
    let activeRequests = 0
    let maxActiveRequests = 0
    let department024Attempts = 0
    const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
      activeRequests += 1
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests)
      await Promise.resolve()
      try {
        if (!init?.method) return new Response(catalogHtml)
        const body = new URLSearchParams(String(init.body))
        const department = body.get('yxsdm')!
        requestedDepartments.push(department)
        if (department === '024') {
          department024Attempts += 1
          if (department024Attempts === 1) return jsonResponse({ error: 'temporary' }, 503)
          return jsonResponse(response024)
        }
        return jsonResponse(response025)
      } finally {
        activeRequests -= 1
      }
    })

    const result = await harvestTsinghuaCatalog({
      checkedAt,
      fetchImpl,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds)
      },
      maxAttempts: 2,
    })

    expect(requestedDepartments).toEqual(['024', '024', '025'])
    expect(sleeps).toEqual([
      DEFAULT_REQUEST_DELAY_MS,
      DEFAULT_REQUEST_DELAY_MS,
      DEFAULT_REQUEST_DELAY_MS,
    ])
    expect(maxActiveRequests).toBe(1)
    expect(result.entities).toHaveLength(3)
  })

  it('rejects unsafe rate limits and stops after the configured retry bound', async () => {
    await expect(harvestTsinghuaCatalog({
      checkedAt,
      detailHtml: catalogHtml,
      dryRun: true,
      delayMs: DEFAULT_REQUEST_DELAY_MS - 1,
    })).rejects.toThrow(`delayMs must be an integer >= ${DEFAULT_REQUEST_DELAY_MS}`)

    const fetchImpl = vi.fn(async (_input: string | URL, init?: RequestInit) => (
      init?.method ? jsonResponse({ error: 'temporary' }, 503) : new Response(catalogHtml)
    ))
    await expect(harvestTsinghuaCatalog({
      checkedAt,
      fetchImpl,
      sleep: async () => undefined,
      maxAttempts: 2,
    })).rejects.toThrow('HTTP 503')
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })
})
