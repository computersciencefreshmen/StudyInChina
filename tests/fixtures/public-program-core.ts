import type { AdmissionCycle, DataBundle, Program } from '../../src/lib/data/types'

/** Synthetic prerequisites for tests of unrelated filtering/tuition behaviour.
 * Real catalogue rows are never edited by this fixture helper. */
export function addFixturePublicCore(bundle: DataBundle, target: Program, today: string, existingCycle?: AdmissionCycle) {
  const program = bundle.programs.find(record => record.id === target.id)!
  const reviewAfter = new Date(Date.parse(today + 'T00:00:00Z') + 30 * 86400_000).toISOString().slice(0, 10)
  const audit = { status: 'verified' as const, verifiedAt: today, reviewAfter, sourceIds: program.sourceIds }
  Object.assign(program, audit, { verificationScope: 'facts', teachingLanguages: ['English'], durationMonths: program.durationMonths ?? 48,
    applyUrl: new URL('/fixture-apply', program.programUrl).href, languageRequirements: [{ test: 'IELTS', minimum: '6.5' }],
    supplementaryDetails: { ...program.supplementaryDetails, eligibility: [{ en: 'Fixture applicants hold the prerequisite diploma.' }] } })
  const cycle = existingCycle ?? { id: `fixture-core-${program.id}`, programId: program.id, tuitionCny: null, applicationFeeCny: null }
  Object.assign(cycle, audit, { academicYear: `${today.slice(0, 4)}-${Number(today.slice(0, 4)) + 1}`, intake: 'other',
    ...(!existingCycle ? { teachingLanguage: 'English', applicationRound: 'fixture-core' } : {}), opensOn: null, closesOn: reviewAfter, dateStatus: 'published',
    factScope: 'partial', evidenceBasis: 'cycle-specific', applyUrl: program.applyUrl,
    languageRequirements: program.languageRequirements, eligibility: program.supplementaryDetails!.eligibility })
  if (!existingCycle) bundle.admissionCycles.push(cycle as AdmissionCycle)
}
