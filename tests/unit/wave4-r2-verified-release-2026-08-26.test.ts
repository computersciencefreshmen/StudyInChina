import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
type JsonValue = ReturnType<typeof JSON.parse>

const root = process.cwd()
const qualityDir = path.resolve(root, 'quality/official-depth-wave-4-2026-08-26')
const readJson = (filePath: string): JsonValue => JSON.parse(fs.readFileSync(filePath, 'utf8'))

const ledger = readJson(path.join(qualityDir, 'priority-ledger.json'))
const closure = readJson(path.join(qualityDir, 'priority-source-closure.json'))
const receipt = readJson(path.join(qualityDir, 'priority-r2-receipt-2026-08-26.json'))
const staged = readJson(path.join(qualityDir, 'priority-staged-import.json'))
const input = {
  sources: readJson(path.join(root, 'content/data/sources.json')),
  programs: readJson(path.join(root, 'content/data/programs.json')),
  admissionCycles: readJson(path.join(root, 'content/data/admission-cycles.json')),
}
const releaseBuilder = require(path.join(
  root,
  'scripts/ingestion/apply-wave4-r2-verified-release-2026-08-26.cjs',
)) as JsonValue

function findProgram(release: JsonValue, programId: string): JsonValue {
  return release.output.programs.find((program: JsonValue) => program.id === programId)
}

function findCycle(release: JsonValue, programId: string): JsonValue {
  return release.output.admissionCycles.find((cycle: JsonValue) => cycle.programId === programId)
}

describe('Wave 4 R2-verified compatibility release', () => {
  it('publishes only the 33 ready packages backed by 22 full-readback sources', () => {
    const release = releaseBuilder.applyCompatibilityRelease(input, ledger, closure, receipt, staged)
    const alreadyApplied = input.sources.some(
      (source: JsonValue) => source.id === staged.candidates[0].sourceDependencies[0].sourceId,
    )
    const changeCount = (firstApply: number) => (alreadyApplied ? 0 : firstApply)
    const urlOnlyProgram = input.programs.find(
      (program: JsonValue) => program.id === 'prog-gap-confirmed-swu-chinese-language-training',
    )
    const needsFactsScopeRepair = alreadyApplied
      && urlOnlyProgram?.verificationScope === 'facts'
      && urlOnlyProgram?.durationMonths === null
      && urlOnlyProgram?.teachingLanguages.length === 0
      && urlOnlyProgram?.languageRequirements.length === 0
    const readyProgramIds = new Set(
      staged.candidates.map((candidate: JsonValue) => candidate.programId),
    )
    const cycleScopeRepairs = alreadyApplied
      ? input.admissionCycles.filter((cycle: JsonValue) => {
          if (!readyProgramIds.has(cycle.programId)) return false
          const expectedScope = cycle.tuitionCny !== null && cycle.applicationFeeCny !== null
            ? 'complete'
            : (cycle.tuitionCny !== null || cycle.applicationFeeCny !== null
                ? 'partial'
                : 'dates-only')
          return cycle.factScope !== expectedScope
        })
      : []
    const repairedCycleCount = (
      status: string,
      dateStatus: string,
    ) => cycleScopeRepairs.filter((cycle: JsonValue) => (
      cycle.status === status && cycle.dateStatus === dateStatus
    )).length
    expect(release.summary).toMatchObject({
      stagedCandidates: 33,
      blockedCandidates: 5,
      verifiedSourceDependencies: 22,
      sourcesAdded: changeCount(22),
      programsUpdated: alreadyApplied ? Number(needsFactsScopeRepair) : 33,
      cyclesAdded: changeCount(9),
      cyclesUpdated: alreadyApplied ? cycleScopeRepairs.length : 23,
      candidatesWithoutCycle: 1,
      currentCyclesMaterialized: alreadyApplied
        ? repairedCycleCount('verified', 'published')
        : 6,
      notAnnouncedCyclesMaterialized: alreadyApplied
        ? repairedCycleCount('verified', 'not-announced')
        : 2,
      historicalOrReferenceCyclesMaterialized: alreadyApplied
        ? repairedCycleCount('stale', 'previous-cycle-reference')
        : 24,
      variantTuitionValuesPublished: 0,
      fieldUpdates: {
        duration: changeCount(10),
        applyUrl: changeCount(15),
        languageRequirements: changeCount(8),
        teachingLanguages: changeCount(2),
        programUrl: changeCount(13),
      },
    })

    const outputSourceIds = new Set(
      release.output.sources.map((source: JsonValue) => source.id),
    )
    for (const candidate of staged.candidates) {
      for (const dependency of candidate.sourceDependencies) {
        expect(outputSourceIds.has(dependency.sourceId), dependency.sourceId).toBe(true)
      }
    }
    for (const blocked of staged.blocked) {
      for (const sourceId of blocked.blockingSourceIds) {
        expect(outputSourceIds.has(sourceId), sourceId).toBe(false)
      }
    }
  })

  it('fills only unambiguous program facts and keeps variants isolated', () => {
    const release = releaseBuilder.applyCompatibilityRelease(input, ledger, closure, receipt, staged)
    expect(findProgram(release, 'program-southwest-university-education-bachelor')).toMatchObject({
      status: 'verified',
      durationMonths: 48,
      teachingLanguages: ['Chinese'],
      applyUrl: 'https://swu.17gz.org/member/login.do',
      programUrl: 'https://admissions.swu.edu.cn/Degree_Programs/Undergraduate/Education.htm',
    })
    expect(findProgram(release, 'program-southwest-university-environmental-science-master')).toMatchObject({
      status: 'verified',
      durationMonths: 36,
      teachingLanguages: ['Chinese', 'English'],
    })
    expect(findProgram(release, 'prog-gap-chinese-degree-ecnu-international-chinese-education-master')).toMatchObject({
      durationMonths: 24,
      applyUrl: 'https://lxsapply.ecnu.edu.cn/',
      languageRequirements: [{ test: 'HSK', minimum: 'Level 5, 210' }],
    })
    expect(findProgram(release, 'prog-gap-confirmed-swu-chinese-language-training')).toMatchObject({
      status: 'verified',
      verificationScope: 'identity',
      durationMonths: null,
      teachingLanguages: [],
      languageRequirements: [],
      applyUrl: 'https://swu.17gz.org/member/login.do',
      programUrl: 'https://admissions.swu.edu.cn/info/1048/1051.htm',
    })

    const environmentalCycle = findCycle(
      release,
      'program-southwest-university-environmental-science-master',
    )
    expect(environmentalCycle.tuitionCny).toBeNull()
    expect(environmentalCycle.tuitionStatus).toBeNull()

    const chineseTrainingCycles = release.output.admissionCycles.filter(
      (cycle: JsonValue) => cycle.programId === 'prog-gap-confirmed-swu-chinese-language-training',
    )
    expect(chineseTrainingCycles).toHaveLength(0)

    const fudanVariantCycle = findCycle(
      release,
      'program-fudan-university-chinese-economy-and-business-program-language',
    )
    expect(fudanVariantCycle.tuitionCny).toBeNull()
    expect(fudanVariantCycle.dateStatus).toBe('previous-cycle-reference')
  })

  it('never promotes conflicting or expired dates as open', () => {
    const release = releaseBuilder.applyCompatibilityRelease(input, ledger, closure, receipt, staged)
    const bfsuFinance = findCycle(
      release,
      'program-beijing-foreign-studies-university-finance-bachelor',
    )
    expect(bfsuFinance).toMatchObject({
      status: 'stale',
      dateStatus: 'previous-cycle-reference',
      opensOn: null,
      closesOn: null,
      tuitionCny: 39900,
      tuitionStatus: 'reference',
    })

    const changedCandidateIds = new Set(
      staged.candidates.map((candidate: JsonValue) => candidate.programId),
    )
    for (const cycle of release.output.admissionCycles) {
      if (!changedCandidateIds.has(cycle.programId)) continue
      if (cycle.closesOn && cycle.closesOn <= releaseBuilder.AUDIT_DATE) {
        expect(cycle.status, cycle.id).toBe('stale')
        expect(cycle.dateStatus, cycle.id).toBe('previous-cycle-reference')
      }
    }

    const currentCycles = release.output.admissionCycles.filter((cycle: JsonValue) => (
      changedCandidateIds.has(cycle.programId)
      && cycle.status === 'verified'
      && cycle.dateStatus === 'published'
    ))
    expect(currentCycles).toHaveLength(6)
    expect(currentCycles.every((cycle: JsonValue) => cycle.closesOn > releaseBuilder.AUDIT_DATE)).toBe(true)
    const currentCyclesWithoutFees = currentCycles.filter((cycle: JsonValue) => (
      cycle.tuitionCny === null && cycle.applicationFeeCny === null
    ))
    expect(currentCyclesWithoutFees).toHaveLength(4)
    expect(currentCyclesWithoutFees.every(
      (cycle: JsonValue) => cycle.factScope === 'dates-only',
    )).toBe(true)
    const candidateCycles = release.output.admissionCycles.filter(
      (cycle: JsonValue) => changedCandidateIds.has(cycle.programId),
    )
    expect(candidateCycles.filter(
      (cycle: JsonValue) => cycle.factScope === 'partial',
    ).every((cycle: JsonValue) => (
      cycle.tuitionCny !== null || cycle.applicationFeeCny !== null
    ))).toBe(true)
  })

  it('does not modify blocked program or cycle records', () => {
    const release = releaseBuilder.applyCompatibilityRelease(input, ledger, closure, receipt, staged)
    const blockedIds = new Set(staged.blocked.map((item: JsonValue) => item.programId))
    const originalPrograms = input.programs.filter((program: JsonValue) => blockedIds.has(program.id))
    const outputPrograms = release.output.programs.filter((program: JsonValue) => blockedIds.has(program.id))
    const originalCycles = input.admissionCycles.filter((cycle: JsonValue) => blockedIds.has(cycle.programId))
    const outputCycles = release.output.admissionCycles.filter((cycle: JsonValue) => blockedIds.has(cycle.programId))
    expect(outputPrograms).toEqual(originalPrograms)
    expect(outputCycles).toEqual(originalCycles)
  })

  it('is idempotent and fails closed if a receipt proof is damaged', () => {
    const first = releaseBuilder.applyCompatibilityRelease(input, ledger, closure, receipt, staged)
    const second = releaseBuilder.applyCompatibilityRelease(first.output, ledger, closure, receipt, staged)
    expect(second.output).toEqual(first.output)
    expect(second.summary).toMatchObject({
      sourcesAdded: 0,
      sourcesUpdated: 0,
      programsUpdated: 0,
      cyclesAdded: 0,
      cyclesUpdated: 0,
      variantTuitionValuesPublished: 0,
    })

    const damagedReceipt = structuredClone(receipt)
    const dependency = staged.candidates[0].sourceDependencies[0]
    const damaged = damagedReceipt.sources.find(
      (source: JsonValue) => source.sourceId === dependency.sourceId,
    )
    damaged.fullReadbackVerified = false
    expect(() => releaseBuilder.applyCompatibilityRelease(
      input,
      ledger,
      closure,
      damagedReceipt,
      staged,
    )).toThrow()
  })
})
