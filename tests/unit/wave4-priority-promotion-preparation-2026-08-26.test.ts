import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)

type JsonRecord = ReturnType<typeof JSON.parse>

const root = process.cwd()
const qualityDir = path.resolve(root, 'quality/official-depth-wave-4-2026-08-26')
const ledger = JSON.parse(fs.readFileSync(path.join(qualityDir, 'priority-ledger.json'), 'utf8')) as JsonRecord
const closure = JSON.parse(fs.readFileSync(path.join(qualityDir, 'priority-source-closure.json'), 'utf8')) as JsonRecord
const receipt = JSON.parse(fs.readFileSync(path.join(qualityDir, 'priority-r2-receipt-2026-08-26.json'), 'utf8')) as JsonRecord

const preparer = require(path.resolve(
  root,
  'scripts/ingestion/prepare-wave4-priority-promotion-2026-08-26.cjs',
)) as JsonRecord
const importer = require(path.resolve(
  root,
  'scripts/ingestion/apply-wave4-priority-promotions-2026-08-26.cjs',
)) as JsonRecord

function ledgerProgram(programId: string): JsonRecord {
  return ledger.universities
    .flatMap((university: JsonRecord) => university.programs)
    .find((program: JsonRecord) => program.programId === programId)
}

describe('Wave 4 minimum official-source closure', () => {
  it('computes exactly 38 safe packages from a minimum 26-source closure', () => {
    const rebuilt = preparer.buildClosure(ledger)
    expect(rebuilt).toEqual(closure)
    expect(closure.summary).toMatchObject({
      safePackages: 38,
      minimumSources: 26,
      hosts: 11,
      redundantSourcesExcluded: ['shu-scholarship-live'],
      historicalStaleReferencePackages: 10,
    })
    expect(closure.sources.some((source: JsonRecord) => source.sourceId === 'shu-scholarship-live')).toBe(false)
    expect(new Set(closure.packages.map((item: JsonRecord) => item.programId)).size).toBe(38)
  })

  it('allows only registered official HTTPS hosts and records compliant serialized host starts', () => {
    for (const source of closure.sources) {
      const url = new URL(source.officialUrl)
      expect(url.protocol).toBe('https:')
      expect(preparer.OFFICIAL_HOST_ALLOWLIST.has(url.hostname), source.sourceId).toBe(true)
      expect(url.port, source.sourceId).toBe('')
    }
    expect(receipt.requestAudit.adjacentHostIntervalsCompliant).toBe(true)

    const lastByHost = new Map<string, number>()
    for (const start of receipt.requestAudit.starts) {
      const timestamp = Date.parse(start.startedAt)
      const previous = lastByHost.get(start.host)
      if (previous !== undefined) {
        expect(timestamp - previous, start.host).toBeGreaterThanOrEqual(
          preparer.MINIMUM_HOST_INTERVAL_MS,
        )
      }
      lastByHost.set(start.host, timestamp)
    }
  })

  it('contains only full-hash readback confirmations and keeps failures quarantined', () => {
    expect(receipt.sanitized).toBe(true)
    expect(receipt.summary.sources).toBe(26)
    expect(receipt.summary.confirmedSources).toBeGreaterThanOrEqual(23)
    expect(receipt.summary.readyPackages).toBeGreaterThanOrEqual(33)

    const sanitized = JSON.stringify(receipt)
    expect(sanitized).not.toMatch(/[A-Z]:\\Users\\/i)
    expect(sanitized).not.toMatch(/cloudflare[_ -]?(api[_ -]?)?token|account[_ -]?id|bearer\s+[a-z0-9]/i)

    const permittedQuarantine = new Set([
      'njust-official-application',
      'njust-undergraduate-catalogue-2026',
      'swu-icl-scholarship-2026',
    ])
    for (const source of receipt.sources) {
      if (source.status === 'confirmed') {
        expect(source.fullReadbackVerified, source.sourceId).toBe(true)
        expect(source.artifactSha256, source.sourceId).toMatch(/^[a-f0-9]{64}$/)
        expect(source.byteLength, source.sourceId).toBeGreaterThan(0)
        expect(source.r2Key, source.sourceId).toContain(source.artifactSha256)
        expect(source.r2Uri, source.sourceId).toBe(
          `r2://studyinchina-source-snapshots/${source.r2Key}`,
        )
      } else {
        expect(permittedQuarantine.has(source.sourceId), source.sourceId).toBe(true)
        expect(source.fullReadbackVerified, source.sourceId).toBe(false)
        expect(source.r2Key, source.sourceId).toBeUndefined()
      }
    }
  })
})

describe('Wave 4 fail-closed staged importer', () => {
  it('stages only packages whose complete selected dependency closure is confirmed', () => {
    const staged = importer.buildStagedImport(ledger, closure, receipt)
    expect(staged.formalCatalogWrite).toBe(false)
    expect(staged.summary.stagedCandidates).toBe(receipt.summary.readyPackages)
    expect(staged.summary.blockedCandidates).toBe(receipt.summary.blockedPackages)

    const confirmedSources = new Set(
      receipt.sources
        .filter((source: JsonRecord) => importer.sourceIsConfirmed(source))
        .map((source: JsonRecord) => source.sourceId),
    )
    for (const candidate of staged.candidates) {
      expect(
        candidate.sourceDependencies.every((source: JsonRecord) => confirmedSources.has(source.sourceId)),
        candidate.programId,
      ).toBe(true)
    }
    expect(staged.candidates.some((candidate: JsonRecord) =>
      candidate.programId === 'prog-gap-chinese-degree-blcu-international-chinese-education-doctorate')).toBe(false)
  })

  it('blocks every dependent package if one readback proof is damaged', () => {
    const confirmed = receipt.sources.find((source: JsonRecord) => source.status === 'confirmed')
    const damagedReceipt = structuredClone(receipt)
    const damaged = damagedReceipt.sources.find((source: JsonRecord) => source.sourceId === confirmed.sourceId)
    damaged.fullReadbackVerified = false

    const staged = importer.buildStagedImport(ledger, closure, damagedReceipt)
    const dependents = new Set<string>(
      closure.packages
        .filter((item: JsonRecord) => item.sourceIds.includes(confirmed.sourceId))
        .map((item: JsonRecord) => item.programId),
    )
    const stagedIds = new Set<string>(
      staged.candidates.map((item: JsonRecord) => String(item.programId)),
    )
    for (const dependent of dependents) expect(stagedIds.has(dependent), dependent).toBe(false)
  })

  it('keeps all ten historical-cycle packages stale/reference and out of current metrics', () => {
    const staged = importer.buildStagedImport(ledger, closure, receipt)
    const historicalIds = new Set(
      closure.packages
        .filter((item: JsonRecord) => item.decision === 'promote_historical_cycle_only')
        .map((item: JsonRecord) => item.programId),
    )
    expect(historicalIds.size).toBe(10)
    const historical = staged.candidates.filter((item: JsonRecord) => historicalIds.has(item.programId))
    expect(historical).toHaveLength(10)
    for (const candidate of historical) {
      expect(candidate.cycleProjection.cycleStatus, candidate.programId).toBe('stale')
      expect(candidate.cycleProjection.dateStatus, candidate.programId).toBe('previous-cycle-reference')
      expect(candidate.cycleProjection.tuitionStatus, candidate.programId).toBe('reference')
      expect(candidate.cycleProjection.eligibleForCurrentConfirmedMetric, candidate.programId).toBe(false)
      expect(candidate.cycleProjection.eligibleForDatedOrRollingMetric, candidate.programId).toBe(false)
      expect(candidate.cycleProjection.eligibleForActiveUpcomingMetric, candidate.programId).toBe(false)
    }
  })

  it('does not promote reference tuition as confirmed and closes expired 2026 dates', () => {
    const staged = importer.buildStagedImport(ledger, closure, receipt)
    const referenceStatuses = importer.REFERENCE_TUITION_STATUSES as Set<string>
    for (const candidate of staged.candidates) {
      const sourceProgram = ledgerProgram(candidate.programId)
      if (referenceStatuses.has(sourceProgram.facts.tuition.status)) {
        expect(candidate.cycleProjection.tuitionStatus, candidate.programId).toBe('reference')
      }
      const deadline = candidate.cycleProjection.deadline
      if (typeof deadline === 'string' && deadline <= '2026-08-26') {
        expect(candidate.cycleProjection.cycleStatus, candidate.programId).toBe('stale')
        expect(candidate.cycleProjection.eligibleForActiveUpcomingMetric, candidate.programId).toBe(false)
      }
    }
  })

  it('is deterministic and refuses formal content/data writes by default', () => {
    const first = importer.buildStagedImport(ledger, closure, receipt)
    const second = importer.buildStagedImport(ledger, closure, receipt)
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
    expect(() => importer.assertSafeOutput(
      path.join(root, 'content/data/programs.json'),
    )).toThrow('formal_content_data_write_refused')
  })
})
