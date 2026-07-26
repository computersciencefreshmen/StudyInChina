import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DOUBLE_FIRST_CLASS_EXPECTED_COUNT,
  parseOfficialDoubleFirstClassText,
  validateDoubleFirstClassRegistry,
} from '../../scripts/ingestion/double-first-class-registry'

const registryPath = join(
  process.cwd(),
  'content',
  'source-manifests',
  'double-first-class',
  'targets.v1.json',
)

function registry() {
  return validateDoubleFirstClassRegistry(
    JSON.parse(readFileSync(registryPath, 'utf8')) as unknown,
  )
}

describe('official Double First-Class institution target registry', () => {
  it('locks the official 147-institution cohort and its source digest', () => {
    const value = registry()

    expect(value.targets).toHaveLength(DOUBLE_FIRST_CLASS_EXPECTED_COUNT)
    expect(value.targets[0]).toMatchObject({
      targetId: 'dfc-2022-001',
      officialNameZh: '\u5317\u4eac\u5927\u5b66',
      catalogInstitutionId: 'uni-peking-university',
    })
    expect(value.targets.at(-1)).toMatchObject({
      targetId: 'dfc-2022-147',
      officialNameZh: '\u7a7a\u519b\u519b\u533b\u5927\u5b66',
    })
    expect(value.officialSource.contentSha256).toBe(
      '305f73ed08c091984a75e3c29289c166fbaf6778b87fb9802afa176104c1f7ac',
    )
    expect(value.targets.filter((target) => target.catalogInstitutionId)).toHaveLength(35)
  })

  it('round-trips all official names through the PDF text parser', () => {
    const value = registry()
    const extractedText = value.targets
      .map((target) => `  ${target.officialNameZh}\uFF1A sample discipline`)
      .join('\n')

    expect(parseOfficialDoubleFirstClassText(extractedText)).toEqual(
      value.targets.map((target) => target.officialNameZh),
    )
  })

  it('keeps every reused catalog identity aligned with its Chinese official name', () => {
    const value = registry()
    const universities = JSON.parse(
      readFileSync(join(process.cwd(), 'content', 'data', 'universities.json'), 'utf8'),
    ) as Array<{ id: string; name: { zh?: string } }>
    const namesById = new Map(universities.map((university) => [university.id, university.name.zh]))

    for (const target of value.targets) {
      if (!target.catalogInstitutionId) continue
      expect(namesById.get(target.catalogInstitutionId)).toBe(target.officialNameZh)
    }
  })
})
