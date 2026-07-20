import type { AdmissionCycle } from './types'

export type ApplicationState =
  | 'open'
  | 'upcoming'
  | 'closed'
  | 'rolling'
  | 'dates-published'
  | 'not-announced'
  | 'previous-cycle'

export function getApplicationState(cycle: AdmissionCycle | undefined, today: string): ApplicationState {
  if (!cycle || cycle.dateStatus === 'not-announced') return 'not-announced'
  if (cycle.dateStatus === 'previous-cycle-reference') return 'previous-cycle'
  if (cycle.closesOn && cycle.closesOn < today) return 'closed'
  if (cycle.opensOn && cycle.opensOn > today) return 'upcoming'
  if (cycle.dateStatus === 'rolling') return 'rolling'
  if (cycle.dateStatus === 'published' && cycle.opensOn) return 'open'
  return 'dates-published'
}

const statePriority: Record<ApplicationState, number> = {
  open: 0,
  rolling: 1,
  upcoming: 2,
  'dates-published': 3,
  'not-announced': 4,
  closed: 5,
  'previous-cycle': 6,
}

function compareWithinState(left: AdmissionCycle, right: AdmissionCycle, state: ApplicationState) {
  if (state === 'open') return (left.closesOn || '9999-12-31').localeCompare(right.closesOn || '9999-12-31')
  if (state === 'upcoming') return (left.opensOn || '9999-12-31').localeCompare(right.opensOn || '9999-12-31')
  const leftDate = left.closesOn || left.opensOn || left.academicYear
  const rightDate = right.closesOn || right.opensOn || right.academicYear
  return rightDate.localeCompare(leftDate)
}

export function selectAdmissionCycle(cycles: AdmissionCycle[], programId: string, today: string) {
  return cycles
    .filter((cycle) => cycle.programId === programId)
    .sort((left, right) => {
      const leftState = getApplicationState(left, today)
      const rightState = getApplicationState(right, today)
      return statePriority[leftState] - statePriority[rightState]
        || compareWithinState(left, right, leftState)
    })[0]
}
