import type { DataBundle, LocalizedText } from '@/lib/data/types'
import { selectPublishedData } from '@/lib/data/publication'
import { getTodayDate, isCurrentVerifiedRecord, isWithinPostDeadlineGrace } from '@/lib/data/freshness'
import { meaningfulFingerprint, type PublishedObservation } from './changes'

function title(name: LocalizedText): string {
  return name.en || name.zh || name.ru || Object.values(name).find(Boolean) || 'Study in China'
}

/** Build observations from the actual public catalog, never the administrator's candidate queue. */
export function observePublishedCatalog(data: DataBundle, now = Date.now()): Record<string, PublishedObservation> {
  const today = getTodayDate(new Date(now))
  const published = selectPublishedData(data, today)
  const publicSchools = new Set(published.universities.map(item => item.id))
  const publicPrograms = new Set(published.programs.map(item => item.id))
  const schools = new Map(data.universities.map(item => [item.id, item]))
  const programs = new Map(data.programs.map(item => [item.id, item]))
  const observations: Record<string, PublishedObservation> = {}

  for (const university of data.universities) {
    if (!publicSchools.has(university.id)) continue
    observations[`university:${university.id}`] = {
      id: university.id, kind: 'university', universityId: university.id,
      fingerprint: meaningfulFingerprint(university), verified: isCurrentVerifiedRecord(university, today),
      title: title(university.name), slug: university.slug,
    }
  }
  for (const program of data.programs) {
    if (!publicPrograms.has(program.id)) continue
    const university = schools.get(program.universityId)!
    observations[`program:${program.id}`] = {
      id: program.id, kind: 'program', universityId: program.universityId,
      fingerprint: meaningfulFingerprint(program),
      verified: isCurrentVerifiedRecord(program, today) && isCurrentVerifiedRecord(university, today),
      title: `${title(program.name)} · ${title(university.name)}`, slug: program.slug,
    }
  }
  // Admission facts have their own identity. An expired cycle does not change a
  // program fingerprint merely because the calendar advances.
  for (const cycle of data.admissionCycles) {
    const program = programs.get(cycle.programId)
    if (!program || !publicPrograms.has(program.id) || !['verified', 'stale'].includes(cycle.status)) continue
    const university = schools.get(program.universityId)!
    observations[`cycle:${cycle.id}`] = {
      id: program.id, kind: 'program', universityId: program.universityId,
      fingerprint: meaningfulFingerprint(cycle),
      verified: isCurrentVerifiedRecord(cycle, today) && isCurrentVerifiedRecord(program, today)
        && isCurrentVerifiedRecord(university, today) && cycle.dateStatus !== 'previous-cycle-reference'
        && (cycle.dateStatus === 'rolling' || isWithinPostDeadlineGrace(cycle.closesOn, today)),
      title: `${title(program.name)} · ${cycle.academicYear} · ${title(university.name)}`, slug: program.slug,
    }
  }
  return observations
}
