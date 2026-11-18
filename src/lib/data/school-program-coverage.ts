import { createHash } from 'node:crypto'
import { canonicalJson, sha256Text } from '../../../scripts/maintenance/contracts'
import { coverageBand, coverageSnapshotSchema, type CoverageSnapshot } from '../../../workers/catalog-maintenance/src/coverage'
import type { DataBundle } from './types'
import type { IdentityAcceptance } from './identity-acceptance'
import type { FieldVerification } from './field-verification'
import { selectDiscoveryData } from './discovery'
import { selectDetailedPublicPrograms } from './public-program-quality'
import { distinctPrograms } from './concrete-majors'
import { completeScholarship } from './decision-evidence'

export async function buildProgramCoverage(bundle: DataBundle, scope: { sha256: string; schools: ReadonlyArray<{ universityId: string }> }, today: string, identities: IdentityAcceptance[] = [], fields: FieldVerification[] = []): Promise<CoverageSnapshot> {
  const directory = selectDiscoveryData(bundle, today, identities, fields)
  const published = selectDetailedPublicPrograms(directory, today, bundle)
  const complete = published.programs
  const projectedAwards = directory.scholarships
  const completeAwards = published.scholarships.filter(award => completeScholarship(award, today))
  const content = {
    format: 'studyinchina.school-program-coverage' as const, version: 1 as const, scopeRegistrySha256: scope.sha256,
    inputCatalogSha256: await sha256Text(canonicalJson(bundle)), evaluatedOn: today,
    schools: scope.schools.map(school => {
      const programs = complete.filter(program => program.universityId === school.universityId), ids = distinctPrograms(programs)
      const reviewDates = programs.flatMap(program => {
        const raw = bundle.programs.find(row => row.id === program.id)
        return [raw?.reviewAfter, ...directory.admissionCycles.filter(cycle => cycle.programId === program.id).map(cycle => cycle.reviewAfter)]
          .filter((date): date is string => Boolean(date && date >= today))
      }).sort()
      return { universityId: school.universityId, rawProgramCount: bundle.programs.filter(program => program.universityId === school.universityId).length,
        directoryProgramCount: distinctPrograms(directory.programs.filter(program => program.universityId === school.universityId)).length,
        currentProgramCount: ids.length, minimumProgramCount: 5 as const, gap: Math.max(0, 5 - ids.length), coverageBand: coverageBand(ids.length),
        countedProgramIds: ids, directoryScholarshipCount: projectedAwards.filter(award => award.universityIds.includes(school.universityId)).length,
        currentScholarshipCount: completeAwards.filter(award => award.universityIds.includes(school.universityId)).length,
        reviewAfter: reviewDates[0] ?? null }
    }).sort((a, b) => a.universityId.localeCompare(b.universityId)),
  }
  return coverageSnapshotSchema.parse({ ...content, sha256: createHash('sha256').update(canonicalJson(content)).digest('hex') })
}
