import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

type Source = {
  id: string
  url: string
  checkedAt: string
  locator?: { type?: string }
}

type Fact = {
  status: string
  evidenceRefs?: string[]
}

type Program = {
  programId: string
  decision: string
  facts: Record<string, Fact>
  conflicts: string[]
}

type University = {
  name: string
  sources: Source[]
  programs: Program[]
}

type Ledger = {
  auditAsOf: string
  summary: {
    promoteCurrentOrStablePrograms: number
    promoteHistoricalCycleOnlyPrograms: number
    historicalReferenceOnlyPrograms: number
    quarantinedPrograms: number
    safeIngestableProgramsIncludingHiddenHistory: number
    remainingIsolatedPrograms: number
  }
  evidenceAudit: {
    unsupportedStatusClaimsBefore: number
    evidenceRefsAdded: number
    downgradedToUnknown: number
    unsupportedStatusClaimsAfter: number
    conflictProgramsNewlyQuarantined: number
    safelyPromotableProgramsIncludingHiddenHistory: number
  }
  universities: University[]
}

const ledgerPath = path.resolve(
  process.cwd(),
  'quality/official-depth-wave-4-2026-08-26/priority-ledger.json',
)
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8')) as Ledger
const nonEvidentiaryStatuses = new Set<string>([
  'unknown',
  'source_unavailable',
  'pending',
  'quarantine',
])

function allPrograms(): Program[] {
  return ledger.universities.flatMap((university) => university.programs)
}

describe('Wave 4 priority ledger P1 evidence audit', () => {
  it('resolves every evidentiary status to a registered official HTTPS source', () => {
    for (const university of ledger.universities) {
      const sourcesById = new Map(
        university.sources.map((source) => [source.id, source]),
      )

      for (const source of university.sources) {
        const url = new URL(source.url)
        expect(url.protocol, source.id).toBe('https:')
        expect(url.hostname.endsWith('.edu.cn'), source.id).toBe(true)
        expect(source.checkedAt, source.id).toBe(ledger.auditAsOf)
        expect(source.locator?.type, source.id).toBeTruthy()
      }

      for (const program of university.programs) {
        for (const [factName, fact] of Object.entries(program.facts)) {
          if (nonEvidentiaryStatuses.has(fact.status)) continue

          expect(
            fact.evidenceRefs?.length ?? 0,
            `${program.programId}:${factName}:${fact.status}`,
          ).toBeGreaterThan(0)

          for (const evidenceRef of fact.evidenceRefs ?? []) {
            expect(
              sourcesById.has(evidenceRef),
              `${program.programId}:${factName}:${evidenceRef}`,
            ).toBe(true)
          }
        }
      }
    }
  })

  it('records the complete 38-claim remediation without hiding downgrades', () => {
    expect(ledger.evidenceAudit).toMatchObject({
      unsupportedStatusClaimsBefore: 38,
      evidenceRefsAdded: 36,
      downgradedToUnknown: 2,
      unsupportedStatusClaimsAfter: 0,
      conflictProgramsNewlyQuarantined: 1,
      safelyPromotableProgramsIncludingHiddenHistory: 38,
    })
  })

  it('quarantines the BLCU doctorate duration conflict', () => {
    const blcu = ledger.universities.find(
      (university) => university.name === 'Beijing Language and Culture University',
    )
    const doctorate = blcu?.programs.find(
      (program) => program.programId
        === 'prog-gap-chinese-degree-blcu-international-chinese-education-doctorate',
    )

    expect(doctorate).toBeDefined()
    expect(doctorate?.decision).toBe('quarantine')
    expect(doctorate?.facts.duration.status)
      .toBe('conflict_quarantined_semantic_split')
    expect(doctorate?.conflicts.join(' ')).toContain('48 months')
  })

  it('keeps the summary equal to computed decision counts', () => {
    const programs = allPrograms()
    const counts = new Map<string, number>()
    for (const program of programs) {
      counts.set(program.decision, (counts.get(program.decision) ?? 0) + 1)
    }

    const safelyPromotable = programs.filter(
      (program) => program.decision.startsWith('promote_'),
    ).length
    const isolated = programs.length - safelyPromotable

    expect(counts.get('promote_current_or_stable')).toBe(
      ledger.summary.promoteCurrentOrStablePrograms,
    )
    expect(counts.get('promote_historical_cycle_only')).toBe(
      ledger.summary.promoteHistoricalCycleOnlyPrograms,
    )
    expect(counts.get('historical_reference_only')).toBe(
      ledger.summary.historicalReferenceOnlyPrograms,
    )
    expect(counts.get('quarantine')).toBe(ledger.summary.quarantinedPrograms)
    expect(safelyPromotable).toBe(
      ledger.summary.safeIngestableProgramsIncludingHiddenHistory,
    )
    expect(isolated).toBe(ledger.summary.remainingIsolatedPrograms)
  })
})
