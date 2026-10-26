import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { retainProvenLocalizedNames } from '../../workers/catalog-maintenance/src/official-names'
import { parsePrograms } from '../../workers/catalog-maintenance/src/extraction'
import type { CapturedSnapshot } from '../../workers/catalog-maintenance/src/capture'
import type { SchoolRow, SourceRow } from '../../workers/catalog-maintenance/src/types'

const sourceUrl = 'https://example.edu.cn/international/programs'
const source = { allowed_hosts_json: '["example.edu.cn"]' } as SourceRow
const school = { university_id: 'uni-example' } as SchoolRow
const snapshot = { sourceUrl, finalUrl: sourceUrl, parserCandidates: [] } as unknown as CapturedSnapshot
const title = 'International Computing Master Program'
const text = `${title} is open to international students. Example University also offers 语言学硕士项目.`
const evidence = (fieldPath: string, quote: string) => ({ fieldPath, quote, locator: 'document' })
function program() {
  return { universityId: school.university_id, name: { en: title } as { en?: string; zh?: string },
    degreeLevel: 'master', programType: 'degree', programUrl: sourceUrl,
    evidence: { quote: title, locator: 'document' },
    internationalEvidence: { quote: 'open to international students', locator: 'document' },
    fieldEvidence: [evidence('name.en', title), evidence('degreeLevel', 'Master Program')] }
}

describe('official names preserve independently proven locales', () => {
  it('retains the official English name and discards an invented translation and its evidence', () => {
    const value = program()
    value.name.zh = '国际计算机硕士项目'
    value.fieldEvidence.push(evidence('name.zh', title))
    const parsed = parsePrograms({ programs: [value] }, text, [school], source, snapshot)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].name).toEqual({ en: title })
    expect(parsed[0].fieldEvidence.map(field => field.fieldPath)).toEqual(['name.en', 'degreeLevel'])
  })

  it('retains a proven Chinese name when the English name is invented', () => {
    const value = program()
    value.name = { en: 'Invented Master Program', zh: '语言学硕士项目' }
    value.fieldEvidence.push(evidence('name.zh', '语言学硕士项目'))
    expect(parsePrograms({ programs: [value] }, text, [school], source, snapshot)[0].name)
      .toEqual({ zh: '语言学硕士项目' })
  })

  it('rejects wrong-script copies, untranslated foreign script and unsupported locale evidence', () => {
    const fields = [evidence('name.en', title), evidence('name.zh', title), evidence('name.ru', 'Стипендия')]
    expect(retainProvenLocalizedNames({ en: title, zh: title, ru: 'Стипендия' }, fields))
      .toEqual({ name: { en: title }, fieldEvidence: [fields[0]] })
    expect(retainProvenLocalizedNames({ en: 'Стипендия', zh: title }, fields).name).toEqual({})
  })

  it('does not fix punctuation, invent names from quotes, or accept unlocated evidence', () => {
    const value = program()
    value.name.en = 'International Computing-Master Program'
    expect(parsePrograms({ programs: [value] }, text, [school], source, snapshot)).toEqual([])
    value.name.en = title
    value.fieldEvidence[0].quote = `Unlocated words: ${title}`
    expect(parsePrograms({ programs: [value] }, text, [school], source, snapshot)).toEqual([])
  })

  it('still requires degree, international scope and a captured official URL', () => {
    for (const kind of ['degree', 'international', 'url']) {
      const value = program()
      if (kind === 'degree') value.fieldEvidence = value.fieldEvidence.filter(field => field.fieldPath !== 'degreeLevel')
      if (kind === 'international') value.internationalEvidence.quote = 'Example University'
      if (kind === 'url') value.programUrl = 'https://example.edu.cn/other'
      expect(parsePrograms({ programs: [value] }, text, [school], source, snapshot)).toEqual([])
    }
  })

  it('retains actual bilingual official names and normalizes whitespace only for proof matching', () => {
    const fields = [evidence('name.en', 'Example   Scholarship'), evidence('name.zh', '示例奖学金')]
    expect(retainProvenLocalizedNames({ en: 'Example Scholarship', zh: '示例奖学金' }, fields).name)
      .toEqual({ en: 'Example Scholarship', zh: '示例奖学金' })
  })

  it('versions only candidate IDs while preserving the paid program prompt and reservation formula', () => {
    const code = readFileSync('workers/catalog-maintenance/src/extraction.ts', 'utf8')
    const instructions = /instructions:'([^']+)'/u.exec(code)?.[1]
    expect(createHash('sha256').update(instructions!).digest('hex')).toBe('e8df585e506eef0733523d35f918ba93d875199eeca5e5fea94c1ef1d5fc1242')
    expect(code).toContain('identity-v1:${row.source_id}:${await digest(payload)}:${pass}')
    expect(code).toContain('${canonical(identityCore(program))}:parser-v2')
  })
})
