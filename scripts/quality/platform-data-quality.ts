import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { bundleSchema } from '../../src/lib/data/schema'
import { getTodayDate } from '../../src/lib/data/freshness'
import { selectPublishedData } from '../../src/lib/data/publication'
import type { DataBundle } from '../../src/lib/data/types'
import {
  isCatalogReconciliationComplete,
  validateSourceManifestDirectory,
  type SourceManifestRecord,
} from '../source-manifest-registry'

export const FOUR_WEEK_QUALITY_THRESHOLDS = {
  publicUniversities: 257,
  schoolsBelowThreePrograms: 0,
  currentCycleCoveragePct: 70,
  durationCoveragePct: 90,
  applicationUrlCoveragePct: 80,
  teachingLanguageCoveragePct: 95,
  requirementsCoveragePct: 50,
  scholarshipUniversityCoverage: 230,
  citiesWithCoordinates: 60,
  manifestInstitutions: 257,
  completedManifests: 257,
  completedReconciliations: 257,
  verifiedOverdueRecords: 0,
  publishedCyclesWithoutAnyDate: 0,
} as const

export type QualityGate = {
  metric: keyof typeof FOUR_WEEK_QUALITY_THRESHOLDS
  comparison: 'at_least' | 'at_most'
  actual: number
  target: number
  passed: boolean
}

export type PlatformDataQualityScorecard = {
  schemaVersion: 1
  generatedAt: string
  evaluatedForDate: string
  metrics: {
    publicRecords: {
      universities: number
      programs: number
      scholarships: number
      admissionCycles: number
      cities: number
    }
    programCoverage: {
      schoolsBelowThreePrograms: number
      schoolIdsBelowThreePrograms: string[]
      programsWithCurrentCycle: number
      currentCycleCoveragePct: number
      programsWithDuration: number
      durationCoveragePct: number
      programsWithApplicationUrl: number
      applicationUrlCoveragePct: number
      programsWithTeachingLanguage: number
      teachingLanguageCoveragePct: number
      programsWithRequirements: number
      requirementsCoveragePct: number
    }
    scholarships: {
      universitiesCovered: number
      universityCoveragePct: number
      recordsWithDeadline: number
      deadlineCoveragePct: number
    }
    cities: {
      withCoordinates: number
      coordinateCoveragePct: number
    }
    sourceManifests: {
      institutionsRegistered: number
      publicUniversitiesRegistered: number
      publicUniversityCoveragePct: number
      v2Manifests: number
      completedManifests: number
      completedReconciliations: number
    }
    anomalies: {
      verifiedOverdueRecords: number
      staleStatusRecords: number
      publishedCyclesWithoutAnyDate: number
    }
  }
  gates: {
    passed: number
    failed: number
    total: number
    allPassed: boolean
    checks: QualityGate[]
  }
}

type BuildOptions = {
  today?: string
  generatedAt?: string
}

type CliOptions = {
  outputPath?: string
  strict: boolean
  today?: string
}

function percent(numerator: number, denominator: number): number {
  if (denominator === 0) return 0
  return Math.round((numerator / denominator) * 10_000) / 100
}

function allAuditedRecords(bundle: DataBundle) {
  return [
    ...bundle.cities,
    ...bundle.universities,
    ...bundle.programs,
    ...bundle.admissionCycles,
    ...bundle.scholarships,
  ]
}

function atLeast(
  metric: keyof typeof FOUR_WEEK_QUALITY_THRESHOLDS,
  actual: number,
): QualityGate {
  const target = FOUR_WEEK_QUALITY_THRESHOLDS[metric]
  return { metric, comparison: 'at_least', actual, target, passed: actual >= target }
}

function atMost(
  metric: keyof typeof FOUR_WEEK_QUALITY_THRESHOLDS,
  actual: number,
): QualityGate {
  const target = FOUR_WEEK_QUALITY_THRESHOLDS[metric]
  return { metric, comparison: 'at_most', actual, target, passed: actual <= target }
}

export function buildPlatformDataQualityScorecard(
  rawBundle: DataBundle,
  manifests: SourceManifestRecord[],
  options: BuildOptions = {},
): PlatformDataQualityScorecard {
  const today = options.today ?? getTodayDate()
  const publicBundle = selectPublishedData(rawBundle, today)
  const programCounts = new Map<string, number>()
  for (const program of publicBundle.programs) {
    programCounts.set(program.universityId, (programCounts.get(program.universityId) ?? 0) + 1)
  }

  const schoolIdsBelowThreePrograms = publicBundle.universities
    .filter((university) => (programCounts.get(university.id) ?? 0) < 3)
    .map((university) => university.id)
    .sort()
  const programsWithCycles = new Set(
    publicBundle.admissionCycles.map((cycle) => cycle.programId),
  )
  const programsWithDuration = publicBundle.programs.filter(
    (program) => program.durationMonths !== null && program.durationMonths > 0,
  ).length
  const programsWithApplicationUrl = publicBundle.programs.filter(
    (program) => Boolean(program.applyUrl?.trim()),
  ).length
  const programsWithTeachingLanguage = publicBundle.programs.filter(
    (program) => program.teachingLanguages.some((language) => language.trim().length > 0),
  ).length
  const programsWithRequirements = publicBundle.programs.filter(
    (program) => program.languageRequirements.length > 0
      || Boolean(program.details?.eligibility.some((item) => Object.values(item).some(Boolean))),
  ).length

  const publicUniversityIds = new Set(publicBundle.universities.map((item) => item.id))
  const scholarshipUniversityIds = new Set(
    publicBundle.scholarships
      .flatMap((scholarship) => scholarship.universityIds)
      .filter((id) => publicUniversityIds.has(id)),
  )
  const scholarshipsWithDeadline = publicBundle.scholarships.filter(
    (scholarship) => scholarship.deadline !== null,
  ).length
  const citiesWithCoordinates = publicBundle.cities.filter(
    (city) => city.coordinates !== null,
  ).length

  const manifestInstitutionIds = new Set(manifests.map((manifest) => manifest.institutionId))
  const v2Manifests = manifests.filter(
    (manifest): manifest is Extract<SourceManifestRecord, { version: 2 }> => manifest.version === 2,
  )
  const completedManifests = v2Manifests.filter(
    (manifest) => manifest.manifestStatus === 'complete',
  ).length
  const completedReconciliations = manifests.filter(isCatalogReconciliationComplete).length

  const auditedRecords = allAuditedRecords(rawBundle)
  const verifiedOverdueRecords = auditedRecords.filter(
    (record) => record.status === 'verified' && record.reviewAfter < today,
  ).length
  const staleStatusRecords = auditedRecords.filter((record) => record.status === 'stale').length
  const publishedCyclesWithoutAnyDate = rawBundle.admissionCycles.filter(
    (cycle) => cycle.dateStatus === 'published'
      && cycle.opensOn === null
      && cycle.closesOn === null,
  ).length

  const programTotal = publicBundle.programs.length
  const universityTotal = publicBundle.universities.length
  const scholarshipTotal = publicBundle.scholarships.length
  const cityTotal = publicBundle.cities.length
  const metrics: PlatformDataQualityScorecard['metrics'] = {
    publicRecords: {
      universities: universityTotal,
      programs: programTotal,
      scholarships: scholarshipTotal,
      admissionCycles: publicBundle.admissionCycles.length,
      cities: cityTotal,
    },
    programCoverage: {
      schoolsBelowThreePrograms: schoolIdsBelowThreePrograms.length,
      schoolIdsBelowThreePrograms,
      programsWithCurrentCycle: programsWithCycles.size,
      currentCycleCoveragePct: percent(programsWithCycles.size, programTotal),
      programsWithDuration,
      durationCoveragePct: percent(programsWithDuration, programTotal),
      programsWithApplicationUrl,
      applicationUrlCoveragePct: percent(programsWithApplicationUrl, programTotal),
      programsWithTeachingLanguage,
      teachingLanguageCoveragePct: percent(programsWithTeachingLanguage, programTotal),
      programsWithRequirements,
      requirementsCoveragePct: percent(programsWithRequirements, programTotal),
    },
    scholarships: {
      universitiesCovered: scholarshipUniversityIds.size,
      universityCoveragePct: percent(scholarshipUniversityIds.size, universityTotal),
      recordsWithDeadline: scholarshipsWithDeadline,
      deadlineCoveragePct: percent(scholarshipsWithDeadline, scholarshipTotal),
    },
    cities: {
      withCoordinates: citiesWithCoordinates,
      coordinateCoveragePct: percent(citiesWithCoordinates, cityTotal),
    },
    sourceManifests: {
      institutionsRegistered: manifestInstitutionIds.size,
      publicUniversitiesRegistered: [...manifestInstitutionIds]
        .filter((id) => publicUniversityIds.has(id)).length,
      publicUniversityCoveragePct: percent(
        [...manifestInstitutionIds].filter((id) => publicUniversityIds.has(id)).length,
        universityTotal,
      ),
      v2Manifests: v2Manifests.length,
      completedManifests,
      completedReconciliations,
    },
    anomalies: {
      verifiedOverdueRecords,
      staleStatusRecords,
      publishedCyclesWithoutAnyDate,
    },
  }

  const checks = [
    atLeast('publicUniversities', metrics.publicRecords.universities),
    atMost('schoolsBelowThreePrograms', metrics.programCoverage.schoolsBelowThreePrograms),
    atLeast('currentCycleCoveragePct', metrics.programCoverage.currentCycleCoveragePct),
    atLeast('durationCoveragePct', metrics.programCoverage.durationCoveragePct),
    atLeast('applicationUrlCoveragePct', metrics.programCoverage.applicationUrlCoveragePct),
    atLeast('teachingLanguageCoveragePct', metrics.programCoverage.teachingLanguageCoveragePct),
    atLeast('requirementsCoveragePct', metrics.programCoverage.requirementsCoveragePct),
    atLeast('scholarshipUniversityCoverage', metrics.scholarships.universitiesCovered),
    atLeast('citiesWithCoordinates', metrics.cities.withCoordinates),
    atLeast('manifestInstitutions', metrics.sourceManifests.institutionsRegistered),
    atLeast('completedManifests', metrics.sourceManifests.completedManifests),
    atLeast('completedReconciliations', metrics.sourceManifests.completedReconciliations),
    atMost('verifiedOverdueRecords', metrics.anomalies.verifiedOverdueRecords),
    atMost('publishedCyclesWithoutAnyDate', metrics.anomalies.publishedCyclesWithoutAnyDate),
  ]
  const passed = checks.filter((check) => check.passed).length

  return {
    schemaVersion: 1,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    evaluatedForDate: today,
    metrics,
    gates: {
      passed,
      failed: checks.length - passed,
      total: checks.length,
      allPassed: passed === checks.length,
      checks,
    },
  }
}

export function parsePlatformDataQualityArgs(argv: string[]): CliOptions {
  const options: CliOptions = { strict: false }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--strict') {
      options.strict = true
    } else if (argument === '--output' || argument === '--today') {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`)
      index += 1
      if (argument === '--output') options.outputPath = value
      else options.today = value
    } else {
      throw new Error(`Unknown argument: ${argument}`)
    }
  }
  if (options.today && !/^\d{4}-\d{2}-\d{2}$/.test(options.today)) {
    throw new Error('--today must use YYYY-MM-DD')
  }
  return options
}

function loadRawCatalog(): DataBundle {
  const read = (name: string): unknown => JSON.parse(
    readFileSync(join(process.cwd(), 'content', 'data', `${name}.json`), 'utf8'),
  )
  return bundleSchema.parse({
    sources: read('sources'),
    cities: read('cities'),
    universities: read('universities'),
    programs: read('programs'),
    admissionCycles: read('admission-cycles'),
    scholarships: read('scholarships'),
  })
}

export function conciseScorecardSummary(report: PlatformDataQualityScorecard): string {
  const { publicRecords, programCoverage, scholarships, cities, sourceManifests } = report.metrics
  return [
    `Data quality: ${publicRecords.universities} universities / ${publicRecords.programs} programs / ${publicRecords.scholarships} scholarships`,
    `current cycles ${programCoverage.currentCycleCoveragePct}%`,
    `scholarship schools ${scholarships.universitiesCovered}`,
    `city coordinates ${cities.withCoordinates}/${publicRecords.cities}`,
    `manifests ${sourceManifests.institutionsRegistered} (${sourceManifests.completedReconciliations} reconciled)`,
    `gates ${report.gates.passed}/${report.gates.total}`,
  ].join(' | ')
}

export async function runPlatformDataQualityCli(argv: string[]): Promise<number> {
  const options = parsePlatformDataQualityArgs(argv)
  const report = buildPlatformDataQualityScorecard(
    loadRawCatalog(),
    validateSourceManifestDirectory(),
    { today: options.today },
  )
  if (options.outputPath) {
    await writeFile(resolve(options.outputPath), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  } else {
    process.stdout.write(`${conciseScorecardSummary(report)}\n`)
  }
  return options.strict && !report.gates.allPassed ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runPlatformDataQualityCli(process.argv.slice(2)).then(
    (exitCode) => { process.exitCode = exitCode },
    (error: unknown) => {
      process.stderr.write(`Platform data-quality report failed: ${error instanceof Error ? error.message : String(error)}\n`)
      process.exitCode = 2
    },
  )
}
