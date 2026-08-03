import { createRequire } from 'node:module'

import { expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { classifyCandidateDiscipline } = require(
  '../../scripts/ingestion/classify-candidate-discipline.cjs',
) as {
  classifyCandidateDiscipline: (candidate: {
    name: Partial<Record<'en' | 'zh' | 'ru', string>>
  }) => string
}

it('keeps Chinese-taught Computer Science in engineering', () => {
  expect(classifyCandidateDiscipline({
    name: {
      en: 'Computer Science and Technology (Chinese-taught Bachelor)',
      zh: '计算机科学与技术（中文授课本科）',
    },
  })).toBe('engineering')
})
