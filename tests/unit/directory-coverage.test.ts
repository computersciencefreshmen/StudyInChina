import { describe, expect, it } from 'vitest'
import { loadMaintenanceBundle } from '../../scripts/maintenance/build-scope'
import { selectDiscoveryData } from '../../src/lib/data/discovery'
import { readIdentityAcceptances } from '../../src/lib/data/identity-acceptance-store'
import { directoryCoverage } from '../../src/lib/data/directory-coverage'

describe('directory coverage and actual application opportunities', () => {
  it('does not count an expired award identity as a current opportunity', () => {
    const raw = loadMaintenanceBundle(process.cwd())
    const directory = selectDiscoveryData(raw, '2026-10-24', readIdentityAcceptances())
    expect(directory.scholarships).toHaveLength(7)
    const metrics = directoryCoverage(directory, 272, '2026-10-24')
    expect(metrics.currentOpportunityCounts.scholarships).toBe(0)
    expect(metrics.schoolCoverageCounts).toMatchObject({ cohort: 272, directory: 255, withDirectoryPrograms: 17 })
  })
  it('counts a fresh leaf-based cycle without upgrading whole-record freshness', () => {
    const raw = loadMaintenanceBundle(process.cwd()), program = raw.programs[0], source = raw.admissionCycles[0]
    const cycle = { ...source, programId: program.id, status: 'stale' as const, dateStatus: 'published' as const,
      opensOn: '2026-10-25', closesOn: null, discovery: { currentFacts: false, currentFieldPaths: ['dateStatus', 'opensOn'] } }
    const directory = { ...raw, programs: [program], scholarships: [], admissionCycles: [cycle] }
    expect(directoryCoverage(directory, 272, '2026-10-24').currentOpportunityCounts).toMatchObject({ programs: 1, admissionCycles: 1 })
    cycle.discovery.currentFieldPaths = ['tuitionCny']
    expect(directoryCoverage(directory, 272, '2026-10-24').currentOpportunityCounts.programs).toBe(0)
  })
})
