import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import admissionCyclesJson from '../../content/data/admission-cycles.json'
import programsJson from '../../content/data/programs.json'
import universitiesJson from '../../content/data/universities.json'
import { ProgramExplorer } from '@/components/features/ProgramExplorer'
import { getMessages } from '@/i18n/messages'
import { classifyProgramField } from '@/lib/data/fields'
import { filterPrograms } from '@/lib/search'
import type { AdmissionCycle, Program, University } from '@/lib/data/types'

const programs = programsJson as Program[]
const universities = universitiesJson as University[]
const admissionCycles = admissionCyclesJson as AdmissionCycle[]

describe('ProgramExplorer', () => {
  it('normalizes a legacy discipline deep link into the complete field taxonomy', () => {
    const expectedCount = programs.filter((program) => classifyProgramField(program) === 'engineering-technology').length

    render(
      <ProgramExplorer
        programs={programs}
        universities={universities}
        cycles={admissionCycles}
        locale="en"
        messages={getMessages('en')}
        initialDiscipline="engineering"
      />,
    )

    expect(screen.getByLabelText('Field')).toHaveValue('engineering-technology')
    expect(screen.getByText(`${expectedCount} programs`)).toBeVisible()
  })

  it('surfaces verified Chinese degree programs in the Chinese language and culture field', () => {
    const baseFilters = { query: '', discipline: 'chinese-language', language: '', dateStatus: '', tuition: '' }
    const masters = filterPrograms(programs, universities, admissionCycles, {
      ...baseFilters,
      degree: 'master',
    })
    const bachelors = filterPrograms(programs, universities, admissionCycles, {
      ...baseFilters,
      degree: 'bachelor',
    })
    const nonDegreeLanguage = programs.find((program) => program.degreeLevel === 'language')

    expect(masters.map((program) => program.id)).toContain('program-changan-university-international-chinese-education-master')
    expect(bachelors.map((program) => program.id)).toContain('program-nankai-university-chinese-language-and-literature-bachelor')
    expect(masters.every((program) => program.degreeLevel === 'master')).toBe(true)
    expect(bachelors.every((program) => program.degreeLevel === 'bachelor')).toBe(true)
    expect(nonDegreeLanguage).toBeDefined()
    expect(masters.map((program) => program.id)).not.toContain(nonDegreeLanguage?.id)
  })

  it.each([
    'MTCSOL',
    '国际中文教育',
    'Международное преподавание китайского языка',
  ])('indexes Chinese-program titles and aliases across languages: %s', (query) => {
    const matches = filterPrograms(programs, universities, admissionCycles, {
      query,
      degree: 'master',
      discipline: 'chinese-language',
      language: '',
      dateStatus: '',
      tuition: '',
    })

    expect(matches.length).toBeGreaterThan(0)
    expect(matches.every((program) => program.degreeLevel === 'master')).toBe(true)
  })
})
