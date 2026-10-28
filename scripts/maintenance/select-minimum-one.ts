import { selectDiscoveryData } from '../../src/lib/data/discovery'
import type { IdentityAcceptanceLedger } from '../../src/lib/data/identity-acceptance'
import type { DataBundle } from '../../src/lib/data/types'
import type { MaintenanceProposal } from './contracts'

export type MinimumOneSkipReason = 'not_program' | 'producer_held' | 'review_not_approved'
  | 'school_not_visible' | 'school_already_covered' | 'school_already_selected' | 'target_identity_unpublished'

export type MinimumOneSelection = {
  selected: MaintenanceProposal[]
  skipped: Array<{ proposalId: string; universityId: string; reason: MinimumOneSkipReason }>
  visibleUniversityIds: string[]
  coveredUniversityIds: string[]
  uncoveredUniversityIds: string[]
}

/**
 * Coverage is an applicant-visible accepted identity, never a raw row count.
 * Preserve producer order and original proposals; the formal importer remains
 * responsible for schemas, official evidence, checksums and review receipts.
 */
export function selectMinimumOneProgrammes(options: {
  bundle: DataBundle
  acceptances: IdentityAcceptanceLedger
  proposals: readonly MaintenanceProposal[]
  today?: string
}): MinimumOneSelection {
  const directory = selectDiscoveryData(options.bundle, options.today, options.acceptances.entries)
  const visible = new Set(directory.universities.map(school => school.id))
  const covered = new Set(directory.programs.map(program => program.universityId))
  const selectedSchools = new Set<string>()
  const records = new Map(options.bundle.programs.map(program => [program.id, program]))
  const selected: MaintenanceProposal[] = [], skipped: MinimumOneSelection['skipped'] = []
  for (const proposal of options.proposals) {
    let reason: MinimumOneSkipReason | undefined
    if (proposal.entityType !== 'program') reason = 'not_program'
    else if (proposal.status !== 'ready') reason = 'producer_held'
    else if (proposal.review?.decision !== 'approved' || !Object.values(proposal.review.checks).every(Boolean)) reason = 'review_not_approved'
    else if (!visible.has(proposal.universityId)) reason = 'school_not_visible'
    else if (covered.has(proposal.universityId)) reason = 'school_already_covered'
    else if (selectedSchools.has(proposal.universityId)) reason = 'school_already_selected'
    else if (proposal.recordId && ['draft', 'archived'].includes(records.get(proposal.recordId)?.status ?? '')) reason = 'target_identity_unpublished'
    if (reason) skipped.push({ proposalId: proposal.id, universityId: proposal.universityId, reason })
    else {
      selected.push(proposal)
      selectedSchools.add(proposal.universityId)
    }
  }
  const visibleUniversityIds = [...visible]
  return { selected, skipped, visibleUniversityIds,
    coveredUniversityIds: visibleUniversityIds.filter(id => covered.has(id)),
    uncoveredUniversityIds: visibleUniversityIds.filter(id => !covered.has(id)) }
}
