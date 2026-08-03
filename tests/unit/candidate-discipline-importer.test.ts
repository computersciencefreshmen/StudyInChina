import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { classifyCandidateDiscipline } = require(
  '../../scripts/ingestion/classify-candidate-discipline.cjs',
) as {
  classifyCandidateDiscipline: (candidate: {
    name: Partial<Record<'en' | 'zh' | 'ru', string>>
  }) => string
}

describe('international coverage candidate discipline importer', () => {
  it('does not treat Chinese as a teaching-language adjective for Computer Science', () => {
    expect(classifyCandidateDiscipline({
      name: {
        en: 'Computer Science and Technology (Chinese-English bilingual)',
        zh: '计算机科学与技术（中英双语）',
      },
    })).toBe('engineering')
  })

  it.each([
    'International Chinese Language Education',
    'Teaching Chinese to Speakers of Other Languages',
    'Chinese Language and Literature',
    'MTCSOL',
    'Business Chinese',
    'Chinese for Business',
    'Chinese Language + Cross-border E-commerce',
  ])('recognizes the explicit Chinese-study title %s', (en) => {
    expect(classifyCandidateDiscipline({ name: { en } })).toBe('chinese-education')
  })

  it('does not classify a standalone Chinese adjective as Chinese-language study', () => {
    expect(classifyCandidateDiscipline({
      name: { en: 'Chinese-English Bilingual Computer Science' },
    })).toBe('engineering')
  })
})
