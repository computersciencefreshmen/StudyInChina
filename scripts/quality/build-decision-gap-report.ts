import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import { getTodayDate } from '../../src/lib/data/freshness'
import { selectPublishedData } from '../../src/lib/data/publication'
import { bundleSchema } from '../../src/lib/data/schema'
import type { DataBundle, Program, University } from '../../src/lib/data/types'

export type DecisionFactKey =
  | 'duration'
  | 'currentConfirmedTuition'
  | 'officialApplyRoute'
  | 'teachingLanguage'
  | 'requirements'
  | 'freshDisposition'

export const DECISION_FACT_ORDER: DecisionFactKey[] = [
  'freshDisposition',
  'currentConfirmedTuition',
  'officialApplyRoute',
  'requirements',
  'duration',
  'teachingLanguage',
]

export const DECISION_FACT_WEIGHTS: Record<DecisionFactKey, number> = {
  duration: 2,
  currentConfirmedTuition: 5,
  officialApplyRoute: 4,
  teachingLanguage: 2,
  requirements: 3,
  freshDisposition: 6,
}

export type DecisionFactCoverage = Record<DecisionFactKey, boolean>

export type ProgramDecisionGap = {
  programId: string
  slug: string
  universityId: string
  universityNameZh: string
  universityNameEn: string
  programNameZh: string
  programNameEn: string
  degreeLevel: Program['degreeLevel']
  discipline: Program['discipline']
  availability: DecisionFactCoverage
  missingFacts: DecisionFactKey[]
  gapScore: number
  valueBoost: number
  valueBoostReasons: string[]
  priorityScore: number
  evidence: {
    currentConfirmedTuitionCycleIds: string[]
    freshDispositionCycleIds: string[]
    officialApplyRouteSourceIds: string[]
  }
}

export type UniversityDecisionGap = {
  universityId: string
  slug: string
  nameZh: string
  nameEn: string
  featured: boolean
  publicProgramCount: number
  programsWithAllDecisionFacts: number
  missingFactCounts: Record<DecisionFactKey, number>
  totalMissingFacts: number
  completionPct: number
  priorityScore: number
  recommendedProgramIds: string[]
}

export type RankedProgramDecisionGap = ProgramDecisionGap & { rank: number }
export type RankedUniversityDecisionGap = UniversityDecisionGap & { rank: number }

export type DecisionGapReport = {
  schemaVersion: 1
  evaluatedForDate: string
  deterministicGeneratedAt: string
  priorityLimit: number
  methodology: {
    catalogScope: string
    currentConfirmedTuition: string
    officialApplyRoute: string
    freshDisposition: string
    requirements: string
    programGapWeights: Record<DecisionFactKey, number>
    valueBoosts: Record<string, number>
    universityPriority: string
  }
  summary: {
    publicUniversities: number
    publicPrograms: number
    programsWithAllDecisionFacts: number
    programsWithAnyGap: number
    factCoverage: Record<DecisionFactKey, {
      covered: number
      missing: number
      coveragePct: number
    }>
  }
  universities: UniversityDecisionGap[]
  programs: ProgramDecisionGap[]
  priorityUniversities: RankedUniversityDecisionGap[]
  priorityPrograms: RankedProgramDecisionGap[]
}

type BuildOptions = {
  today?: string
  priorityLimit?: number
  generatedAt?: string
}

type CliOptions = {
  dataDir: string
  today: string
  priorityLimit: number
  outputPath: string | null
}

const VALUE_BOOSTS = {
  featuredUniversity: 3,
  chineseLanguageOrEducation: 2,
  advancedDegree: 1,
} as const

function assertIsoDate(value: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new Error(`${label} must use YYYY-MM-DD`)
  }
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} must be a real calendar date`)
  }
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer`)
  }
}

function shiftIsoDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function percent(numerator: number, denominator: number): number {
  if (denominator === 0) return 0
  return Math.round((numerator / denominator) * 10_000) / 100
}

function roundScore(value: number): number {
  return Math.round(value * 100) / 100
}

function localizedName(
  name: { zh?: string; en?: string },
  locale: 'zh' | 'en',
  fallback: string,
): string {
  return name[locale] ?? name.zh ?? name.en ?? fallback
}

function hasRequirements(program: Program): boolean {
  return program.languageRequirements.length > 0
    || Boolean(program.details?.eligibility.some(
      (item) => Object.values(item).some((value) => Boolean(value?.trim())),
    ))
}

function programValueBoost(
  program: Program,
  university: University,
): { score: number; reasons: string[] } {
  const reasons: string[] = []
  let score = 0

  if (university.featured) {
    score += VALUE_BOOSTS.featuredUniversity
    reasons.push('featured_university')
  }
  if (program.degreeLevel === 'language' || program.discipline === 'chinese-education') {
    score += VALUE_BOOSTS.chineseLanguageOrEducation
    reasons.push('chinese_language_or_education')
  }
  if (program.degreeLevel === 'master' || program.degreeLevel === 'doctorate') {
    score += VALUE_BOOSTS.advancedDegree
    reasons.push('advanced_degree')
  }

  return { score, reasons }
}

function comparePrograms(left: ProgramDecisionGap, right: ProgramDecisionGap): number {
  return right.priorityScore - left.priorityScore
    || right.gapScore - left.gapScore
    || left.universityNameEn.localeCompare(right.universityNameEn, 'en')
    || left.programNameEn.localeCompare(right.programNameEn, 'en')
    || left.programId.localeCompare(right.programId, 'en')
}

function compareUniversities(
  left: UniversityDecisionGap,
  right: UniversityDecisionGap,
): number {
  return right.priorityScore - left.priorityScore
    || right.totalMissingFacts - left.totalMissingFacts
    || left.nameEn.localeCompare(right.nameEn, 'en')
    || left.universityId.localeCompare(right.universityId, 'en')
}

function emptyMissingFactCounts(): Record<DecisionFactKey, number> {
  return {
    duration: 0,
    currentConfirmedTuition: 0,
    officialApplyRoute: 0,
    teachingLanguage: 0,
    requirements: 0,
    freshDisposition: 0,
  }
}

export function buildDecisionGapReport(
  rawBundle: DataBundle,
  options: BuildOptions = {},
): DecisionGapReport {
  const today = options.today ?? getTodayDate()
  const priorityLimit = options.priorityLimit ?? 30
  assertIsoDate(today, 'today')
  assertPositiveInteger(priorityLimit, 'priorityLimit')

  const published = selectPublishedData(rawBundle, today)
  const freshDispositionCutoff = shiftIsoDate(today, -30)
  const officialSourceIds = new Set(
    rawBundle.sources.filter((source) => source.official).map((source) => source.id),
  )
  const universityById = new Map(
    published.universities.map((university) => [university.id, university]),
  )
  const cyclesByProgram = new Map<string, DataBundle['admissionCycles']>()
  for (const cycle of published.admissionCycles) {
    const cycles = cyclesByProgram.get(cycle.programId) ?? []
    cycles.push(cycle)
    cyclesByProgram.set(cycle.programId, cycles)
  }

  const programs = published.programs.map((program): ProgramDecisionGap => {
    const university = universityById.get(program.universityId)
    if (!university) {
      throw new Error(`Published program ${program.id} has no published university`)
    }
    const cycles = cyclesByProgram.get(program.id) ?? []
    const currentConfirmedTuitionCycleIds = cycles
      .filter((cycle) => cycle.tuitionCny !== null && cycle.tuitionStatus === 'confirmed')
      .map((cycle) => cycle.id)
      .sort()
    const freshDispositionCycleIds = cycles
      .filter((cycle) => (
        cycle.verifiedAt >= freshDispositionCutoff
        && cycle.verifiedAt <= today
      ))
      .map((cycle) => cycle.id)
      .sort()
    const officialApplyRouteSourceIds = program.applyUrl
      ? program.sourceIds.filter((sourceId) => officialSourceIds.has(sourceId)).sort()
      : []
    const availability: DecisionFactCoverage = {
      duration: program.durationMonths !== null && program.durationMonths > 0,
      currentConfirmedTuition: currentConfirmedTuitionCycleIds.length > 0,
      officialApplyRoute: Boolean(program.applyUrl?.trim())
        && officialApplyRouteSourceIds.length > 0,
      teachingLanguage: program.teachingLanguages.some(
        (language) => language.trim().length > 0,
      ),
      requirements: hasRequirements(program),
      freshDisposition: freshDispositionCycleIds.length > 0,
    }
    const missingFacts = DECISION_FACT_ORDER.filter((fact) => !availability[fact])
    const gapScore = missingFacts.reduce(
      (total, fact) => total + DECISION_FACT_WEIGHTS[fact],
      0,
    )
    const valueBoost = programValueBoost(program, university)

    return {
      programId: program.id,
      slug: program.slug,
      universityId: university.id,
      universityNameZh: localizedName(university.name, 'zh', university.slug),
      universityNameEn: localizedName(university.name, 'en', university.slug),
      programNameZh: localizedName(program.name, 'zh', program.slug),
      programNameEn: localizedName(program.name, 'en', program.slug),
      degreeLevel: program.degreeLevel,
      discipline: program.discipline,
      availability,
      missingFacts,
      gapScore,
      valueBoost: valueBoost.score,
      valueBoostReasons: valueBoost.reasons,
      priorityScore: gapScore + valueBoost.score,
      evidence: {
        currentConfirmedTuitionCycleIds,
        freshDispositionCycleIds,
        officialApplyRouteSourceIds,
      },
    }
  }).sort((left, right) => (
    left.universityId.localeCompare(right.universityId, 'en')
    || left.programId.localeCompare(right.programId, 'en')
  ))

  const programsByUniversity = new Map<string, ProgramDecisionGap[]>()
  for (const program of programs) {
    const records = programsByUniversity.get(program.universityId) ?? []
    records.push(program)
    programsByUniversity.set(program.universityId, records)
  }

  const universities = published.universities.map((university): UniversityDecisionGap => {
    const universityPrograms = programsByUniversity.get(university.id) ?? []
    const missingFactCounts = emptyMissingFactCounts()
    for (const program of universityPrograms) {
      for (const fact of program.missingFacts) missingFactCounts[fact] += 1
    }
    const totalMissingFacts = Object.values(missingFactCounts)
      .reduce((total, count) => total + count, 0)
    const topPrograms = universityPrograms
      .filter((program) => program.gapScore > 0)
      .sort(comparePrograms)
      .slice(0, 3)
    const topProgramAverage = topPrograms.length === 0
      ? 0
      : topPrograms.reduce((total, program) => total + program.priorityScore, 0)
        / topPrograms.length
    const sparseSchoolBoost = universityPrograms.length <= 2
      ? 3
      : universityPrograms.length <= 4
        ? 1
        : 0
    const possibleFacts = universityPrograms.length * DECISION_FACT_ORDER.length

    return {
      universityId: university.id,
      slug: university.slug,
      nameZh: localizedName(university.name, 'zh', university.slug),
      nameEn: localizedName(university.name, 'en', university.slug),
      featured: university.featured,
      publicProgramCount: universityPrograms.length,
      programsWithAllDecisionFacts: universityPrograms
        .filter((program) => program.missingFacts.length === 0).length,
      missingFactCounts,
      totalMissingFacts,
      completionPct: percent(possibleFacts - totalMissingFacts, possibleFacts),
      priorityScore: roundScore(topProgramAverage + sparseSchoolBoost),
      recommendedProgramIds: topPrograms.map((program) => program.programId),
    }
  }).sort((left, right) => left.universityId.localeCompare(right.universityId, 'en'))

  const factCoverage = Object.fromEntries(
    DECISION_FACT_ORDER.map((fact) => {
      const covered = programs.filter((program) => program.availability[fact]).length
      return [fact, {
        covered,
        missing: programs.length - covered,
        coveragePct: percent(covered, programs.length),
      }]
    }),
  ) as DecisionGapReport['summary']['factCoverage']

  const priorityPrograms = programs
    .filter((program) => program.gapScore > 0)
    .sort(comparePrograms)
    .slice(0, priorityLimit)
    .map((program, index) => ({ ...program, rank: index + 1 }))
  const priorityUniversities = universities
    .filter((university) => university.totalMissingFacts > 0)
    .sort(compareUniversities)
    .slice(0, priorityLimit)
    .map((university, index) => ({ ...university, rank: index + 1 }))

  return {
    schemaVersion: 1,
    evaluatedForDate: today,
    deterministicGeneratedAt: options.generatedAt ?? `${today}T00:00:00.000Z`,
    priorityLimit,
    methodology: {
      catalogScope: 'Exact output of selectPublishedData(rawBundle, evaluatedForDate).',
      currentConfirmedTuition: 'A published current cycle has numeric tuitionCny and tuitionStatus=confirmed. Historical or reference tuition never qualifies.',
      officialApplyRoute: 'The published program has a non-empty applyUrl and at least one associated official source.',
      freshDisposition: 'A published non-historical cycle was verified within the inclusive 30-day window ending on evaluatedForDate.',
      requirements: 'At least one language requirement or non-empty localized eligibility item is public.',
      programGapWeights: { ...DECISION_FACT_WEIGHTS },
      valueBoosts: { ...VALUE_BOOSTS },
      universityPriority: 'Average priority score of up to three highest-gap public programs, plus a small boost for schools with four or fewer public programs.',
    },
    summary: {
      publicUniversities: published.universities.length,
      publicPrograms: programs.length,
      programsWithAllDecisionFacts: programs
        .filter((program) => program.missingFacts.length === 0).length,
      programsWithAnyGap: programs
        .filter((program) => program.missingFacts.length > 0).length,
      factCoverage,
    },
    universities,
    programs,
    priorityUniversities,
    priorityPrograms,
  }
}

function readBundle(dataDir: string): DataBundle {
  const readJson = (name: string): unknown => JSON.parse(
    readFileSync(join(dataDir, `${name}.json`), 'utf8'),
  ) as unknown

  return bundleSchema.parse({
    sources: readJson('sources'),
    cities: readJson('cities'),
    universities: readJson('universities'),
    programs: readJson('programs'),
    admissionCycles: readJson('admission-cycles'),
    scholarships: readJson('scholarships'),
  })
}

function usage(): string {
  return `Usage: tsx scripts/quality/build-decision-gap-report.ts [options]

Builds a deterministic decision-fact gap report from the production publication selector.

Options:
  --data-dir <path>       Catalog JSON directory (default: content/data)
  --today <YYYY-MM-DD>    Deterministic publication date (default: China today)
  --limit <count>         Number of priority universities/programs (default: 30)
  --output <path>         Write JSON to a file instead of stdout
  --help                  Show this help
`
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    dataDir: 'content/data',
    today: getTodayDate(),
    priorityLimit: 30,
    outputPath: null,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    const nextValue = (): string => {
      index += 1
      if (index >= argv.length) throw new Error(`${argument} requires a value`)
      return argv[index]
    }

    switch (argument) {
      case '--data-dir':
        options.dataDir = nextValue()
        break
      case '--today':
        options.today = nextValue()
        break
      case '--limit':
        options.priorityLimit = Number(nextValue())
        break
      case '--output':
        options.outputPath = nextValue()
        break
      case '--help':
      case '-h':
        process.stdout.write(usage())
        process.exit(0)
        break
      default:
        throw new Error(`Unknown argument: ${argument}\n\n${usage()}`)
    }
  }

  assertIsoDate(options.today, '--today')
  assertPositiveInteger(options.priorityLimit, '--limit')
  return options
}

export function runDecisionGapReportCli(argv: string[]): number {
  const options = parseArgs(argv)
  const report = buildDecisionGapReport(
    readBundle(resolve(options.dataDir)),
    { today: options.today, priorityLimit: options.priorityLimit },
  )
  const output = `${JSON.stringify(report, null, 2)}\n`

  if (options.outputPath) {
    const outputPath = resolve(options.outputPath)
    mkdirSync(dirname(outputPath), { recursive: true })
    writeFileSync(outputPath, output, 'utf8')
  } else {
    process.stdout.write(output)
  }
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.exitCode = runDecisionGapReportCli(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(
      `Decision-gap report failed: ${error instanceof Error ? error.stack : String(error)}\n`,
    )
    process.exitCode = 2
  }
}
