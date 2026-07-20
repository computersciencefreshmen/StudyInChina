import { describe, expect, it } from 'vitest'
import { getApplicationState, selectAdmissionCycle } from '@/lib/data/admission'
import type { AdmissionCycle } from '@/lib/data/types'

const cycle = {
  dateStatus: 'published',
  opensOn: '2026-03-01',
  closesOn: '2026-06-30',
} as AdmissionCycle

describe('application state', () => {
  it('distinguishes upcoming, open and closed windows', () => {
    expect(getApplicationState(cycle, '2026-02-28')).toBe('upcoming')
    expect(getApplicationState(cycle, '2026-03-01')).toBe('open')
    expect(getApplicationState(cycle, '2026-07-01')).toBe('closed')
  })

  it('does not call a deadline-only notice open', () => {
    expect(getApplicationState({ ...cycle, opensOn: null }, '2026-06-01')).toBe('dates-published')
  })

  it('prefers the next upcoming intake over a closed cycle', () => {
    const autumn = { ...cycle, id: 'autumn', programId: 'program', opensOn: '2026-03-15', closesOn: '2026-06-30' } as AdmissionCycle
    const spring = { ...cycle, id: 'spring', programId: 'program', opensOn: '2026-09-15', closesOn: '2026-12-15' } as AdmissionCycle

    expect(selectAdmissionCycle([autumn, spring], 'program', '2026-07-20')?.id).toBe('spring')
  })
})
