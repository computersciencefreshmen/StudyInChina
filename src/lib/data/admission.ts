import type { AdmissionCycle } from './types'
import { getTodayDate, isCurrentVerifiedRecord } from './freshness'
import { hasCurrentDirectoryCycleDates } from './discovery-state'

export function isCurrentOfficialReferenceTuition(cycle: AdmissionCycle | undefined, today = getTodayDate()): boolean {
  return Boolean(cycle && isCurrentVerifiedRecord(cycle, today) && cycle.verifiedAt <= today
    && cycle.tuitionStatus === 'reference' && cycle.tuitionCny !== null && cycle.tuitionPeriod
    && cycle.factScope === 'complete' && cycle.evidenceBasis === 'cycle-specific'
    && (cycle.dateStatus === 'published' || cycle.dateStatus === 'rolling')
    && (!cycle.closesOn || cycle.closesOn >= today))
}

export type ApplicationState =
  | 'open'
  | 'upcoming'
  | 'closed'
  | 'rolling'
  | 'dates-published'
  | 'not-announced'
  | 'previous-cycle'

export function getApplicationState(cycle: AdmissionCycle | undefined, today: string): ApplicationState {
  if (cycle && 'discovery' in cycle && !hasCurrentDirectoryCycleDates(cycle, today)) return 'not-announced'
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

/**
 * Selects the newest official tuition reference supplied by the caller.
 * Callers must pre-filter cycles to records backed by at least one official source.
 */
export function selectLatestTuitionReference(
  cycles: AdmissionCycle[],
  programId: string,
): AdmissionCycle | undefined {
  return cycles
    .filter((cycle) => cycle.programId === programId
      && (cycle.status === 'verified' || cycle.status === 'stale')
      && cycle.tuitionCny !== null
      && (cycle.dateStatus === 'previous-cycle-reference' || cycle.tuitionStatus === 'reference'))
    .sort((left, right) => right.academicYear.localeCompare(left.academicYear)
      || right.verifiedAt.localeCompare(left.verifiedAt)
      || right.id.localeCompare(left.id))[0]
}
