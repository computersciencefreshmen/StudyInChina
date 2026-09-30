import { describe, expect, it, vi } from 'vitest'
import sources from '../../content/data/sources.json'
import cities from '../../content/data/cities.json'
import universities from '../../content/data/universities.json'
import programs from '../../content/data/programs.json'
import scholarships from '../../content/data/scholarships.json'
import admissionCycles from '../../content/data/admission-cycles.json'
import type { DataBundle, University, UniversityRanking } from '@/lib/data/types'
import { bundleSchema, universitySchema } from '@/lib/data/schema'
import { selectPublishedData } from '@/lib/data/publication'
import { selectCatalogApiData } from '@/lib/catalog-api/projection'
import { currentUniversityRankings, matchesUniversityRankings, parseRankingFilters, rankingEditionLabel } from '@/lib/data/rankings'
import { parseUniversityCatalogFilters, universityCatalogHref } from '@/lib/university-catalog'
import { parseProgramCatalogFilters, programCatalogHref, queryProgramCatalog } from '@/lib/program-catalog'
import { parseScholarshipCatalogFilters, scholarshipCatalogHref, queryScholarshipCatalog } from '@/lib/scholarship-catalog'
import { createD1CatalogRepository, createJsonCatalogRepository, deriveCatalogRelease } from '@/lib/catalog'
import { CatalogApiService } from '@/lib/catalog-api/service'
import { rankingParams } from '@/lib/catalog-api/http'

const today = '2026-09-29'
function rank(system: UniversityRanking['system'], rankMin: number, rankMax = rankMin, year = 2026): UniversityRanking {
  const host = { qs: 'topuniversities.com', the: 'timeshighereducation.com', usnews: 'usnews.com', arwu: 'shanghairanking.com' }[system]
  return { system, year, rankMin, rankMax, rankLabel: rankMin === rankMax ? String(rankMin) : `${rankMin}–${rankMax}`, sourceUrl: `https://www.${host}/rankings`, checkedAt: today }
}

function fixture(): DataBundle {
  const schools: University[] = universities.slice(0, 3).map((university, index) => ({
    ...university, id: `rank-school-${index}`, slug: `rank-school-${index}`, cityId: cities[0]!.id,
    rankings: index === 0 ? [rank('qs', 99), rank('the', 201, 250)] : index === 1 ? [rank('qs', 201, 250), rank('the', 99)] : undefined,
  })) as University[]
  const linkedPrograms = programs.slice(0, 3).map((program, index) => ({
    ...program, id: `rank-program-${index}`, slug: `rank-program-${index}`, universityId: schools[index]!.id, status: 'stale',
  })) as DataBundle['programs']
  const linkedScholarships = [
    { ...scholarships[0]!, id: 'rank-award', slug: 'rank-award', universityIds: [schools[0]!.id, schools[1]!.id], programIds: [], status: 'stale' },
    { ...scholarships[0]!, id: 'program-award', slug: 'program-award', universityIds: [], programIds: [linkedPrograms[0]!.id], status: 'stale' },
  ] as DataBundle['scholarships']
  return { sources: sources as DataBundle['sources'], cities: [cities[0]!] as DataBundle['cities'], universities: schools, programs: linkedPrograms, scholarships: linkedScholarships, admissionCycles: [] }
}

describe('university ranking filters', () => {
  it('keeps rank bands inside their entire Top N and uses the newest edition', () => {
    const university = { ...fixture().universities[0]!, rankings: [rank('qs', 50, 50, 2025), rank('qs', 201, 250, 2026)] }
    expect(matchesUniversityRankings(university, { qsRankMax: '200' })).toBe(false)
    expect(matchesUniversityRankings(university, { qsRankMax: '500' })).toBe(true)
    expect(matchesUniversityRankings(university, { qsRankMax: 'ranked' })).toBe(true)
    expect(matchesUniversityRankings(university, { qsRankMax: 'unverified' })).toBe(false)
    expect(matchesUniversityRankings(fixture().universities[2]!, { qsRankMax: 'unverified' })).toBe(true)
    expect(matchesUniversityRankings(fixture().universities[2]!, { qsRankMax: '1000' })).toBe(false)
    expect(university.rankings[0]!.year).toBe(2025)
    expect(rankingEditionLabel(rank('usnews', 37, 37, 2027))).toBe('2026–2027')
    const expired = { ...university, rankings: [{ ...rank('qs', 50), reviewAfter: '2026-09-28' }] }
    expect(matchesUniversityRankings(expired, { qsRankMax: 'ranked' }, today)).toBe(false)
    expect(matchesUniversityRankings(expired, { qsRankMax: '100' }, today)).toBe(false)
    expect(matchesUniversityRankings(expired, { qsRankMax: 'unverified' }, today)).toBe(true)
    expect(matchesUniversityRankings(expired, { qsRankMax: '100' }, '2026-09-28')).toBe(true)
  })

  it('validates four shared URL parameters without accepting arbitrary ranks', () => {
    const params = { qsRankMax: '100', theRankMax: 'ranked', usNewsRankMax: 'unverified', arwuRankMax: '500' }
    for (const [parse, href] of [
      [parseUniversityCatalogFilters, universityCatalogHref],
      [parseProgramCatalogFilters, programCatalogHref],
      [parseScholarshipCatalogFilters, scholarshipCatalogHref],
    ] as const) {
      const filters = parse(params)
      const url = href('zh', filters as never)
      for (const [key, value] of Object.entries(params)) expect(new URL(url, 'https://test.invalid').searchParams.get(key)).toBe(value)
    }
    expect(parseRankingFilters({ qsRankMax: 'not-real', theRankMax: ['100', '500'] })).toMatchObject({ qsRankMax: '', theRankMax: '' })
    expect(rankingParams(new URLSearchParams(params))).toEqual(params)
    expect(() => rankingParams(new URLSearchParams({ qsRankMax: '75' }))).toThrow('qsRankMax is invalid')
  })

  it('filters institutions and linked programs through the same university ranking', async () => {
    const data = fixture()
    const repository = createJsonCatalogRepository(() => data)
    const schools = await repository.listInstitutions({ qsRankMax: '100', today })
    expect(schools.total).toBe(1)
    expect(schools.items[0]!.institution.id).toBe('rank-school-0')
    expect(queryProgramCatalog(data, parseProgramCatalogFilters({ qsRankMax: '100' }), today).items.map(({ program }) => program.id)).toEqual(['rank-program-0'])
    const page = await repository.listPrograms({ theRankMax: '100', today })
    expect(page.items.map(({ program }) => program.id)).toEqual(['rank-program-1'])
  })

  it('requires one linked school to satisfy all ranks, including a selected school', () => {
    const data = fixture()
    expect(queryScholarshipCatalog(data, parseScholarshipCatalogFilters({ qsRankMax: '100' }), today).items.map(({ scholarship }) => scholarship.id)).toEqual(['rank-award', 'program-award'])
    expect(queryScholarshipCatalog(data, parseScholarshipCatalogFilters({ qsRankMax: '100', theRankMax: '100' }), today).total).toBe(0)
    expect(queryScholarshipCatalog(data, parseScholarshipCatalogFilters({ qsRankMax: '100', institution: 'rank-school-1' }), today).total).toBe(0)
    const selectedSchool = queryScholarshipCatalog(data, parseScholarshipCatalogFilters({ qsRankMax: '100', institution: 'rank-school-0' }), today)
    expect(selectedSchool.items.map(({ scholarship }) => scholarship.id)).toEqual(['rank-award', 'program-award'])
    expect(selectedSchool.universityOptions.map(({ value }) => value)).toContain('rank-school-0')
  })

  it('keeps rank filtering independent of university freshness and other facts', () => {
    const data = fixture()
    const before = structuredClone(data)
    const service = new CatalogApiService(data, deriveCatalogRelease(data), today)
    expect(service.listInstitutions({ qsRankMax: '100' }).data.map(({ id }) => id)).toEqual(['rank-school-0'])
    expect(service.listPrograms({ qsRankMax: '100' }).data.map(({ id }) => id)).toEqual(['rank-program-0'])
    expect(data).toEqual(before)
  })

  it('applies the same linked-school rules to scholarship APIs and returns rank evidence', () => {
    const data = fixture()
    data.scholarships = data.scholarships.map((scholarship) => ({ ...scholarship, status: 'verified', verifiedAt: today, reviewAfter: '2026-10-29' }))
    const service = new CatalogApiService(data, deriveCatalogRelease(data), today)
    expect(service.listScholarships({ qsRankMax: '100' }).data.map(({ id }) => id)).toEqual(['program-award', 'rank-award'])
    expect(service.listScholarships({ qsRankMax: '100', theRankMax: '100' }).data).toHaveLength(0)
    expect(service.listScholarships({ qsRankMax: '100', institution: 'rank-school-1' }).data).toHaveLength(0)
    expect(service.listScholarships({ qsRankMax: '100', institution: 'rank-school-0' }).data.map(({ id }) => id)).toEqual(['program-award', 'rank-award'])
    expect(service.listPrograms({ qsRankMax: '100' }).data[0]!.university.rankings?.[0]?.sourceUrl).toBe('https://www.topuniversities.com/rankings')
    data.universities[0]!.rankings![0]!.reviewAfter = '2026-09-28'
    expect(service.getInstitution('rank-school-0')!.data.rankings?.some((ranking) => ranking.system === 'qs')).toBe(false)
  })

  it('ties a scholarship ranking to the selected program university', () => {
    const data = fixture()
    data.scholarships = [{ ...data.scholarships[0]!, programIds: data.programs.slice(0, 2).map((program) => program.id), status: 'verified', verifiedAt: today, reviewAfter: '2026-10-29' }]
    const service = new CatalogApiService(data, deriveCatalogRelease(data), today)
    expect(service.listScholarships({ program: 'rank-program-0', qsRankMax: '100' }).data).toHaveLength(1)
    expect(service.listScholarships({ program: 'rank-program-1', qsRankMax: '100' }).data).toHaveLength(0)
    expect(service.listScholarships({ program: 'rank-program-1', theRankMax: '100' }).data).toHaveLength(1)
  })

  it('discovers stale scholarship identities by affiliation without restoring expired eligibility or facts', () => {
    const data = fixture()
    const before = structuredClone(data)
    const service = new CatalogApiService(data, deriveCatalogRelease(data), today)
    const records = service.listScholarships({ qsRankMax: '100' }).data
    expect(records.map(({ id }) => id)).toEqual(['program-award', 'rank-award'])
    for (const record of records) {
      expect(record.universityIds).toBeNull()
      expect(record.programIds).toBeNull()
      expect(record.coverage).toEqual({ tuition: null, accommodation: null, insurance: null, stipendCnyPerMonth: null })
      expect(record.deadline).toBeNull()
      expect(record.applicationUrl).toBeNull()
      expect(record.summary).toBeNull()
      expect(record.fieldMeta.universityIds.status).toBe('stale')
      expect(record.fieldMeta.programIds.status).toBe('stale')
      expect(record.verifiedAt).toBe(data.scholarships.find(({ id }) => id === record.id)!.verifiedAt)
    }
    expect(service.listScholarships({ qsRankMax: '100', institution: 'rank-school-0' }).data).toHaveLength(0)
    expect(service.listScholarships({ qsRankMax: '100', program: 'rank-program-0' }).data).toHaveLength(0)
    expect(service.listScholarships({ qsRankMax: '100', theRankMax: '100' }).data).toHaveLength(0)
    expect(data).toEqual(before)
  })

  it('keeps actual website and API scholarship rank discovery aligned on 2026-09-30', () => {
    const date = '2026-09-30'
    const data = bundleSchema.parse({ sources, cities, universities, programs, scholarships, admissionCycles })
    const filters = { qsRankMax: '100', theRankMax: '100', usNewsRankMax: '100', arwuRankMax: '100' } as const
    const web = queryScholarshipCatalog(selectPublishedData(data, date), parseScholarshipCatalogFilters(filters), date, 100)
    const service = new CatalogApiService(selectCatalogApiData(data, date), deriveCatalogRelease(data), date)
    const api = service.listScholarships({ ...filters, limit: 100 })
    expect(web.total).toBeGreaterThan(0)
    expect(web.total).toBeLessThanOrEqual(100)
    expect(api.data.map(({ id }) => id).sort()).toEqual(web.items.map(({ scholarship }) => scholarship.id).sort())
  })

  it('never publishes older ranking evidence when its newest edition is overdue', () => {
    const data = fixture()
    data.universities[0]!.rankings = [rank('qs', 99, 99, 2025), { ...rank('qs', 50, 50, 2026), reviewAfter: '2026-09-28' }, rank('arwu', 99)]
    expect(currentUniversityRankings(data.universities[0]!, today).map(({ system }) => system)).toEqual(['arwu'])
    const service = new CatalogApiService(data, deriveCatalogRelease(data), today)
    expect(service.getInstitution('rank-school-0')!.data.rankings?.map(({ system }) => system)).toEqual(['arwu'])
    expect(service.getProgram('rank-program-0')!.data.university.rankings?.map(({ system }) => system)).toEqual(['arwu'])
  })

  it.each(['qs', 'the', 'usnews', 'arwu'] as const)('uses %s evidence consistently across catalogue and API filtering', async (system) => {
    const key = { qs: 'qsRankMax', the: 'theRankMax', usnews: 'usNewsRankMax', arwu: 'arwuRankMax' }[system]
    const data = fixture()
    data.universities[0]!.rankings = [rank(system, 99)]
    data.universities[1]!.rankings = [rank(system, 201, 250)]
    data.scholarships = data.scholarships.map((scholarship) => ({ ...scholarship, status: 'verified', verifiedAt: today, reviewAfter: '2026-10-29' }))
    const repository = createJsonCatalogRepository(() => data)
    const query = { [key]: '100' as const }
    expect((await repository.listInstitutions({ ...query, today })).items.map(({ institution }) => institution.id)).toEqual(['rank-school-0'])
    expect((await repository.listPrograms({ ...query, today })).items.map(({ program }) => program.id)).toEqual(['rank-program-0'])
    expect((await repository.listScholarships({ ...query, today })).items.map(({ scholarship }) => scholarship.id)).toEqual(['rank-award', 'program-award'])
    const service = new CatalogApiService(data, deriveCatalogRelease(data), today)
    expect(service.listInstitutions(query).data.map(({ id }) => id)).toEqual(['rank-school-0'])
    expect(service.listPrograms(query).data.map(({ id }) => id)).toEqual(['rank-program-0'])
    expect(service.listScholarships(query).data.map(({ id }) => id)).toEqual(['program-award', 'rank-award'])
  })

  it('binds pagination cursors to the selected rankings', async () => {
    const data = fixture()
    data.universities[1]!.rankings = [rank('qs', 99)]
    const repository = createJsonCatalogRepository(() => data)
    const page = await repository.listInstitutions({ qsRankMax: '100', limit: 1, today })
    expect(page.nextCursor).not.toBeNull()
    expect((await repository.listInstitutions({ qsRankMax: '100', limit: 1, today, cursor: page.nextCursor! })).items).toHaveLength(1)
    await expect(repository.listInstitutions({ qsRankMax: '500', limit: 1, today, cursor: page.nextCursor! })).rejects.toMatchObject({ code: 'INVALID_LIST_CURSOR' })
    const service = new CatalogApiService(data, deriveCatalogRelease(data), today)
    const apiPage = service.listInstitutions({ qsRankMax: '100', limit: 1 })
    expect(apiPage.meta.nextCursor).not.toBeNull()
    expect(() => service.listInstitutions({ qsRankMax: '500', limit: 1, cursor: apiPage.meta.nextCursor! })).toThrow('Invalid cursor')
  })

  it('rejects unrelated sources, reversed bands and duplicate editions', () => {
    const university = fixture().universities[0]!
    const officialSource = `${university.officialUrl.replace(/\/$/u, '')}/ranking`
    expect(universitySchema.safeParse({ ...university, rankings: [{ ...rank('usnews', 37), sourceUrl: officialSource }] }).success).toBe(true)
    expect(universitySchema.safeParse({ ...university, rankings: [{ ...rank('qs', 37), sourceUrl: 'https://unrelated.edu.cn/ranking' }] }).success).toBe(false)
    const departmentSource = { ...university, officialUrl: 'https://en.sjtu.edu.cn/', rankings: [{ ...rank('usnews', 37), sourceUrl: 'https://gfb.sjtu.edu.cn/ranking' }] }
    expect(universitySchema.safeParse(departmentSource).success).toBe(true)
    expect(universitySchema.safeParse({ ...university, rankings: [rank('qs', 250, 201)] }).success).toBe(false)
    expect(universitySchema.safeParse({ ...university, rankings: [rank('qs', 99), rank('qs', 99)] }).success).toBe(false)
    expect(universitySchema.safeParse({ ...university, rankings: [{ ...rank('qs', 99), sourceUrl: 'invalid-url' }] }).success).toBe(false)
  })

  it('explicitly rejects ranking filters on D1 releases without ranking support', async () => {
    const fetch = vi.fn()
    const repository = createD1CatalogRepository({ apiUrl: 'https://catalog.example.com', fetch })
    for (const method of [repository.listInstitutions.bind(repository), repository.listPrograms.bind(repository), repository.listScholarships.bind(repository)]) {
      await expect(method({ qsRankMax: '100' })).rejects.toMatchObject({ code: 'UNSUPPORTED_RANKING_FILTERS' })
    }
    expect(fetch).not.toHaveBeenCalled()
  })
})
