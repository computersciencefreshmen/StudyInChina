import { describe, expect, it } from 'vitest'
import { hasProgramInternationalScopeEvidence } from '../../workers/catalog-maintenance/src/program-international-scope'
import { parsePrograms } from '../../workers/catalog-maintenance/src/extraction'
import type { CapturedSnapshot } from '../../workers/catalog-maintenance/src/capture'
import type { SchoolRow, SourceRow } from '../../workers/catalog-maintenance/src/types'

describe('programme international admissions scope vocabulary', () => {
  it.each([
    'Applicants must be non-Chinese citizens with a valid passport.',
    'Students apply this program must be N on-Chinese citizens with a valid passport.',
    'Applicants must have non-Chinese citizenship.',
    'Applicants must be non–Chinese nationals.',
    'Applicants must not hold Chinese citizenship.',
    'Applicants must not be Chinese citizens.',
    'Applicants without Chinese nationality may apply.',
    'This programme is open to international students.',
    'Foreign applicants may apply for this degree.',
    '招收来华留学生。',
  ])('recognizes an explicit audience in %s', quote => {
    expect(hasProgramInternationalScopeEvidence(quote)).toBe(true)
  })

  it.each([
    'Applicants must be Chinese citizens.',
    'Applicants must hold Chinese citizenship.',
    'Applicants need non-Chinese-language proficiency.',
    'A non-Chinese language is required.',
    'An international internship is included in the degree.',
    'International cooperation and foreign language courses are available.',
    '项目提供国际实习和外语课程。',
    'Master Programs',
  ])('does not infer an admissions audience from %s', quote => {
    expect(hasProgramInternationalScopeEvidence(quote)).toBe(false)
  })

  it('accepts the exact located nationality quote without changing it, and rejects an unlocated replacement', () => {
    const url = 'https://example.edu.cn/programme'
    const quote = 'Students apply this program must be N on-Chinese citizens with a valid passport.'
    const text = `Bachelor in Economics. ${quote}`
    const schools = [{ university_id: 'uni-example' }] as SchoolRow[]
    const source = { allowed_hosts_json: '["example.edu.cn"]' } as SourceRow
    const snapshot = { sourceUrl: url, finalUrl: url, parserCandidates: [] } as unknown as CapturedSnapshot
    const program = { name: { en: 'Bachelor in Economics' }, degreeLevel: 'bachelor', programType: 'degree', programUrl: url,
      evidence: { quote: 'Bachelor in Economics', locator: 'document' }, internationalEvidence: { quote, locator: 'document' },
      fieldEvidence: [{ fieldPath: 'name.en', quote: 'Bachelor in Economics', locator: 'document' },
        { fieldPath: 'degreeLevel', quote: 'Bachelor in Economics', locator: 'document' }] }
    const parsed = parsePrograms({ programs: [program] }, text, schools, source, snapshot)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].internationalEvidence.quote).toBe(quote)
    program.internationalEvidence.quote = 'Applicants must be non-Chinese citizens.'
    expect(parsePrograms({ programs: [program] }, text, schools, source, snapshot)).toEqual([])
  })
})
