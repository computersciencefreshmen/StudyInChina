export type ScheduledJob = { stage: string; priority: number; source_last_success_at?: string | null;
  coverage_count?: number; review_after?: string | null; source_category?: string }
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
  // Current facts approaching their review date are urgent acquisition work.
  // Scheduling never extends the underlying evidence dates.
  const today = new Date(options.now + 8 * 3600000).toISOString().slice(0, 10)
  const reviewLimit = new Date(options.now + 7 * 86400000 + 8 * 3600000).toISOString().slice(0, 10)
  jobs = [...jobs].sort((a, b) => {
    const urgent = (job: T) => job.priority <= 0 || Boolean(job.review_after && job.review_after >= today && job.review_after <= reviewLimit)
    if (urgent(a) !== urgent(b)) return urgent(a) ? -1 : 1
    const band = (job: T) => job.coverage_count === undefined ? 4 : job.coverage_count === 0 ? 0 : job.coverage_count === 1 ? 1 : job.coverage_count < 5 ? 2 : 3
    return band(a) - band(b)
  })
  const urgent = jobs.flatMap((job, index) => job.priority <= 0 || job.review_after && job.review_after >= today && job.review_after <= reviewLimit ? [index] : []).slice(0, options.limit)
  if (urgent.length === options.limit) return urgent.map(index => jobs[index])
  const tick = Math.floor(options.now / TICK_MS), maintenanceTenths = options.firstRoundComplete ? 7 : 3
  const reservedMaintenance = Math.floor((tick + 1) * options.limit * maintenanceTenths / 10)
    - Math.floor(tick * options.limit * maintenanceTenths / 10)
  const reservedExpansion = options.limit - reservedMaintenance
  const urgentMaintenance = urgent.filter(index => maintenanceLane(jobs[index])).length
  const selected = new Set(urgent)
  let expansionSlotsUsed = 0
  const take = (maintenance: boolean, count: number) => {
    if (!maintenance && jobs.some(job => job.stage === 'award' || job.source_category === 'scholarships')) {
      const isAward = (job: T) => job.stage === 'award' || job.source_category === 'scholarships'
      // Program / program / award rotation. Empty shares are borrowed immediately.
      for (let slot = 0; slot < count && selected.size < options.limit; slot++) {
        const award = (tick + expansionSlotsUsed++) % 3 === 2
        let index = jobs.findIndex((job, i) => !selected.has(i) && !maintenanceLane(job) && isAward(job) === award)
        if (index < 0) index = jobs.findIndex((job, i) => !selected.has(i) && !maintenanceLane(job))
        if (index >= 0) selected.add(index)
      }
      return
    }
    for (let index = 0; index < jobs.length && count > 0 && selected.size < options.limit; index++) {
      if (selected.has(index) || maintenanceLane(jobs[index]) !== maintenance) continue
      selected.add(index); count--
    }
  }
  take(true, Math.max(0, reservedMaintenance - urgentMaintenance))
  take(false, Math.max(0, reservedExpansion - (urgent.length - urgentMaintenance)))
  if (!jobs.some((job, index) => !selected.has(index) && maintenanceLane(job))) take(false, options.limit - selected.size)
  // Borrow unused capacity in the caller's original priority/due order.
  for (let index = 0; index < jobs.length && selected.size < options.limit; index++) selected.add(index)
  return [...urgent, ...jobs.flatMap((_, index) => selected.has(index) && !urgent.includes(index) ? [index] : [])]
    .map(index => jobs[index])
}
