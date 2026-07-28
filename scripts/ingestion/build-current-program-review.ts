import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { bundleSchema } from '../../src/lib/data/schema'
import type { AdmissionCycle, DataBundle, Program } from '../../src/lib/data/types'

type ReviewRecord = {
  institutionId: string
  programNameOriginal: string
  programNameEn: string
  degreeLevel: string
  programType: string
  intake: string
  applicationOpen: string | null
  deadline: string | null
  officialUrl: string
  checkedAt: string
}

export type CurrentProgramReview = {
  generatedAt: string
  source: 'current-catalog'
  records: ReviewRecord[]
  summary: {
    programs: number
    officialUrls: number
    institutions: number
  }
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function programType(program: Program): string {
  if (['bachelor', 'master', 'doctorate'].includes(program.degreeLevel)) return 'degree'
  if (program.degreeLevel === 'language') return 'language'
  if (program.degreeLevel === 'foundation') return 'foundation'
  return 'other'
}

function cycleRank(cycle: AdmissionCycle): string {
  return [
    cycle.academicYear,
    cycle.closesOn ?? '',
    cycle.opensOn ?? '',
    cycle.id,
  ].join(':')
}

function latestCycle(bundle: DataBundle, programId: string): AdmissionCycle | undefined {
  return bundle.admissionCycles
    .filter(
      (cycle) => cycle.programId === programId
        && (cycle.status === 'verified' || cycle.status === 'stale')
        && cycle.dateStatus !== 'previous-cycle-reference',
    )
    .sort((left, right) => cycleRank(right).localeCompare(cycleRank(left)))[0]
}

export function buildCurrentProgramReview(
  bundle: DataBundle,
  generatedAt = new Date().toISOString(),
): CurrentProgramReview {
  const records = bundle.programs
    .filter((program) => program.status === 'verified' || program.status === 'stale')
    .map((program): ReviewRecord => {
      const cycle = latestCycle(bundle, program.id)
      return {
        institutionId: program.universityId,
        programNameOriginal: program.name.zh ?? program.name.en ?? program.id,
        programNameEn: program.name.en ?? program.name.zh ?? program.id,
        degreeLevel: program.degreeLevel,
        programType: programType(program),
        intake: cycle?.intake ?? 'other',
        applicationOpen: cycle?.opensOn ?? null,
        deadline: cycle?.closesOn ?? null,
        officialUrl: program.programUrl,
        checkedAt: program.verifiedAt,
      }
    })
    .sort((left, right) => (
      left.officialUrl.localeCompare(right.officialUrl)
      || left.institutionId.localeCompare(right.institutionId)
      || left.programNameEn.localeCompare(right.programNameEn)
    ))

  return {
    generatedAt,
    source: 'current-catalog',
    records,
    summary: {
      programs: records.length,
      officialUrls: new Set(records.map((record) => record.officialUrl)).size,
      institutions: new Set(records.map((record) => record.institutionId)).size,
    },
  }
}

async function readBundle(dataDirectory: string): Promise<DataBundle> {
  const read = async (name: string): Promise<unknown> => (
    JSON.parse(await readFile(resolve(dataDirectory, `${name}.json`), 'utf8'))
  )
  return bundleSchema.parse({
    sources: await read('sources'),
    cities: await read('cities'),
    universities: await read('universities'),
    programs: await read('programs'),
    admissionCycles: await read('admission-cycles'),
    scholarships: await read('scholarships'),
  })
}

async function main(): Promise<void> {
  const dataDirectory = resolve(argument('--data-dir') ?? 'content/data')
  const outputPath = resolve(
    argument('--output') ?? '.pipeline-build/current-program-review.json',
  )
  const generatedAt = argument('--generated-at') ?? new Date().toISOString()
  const bundle = await readBundle(dataDirectory)
  const review = buildCurrentProgramReview(bundle, generatedAt)
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(review, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ outputPath, ...review.summary }))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
