import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import admissionCyclesJson from '../../content/data/admission-cycles.json'
import programsJson from '../../content/data/programs.json'
import universitiesJson from '../../content/data/universities.json'
import { ProgramExplorer } from '@/components/features/ProgramExplorer'
import { getMessages } from '@/i18n/messages'
import { classifyProgramField } from '@/lib/data/fields'
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
})
