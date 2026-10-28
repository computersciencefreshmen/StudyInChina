import { describe, expect, it } from 'vitest'
import { hasProgramInternationalScopeEvidence } from '../../workers/catalog-maintenance/src/program-international-scope'

describe('official programme admissions audience vocabulary', () => {
  it.each([
    "Applicants shall be a Non-Chinese citizen who abide by the laws of the People's Republic of China, have no criminal record, and demonstrate good personal integrity.",
    'Applicants must be non Chinese citizens with a valid passport.',
    'Applicants must be N on-Chinese citizens with valid ordinary passports.',
    'Applicants must be of Non-Chinesenationality and hold a valid passport.',
    'Applicants must be without Chinese citizenship.',
    'Applicants must not hold Chinese nationality.',
    '申请人须为非中国籍公民，持有效外国护照。',
    '申请对象：非中国籍人士。',
    '持有效护照的非中国国籍公民。',
    '申请对象：非 中 国 籍 公民。',
    'International students may apply to this master programme.',
  ])('recognizes an explicit foreign-student audience without changing the stored quote: %s', quote => {
    expect(hasProgramInternationalScopeEvidence(quote)).toBe(true)
  })
  it.each([
    'Only Chinese citizens may apply to this programme.',
    '本项目仅限中国籍公民申请。',
    'The programme includes international internships.',
    'The university encourages international cooperation.',
    'The course teaches a foreign language.',
    'The programme uses a non-Chinese language of instruction.',
    'Chinese speakers may study in this course.',
    '项目包含国际实习、国际合作和外语课程。',
  ])('does not mistake domestic eligibility or language/activity descriptions for international admissions: %s', quote => {
    expect(hasProgramInternationalScopeEvidence(quote)).toBe(false)
  })
})
