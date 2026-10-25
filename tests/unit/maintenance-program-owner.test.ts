import { describe, expect, it } from 'vitest'
import { parsePrograms } from '../../workers/catalog-maintenance/src/extraction'
import type { CapturedSnapshot } from '../../workers/catalog-maintenance/src/capture'
import type { SchoolRow, SourceRow } from '../../workers/catalog-maintenance/src/types'

const url = 'https://example.edu.cn/international/catalogue'
const row = { allowed_hosts_json: '["example.edu.cn"]' } as SourceRow
const snapshot = { sourceUrl: url, finalUrl: url, parserCandidates: [] } as unknown as CapturedSnapshot
const schools = [{ university_id: 'uni-source-owner' }] as SchoolRow[]
function candidate(name = 'Computer Science & Technology (Language Intelligence)') {
  const text = `${name} Bachelor degree programme for international students.`
  const program: Record<string, unknown> = { name: { en: name }, degreeLevel: 'bachelor', programType: 'degree', programUrl: url,
    evidence: { quote: text, locator: 'document' }, internationalEvidence: { quote: 'for international students', locator: 'document' },
    fieldEvidence: [{ fieldPath: 'name.en', quote: name, locator: 'document' }, { fieldPath: 'degreeLevel', quote: 'Bachelor degree', locator: 'document' }] }
  return { program, text }
}
const parse = (program: Record<string, unknown>, text: string, owners = schools) => parsePrograms({ programs: [program] }, text, owners, row, snapshot)

describe('programme owner metadata does not replace identity evidence', () => {
  it('binds an omitted universityId only to one authoritative source school without mutating the model output', () => {
    const { program, text } = candidate(), before = JSON.stringify(program)
    const values = parse(program, text)
    expect(values).toHaveLength(1)
    expect(values[0].universityId).toBe(schools[0].university_id)
    expect(values[0].name).toEqual(program.name)
    expect(JSON.stringify(program)).toBe(before)
  })
  it('does not fill an absent owner for zero, duplicate or multiple school mappings', () => {
    const { program, text } = candidate()
    for (const owners of [[], [...schools, ...schools], [...schools, { university_id: 'uni-other' } as SchoolRow]]) expect(parse(program, text, owners)).toEqual([])
    // One active canary must not hide the source's second authoritative owner.
    expect(parsePrograms({ programs: [program] }, text, schools, row, snapshot, 2)).toEqual([])
  })
  it('never repairs an explicit wrong, null, empty or undefined universityId', () => {
    for (const universityId of ['uni-other', null, '', undefined, 1]) {
      const { program, text } = candidate()
      expect(parse({ ...program, universityId }, text)).toEqual([])
    }
    const { program, text } = candidate()
    expect(parse({ ...program, universityId: schools[0].university_id }, text)).toHaveLength(1)
  })
  it('retains all strict quote, international, degree and captured-URL checks after metadata binding', () => {
    for (const change of ['evidence', 'international', 'degree', 'url'] as const) {
      const { program, text } = candidate()
      if (change === 'evidence') program.evidence = { quote: 'Unlocated words', locator: 'document' }
      if (change === 'international') program.internationalEvidence = { quote: 'Bachelor degree', locator: 'document' }
      if (change === 'degree') program.degreeLevel = 'master'
      if (change === 'url') program.programUrl = 'https://example.edu.cn/unfetched'
      expect(parse(program, text)).toEqual([])
    }
  })
  it('holds comma-joined catalogue cells instead of accepting or splitting them into programme identities', () => {
    for (const name of ['International Business, Accounting, Business Administration', 'Arabic, German, Russian, Italian, etc.',
      'English, Advanced Diplomatic Translation & Interpreting', 'English; French', 'English，French', 'English、French']) {
      const { program, text } = candidate(name)
      expect(parse(program, text)).toEqual([])
    }
  })
  it('retains conjunctions and parenthetical language qualifiers within a single official programme name', () => {
    for (const name of ['Computer Science & Technology (Language Intelligence)', 'Biochemistry and Molecular Biology',
      'Computer Science (Chinese, English)', 'Translation & Interpreting']) {
      const { program, text } = candidate(name)
      expect(parse(program, text)).toHaveLength(1)
    }
  })
})
