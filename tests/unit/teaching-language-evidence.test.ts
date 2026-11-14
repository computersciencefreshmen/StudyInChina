import { describe, expect, it } from 'vitest'
import { teachingLanguageEvidenceIsSpecific as supports } from '../../src/lib/data/teaching-language-evidence'
import { parseFieldExtraction } from '../../workers/catalog-maintenance/src/field-updates'
import type { MaintenanceRecordTarget } from '../../scripts/maintenance/field-contracts'

const identity = { name: { en: 'Computer Science and Technology', zh: '计算机科学与技术' }, degreeLevel: 'bachelor' }
const target: MaintenanceRecordTarget = { recordId: 'programme', universityId: 'university', entityType: 'program', identity, year: null, intake: null, fields: {}, sourceIds: ['source'], recordScopeSha256: 'a'.repeat(64), reviewAfter: '2026-11-14' }
const oldTitle = 'Divisions (Chinese and English Programs)'
const oldApplicability = 'Computer Science Department of Computer Science and Technology Computer Science and Technology Physics'
describe('specific teaching-language evidence shared by extraction and import', () => {
  it.each([
    ['Computer Science and Technology is taught in Chinese and English.', ['Chinese', 'English']],
    ['The Computer Science and Technology programme is taught in English.', ['English']],
    ['Computer Science and Technology — Language of instruction: English.', ['English']],
    ['计算机科学与技术专业授课语言为中文和英文。', ['Chinese', 'English']],
    ['All undergraduate programmes listed here, including Computer Science and Technology, are taught in English.', ['English']],
  ])('accepts an explicit assignment with proved named/group membership: %s', (quote, value) => expect(supports(identity, value, quote as string)).toBe(true))
  it.each([
    oldTitle,
    `${oldTitle}\n${oldApplicability}`,
    'Computer Science and Technology. Physics is taught in Chinese and English.',
    'Computer Science and Technology and Physics. Languages of instruction: Chinese and English.',
    'Physics, unlike Computer Science and Technology, is taught in Chinese and English.',
    'Divisions of Computer Science and Technology (Chinese and English Programs)',
    'All programmes are taught in Chinese and English.',
    'Computer Science and Technology may be taught in Chinese and English.',
    'Computer Science and Technology is not taught in Chinese and English.',
    'It is untrue that Computer Science and Technology is taught in Chinese and English.',
    'All master programmes listed here, including Computer Science and Technology, are taught in Chinese and English.',
    'Computer Science and Technology is taught in Chinese and English depending on the programme.',
    'Computer Science and Technology is taught in Chinese and English? No.',
    'Computer Science and Technology is taught in Chinese and English？No.',
    'Computer Science and Technology is taught in Chinese and English. No.',
    'Computer Science and Technology is taught in Chinese and English',
  ])('holds mixed headings, cross-programme, ambiguous, negated or wrong-degree evidence: %s', quote => expect(supports(identity, ['Chinese', 'English'], quote)).toBe(false))
  it('does not borrow a language from the programme name or silently omit a stated instruction language', () => {
    expect(supports({ name: { en: 'Chinese Studies' } }, ['Chinese', 'English'], 'Chinese Studies is taught in English.')).toBe(false)
    expect(supports(identity, ['English'], 'Computer Science and Technology is taught in Chinese and English.')).toBe(false)
  })
  it('rejects the actual bad leaf even when a separate applicability quote names the programme', () => {
    const value = { recordId: target.recordId, year: null, intake: null, scopeQuote: null, applicabilityQuote: oldApplicability,
      patches: [{ fieldPath: 'teachingLanguages', value: ['Chinese', 'English'], factStatus: 'known', quote: oldTitle }] }
    expect(parseFieldExtraction({ records: [value] }, `${oldTitle}\n${oldApplicability}`, [target]).size).toBe(0)
    const question = 'Computer Science and Technology is taught in Chinese and English? No.'
    expect(parseFieldExtraction({ records: [{ ...value, applicabilityQuote: question, patches: [{ ...value.patches[0], quote: question }] }] }, question, [target]).size).toBe(0)
    const quote = 'Computer Science and Technology is taught in Chinese and English.'
    expect(parseFieldExtraction({ records: [{ ...value, applicabilityQuote: quote, patches: [{ ...value.patches[0], quote }] }] }, quote, [target]).get(target.recordId)?.patches).toHaveLength(1)
  })
})
