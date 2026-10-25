import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { webcrypto } from 'node:crypto'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { buildSchoolExpansionQueue, schoolExpansionReport } from '../../scripts/maintenance/build-school-expansion-queue'
import { loadMaintenanceBundle } from '../../scripts/maintenance/build-scope'
import { identityFingerprint, type IdentityAcceptance } from '../../src/lib/data/identity-acceptance'
import type { DataBundle } from '../../src/lib/data/types'

let bundle: DataBundle, scope: unknown
const today = '2026-10-25'
beforeAll(() => {
  vi.stubGlobal('crypto', webcrypto)
  const raw = loadMaintenanceBundle(process.cwd())
  scope = JSON.parse(readFileSync(join(process.cwd(), 'content/maintenance/scope-272.v1.json'), 'utf8'))
  const first = raw.programs.find(program => program.status === 'verified' && program.reviewAfter >= today && program.verifiedAt <= '2026-10-24')!
  const second = raw.programs.find(program => program.status === 'verified' && program.reviewAfter >= today && program.universityId !== first.universityId)!
  bundle = { ...raw, programs: [{ ...first, reviewAfter: '2026-10-24' }, second], admissionCycles: [], scholarships: [] }
})

describe('school-level expansion queue', () => {
  it('ranks schools with no accepted programmes before an already covered school, without counting stale raw records as coverage', async () => {
    const queue = await buildSchoolExpansionQueue({ bundle, scope, today, excludeUniversityIds: [bundle.programs[0].universityId] })
    const empty = queue.rows.find(row => row.universityId === bundle.programs[0].universityId)!
    const covered = queue.rows.find(row => row.universityId === bundle.programs[1].universityId)!
    expect(empty.rawProgramCount).toBe(1)
    expect(empty.directoryProgramCount).toBe(0)
    expect(empty.classification).toBe('programme_acceptance_or_expansion_needed')
    expect(empty.rank).toBeLessThan(covered.rank)
    expect(covered.directoryProgramCount).toBe(1)
    expect(queue.summary).toMatchObject({ cohort: 272, withDirectoryPrograms: 1, withoutDirectoryPrograms: 271 })
    expect(queue.rows).toHaveLength(272)
    expect(queue.nextCohort).toHaveLength(20)
    expect(queue.nextCohort).not.toContain(empty.universityId)
    expect(queue.policy.stopOrUnknownMustBeCheckedBeforeExecution).toBe(true)
    expect(queue.rows.every(row => row.priorStopOrUnknownChecked === false)).toBe(true)
  })
  it('counts an explicit accepted identity preview as one newly covered school while keeping expired facts and opportunities separate', async () => {
    const program = bundle.programs[0]
    const identity: IdentityAcceptance = { entityType: 'program', recordId: program.id, identitySha256: identityFingerprint('program', program), sourceIds: program.sourceIds,
      acceptedAt: `${today}T00:00:00.000Z`, reviewer: 'fixture-only', receiptPath: 'quality/fixture.json', receiptSha256: 'a'.repeat(64) }
    const queue = await buildSchoolExpansionQueue({ bundle, scope, today, identities: [identity], preview: true })
    const row = queue.rows.find(row => row.universityId === program.universityId)!
    expect(queue.mode).toBe('accepted-preview')
    expect(row).toMatchObject({ directoryProgramCount: 1, currentFactProgramCount: 0, currentOpportunityProgramCount: 0 })
    expect(queue.summary).toMatchObject({ withDirectoryPrograms: 2, withoutDirectoryPrograms: 270, withCurrentOpportunities: 0 })
    expect(schoolExpansionReport(queue)).toContain('2/272 schools have accepted directory programmes')
    expect(bundle.programs[0].reviewAfter).toBe('2026-10-24')
  })
  it('keeps the national outside-cohort backlog separate and refuses a changed fixed-school set', async () => {
    const queue = await buildSchoolExpansionQueue({ bundle, scope, today, nationalRegistry: { format: 'studyinchina.national-university-target-registry', sourceYear: 2026, asOf: '2026-06-17',
      institutions: [{ educationCategory: 'bachelor-level', catalogueMatch: { universityId: bundle.universities[0].id } }, { educationCategory: 'higher-vocational', catalogueMatch: null }] } })
    expect(queue.nationalBacklog).toMatchObject({ totalNationalIdentities: 2, matchedFixedCohort: 1, beyondFixedScopeCandidates: 1, addedToFixedScope: 0 })
    expect(queue.rows.map(row => row.universityId).sort()).toEqual(bundle.universities.map(school => school.id).sort())
    await expect(buildSchoolExpansionQueue({ bundle: { ...bundle, universities: bundle.universities.slice(0, 271) }, scope, today })).rejects.toThrow()
  })
})
