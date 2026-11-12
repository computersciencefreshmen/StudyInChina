export type ScheduledJob = { stage: string; priority: number; source_last_success_at?: string | null;
  coverage_count?: number; review_after?: string | null; source_category?: string;
  scheduling_school_id?: string; school_last_attempt_at?: string | null; school_last_dispatched_tick?: number }
export type SchedulingOptions = { limit: number; firstRoundComplete: boolean; now: number }
const TICK_MS = 15 * 60 * 1000

function maintenanceLane(job: ScheduledJob): boolean {
  return job.stage === 'maintain' || job.stage === 'capture' && Boolean(job.source_last_success_at)
}

// Unknown coverage needs expansion too. This priority does not assert that its
// factual count is zero; only an independently complete snapshot can end growth.
export const schedulingCoverageBand = (count?: number | null) => count == null || count === 0 ? 0 : count === 1 ? 1 : count < 5 ? 2 : 3

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
    return schedulingCoverageBand(a.coverage_count) - schedulingCoverageBand(b.coverage_count)
  })
  const selected = new Set<number>(), schoolUses = new Map<string, number>()
  const add = (index: number) => {
    selected.add(index)
    const school = jobs[index].scheduling_school_id
    if (school) schoolUses.set(school, (schoolUses.get(school) ?? 0) + 1)
  }
  const pick = (accept: (job: T) => boolean) => {
    let best = -1
    for (let index = 0; index < jobs.length; index++) {
      if (selected.has(index) || !accept(jobs[index])) continue
      if (best < 0) { best = index; continue }
      const a = jobs[index], b = jobs[best]
      const band = schedulingCoverageBand(a.coverage_count) - schedulingCoverageBand(b.coverage_count)
      const uses = (schoolUses.get(a.scheduling_school_id ?? '') ?? 0) - (schoolUses.get(b.scheduling_school_id ?? '') ?? 0)
      const dispatched = a.scheduling_school_id && b.scheduling_school_id
        ? (a.school_last_dispatched_tick ?? 0) - (b.school_last_dispatched_tick ?? 0) : 0
      const age = a.scheduling_school_id && b.scheduling_school_id
        ? (a.school_last_attempt_at ?? '').localeCompare(b.school_last_attempt_at ?? '') : 0
      if (band < 0 || band === 0 && (uses < 0 || uses === 0 && (dispatched < 0 || dispatched === 0 && age < 0))) best = index
    }
    return best
  }
  const urgent: number[] = []
  while (urgent.length < options.limit) {
    const index = pick(job => job.priority <= 0 || Boolean(job.review_after && job.review_after >= today && job.review_after <= reviewLimit))
    if (index < 0) break
    urgent.push(index); add(index)
  }
  if (urgent.length === options.limit) return urgent.map(index => jobs[index])
  const tick = Math.floor(options.now / TICK_MS), maintenanceTenths = options.firstRoundComplete ? 7 : 3
  const reservedMaintenance = Math.floor((tick + 1) * options.limit * maintenanceTenths / 10)
    - Math.floor(tick * options.limit * maintenanceTenths / 10)
  const reservedExpansion = options.limit - reservedMaintenance
  const urgentMaintenance = urgent.filter(index => maintenanceLane(jobs[index])).length
  let expansionSlotsUsed = 0
  const take = (maintenance: boolean, count: number) => {
    if (!maintenance && jobs.some(job => job.stage === 'award' || job.source_category === 'scholarships')) {
      const isAward = (job: T) => job.stage === 'award' || job.source_category === 'scholarships'
      // Program / program / award rotation. Empty shares are borrowed immediately.
      for (let slot = 0; slot < count && selected.size < options.limit; slot++) {
        const award = (tick + expansionSlotsUsed++) % 3 === 2
        let index = pick(job => !maintenanceLane(job) && isAward(job) === award)
        if (index < 0) index = pick(job => !maintenanceLane(job))
        if (index >= 0) add(index)
      }
      return
    }
    while (count > 0 && selected.size < options.limit) {
      const index = pick(job => maintenanceLane(job) === maintenance)
      if (index < 0) break
      add(index); count--
    }
  }
  take(true, Math.max(0, reservedMaintenance - urgentMaintenance))
  take(false, Math.max(0, reservedExpansion - (urgent.length - urgentMaintenance)))
  if (!jobs.some((job, index) => !selected.has(index) && maintenanceLane(job))) take(false, options.limit - selected.size)
  // Borrow unused capacity while preserving the same school fairness.
  while (selected.size < options.limit) {
    const index = pick(() => true)
    if (index < 0) break
    add(index)
  }
  return [...urgent, ...jobs.flatMap((_, index) => selected.has(index) && !urgent.includes(index) ? [index] : [])]
    .map(index => jobs[index])
}
