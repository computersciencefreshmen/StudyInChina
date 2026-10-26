import { describe, expect, it } from 'vitest'
import { parsePrograms } from '../../workers/catalog-maintenance/src/extraction'
import type { CapturedSnapshot } from '../../workers/catalog-maintenance/src/capture'
import type { SchoolRow, SourceRow } from '../../workers/catalog-maintenance/src/types'

const url = 'https://example.edu.cn/catalogue.pdf'
const text = 'International students: Comparative Education 比较教育学 Master English track. Comparative Education 比较教育学 Master Chinese track. Comparative Education 比较教育学 Ph.D. Codes C1 C2. Departments D1 D2.'
const source = { allowed_hosts_json: '["example.edu.cn"]' } as SourceRow
const schools = [{ university_id: 'uni-example' }] as SchoolRow[]
const snapshot = { sourceUrl: url, finalUrl: url, parserCandidates: [] } as unknown as CapturedSnapshot
function program(track: 'English' | 'Chinese' = 'English') {
  return { name: { en: 'Comparative Education' } as { en?: string; zh?: string }, universityId: schools[0].university_id,
    degreeLevel: 'master', programType: 'degree', programUrl: url,
    evidence: { quote: `Comparative Education 比较教育学 Master ${track} track.`, locator: 'document' },
    internationalEvidence: { quote: 'International students', locator: 'document' },
    fieldEvidence: [{ fieldPath: 'name.en', quote: 'Comparative Education', locator: 'document' },
      { fieldPath: 'degreeLevel', quote: 'Master', locator: 'document' }] }
}
const parse = (programs: unknown[]) => parsePrograms({ programs }, text, schools, source, snapshot)

describe('exact validated programme identity deduplication', () => {
  it('collapses duplicate teaching-language rows and preserves the first valid evidence without mutating inputs', () => {
    const first = program(), second = program('Chinese'), before = JSON.stringify([first, second])
    const result = parse([first, second])
    expect(result).toHaveLength(1)
    expect(result[0].evidence.quote).toBe(first.evidence.quote)
    expect(JSON.stringify([first, second])).toBe(before)
  })

  it('does not let an unlocated earlier record consume the identity before the valid row is checked', () => {
    const invalid = program(); invalid.evidence.quote = 'An invented English track row'
    const valid = program('Chinese'), result = parse([invalid, valid])
    expect(result).toHaveLength(1)
    expect(result[0].evidence.quote).toBe(valid.evidence.quote)
  })

  it('keeps the same official name at master and doctoral levels as two identities', () => {
    const master = program(), doctorate = program()
    doctorate.degreeLevel = 'doctorate'; doctorate.evidence.quote = 'Comparative Education 比较教育学 Ph.D.'
    doctorate.fieldEvidence[1].quote = 'Ph.D.'
    expect(parse([master, doctorate]).map(row => row.degreeLevel)).toEqual(['master', 'doctorate'])
  })

  it('keeps different programme types and proven locale sets distinct', () => {
    const degree = program(), visiting = { ...program(), programType: 'visiting' }
    expect(parse([degree, visiting])).toHaveLength(2)
    const bilingual = program(); bilingual.name.zh = '比较教育学'
    bilingual.fieldEvidence.push({ fieldPath: 'name.zh', quote: '比较教育学', locator: 'document' })
    expect(parse([degree, bilingual])).toHaveLength(2)
  })

  it.each(['officialProgramCode', 'departmentCode'])('keeps independently proven %s values distinct', fieldPath => {
    const values = fieldPath === 'officialProgramCode' ? ['C1', 'C2'] : ['D1', 'D2']
    const records = values.map(value => {
      const row = program()
      row.fieldEvidence.push({ fieldPath, quote: value, locator: 'document' })
      return { ...row, [fieldPath]: value }
    })
    expect(parse(records)).toHaveLength(2)
  })
})
