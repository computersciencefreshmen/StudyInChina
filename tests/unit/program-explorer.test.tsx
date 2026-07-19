import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import admissionCyclesJson from '../../content/data/admission-cycles.json'
import programsJson from '../../content/data/programs.json'
import universitiesJson from '../../content/data/universities.json'
import { ProgramExplorer } from '@/components/features/ProgramExplorer'
import { getMessages } from '@/i18n/messages'
import type { AdmissionCycle, Program, University } from '@/lib/data/types'

const programs = programsJson as Program[]
const universities = universitiesJson as University[]
const admissionCycles = admissionCyclesJson as AdmissionCycle[]

describe('ProgramExplorer', () => {
  it('applies a discipline supplied by a homepage deep link', () => {
    const expectedCount = programs.filter((program) => program.discipline === 'engineering').length

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

    expect(screen.getByLabelText('Field')).toHaveValue('engineering')
    expect(screen.getByText(`${expectedCount} programs`)).toBeVisible()
  })
})
