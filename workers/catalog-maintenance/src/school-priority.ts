import bundledPriority from '../../../content/maintenance/expansion-priority.v1.json'

type School = { university_id: string; last_attempt_at: string | null }
type Priority = { format?: unknown; version?: unknown; evaluatedForDate?: unknown; scopeRegistrySha256?: unknown; inputCatalogSha256?: unknown; universityIds?: unknown }
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value)

/** Stale-tolerant collection hints only: never identity acceptance, inspection proof, or permission to run a model. */
export function orderSchoolExpansionCandidates<T extends School>(schools: readonly T[], scopeRegistrySha256: string, value: unknown = bundledPriority): T[] {
  const original = [...schools]
  if (!value || typeof value !== 'object' || Array.isArray(value)) return original
  const priority = value as Priority, ids = priority.universityIds, day = priority.evaluatedForDate
  if (priority.format !== 'studyinchina.school-expansion-priority' || priority.version !== 1
    || !hash(priority.scopeRegistrySha256) || priority.scopeRegistrySha256 !== scopeRegistrySha256 || !hash(priority.inputCatalogSha256)
    || typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(day) || !Number.isFinite(Date.parse(`${day}T00:00:00Z`)) || new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day
    || schools.length !== 272 || !Array.isArray(ids) || ids.length !== 272 || ids.some(id => typeof id !== 'string') || new Set(ids).size !== 272) return original
  const known = new Set(schools.map(school => school.university_id))
  if (known.size !== 272 || ids.some(id => !known.has(id))) return original
  const ranks = new Map((ids as string[]).map((id, index) => [id, index]))
  // Prior attempts remain scheduling hints; rollout.ts independently checks actual immutable inspection evidence.
  return original.sort((left, right) => Number(Boolean(left.last_attempt_at)) - Number(Boolean(right.last_attempt_at))
    || ranks.get(left.university_id)! - ranks.get(right.university_id)!)
}
