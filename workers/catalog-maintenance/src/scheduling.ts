export type ScheduledJob = { stage: string; priority: number; source_last_success_at?: string | null }
export type SchedulingOptions = { limit: number; firstRoundComplete: boolean; now: number }
const TICK_MS = 15 * 60 * 1000

function maintenanceLane(job: ScheduledJob): boolean {
  return job.stage === 'maintain' || job.stage === 'capture' && Boolean(job.source_last_success_at)
}

/** The caller supplies priority/due order. Cumulative integer floors distribute
 * fractional slots without state: every ten 8-slot ticks reserve exactly 24/56.
 * Urgent work may override that split; unused shares are always work-conserving. */
export function selectScheduledJobs<T extends ScheduledJob>(jobs: T[], options: SchedulingOptions): T[] {
  if (!Number.isSafeInteger(options.limit) || options.limit < 0 || !Number.isFinite(options.now))
    throw new RangeError('invalid_scheduling_options')
  if (options.limit === 0 || jobs.length === 0) return []
  const urgent = jobs.flatMap((job, index) => job.priority <= 0 ? [index] : []).slice(0, options.limit)
  if (urgent.length === options.limit) return urgent.map(index => jobs[index])
  const tick = Math.floor(options.now / TICK_MS), maintenanceTenths = options.firstRoundComplete ? 7 : 3
  const reservedMaintenance = Math.floor((tick + 1) * options.limit * maintenanceTenths / 10)
    - Math.floor(tick * options.limit * maintenanceTenths / 10)
  const reservedExpansion = options.limit - reservedMaintenance
  const urgentMaintenance = urgent.filter(index => maintenanceLane(jobs[index])).length
  const selected = new Set(urgent)
  const take = (maintenance: boolean, count: number) => {
    for (let index = 0; index < jobs.length && count > 0 && selected.size < options.limit; index++) {
      if (selected.has(index) || maintenanceLane(jobs[index]) !== maintenance) continue
      selected.add(index); count--
    }
  }
  take(true, Math.max(0, reservedMaintenance - urgentMaintenance))
  take(false, Math.max(0, reservedExpansion - (urgent.length - urgentMaintenance)))
  // Borrow unused capacity in the caller's original priority/due order.
  for (let index = 0; index < jobs.length && selected.size < options.limit; index++) selected.add(index)
  return [...urgent, ...jobs.flatMap((_, index) => selected.has(index) && !urgent.includes(index) ? [index] : [])]
    .map(index => jobs[index])
}
