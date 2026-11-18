import { describe, expect, it } from 'vitest'
import type { DataBundle, Program, Scholarship, University } from '@/lib/data/types'
import type { ThirdPartyProgram } from '@/lib/third-party-programs'
import { combineProgramRecords, countUnifiedUniversityPrograms, queryUnifiedProgramData, unifiedProgramSlug } from '@/lib/unified-programs'
import { parseProgramCatalogFilters, programCatalogHref } from '@/lib/program-catalog'

const today = '2026-11-17'
const audit = { status: 'verified' as const, verifiedAt: '2026-11-16', reviewAfter: '2027-11-17', sourceIds: ['official-source'] }
const university: University = { ...audit, id: 'alpha', slug: 'alpha-university', name: { en: 'Alpha University' }, cityId: 'city', region: null, officialUrl: 'https://alpha.edu.cn', admissionsUrl: null, summary: null, featured: false }
const reviewed: Program = { ...audit, id: 'core-computing', slug: 'core-computing', universityId: university.id, name: { en: 'Computer Science' }, degreeLevel: 'bachelor', discipline: 'engineering', teachingLanguages: ['English'], durationMonths: 48, programUrl: 'https://alpha.edu.cn/computing', applyUrl: null, languageRequirements: [] }
const data: DataBundle = { universities: [university], programs: [reviewed], admissionCycles: [], scholarships: [], cities: [], sources: [] }
function captured(id: string, name: string, overrides: Partial<ThirdPartyProgram> = {}): ThirdPartyProgram {
  return { id, sourceId: id, schoolId: 'cucas-alpha', schoolName: 'Alpha University', provider: 'CUCAS', name, sourceUrl: `https://alpha.cucas.cn/${id}`, fetchedAt: '2026-11-17T00:00:00Z', status: 'extracted', official: false, admissionYear: null, fields: { degree: 'Bachelor', language: 'English', tuition: '4000 CNY / course' }, ...overrides }
}
const filters = (values: Record<string, string> = {}) => parseProgramCatalogFilters(values)

describe('one program catalogue', () => {
  it('searches the bound bilingual school name, quarantines test identities, and counts unknown budget evidence separately', () => {
    const bilingual = { ...data, universities: [{ ...university, name: { en: 'Alpha University', zh: '阿尔法大学' } }] }
    const rows = [captured('cucas-1', 'History'), captured('sicas-27165', 'Renamed'), captured('sicas-2', 'TEST 21')]
    const zh = queryUnifiedProgramData(bilingual, rows, filters({ q: '阿尔法大学' }), today, 'rev')
    const en = queryUnifiedProgramData(bilingual, rows, filters({ q: 'Alpha University' }), today, 'rev')
    expect(zh.items.map(unifiedProgramSlug)).toEqual(en.items.map(unifiedProgramSlug))
    expect(zh.total).toBe(2)
    const budget = queryUnifiedProgramData(bilingual, rows, filters({ tuition: 'under-20000' }), today, 'rev')
    expect(budget.sourceConditionsUnknown).toBe(1)
  })
  it('counts canonical captured and reviewed offerings together without URL-only placeholders or duplicate source aliases', () => {
    const emptyUniversity = { ...university, id: 'empty', slug: 'empty-university', name: { en: 'Empty University' } }
    const scopedData = { ...data, universities: [university, emptyUniversity] }
    const fields = { degree: 'Bachelor', language: 'English', duration: '4 Years', tuition: 'CNY 20000', startDate: '2027-09-01', deadline: '2027-07-01' }
    const records = [captured('first', 'Medicine', { fields }), captured('duplicate', 'Medicine', { fields }),
      captured('link-only', 'Not captured', { status: 'link_only', fields: {} }),
      captured('unmatched', 'Another programme', { schoolName: 'Alpha Medical University' })]
    const counts = countUnifiedUniversityPrograms(scopedData, records, today)
    expect(counts.get(university.id)).toBe(2)
    expect(counts.get(emptyUniversity.id)).toBe(0)
    expect(counts.get(university.id)).toBe(queryUnifiedProgramData(scopedData, records, filters({ institution: university.slug }), today, 'snapshot-one').total)
  })

  it('binds unique English punctuation variants and Chinese names to the same university across counts and institution filters', () => {
    const xian = { ...university, id: 'xian', slug: 'xian-university', name: { en: "Xi'an University", zh: '西安大学' } }
    const scopedData = { ...data, universities: [xian], programs: [{ ...reviewed, universityId: xian.id }] }
    const records = [captured('xian-en', 'Medicine', { schoolId: 'source-xian', schoolName: 'Xian University' }),
      captured('xian-zh', 'Economics', { schoolId: 'source-xian-zh', schoolName: '西安大学' })]
    expect(countUnifiedUniversityPrograms(scopedData, records, today).get(xian.id)).toBe(3)
    for (const institution of [xian.id, xian.slug, 'source-xian', 'source-xian-zh']) {
      expect(queryUnifiedProgramData(scopedData, records, filters({ institution }), today, 'snapshot-one').total).toBe(3)
    }
    expect(combineProgramRecords(scopedData, records, today).items.every(item => item.university?.id === xian.id)).toBe(true)
  })

  it('does not assign an ambiguous compact school name to the first university or conflate Medical and general universities', () => {
    const first = { ...university, id: 'first', slug: 'first', name: { en: 'AB University', zh: '甲大学' } }
    const second = { ...university, id: 'second', slug: 'second', name: { en: 'A B University', zh: '乙大学' } }
    const scopedData = { ...data, universities: [first, second], programs: [] }
    const records = [captured('ambiguous', 'Medicine', { schoolName: 'A-B University' })]
    expect(combineProgramRecords(scopedData, records, today).items[0].university).toBeUndefined()
    expect([...countUnifiedUniversityPrograms(scopedData, records, today).values()]).toEqual([0, 0])
    for (const institution of [first.id, first.slug, second.id, second.slug]) {
      expect(queryUnifiedProgramData(scopedData, records, filters({ institution }), today, 'snapshot-one').total).toBe(0)
    }
    expect(countUnifiedUniversityPrograms(data, [captured('medical', 'Medicine', { schoolName: 'Alpha Medical University' })], today).get(university.id)).toBe(1)
  })

  it('deduplicates proven same offerings across unique known English and Chinese school names once', () => {
    const scopedData = { ...data, universities: [{ ...university, name: { ...university.name, zh: '阿尔法大学' } }] }
    const fields = { degree: 'Bachelor', language: 'English', duration: '4 Years', tuition: 'CNY 20000', startDate: '2027-09-01', deadline: '2027-07-01' }
    const records = [captured('same-en', 'Medicine', { fields }), captured('same-zh', 'Medicine', { schoolName: '阿尔法大学', fields })]
    expect(countUnifiedUniversityPrograms(scopedData, records, today).get(university.id)).toBe(2)
    expect(queryUnifiedProgramData(scopedData, records, filters({ institution: university.slug }), today, 'snapshot-one').total).toBe(2)
  })

  it('combines captured records before a single bounded pagination and visits every record once', () => {
    const records = Array.from({ length: 55 }, (_, i) => captured(`cucas-${i}`, `Program ${i}`))
    const first = queryUnifiedProgramData(data, records, filters(), today, 'snapshot-one')
    expect(first.total).toBe(records.length + data.programs.length)
    expect(first.pageSize).toBe(24)
    const pages = Array.from({ length: first.pageCount }, (_, i) => queryUnifiedProgramData(data, records, filters({ page: String(i + 1) }), today, 'snapshot-one'))
    const ids = pages.flatMap(page => page.items.map(unifiedProgramSlug))
    expect(ids).toHaveLength(first.total)
    expect(new Set(ids).size).toBe(first.total)
    expect(pages.every(page => page.items.length <= 24)).toBe(true)
  })

  it('preserves reviewed facts and a separate source offering when comparable offering dimensions are unknown', () => {
    const duplicate = captured('cucas-exact', 'Computer Science', { schoolName: 'ＡＬＰＨＡ -- University' })
    const combined = combineProgramRecords(data, [duplicate], today)
    expect(combined.items).toHaveLength(2)
    expect(combined.aliases.get(duplicate.id)).toBe(duplicate.id)
    const item = combined.items[0]
    expect('program' in item && item.program).toBe(reviewed)
    expect(combined.items[1].sources?.[0].sourceUrl).toBe(duplicate.sourceUrl)
    expect(reviewed).not.toHaveProperty('tuition')
    expect(queryUnifiedProgramData(data, [duplicate], filters({ institution: duplicate.schoolId }), today, 'snapshot-one').items.map(unifiedProgramSlug)).toEqual([reviewed.slug, duplicate.id])
  })

  it('combines two source references only when every offering dimension is explicitly known and identical', () => {
    const fields = { degree: 'Bachelor', language: 'English', duration: '4 Years', tuition: '20000 CNY / year', startDate: '2027-09-01', deadline: '2027-07-01' }
    const records = [captured('cucas-one', 'Medicine', { fields }), captured('cucas-two', 'Medicine', { fields })]
    const combined = combineProgramRecords(data, records, today)
    expect(combined.items).toHaveLength(2)
    expect(combined.aliases.get('cucas-two')).toBe('cucas-one')
    expect(combined.items[1].sources).toHaveLength(2)
  })

  it.each([
    ['XUT', 'cucas-72377', 'cucas-72378', 'Language Training', '1 Semester', 'RMB 5000', '1 Year', 'RMB 10000'],
    ['Shanghai Business', 'cucas-90007', 'cucas-90008', 'Chinese', '1 Semester', 'RMB 10300', '1 Year', 'RMB 20600'],
  ])('keeps the different %s course offerings and their original source details independently routable', (school, firstID, secondID, name, firstDuration, firstTuition, secondDuration, secondTuition) => {
    const records = [
      captured(firstID, name, { schoolName: school, fields: { degree: 'Non-Degree', language: 'Chinese', duration: firstDuration, tuition: firstTuition } }),
      captured(secondID, name, { schoolName: school, fields: { degree: 'Non-Degree', language: 'Chinese', duration: secondDuration, tuition: secondTuition } }),
    ]
    const combined = combineProgramRecords(data, records, today)
    expect(combined.items).toHaveLength(data.programs.length + records.length)
    expect(combined.aliases.get(firstID)).toBe(firstID)
    expect(combined.aliases.get(secondID)).toBe(secondID)
    const second = combined.items.find(item => unifiedProgramSlug(item) === secondID)
    expect(second).toMatchObject({ collected: { fields: { duration: secondDuration, tuition: secondTuition } } })
  })

  it('keeps an unannounced batch distinct even when known duration and fees happen to match', () => {
    const fields = { degree: 'Non-Degree', language: 'Chinese', duration: '1 Year', tuition: 'RMB 10000' }
    expect(combineProgramRecords(data, [captured('first-batch', 'Chinese', { fields }), captured('unknown-batch', 'Chinese', { fields })], today).items).toHaveLength(3)
  })

  it('does not treat matching month/day strings without a year as a known academic batch', () => {
    const fields = { degree: 'Non-Degree', language: 'Chinese', duration: '1 Year', tuition: 'RMB 10000', startDate: 'September 1', deadline: 'July 1' }
    expect(combineProgramRecords(data, [captured('first-year', 'Chinese', { fields }), captured('another-year', 'Chinese', { fields })], today).items).toHaveLength(3)
  })

  it('keeps different institutions, degrees and unknown language identities distinct and excludes URL-only discoveries', () => {
    const records = [captured('different-school', 'Computer Science', { schoolName: 'Alpha Medical University' }), captured('different-degree', 'Computer Science', { fields: { degree: 'Master', language: 'English' } }), captured('unknown-language', 'Computer Science', { fields: { degree: 'Bachelor' } }), captured('link-only', 'Unknown', { status: 'link_only', fields: {} })]
    expect(combineProgramRecords(data, records, today).items).toHaveLength(4)
  })

  it('applies common search/degree/language/institution filters without claiming current dates or annual fee units', () => {
    const records = [captured('cucas-business', 'Business Administration'), captured('cucas-masters', 'Advanced Business', { fields: { degree: 'Master', language: 'Chinese' } })]
    const result = queryUnifiedProgramData(data, records, filters({ q: 'Business', degree: 'bachelor', language: 'English', institution: university.slug }), today, 'snapshot-one')
    expect(result.items.map(unifiedProgramSlug)).toEqual(['cucas-business'])
    expect(queryUnifiedProgramData(data, records, filters({ applicationState: 'open' }), today, 'snapshot-one').items.some(item => 'collected' in item)).toBe(false)
    expect(queryUnifiedProgramData(data, records, filters({ tuition: 'under-20000' }), today, 'snapshot-one').items.some(item => 'collected' in item)).toBe(false)
    expect(result.items[0]).toMatchObject({ collected: { official: false, fields: { tuition: '4000 CNY / course' } } })
  })

  it('restricts linked scholarship results to current verified funding with actual program scope, including an empty result when none qualify', () => {
    const records = [captured('collected-also-at-alpha', 'Medicine')]
    const linked = filters({ scholarship: 'linked' })
    expect(queryUnifiedProgramData(data, records, linked, today, 'snapshot-one').items).toEqual([])
    const scholarship: Scholarship = { ...audit, id: 'funding', slug: 'funding', name: { en: 'Program funding' }, providerType: 'university', universityIds: [university.id], programIds: [reviewed.id], coverage: { tuition: 'full', accommodation: 'none', insurance: false, stipendCnyPerMonth: null }, deadline: '2027-06-01', applicationUrl: 'https://alpha.edu.cn/funding', summary: null }
    const scopedData = { ...data, programs: [reviewed, { ...reviewed, id: 'outside-scope', slug: 'outside-scope', name: { en: 'Another program' } }], scholarships: [scholarship] }
    expect(queryUnifiedProgramData(scopedData, records, linked, today, 'snapshot-one').items.map(unifiedProgramSlug)).toEqual([reviewed.slug])
    expect(queryUnifiedProgramData({ ...scopedData, scholarships: [{ ...scholarship, reviewAfter: '2026-01-01' }] }, records, linked, today, 'snapshot-one').items).toEqual([])
  })

  it('does not infer a city or ranking relationship for an unmatched collected school', () => {
    const records = [captured('unmatched-school', 'Medicine', { schoolName: 'Alpha Medical University' })]
    const scopedData: DataBundle = { ...data, cities: [{ ...audit, id: 'city', slug: 'alpha-city', name: { en: 'Alpha City' }, province: null, region: null, coordinates: null, overview: null, climate: null, foodHighlights: [], sights: [] }] }
    expect(queryUnifiedProgramData(scopedData, records, filters({ city: 'alpha-city' }), today, 'snapshot-one').items.map(unifiedProgramSlug)).toEqual([reviewed.slug])
    expect(queryUnifiedProgramData(scopedData, records, filters({ qsRankMax: '100' }), today, 'snapshot-one').items).toEqual([])
  })

  it('resets old cursors or changed snapshot revisions and uses normal Programs links for both page directions', () => {
    const records = Array.from({ length: 55 }, (_, i) => captured(`cucas-${i}`, `Program ${i}`))
    expect(queryUnifiedProgramData(data, records, filters({ page: '2', cursor: 'old-core-cursor' }), today, 'snapshot-one').page).toBe(1)
    expect(queryUnifiedProgramData(data, records, filters({ page: '2', revision: 'snapshot-old' }), today, 'snapshot-one').page).toBe(1)
    const second = queryUnifiedProgramData(data, records, filters({ page: '2', revision: 'snapshot-one' }), today, 'snapshot-one')
    expect(second.page).toBe(2)
    const previous = new URL(programCatalogHref('en', second.filters, 1), 'https://example.test')
    expect(previous.pathname).toBe('/en/programs')
    expect(previous.searchParams.has('cursor')).toBe(false)
    expect(previous.searchParams.get('revision')).toBe('snapshot-one')
  })
})
