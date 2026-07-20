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
