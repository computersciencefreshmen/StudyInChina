import { describe, expect, it } from 'vitest'
import sources from '../../content/data/sources.json'
import cities from '../../content/data/cities.json'
import universities from '../../content/data/universities.json'
import programs from '../../content/data/programs.json'
import admissionCycles from '../../content/data/admission-cycles.json'
import scholarships from '../../content/data/scholarships.json'
import targets from '../../content/source-manifests/double-first-class/targets.v1.json'
import { bundleSchema } from '@/lib/data/schema'
import { selectPublishedData } from '@/lib/data/publication'

const data = bundleSchema.parse({
  sources,
  cities,
  universities,
  programs,
  admissionCycles,
  scholarships,
})
const published = selectPublishedData(data, '2026-07-29')

const expansionUniversityIds = new Set([
  'uni-peking-union-medical-college',
  'uni-chengdu-university-of-technology',
  'uni-chengdu-university-of-traditional-chinese-medicine',
  'uni-chongqing-medical-university',
  'uni-chongqing-university-of-posts-and-telecommunications',
  'uni-dalian-medical-university',
  'uni-dongbei-university-of-finance-and-economics',
  'uni-northeast-normal-university',
  'uni-fujian-normal-university',
  'uni-guangxi-medical-university',
  'uni-guangzhou-university',
  'uni-guangzhou-university-of-chinese-medicine',
  'uni-guizhou-normal-university',
  'uni-harbin-normal-university',
  'uni-hangzhou-dianzi-university',
  'uni-huaqiao-university',
  'uni-jiangsu-university',
  'uni-jiangsu-normal-university',
  'uni-kunming-medical-university',
  'uni-southern-medical-university',
  'uni-ningbo-university',
  'uni-ningxia-university',
  'uni-qinghai-university',
  'uni-shandong-normal-university',
  'uni-shantou-university',
  'uni-shanghai-university-of-international-business-and-economics',
  'uni-shanghai-maritime-university',
  'uni-shanghaitech-university',
  'uni-university-of-shanghai-for-science-and-technology',
  'uni-shenyang-pharmaceutical-university',
  'uni-shihezi-university',
  'uni-capital-university-of-economics-and-business',
  'uni-capital-normal-university',
  'uni-sichuan-agricultural-university',
  'uni-sichuan-normal-university',
  'uni-sichuan-international-studies-university',
  'uni-tianjin-university-of-finance-and-economics',
  'uni-tianjin-foreign-studies-university',
  'uni-tianjin-medical-university',
  'uni-northwest-university',
  'uni-tibet-university',
  'uni-southwest-petroleum-university',
  'uni-yunnan-normal-university',
  'uni-zhejiang-university-of-finance-and-economics',
  'uni-zhejiang-university-of-technology',
  'uni-zhejiang-normal-university',
  'uni-china-university-of-geosciences-beijing',
  'uni-china-jiliang-university',
  'uni-university-of-chinese-academy-of-sciences',
  'uni-china-university-of-mining-and-technology-beijing',
  'uni-peoples-public-security-university-of-china',
  'uni-china-medical-university',
  'uni-central-academy-of-fine-arts',
  'uni-central-academy-of-drama',
  'uni-wenzhou-university',
  'uni-hubei-university',
  'uni-chongqing-normal-university',
  'uni-minnan-normal-university',
  'uni-zhejiang-af-university',
  'uni-qingdao-university',
  'uni-university-of-jinan',
  'uni-yantai-university',
  'uni-hebei-university',
  'uni-dalian-university-of-foreign-languages',
])

const newProgramIds = new Set([
  'program-cdut-china-link-2026-2027',
  'program-wzu-china-link-2026-2027',
  'program-hubu-iclt-one-semester-spring-2027',
  'program-cqnu-iclt-one-semester-spring-2027',
  'program-mnnu-iclt-one-semester-spring-2027',
  'program-zafu-iclt-one-semester-spring-2027',
  'program-fjnu-iclt-one-semester-spring-2027',
  'program-ybu-iclt-one-semester-spring-2027',
  'program-jiangnan-iclt-one-semester-spring-2027',
  'program-sufe-iclt-one-semester-spring-2027',
  'program-zjnu-iclt-one-semester-spring-2027',
  'program-cqnu-chinese-language-spring-2027',
])

describe('2026-07-29 official catalog expansion', () => {
  it('publishes 202 unique universities and exposes all 64 expansion identities', () => {
    expect(data.universities).toHaveLength(202)
    expect(new Set(data.universities.map((item) => item.id)).size).toBe(202)
    expect(new Set(data.universities.map((item) => item.slug)).size).toBe(202)
    expect(new Set(data.universities.map((item) => item.name.zh)).size).toBe(202)
    expect(published.universities).toHaveLength(202)
    expect(expansionUniversityIds.size).toBe(64)

    for (const id of expansionUniversityIds) {
      const university = published.universities.find((item) => item.id === id)
      expect(university, id).toBeDefined()
      expect(university?.officialUrl).toMatch(/^https:\/\/[^/]+/)
      expect(university?.name.en).toBeTruthy()
      expect(university?.name.zh).toBeTruthy()
      expect(university?.name.ru).toBeTruthy()
      expect(published.cities.some((city) => city.id === university?.cityId)).toBe(true)
      expect(
        published.sources.some(
          (source) => source.official && university?.sourceIds.includes(source.id),
        ),
      ).toBe(true)
    }
  })

  it('maps every non-military Double First-Class target to a catalog institution', () => {
    const mapped = targets.targets.filter((target) => target.catalogInstitutionId)
    const excluded = new Set(['国防科技大学', '海军军医大学', '空军军医大学'])
    expect(mapped).toHaveLength(144)
    for (const target of targets.targets) {
      if (excluded.has(target.officialNameZh)) {
        expect(target.catalogInstitutionId).toBeUndefined()
      } else {
        expect(target.catalogInstitutionId, target.officialNameZh).toBeTruthy()
        expect(data.universities.some((item) => item.id === target.catalogInstitutionId)).toBe(true)
      }
    }
  })

  it('publishes all new programs with program-level official evidence', () => {
    const publishedIds = new Set(published.programs.map((item) => item.id))
    expect(newProgramIds.size).toBe(12)
    for (const id of newProgramIds) {
      const program = data.programs.find((item) => item.id === id)
      expect(program, id).toBeDefined()
      expect(publishedIds.has(id), id).toBe(true)
      expect(program?.details, `${id}: details`).toBeDefined()
      expect(program?.details?.overview.en, `${id}: English overview`).toBeTruthy()
      expect(program?.details?.overview.zh, `${id}: Chinese overview`).toBeTruthy()
      expect(program?.details?.overview.ru, `${id}: Russian overview`).toBeTruthy()
      expect(
        data.sources.some(
          (source) => source.official
            && source.kind === 'program'
            && source.url === program?.programUrl
            && program.sourceIds.includes(source.id),
        ),
      ).toBe(true)
    }
  })

  it('keeps every new fixed deadline at least 30 days ahead or rolling', () => {
    const threshold = '2026-08-28'
    const newCycles = data.admissionCycles.filter((item) => (
      newProgramIds.has(item.programId)
    ))
    expect(newCycles).toHaveLength(12)
    for (const cycle of newCycles) {
      if (cycle.dateStatus === 'rolling') {
        expect(cycle.closesOn).toBeNull()
      } else {
        expect(cycle.closesOn, cycle.id).not.toBeNull()
        expect(cycle.closesOn !== null && cycle.closesOn >= threshold, cycle.id).toBe(true)
      }
    }
  })

  it('preserves source conflicts and non-zero fees instead of hiding them', () => {
    const cqnu = data.admissionCycles.find(
      (item) => item.id === 'cycle-cqnu-chinese-language-spring-2027',
    )
    expect(cqnu).toMatchObject({
      opensOn: '2026-09-01',
      closesOn: '2026-12-30',
      tuitionCny: 7000,
      tuitionPeriod: 'semester',
      applicationFeeCny: 400,
    })
    expect(cqnu?.notes?.en).toContain('English page says December 31')

    const zafu = data.admissionCycles.find(
      (item) => item.id === 'cycle-zafu-iclt-one-semester-spring-2027',
    )
    expect(zafu?.applicationFeeCny).toBe(600)

    const sufe = data.admissionCycles.find(
      (item) => item.id === 'cycle-sufe-iclt-one-semester-spring-2027',
    )
    expect(sufe?.closesOn).toBe('2026-10-15')
    expect(sufe?.notes?.en).toContain('central scholarship application')
    expect(sufe?.notes?.en).toContain('October 31')

    const zafuProgram = data.programs.find(
      (item) => item.id === 'program-zafu-iclt-one-semester-spring-2027',
    )
    expect(zafuProgram?.name.en).toContain('Chinese Language and Literature')
    expect(zafuProgram?.details?.eligibility.some((item) => item.en?.includes('X1 or X2'))).toBe(true)

    const jiangnanScholarship = data.scholarships.find(
      (item) => item.id === 'scholarship-jiangnan-iclt-one-semester-spring-2027',
    )
    expect(jiangnanScholarship?.coverage.stipendCnyPerMonth).toBe(2500)

    const cqnuLanguage = data.programs.find(
      (item) => item.id === 'program-cqnu-chinese-language-spring-2027',
    )
    expect(cqnuLanguage?.sourceIds).toContain('src-cqnu-chinese-language-2027-zh')
    expect(cqnu?.sourceIds).toContain('src-cqnu-chinese-language-2027-zh')
  })

  it('merges the duplicate BLCU institution and remaps all foreign keys', () => {
    expect(
      data.universities.find((item) => item.id === 'uni-beijing-language-university'),
    ).toBeUndefined()
    expect(
      data.universities.find(
        (item) => item.id === 'uni-beijing-language-and-culture-university',
      ),
    ).toBeDefined()
    expect(
      data.programs.some(
        (item) => item.universityId === 'uni-beijing-language-university',
      ),
    ).toBe(false)
    expect(
      data.scholarships.some(
        (item) => item.universityIds.includes('uni-beijing-language-university'),
      ),
    ).toBe(false)
  })
})
