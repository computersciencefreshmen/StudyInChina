import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import { getTodayDate } from '../../src/lib/data/freshness'
import { selectPublishedData } from '../../src/lib/data/publication'
import { bundleSchema } from '../../src/lib/data/schema'
import type { DataBundle, Program } from '../../src/lib/data/types'

export type CoverageMode = 'report' | 'strict'
export type CoverageGapReason = 'draft' | 'expired' | 'no_identity'

export type UniversityProgramCoverage = {
  universityId: string
  slug: string
  nameZh: string
  nameEn: string
  publishedProgramCount: number
  publishedProgramIds: string[]
  rawProgramCount: number
  draftProgramIds: string[]
  expiredProgramIds: string[]
  gapReasons: CoverageGapReason[]
}

export type ProgramIdentityDuplicate = {
  identityKey: string
  universityId: string
  degreeLevel: Program['degreeLevel']
  normalizedName: string
  programIds: string[]
  publishedProgramIds: string[]
}

export type ProgramCoverageReport = {
  generatedAt: string
  today: string
  mode: CoverageMode
  minimumPublishedPrograms: number
  lowCoverageCeiling: number
  summary: {
    publicUniversities: number
    publishedPrograms: number
    meetingMinimum: number
    belowMinimum: number
    duplicateProgramIdentities: number
    distribution: {
      zero: number
      one: number
      two: number
      threeOrMore: number
    }
    belowMinimumByReason: Record<CoverageGapReason, number>
  }
  lowCoverage: UniversityProgramCoverage[]
  belowMinimum: UniversityProgramCoverage[]
  identityDuplicates: ProgramIdentityDuplicate[]
}

type CoverageOptions = {
  today?: string
  mode?: CoverageMode
  minimumPublishedPrograms?: number
  lowCoverageCeiling?: number
  generatedAt?: string
}

type CliOptions = {
  dataDir: string
  mode: CoverageMode
  today: string
  minimumPublishedPrograms: number
  lowCoverageCeiling: number
  jsonPath: string | null
  markdownPath: string | null
}

const GAP_REASON_ORDER: CoverageGapReason[] = ['draft', 'expired', 'no_identity']

function localizedName(
  name: { zh?: string; en?: string },
  locale: 'zh' | 'en',
  fallback: string,
): string {
  return name[locale] ?? name.zh ?? name.en ?? fallback
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer`)
  }
}

function assertIsoDate(value: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new Error(`${label} must use YYYY-MM-DD`)
  }
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} must be a real calendar date`)
  }
}

function gapReasons(
  rawPrograms: Program[],
  publishedProgramIds: Set<string>,
): CoverageGapReason[] {
  const hiddenPrograms = rawPrograms.filter((program) => !publishedProgramIds.has(program.id))
  const reasons = new Set<CoverageGapReason>()

  if (hiddenPrograms.some((program) => program.status === 'draft')) {
    reasons.add('draft')
  }
  // "expired" is the operational bucket for every non-draft identity removed by
  // the production publication selector: stale/archived program identity,
  // overdue reviewAfter, or an identity whose only cycles are no longer current.
  if (hiddenPrograms.some((program) => program.status !== 'draft')) {
    reasons.add('expired')
  }
  // No hidden record exists to promote. More official identities must first be
  // discovered and recorded before this school can gain another public program.
  if (hiddenPrograms.length === 0) {
    reasons.add('no_identity')
  }

  return GAP_REASON_ORDER.filter((reason) => reasons.has(reason))
}

function normalizeProgramIdentityName(program: Program): string {
  return (program.name.en ?? program.name.zh ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gu, '')
}

export function findSemanticProgramDuplicates(
  programs: Program[],
  publishedProgramIds: Set<string> = new Set(),
): ProgramIdentityDuplicate[] {
  const groups = new Map<string, Program[]>()
  for (const program of programs) {
    const normalizedName = normalizeProgramIdentityName(program)
    const key = [program.universityId, program.degreeLevel, normalizedName].join('|')
    const records = groups.get(key) ?? []
    records.push(program)
    groups.set(key, records)
  }
  return [...groups.entries()]
    .filter(([, records]) => records.length > 1)
    .map(([identityKey, records]) => ({
      identityKey,
      universityId: records[0].universityId,
      degreeLevel: records[0].degreeLevel,
      normalizedName: normalizeProgramIdentityName(records[0]),
      programIds: records.map((program) => program.id).sort(),
      publishedProgramIds: records
        .filter((program) => publishedProgramIds.has(program.id))
        .map((program) => program.id)
        .sort(),
    }))
    .sort((left, right) => left.identityKey.localeCompare(right.identityKey))
}

export function buildProgramCoverageReport(
  data: DataBundle,
  options: CoverageOptions = {},
): ProgramCoverageReport {
  const today = options.today ?? getTodayDate()
  const mode = options.mode ?? 'report'
  const minimumPublishedPrograms = options.minimumPublishedPrograms ?? 1
  const lowCoverageCeiling = options.lowCoverageCeiling ?? 2

  assertIsoDate(today, 'today')
  assertPositiveInteger(minimumPublishedPrograms, 'minimumPublishedPrograms')
  if (!Number.isInteger(lowCoverageCeiling) || lowCoverageCeiling < 0) {
    throw new Error('lowCoverageCeiling must be a non-negative integer')
  }

  const published = selectPublishedData(data, today)
  const publishedProgramIds = new Set(published.programs.map((program) => program.id))
  const identityDuplicates = findSemanticProgramDuplicates(data.programs, publishedProgramIds)
  const rawProgramsByUniversity = new Map<string, Program[]>()
  const publishedProgramsByUniversity = new Map<string, Program[]>()

  for (const program of data.programs) {
    const programs = rawProgramsByUniversity.get(program.universityId) ?? []
    programs.push(program)
    rawProgramsByUniversity.set(program.universityId, programs)
  }
  for (const program of published.programs) {
    const programs = publishedProgramsByUniversity.get(program.universityId) ?? []
    programs.push(program)
    publishedProgramsByUniversity.set(program.universityId, programs)
  }

  const coverage = published.universities
    .map((university): UniversityProgramCoverage => {
      const rawPrograms = rawProgramsByUniversity.get(university.id) ?? []
      const publishedPrograms = publishedProgramsByUniversity.get(university.id) ?? []
      const hiddenPrograms = rawPrograms.filter((program) => !publishedProgramIds.has(program.id))

      return {
        universityId: university.id,
        slug: university.slug,
        nameZh: localizedName(university.name, 'zh', university.slug),
        nameEn: localizedName(university.name, 'en', university.slug),
        publishedProgramCount: publishedPrograms.length,
        publishedProgramIds: publishedPrograms.map((program) => program.id).sort(),
        rawProgramCount: rawPrograms.length,
        draftProgramIds: hiddenPrograms
          .filter((program) => program.status === 'draft')
          .map((program) => program.id)
          .sort(),
        expiredProgramIds: hiddenPrograms
          .filter((program) => program.status !== 'draft')
          .map((program) => program.id)
          .sort(),
        gapReasons: gapReasons(rawPrograms, publishedProgramIds),
      }
    })
    .sort((left, right) => (
      left.publishedProgramCount - right.publishedProgramCount
      || left.nameZh.localeCompare(right.nameZh, 'zh-CN')
      || left.universityId.localeCompare(right.universityId, 'en')
    ))

  const belowMinimum = coverage.filter(
    (item) => item.publishedProgramCount < minimumPublishedPrograms,
  )
  const lowCoverage = coverage.filter(
    (item) => item.publishedProgramCount <= lowCoverageCeiling,
  )
  const belowMinimumByReason = Object.fromEntries(
    GAP_REASON_ORDER.map((reason) => [
      reason,
      belowMinimum.filter((item) => item.gapReasons.includes(reason)).length,
    ]),
  ) as Record<CoverageGapReason, number>

  return {
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    today,
    mode,
    minimumPublishedPrograms,
    lowCoverageCeiling,
    summary: {
      publicUniversities: published.universities.length,
      publishedPrograms: published.programs.length,
      meetingMinimum: coverage.length - belowMinimum.length,
      belowMinimum: belowMinimum.length,
      duplicateProgramIdentities: identityDuplicates.length,
      distribution: {
        zero: coverage.filter((item) => item.publishedProgramCount === 0).length,
        one: coverage.filter((item) => item.publishedProgramCount === 1).length,
        two: coverage.filter((item) => item.publishedProgramCount === 2).length,
        threeOrMore: coverage.filter((item) => item.publishedProgramCount >= 3).length,
      },
      belowMinimumByReason,
    },
    lowCoverage,
    belowMinimum,
    identityDuplicates,
  }
}

export function coverageExitCode(report: ProgramCoverageReport): number {
  return report.mode === 'strict'
    && (
      report.summary.belowMinimum > 0
      || report.summary.duplicateProgramIdentities > 0
    )
    ? 1
    : 0
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
  return `Usage: tsx scripts/quality/check-program-coverage.ts [options]

Audits public universities against the exact production publication policy.

Options:
  --data-dir <path>       Catalog JSON directory (default: content/data)
  --mode <mode>           report or strict (default: report)
  --today <YYYY-MM-DD>    Deterministic publication date (default: China today)
  --minimum <count>       Strict minimum public programs per university (default: 1)
  --low-coverage <count>  Include schools at or below this count (default: 2)
  --json <path>           Write the complete JSON report
  --markdown <path>       Write the Markdown report
  --help                  Show this help

Exit codes:
  0  Report completed, or strict target is satisfied
  1  Strict target has coverage gaps
  2  Invalid arguments or catalog data
`
}

function parseInteger(rawValue: string, argument: string, allowZero = false): number {
  const value = Number(rawValue)
  if (!Number.isInteger(value) || value < (allowZero ? 0 : 1)) {
    throw new Error(`${argument} requires ${allowZero ? 'a non-negative' : 'a positive'} integer`)
  }
  return value
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    dataDir: 'content/data',
    mode: 'report',
    today: getTodayDate(),
    minimumPublishedPrograms: 1,
    lowCoverageCeiling: 2,
    jsonPath: null,
    markdownPath: null,
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
      case '--mode': {
        const mode = nextValue()
        if (mode !== 'report' && mode !== 'strict') {
          throw new Error('--mode must be report or strict')
        }
        options.mode = mode
        break
      }
      case '--today':
        options.today = nextValue()
        break
      case '--minimum':
        options.minimumPublishedPrograms = parseInteger(nextValue(), argument)
        break
      case '--low-coverage':
        options.lowCoverageCeiling = parseInteger(nextValue(), argument, true)
        break
      case '--json':
        options.jsonPath = nextValue()
        break
      case '--markdown':
        options.markdownPath = nextValue()
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
  return options
}

function escapeCell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ')
}

function renderCoverageSection(
  count: number,
  entries: UniversityProgramCoverage[],
): string {
  const matching = entries.filter((item) => item.publishedProgramCount === count)
  if (matching.length === 0) return `## ${count} published programs\n\n_None._\n`

  const rows = matching.map((item) => (
    `| ${escapeCell(item.nameZh)} | ${escapeCell(item.nameEn)} | `
    + `${item.gapReasons.join(', ')} | ${item.rawProgramCount} | `
    + `${item.draftProgramIds.length} | ${item.expiredProgramIds.length} |`
  ))
  return `## ${count} published programs

| University | English name | Gap reason | Raw identities | Draft | Expired |
| --- | --- | --- | ---: | ---: | ---: |
${rows.join('\n')}
`
}

export function renderProgramCoverageMarkdown(report: ProgramCoverageReport): string {
  const { distribution } = report.summary
  return `# Public university program coverage

> This report reuses the production publication selector. Report mode is advisory; strict mode fails when a public university is below the configured minimum or the raw catalog contains a duplicate semantic program identity.

Generated: ${report.generatedAt}<br>
Publication date: **${report.today}**<br>
Mode: **${report.mode}**<br>
Strict minimum: **${report.minimumPublishedPrograms}** public program(s) per university

| Public universities | Published programs | Meeting minimum | Below minimum | Duplicate identities | 0 programs | 1 program | 2 programs | 3+ programs |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| ${report.summary.publicUniversities} | ${report.summary.publishedPrograms} | ${report.summary.meetingMinimum} | ${report.summary.belowMinimum} | ${report.summary.duplicateProgramIdentities} | ${distribution.zero} | ${distribution.one} | ${distribution.two} | ${distribution.threeOrMore} |

Reason definitions:

- \`draft\`: an unpublished draft identity exists.
- \`expired\`: a non-draft identity is excluded by freshness, status, or admission-cycle publication rules.
- \`no_identity\`: there is no additional hidden identity in the raw catalog; more official project identities must be collected.

${renderCoverageSection(0, report.lowCoverage)}
${renderCoverageSection(1, report.lowCoverage)}
${renderCoverageSection(2, report.lowCoverage)}
`
}

function writeOutput(filePath: string, contents: string): void {
  const absolutePath = resolve(filePath)
  mkdirSync(dirname(absolutePath), { recursive: true })
  writeFileSync(absolutePath, contents, 'utf8')
}

export function runProgramCoverageCli(argv: string[]): number {
  const options = parseArgs(argv)
  const report = buildProgramCoverageReport(
    readBundle(resolve(options.dataDir)),
    {
      today: options.today,
      mode: options.mode,
      minimumPublishedPrograms: options.minimumPublishedPrograms,
      lowCoverageCeiling: options.lowCoverageCeiling,
    },
  )
  const markdown = renderProgramCoverageMarkdown(report)

  process.stdout.write(markdown)
  if (options.jsonPath) {
    writeOutput(options.jsonPath, `${JSON.stringify(report, null, 2)}\n`)
  }
  if (options.markdownPath) {
    writeOutput(options.markdownPath, markdown)
  }
  return coverageExitCode(report)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.exitCode = runProgramCoverageCli(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(
      `Program coverage check failed: ${error instanceof Error ? error.stack : String(error)}\n`,
    )
    process.exitCode = 2
  }
}
