import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildCurrentSourceManifestTrustLedger,
  buildSourceManifestTrustLedger,
  parseSourceManifestTrustLedgerCli,
} from '../../scripts/ingestion/build-source-manifest-trust-ledger'
import { buildCurrentSourceManifestCohort } from '../../scripts/ingestion/build-source-manifest-cohort'

describe('SourceManifestV2 public trust ledger', () => {
  it('covers every current public university while separating candidates from reconciliation', () => {
    const report = buildCurrentSourceManifestTrustLedger('2026-08-10', resolve('.'))

    expect(report).toMatchObject({
      format: 'studyinchina.source-manifest-trust-ledger',
      formatVersion: 1,
      checkedAt: '2026-08-10',
      scope: 'public_catalog',
      disposition: 'audit_only',
      summary: {
        publicUniversities: 266,
        ledgerEntries: 266,
        formalManifestRecords: 10,
        formalRecordsOutsidePublicCatalog: 0,
        legacyV1UpgradePaths: 0,
        formalV2InProgress: 10,
        completeFormalReconciliations: 0,
        candidateCoverage: 140,
        candidateRecordsOutsidePublicCatalog: 4,
        candidateOnlyRecords: 130,
        formalCandidateOverlap: 10,
        officialSourceDiscoveryRequired: 126,
        candidateCohort: {
          officialTargets: 147,
          militaryExcluded: 3,
          eligibleTargets: 144,
          candidateManifests: 144,
          catalogLinkedCandidates: 140,
          limitedOfficialCatalogCandidates: 4,
        },
      },
    })
    expect(
      Object.values(report.summary.statusCounts)
        .reduce((total, count) => total + count, 0),
    ).toBe(report.summary.publicUniversities)
    expect(report.summary.statusCounts).toEqual({
      complete: 0,
      in_progress: 266,
      limited_official_catalog: 0,
    })
    expect(new Set(report.entries.map((entry) => entry.institutionId)).size)
      .toBe(report.entries.length)

    const candidates = report.entries.filter((entry) => entry.candidate.available)
    expect(candidates).toHaveLength(140)
    expect(candidates.every((entry) => (
      entry.candidate.safelyDisabled
      && entry.gates.candidateEvidenceOnly
      && !entry.gates.publicationEligible
      && entry.reconciliation.state !== 'complete'
    ))).toBe(true)

    const formalV2Pilots = report.entries.filter(
      (entry) => entry.formalManifest.version === 2
        && entry.formalManifest.state === 'in_progress',
    )
    expect(formalV2Pilots).toHaveLength(10)
    expect(formalV2Pilots.every((entry) => (
      entry.upgradeStage === 'formal_v2_reconciliation_required'
      && entry.reconciliation.state === 'in_progress'
      && !entry.gates.publicationEligible
    ))).toBe(true)
  })

  it('fails closed if a cohort candidate is enabled or no longer pending', () => {
    const { build } = buildCurrentSourceManifestCohort('2026-08-10', resolve('.'))
    const candidateBuild = structuredClone(build)
    candidateBuild.candidates[0]!.manifest.sources[0]!.enabled = true

    expect(() => buildSourceManifestTrustLedger({
      checkedAt: '2026-08-10',
      publicUniversities: [{
        id: candidateBuild.candidates[0]!.manifest.institutionId,
        slug: 'test-university',
        name: { en: 'Test University', zh: '测试大学' },
      }],
      formalManifests: [],
      candidateBuild,
    })).toThrow(/not safely disabled and pending/)
  })

  it('never makes representative discovery publication eligible', () => {
    const { build } = buildCurrentSourceManifestCohort('2026-08-10', resolve('.'))
    const candidateBuild = structuredClone(build)
    const candidate = candidateBuild.candidates[0]!
    const representative = structuredClone(candidate.manifest)
    representative.manifestStatus = 'complete'
    representative.catalogReconciliation.status = 'complete'
    representative.catalogReconciliation.scope = 'representative_international_programs'
    representative.catalogReconciliation.entries = representative.catalogReconciliation.entries
      .map((entry, index) => ({
        ...entry,
        status: 'published' as const,
        recordId: `program-review-${index + 1}`,
      }))

    const report = buildSourceManifestTrustLedger({
      checkedAt: '2026-08-10',
      publicUniversities: [{
        id: representative.institutionId,
        slug: 'representative-test',
        name: { en: 'Representative Test', zh: '代表性发现测试' },
      }],
      formalManifests: [representative],
      candidateBuild,
    })

    expect(report.entries).toHaveLength(1)
    expect(report.entries[0]).toMatchObject({
      status: 'in_progress',
      reconciliation: { state: 'in_progress', basis: 'formal_v2' },
      gates: {
        publicationEligible: false,
        candidateEvidenceOnly: true,
        requiresHumanReview: true,
      },
    })
    expect(report.summary.completeFormalReconciliations).toBe(0)
  })

  it('requires an explicit real date and an explicit output option', () => {
    expect(parseSourceManifestTrustLedgerCli([
      '--checked-at', '2026-08-10',
    ])).toEqual({ checkedAt: '2026-08-10' })
    expect(parseSourceManifestTrustLedgerCli([
      '--checked-at', '2026-08-10', '--output', 'ledger.json',
    ])).toEqual({
      checkedAt: '2026-08-10',
      outputPath: 'ledger.json',
    })
    expect(() => parseSourceManifestTrustLedgerCli([
      '--checked-at', '2026-02-30',
    ])).toThrow(/real YYYY-MM-DD/)
    expect(() => parseSourceManifestTrustLedgerCli([
      '--checked-at', '2026-08-10', '--write-formal',
    ])).toThrow(/Unknown CLI option/)
  })
})
