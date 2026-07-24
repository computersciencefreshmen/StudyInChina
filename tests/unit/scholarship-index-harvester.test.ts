import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_SCHOLARSHIP_INDEX_SOURCES,
  assertOfficialHttpsUrl,
  harvestScholarshipIndexes,
  parseScholarshipIndexHtml,
  type ScholarshipIndexSource,
} from '../../scripts/ingestion/scholarship-index-harvester'

const CHECKED_AT = '2026-07-23T08:00:00.000Z'
const FIXTURE_DIRECTORY = resolve(
  process.cwd(),
  'tests/fixtures/scholarship-index',
)

function fixture(name: string): string {
  return readFileSync(resolve(FIXTURE_DIRECTORY, `${name}.html`), 'utf8')
}

function defaultFixtureMap(): Readonly<Record<string, string>> {
  return Object.fromEntries(
    DEFAULT_SCHOLARSHIP_INDEX_SOURCES.map((source) => [
      source.id,
      fixture(source.fixtureFile),
    ]),
  )
}

function response(
  body: string,
  status = 200,
  contentType = 'text/html; charset=utf-8',
): Response {
  return new Response(body, {
    status,
    headers: contentType ? { 'content-type': contentType } : undefined,
  })
}

describe('scholarship index harvester', () => {
  it('extracts at least 50 deduplicated official scholarship identities from six top universities', async () => {
    const result = await harvestScholarshipIndexes({
      checkedAt: CHECKED_AT,
      fixturesBySourceId: defaultFixtureMap(),
    })

    expect(result.sourceMode).toBe('fixture')
    expect(result.institutionsCovered).toHaveLength(6)
    expect(result.verifiedCandidateCount).toBe(57)
    expect(result.entities).toHaveLength(result.verifiedCandidateCount)
    expect(new Set(result.entities.map((entity) => entity.entityKey)).size).toBe(
      result.entities.length,
    )
    expect(result.sources.every((source) => source.status === 'ok')).toBe(true)

    for (const entity of result.entities) {
      expect(entity.entityType).toBe('scholarship')
      expect(entity.nameZh ?? entity.nameEn).toBeTruthy()
      expect(entity.officialUrl.startsWith('https://')).toBe(true)
      expect(entity.sourceCheckedAt).toBe(CHECKED_AT)
      expect(entity.evidence.checkedAt).toBe(CHECKED_AT)
      expect(entity.evidence.quote.length).toBeGreaterThan(0)
      expect(entity.evidence.officialUrl.startsWith('https://')).toBe(true)
    }

    const names = result.entities
      .map((entity) => entity.nameEn ?? entity.nameZh ?? '')
      .join('\n')
    expect(names).not.toMatch(
      /annual review|application guide|评审结果|结果公示|申请系统|申请通知|招生简章/iu,
    )
    expect(names).not.toContain('Full Scholarships for Certain Programs')
    expect(names).not.toContain('Social Donation Scholarship')
  })

  it('uses a full title attribute as auditable evidence when the visible label is truncated', () => {
    const source = DEFAULT_SCHOLARSHIP_INDEX_SOURCES.find(
      (candidate) => candidate.id === 'fudan-new-student-scholarship-index',
    )
    expect(source).toBeDefined()

    const entities = parseScholarshipIndexHtml({
      html: fixture('fudan'),
      source: source!,
      checkedAt: CHECKED_AT,
    })
    const languageBachelor = entities.find((entity) =>
      entity.nameZh?.includes('汉语言（对外）专业本科生'),
    )

    expect(languageBachelor).toBeDefined()
    expect(languageBachelor?.evidence.locator).toMatch(/@title$/u)
    expect(languageBachelor?.evidence.quote).toContain(
      '国际中文教师奖学金汉语言（对外）专业本科生',
    )
  })

  it('rejects non-HTTPS, non-allowlisted, credentialed, and private URLs', () => {
    expect(() =>
      assertOfficialHttpsUrl('http://official.example.edu.cn/list.htm', [
        'official.example.edu.cn',
      ]),
    ).toThrow(/HTTPS/u)
    expect(() =>
      assertOfficialHttpsUrl('https://evil.example/list.htm', [
        'official.example.edu.cn',
      ]),
    ).toThrow(/not allowlisted/u)
    expect(() =>
      assertOfficialHttpsUrl('https://user:pass@official.example.edu.cn/list.htm', [
        'official.example.edu.cn',
      ]),
    ).toThrow(/credentials/u)
    expect(() =>
      assertOfficialHttpsUrl('https://127.0.0.1/list.htm', ['127.0.0.1']),
    ).toThrow(/Invalid official host/u)
  })

  it('excludes navigation, generic guides, news, external links, and duplicates', () => {
    const source: ScholarshipIndexSource = {
      id: 'test-scholarship-index',
      institutionId: 'uni-test',
      officialUrl: 'https://official.example.edu.cn/scholarships/index.htm',
      allowedHosts: ['official.example.edu.cn'],
      fixtureFile: 'test',
    }
    const html = `
      <nav>
        <a href="/scholarships/index.htm">Scholarships</a>
        <a href="/guide.htm">Scholarship Application Guide</a>
      </nav>
      <main>
        <a href="/merit.htm">University Merit Scholarship</a>
        <a href="/merit.htm">University Merit Scholarship</a>
        <a href="/review.htm">Notice on the 2026 Annual Review of University Merit Scholarship</a>
        <a href="https://evil.example/award.htm">External Excellence Scholarship</a>
        <a href="/program.htm">International Master Program</a>
      </main>
    `

    const entities = parseScholarshipIndexHtml({ html, source, checkedAt: CHECKED_AT })

    expect(entities).toHaveLength(1)
    expect(entities[0]).toMatchObject({
      nameEn: 'University Merit Scholarship',
      nameZh: null,
      officialUrl: 'https://official.example.edu.cn/merit.htm',
      evidence: {
        quote: 'University Merit Scholarship',
        officialUrl: source.officialUrl,
      },
    })
  })

  it('skips a source without fetching its page when robots.txt disallows it', async () => {
    const source: ScholarshipIndexSource = {
      id: 'robots-blocked-index',
      institutionId: 'uni-robots',
      officialUrl: 'https://official.example.edu.cn/scholarships/index.htm',
      allowedHosts: ['official.example.edu.cn'],
      fixtureFile: 'robots',
    }
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = new URL(input)
      if (url.pathname === '/robots.txt') {
        return response('User-agent: StudyInChinaDataBot\nDisallow: /scholarships')
      }
      return response('<a href="/award.htm">Should Not Be Fetched Scholarship</a>')
    })

    const result = await harvestScholarshipIndexes({
      sources: [source],
      checkedAt: CHECKED_AT,
      fetchImpl,
      sleep: async () => undefined,
      maxAttempts: 1,
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(result.verifiedCandidateCount).toBe(0)
    expect(result.sources[0]).toMatchObject({
      status: 'robots_blocked',
      candidateCount: 0,
    })
  })

  it('retries 429 and 5xx responses while enforcing at least five seconds per host', async () => {
    const source: ScholarshipIndexSource = {
      id: 'retry-index',
      institutionId: 'uni-retry',
      officialUrl: 'https://official.example.edu.cn/scholarships/index.htm',
      allowedHosts: ['official.example.edu.cn'],
      fixtureFile: 'retry',
    }
    let clock = 0
    const sleeps: number[] = []
    const pageResponses = [
      response('rate limited', 429),
      response('temporary failure', 503),
      response('<main><a href="/merit.htm">Future Leaders Scholarship</a></main>'),
    ]
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = new URL(input)
      if (url.pathname === '/robots.txt') return response('', 404, 'text/plain')
      return pageResponses.shift() ?? response('unexpected', 500)
    })

    const result = await harvestScholarshipIndexes({
      sources: [source],
      checkedAt: CHECKED_AT,
      fetchImpl,
      now: () => clock,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds)
        clock += milliseconds
      },
      delayMs: 5_000,
      maxAttempts: 3,
    })

    expect(fetchImpl).toHaveBeenCalledTimes(4)
    expect(sleeps).toEqual([5_000, 5_000, 5_000])
    expect(result.verifiedCandidateCount).toBe(1)
    expect(result.sources[0]?.status).toBe('ok')
  })

  it('fails closed when a fixture bundle omits a registered source', async () => {
    const source = DEFAULT_SCHOLARSHIP_INDEX_SOURCES[0]!
    const result = await harvestScholarshipIndexes({
      sources: [source],
      checkedAt: CHECKED_AT,
      fixturesBySourceId: {},
    })

    expect(result.verifiedCandidateCount).toBe(0)
    expect(result.sources).toEqual([
      expect.objectContaining({
        sourceId: source.id,
        status: 'fixture_missing',
      }),
    ])
  })
})
