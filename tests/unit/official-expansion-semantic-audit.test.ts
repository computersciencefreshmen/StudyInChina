import { describe, expect, it } from 'vitest'
import sources from '../../content/data/sources.json'
import programs from '../../content/data/programs.json'
import admissionCycles from '../../content/data/admission-cycles.json'
import scholarships from '../../content/data/scholarships.json'

describe('official expansion semantic audit', () => {
  it('does not project old or unsupported evidence into a future cycle', () => {
    const ids = new Set(admissionCycles.map((cycle) => cycle.id))
    for (const id of [
      'cycle-2027-blcu-finance-english-spring',
      'cycle-2027-changan-transportation-engineering-autumn',
      'cycle-2027-changan-civil-engineering-autumn',
      'cycle-2027-changan-self-funded-chinese-language-spring',
    ]) {
      expect(ids).not.toContain(id)
    }
  })

  it('does not expose registration charges as application fees', () => {
    for (const id of [
      'cycle-2027-xisu-regular-chinese-spring',
      'cycle-2026-wenzhou-medical-university-mbbs-autumn',
      'cycle-2026-wenzhou-medical-university-bds-autumn',
      'cycle-2026-wenzhou-medical-university-pharmaceutical-sciences-autumn',
    ]) {
      expect(admissionCycles.find((cycle) => cycle.id === id)?.applicationFeeCny).toBeNull()
    }
  })

  it('keeps program identity separate from scholarship and application routes', () => {
    const nauPrograms = programs.filter(
      (program) => program.universityId === 'uni-nanjing-audit-university',
    )
    expect(nauPrograms.map((program) => program.id).sort()).toEqual([
      'prog-gap-mve-ecma-nau-finance-master',
      'prog-gap-wave8-final-nau-chinese-language-nondegree',
      'program-nanjing-audit-university-master-of-auditing',
    ])
    expect(
      scholarships.find(
        (scholarship) => scholarship.id === 'scholarship-nanjing-audit-university-mofcom-maud',
      )?.programIds,
    ).toEqual(['program-nanjing-audit-university-master-of-auditing'])
  })

  it('keeps unsupported duration and teaching-language values unknown', () => {
    expect(
      programs.find(
        (program) => program.id === 'program-xian-international-studies-university-regular-chinese-language',
      )?.durationMonths,
    ).toBeNull()
    expect(
      programs.find(
        (program) => program.id === 'program-changan-university-self-funded-chinese-language',
      )?.durationMonths,
    ).toBeNull()
    expect(
      programs.find(
        (program) => program.id === 'program-xian-international-studies-university-new-sinology-translation-master',
      )?.teachingLanguages,
    ).toEqual([])
  })

  it('uses precise official application and canonical source URLs', () => {
    expect(
      programs.find(
        (program) => program.id === 'program-guangdong-university-of-foreign-studies-international-business-bachelor',
      )?.applyUrl,
    ).toBe('https://gdufs.17gz.org/')
    expect(
      programs.find(
        (program) => program.id === 'program-shenzhen-university-iclt-one-semester-language',
      )?.applyUrl,
    ).toBe('https://status.szu.edu.cn/szulxs/stuzs/stuLogin.action?fpage_id=216')
    expect(
      sources.find((source) => source.id === 'src-sustech-2026-postgraduate')?.url,
    ).toBe('https://med.sustech.edu.cn/Home/Default/NewsDetailNE?AID=7174&classIDNow=3451')
  })

  it('describes cash awards and scholarship limits without widening their scope', () => {
    const wmu = scholarships.find(
      (scholarship) => scholarship.id === 'scholarship-wenzhou-medical-university-undergraduate-freshman',
    )
    expect(wmu?.coverage.tuition).toBe('unknown')
    expect(wmu?.name.en).toContain('MBBS/BDS')
    expect(wmu?.summary.en).toContain('first pay the full tuition')

    const nau = scholarships.find(
      (scholarship) => scholarship.id === 'scholarship-nanjing-audit-university-mofcom-maud',
    )
    expect(nau?.deadline).toBeNull()
    expect(nau?.summary.en).toContain('annual recommended date')

    for (const id of ['scholarship-sustech-president', 'scholarship-sustech-tuition-waiver']) {
      const scholarship = scholarships.find((item) => item.id === id)
      expect(scholarship?.summary.en).toContain('undergraduate-only')
      expect(scholarship?.summary.en).toContain('test waiver')
    }
  })
})
