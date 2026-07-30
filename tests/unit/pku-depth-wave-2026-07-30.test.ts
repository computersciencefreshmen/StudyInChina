import { describe, expect, it } from 'vitest'

import admissionCycles from '../../content/data/admission-cycles.json'
import programs from '../../content/data/programs.json'
import scholarships from '../../content/data/scholarships.json'

const data = { admissionCycles, programs, scholarships }

const pkuDepthPrograms = data.programs.filter((program) =>
  program.id.startsWith('prog-gap-pku-depth-'))

describe('PKU official depth wave on 2026-07-30', () => {
  it('never stringifies an unknown teaching-language fact', () => {
    expect(pkuDepthPrograms).toHaveLength(14)
    expect(
      pkuDepthPrograms.flatMap((program) => program.teachingLanguages),
    ).not.toContain('[object Object]')
  })

  it('preserves verified duration ranges and the rolling research cycle', () => {
    const undergraduate = pkuDepthPrograms.find((program) =>
      program.id === 'prog-gap-pku-depth-undergraduate-international-degree-entry')
    const yuke = pkuDepthPrograms.find((program) =>
      program.id === 'prog-gap-pku-depth-yuke-pre-university')
    const llm = pkuDepthPrograms.find((program) =>
      program.id === 'prog-gap-pku-depth-llm-chinese-law')
    const researchCycle = data.admissionCycles.find((cycle) =>
      cycle.programId === 'prog-gap-pku-depth-research-scholar')

    expect(undergraduate?.teachingLanguages).toEqual(['Chinese'])
    expect(undergraduate?.durationMonths).toBe(48)
    expect(undergraduate?.durationMonthsMax).toBeUndefined()
    expect([yuke?.durationMonths, yuke?.durationMonthsMax]).toEqual([12, 18])
    expect([llm?.durationMonths, llm?.durationMonthsMax]).toEqual([12, 24])
    expect(researchCycle?.dateStatus).toBe('rolling')
    expect(researchCycle?.closesOn).toBeNull()
  })

  it('keeps the open language-teacher scholarship scoped to its PKU routes', () => {
    const scholarship = data.scholarships.find((item) =>
      item.id === 'sch-gap-pku-depth-international-chinese-language-teachers-scholarship')

    expect(scholarship?.deadline).toBe('2026-10-31')
    expect(scholarship?.coverage).toMatchObject({
      tuition: 'full',
      accommodation: 'full',
      insurance: true,
    })
    expect(scholarship?.programIds).toEqual([
      'prog-gap-pku-depth-gvs-chinese-language',
      'prog-gap-pku-depth-yuke-pre-university',
    ])
  })

  it('binds each route-specific award and classifies Beijing funding as city-level', () => {
    const byId = new Map(data.scholarships.map((item) => [item.id, item]))
    expect(byId.get('sch-gap-pku-depth-law-international-student-scholarship')?.programIds)
      .toEqual(['prog-gap-pku-depth-llm-chinese-law'])
    expect(byId.get('sch-gap-pku-depth-cs-international-phd-full-support')?.programIds)
      .toEqual(['prog-gap-pku-depth-cs-doctorate-english'])
    expect(byId.get('sch-gap-pku-depth-yenching-fellowship')?.programIds)
      .toEqual(['prog-gap-pku-depth-yenching-china-studies-master'])
    expect(byId.get('sch-gap-pku-depth-beijing-government-scholarship')?.providerType)
      .toBe('city')
  })
})
