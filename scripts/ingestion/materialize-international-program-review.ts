import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { bundleSchema } from '../../src/lib/data/schema'
import type {
  AdmissionCycle,
  City,
  DataBundle,
  DegreeLevel,
  Discipline,
  Program,
  Source,
  University,
} from '../../src/lib/data/types'

type ReviewRecord = {
  institutionId: string
  institutionZh: string
  institutionEn: string
  institutionRu?: string
  cityZh?: string
  cityEn?: string
  cityRu?: string
  province: string
  programNameOriginal: string
  programNameEn: string
  programNameRu?: string
  programType: string
  degreeLevel: string
  teachingLanguage: string
  intake: string
  applicationOpen: string | null
  deadline: string | null
  cycleStatus: string
  publicationTier: 'cycle_ready' | 'program_identity_only'
  officialUrl: string
  catalogUrl: string
  checkedAt: string
}

type ReviewDocument = {
  records: ReviewRecord[]
}

type CoverageInstitution = {
  institutionId: string | null
  targetId: string
  nameZh: string
  nameEn: string | null
  province: string | null
  region: string | null
  sources: Array<{
    category: string
    officialUrl: string
  }>
}

type CoverageDocument = {
  institutions: CoverageInstitution[]
}

type MaterializeOptions = {
  reviewPath: string
  coveragePath: string
  dataDirectory: string
  outputDirectory: string
}

function parseArguments(arguments_: string[]): MaterializeOptions {
  const values = new Map<string, string>()
  for (let index = 0; index < arguments_.length; index += 2) {
    const key = arguments_[index]
    const value = arguments_[index + 1]
    if (!key?.startsWith('--') || !value) {
      throw new Error('Arguments must use --key value pairs')
    }
    values.set(key.slice(2), value)
  }
  return {
    reviewPath: resolve(
      values.get('review')
      ?? 'quality/international-program-review/expanded-2026-07-27.json',
    ),
    coveragePath: resolve(
      values.get('coverage')
      ?? 'src/data/generated/double-first-class-coverage.json',
    ),
    dataDirectory: resolve(values.get('data-dir') ?? 'content/data'),
    outputDirectory: resolve(values.get('output-dir') ?? '.pipeline-build/materialized-data'),
  }
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12)
}

function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .toLocaleLowerCase('en')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 72)
}

function institutionCatalogId(institution: CoverageInstitution): string {
  return (
    institution.institutionId
    ?? `uni-${slugify(institution.nameEn ?? institution.nameZh)}`
  )
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.valueOf())) throw new Error(`Invalid date: ${value}`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function normalizeCoverageRegion(value: string | null): University['region'] {
  if (value === 'west') return 'northwest'
  if (
    value === 'north'
    || value === 'northeast'
    || value === 'east'
    || value === 'south'
    || value === 'central'
    || value === 'southwest'
    || value === 'northwest'
  ) return value
  return null
}

function normalizeDegreeLevel(record: ReviewRecord): DegreeLevel {
  const level = record.degreeLevel.toLocaleLowerCase('en')
  if (level.includes('bachelor')) return 'bachelor'
  if (level.includes('master')) return 'master'
  if (level.includes('doctor') || level.includes('phd')) return 'doctorate'
  if (record.programType === 'language') return 'language'
  if (record.programType === 'foundation') return 'foundation'
  return 'other'
}

function classifyDiscipline(record: ReviewRecord): Discipline {
  const value = `${record.programNameEn} ${record.programNameOriginal}`
    .toLocaleLowerCase('en')
  const rules: Array<[Discipline, RegExp]> = [
    ['medicine', /medicine|medical|clinical|nursing|pharmacy|pharmaceutical|public health|traditional chinese medicine/iu],
    ['business', /business|finance|econom|management|accounting|commerce|trade|investment/iu],
    ['law-ir', /law|legal|international relations|diplomacy|politic|global affairs/iu],
    ['art-design', /art|design|music|film|theatre|dance|architecture/iu],
    ['chinese-education', /chinese language|international chinese|business chinese|汉语|中文|预科/iu],
    ['engineering', /engineering|computer|artificial intelligence|automation|information|electronic|material|energy|vehicle|aerospace|civil|software|data science/iu],
    ['science', /science|mathemat|physics|chemistry|biology|environment|geography|meteorology|agricultur|crop|forestry|ocean|geology/iu],
    ['humanities', /literature|history|education|journalism|communication|culture|linguistic|philosophy/iu],
  ]
  return rules.find(([, pattern]) => pattern.test(value))?.[0] ?? 'other'
}

function normalizeTeachingLanguages(value: string): string[] {
  const normalized = value.trim()
  if (!normalized || /source.language|confirm|unknown|not.announced/iu.test(normalized)) {
    return []
  }
  const languages: string[] = []
  if (/english|英文|英语/iu.test(normalized)) languages.push('English')
  if (/chinese|mandarin|中文|汉语/iu.test(normalized)) languages.push('Chinese')
  if (languages.length === 0) languages.push(normalized)
  return [...new Set(languages)]
}

function inferCycle(record: ReviewRecord, programId: string, sourceId: string): AdmissionCycle | null {
  if (record.publicationTier !== 'cycle_ready') return null
  const rolling = record.cycleStatus.toLocaleLowerCase('en').includes('rolling')
  if (!rolling && !record.applicationOpen && !record.deadline) return null
  const yearText = (
    record.intake.match(/20\d{2}/u)?.[0]
    ?? record.deadline?.slice(0, 4)
    ?? record.applicationOpen?.slice(0, 4)
    ?? record.checkedAt.slice(0, 4)
  )
  const year = Number(yearText)
  const intakeText = record.intake.toLocaleLowerCase('en')
  const intake = intakeText.includes('spring')
    ? 'spring'
    : (intakeText.includes('autumn') || intakeText.includes('fall'))
        ? 'autumn'
        : 'other'
  const academicStart = intake === 'spring' ? year - 1 : year
  return {
    id: `cycle-${academicStart}-${hash(`${programId}|${record.intake}`)}`,
    programId,
    academicYear: `${academicStart}-${academicStart + 1}`,
    intake,
    opensOn: record.applicationOpen,
    closesOn: record.deadline,
    dateStatus: rolling ? 'rolling' : 'published',
    tuitionCny: null,
    tuitionPeriod: null,
    tuitionStatus: null,
    evidenceBasis: 'cycle-specific',
    factScope: 'dates-only',
    applicationFeeCny: null,
    sourceIds: [sourceId],
    verifiedAt: record.checkedAt,
    reviewAfter: addDays(record.checkedAt, 7),
    status: 'verified',
  }
}

function sourceForProgram(record: ReviewRecord): Source {
  return {
    id: `src-program-review-${hash(record.officialUrl)}`,
    url: record.officialUrl,
    title: `Official program information — ${record.programNameEn}`,
    publisher: record.institutionEn,
    kind: 'program',
    language: 'other',
    official: true,
    accessedAt: record.checkedAt,
  }
}

function sourceForUniversity(
  institution: CoverageInstitution,
  checkedAt: string,
  catalogId: string,
): Source {
  const source = (
    institution.sources.find((item) => item.category === 'international_admissions_home')
    ?? institution.sources[0]
  )
  if (!source) throw new Error(`Missing official university source: ${institution.nameZh}`)
  return {
    id: `src-${catalogId}`,
    url: source.officialUrl,
    title: `Official international admissions — ${institution.nameEn ?? institution.nameZh}`,
    publisher: institution.nameEn ?? institution.nameZh,
    kind: 'admissions',
    language: 'other',
    official: true,
    accessedAt: checkedAt,
  }
}

function cityForRecord(
  record: ReviewRecord,
  institution: CoverageInstitution,
  sourceId: string,
): City {
  const cityEn = record.cityEn?.trim()
  const cityZh = record.cityZh?.trim()
  const cityRu = record.cityRu?.trim()
  if (!cityEn || !cityZh || !cityRu) {
    throw new Error(`Missing city localization for ${record.institutionZh}`)
  }
  const slug = slugify(cityEn)
  return {
    id: `city-${slug}`,
    slug,
    name: { en: cityEn, zh: cityZh, ru: cityRu },
    province: institution.province
      ? { en: institution.province, zh: institution.province, ru: institution.province }
      : null,
    region: normalizeCoverageRegion(institution.region),
    coordinates: null,
    overview: null,
    climate: null,
    foodHighlights: [],
    sights: [],
    sourceIds: [sourceId],
    verifiedAt: record.checkedAt,
    reviewAfter: addDays(record.checkedAt, 180),
    status: 'verified',
  }
}

function universityForRecord(
  record: ReviewRecord,
  institution: CoverageInstitution,
  city: City,
  source: Source,
): University {
  const institutionRu = record.institutionRu?.trim() || record.institutionEn
  return {
    id: record.institutionId,
    slug: record.institutionId.replace(/^uni-/u, ''),
    name: {
      en: record.institutionEn,
      zh: record.institutionZh,
      ru: institutionRu,
    },
    cityId: city.id,
    region: normalizeCoverageRegion(institution.region),
    officialUrl: source.url,
    admissionsUrl: source.url,
    summary: {
      en: `${record.institutionEn} is located in ${record.cityEn}. Current international programs and requirements are published on the official admissions website.`,
      zh: `${record.institutionZh}位于${record.cityZh}。当前国际学生项目和申请要求以学校官方招生网站为准。`,
      ru: `${institutionRu} находится в городе ${record.cityRu}. Актуальные программы и требования опубликованы на официальном сайте приёма.`,
    },
    featured: false,
    sourceIds: [source.id],
    verifiedAt: record.checkedAt,
    reviewAfter: addDays(record.checkedAt, 180),
    status: 'verified',
  }
}

async function readBundle(directory: string): Promise<DataBundle> {
  const read = async (name: string): Promise<unknown> => (
    JSON.parse(await readFile(join(directory, `${name}.json`), 'utf8'))
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
  const options = parseArguments(process.argv.slice(2))
  const review = JSON.parse(
    await readFile(options.reviewPath, 'utf8'),
  ) as ReviewDocument
  const coverage = JSON.parse(
    await readFile(options.coveragePath, 'utf8'),
  ) as CoverageDocument
  const original = await readBundle(options.dataDirectory)
  const coverageById = new Map(
    coverage.institutions.map((item) => [institutionCatalogId(item), item]),
  )
  const coverageByName = new Map(
    coverage.institutions.map((item) => [item.nameZh, item]),
  )
  const reviewInstitutionIds = new Set(review.records.map((item) => item.institutionId))

  const retainedPrograms = original.programs.filter((program) => (
    !reviewInstitutionIds.has(program.universityId)
    || (program.status === 'verified' && Boolean(program.details))
  ))
  const retainedProgramIds = new Set(retainedPrograms.map((item) => item.id))
  const retainedCycles = original.admissionCycles.filter((cycle) => (
    retainedProgramIds.has(cycle.programId)
  ))

  const sources = new Map(original.sources.map((item) => [item.id, item]))
  const cities = new Map(original.cities.map((item) => [item.id, item]))
  const universities = new Map(original.universities.map((item) => [item.id, item]))
  const programs = new Map(retainedPrograms.map((item) => [item.id, item]))
  const cycles = new Map(retainedCycles.map((item) => [item.id, item]))
  const skipped: Array<{ institutionId: string; program: string; reason: string }> = []

  for (const record of review.records) {
    const institution = (
      coverageById.get(record.institutionId)
      ?? coverageByName.get(record.institutionZh)
    )
    if (!institution) {
      skipped.push({
        institutionId: record.institutionId,
        program: record.programNameEn,
        reason: 'institution_missing_from_coverage',
      })
      continue
    }
    const programSource = sourceForProgram(record)
    let university = universities.get(record.institutionId)
    if (!university) {
      try {
        const universitySource = sourceForUniversity(
          institution,
          record.checkedAt,
          record.institutionId,
        )
        sources.set(universitySource.id, universitySource)
        const candidateCity = cityForRecord(record, institution, universitySource.id)
        const city = cities.get(candidateCity.id) ?? candidateCity
        cities.set(city.id, city)
        university = universityForRecord(record, institution, city, universitySource)
        universities.set(university.id, university)
      } catch (error) {
        skipped.push({
          institutionId: record.institutionId,
          program: record.programNameEn,
          reason: error instanceof Error ? error.message : String(error),
        })
        continue
      }
    }

    const languages = normalizeTeachingLanguages(record.teachingLanguage)
    if (languages.length === 0) {
      skipped.push({
        institutionId: record.institutionId,
        program: record.programNameEn,
        reason: 'teaching_language_not_confirmed',
      })
      continue
    }
    sources.set(programSource.id, programSource)
    const degreeLevel = normalizeDegreeLevel(record)
    const baseSlug = slugify(
      `${university.slug}-${record.programNameEn}-${degreeLevel}`,
    )
    const slug = baseSlug || `${university.slug}-program-${hash(record.officialUrl)}`
    const id = `program-${slug}`
    const existing = programs.get(id)
    const program: Program = existing?.details ? existing : {
      id,
      slug,
      universityId: university.id,
      name: {
        en: record.programNameEn,
        zh: record.programNameOriginal,
        ru: record.programNameRu?.trim() || record.programNameEn,
      },
      degreeLevel,
      discipline: classifyDiscipline(record),
      teachingLanguages: languages,
      durationMonths: null,
      programUrl: record.officialUrl,
      applyUrl: record.catalogUrl !== record.officialUrl ? record.catalogUrl : null,
      languageRequirements: [],
      verificationScope: 'identity',
      sourceIds: [programSource.id],
      verifiedAt: record.checkedAt,
      reviewAfter: addDays(record.checkedAt, 30),
      status: 'verified',
    }
    programs.set(program.id, program)
    const cycle = inferCycle(record, program.id, programSource.id)
    if (cycle) cycles.set(cycle.id, cycle)
  }

  const output: DataBundle = bundleSchema.parse({
    sources: [...sources.values()],
    cities: [...cities.values()],
    universities: [...universities.values()],
    programs: [...programs.values()],
    admissionCycles: [...cycles.values()],
    scholarships: original.scholarships,
  })
  await mkdir(options.outputDirectory, { recursive: true })
  const files: Array<[string, unknown]> = [
    ['sources', output.sources],
    ['cities', output.cities],
    ['universities', output.universities],
    ['programs', output.programs],
    ['admission-cycles', output.admissionCycles],
    ['scholarships', output.scholarships],
  ]
  await Promise.all(files.map(([name, value]) => (
    writeFile(
      join(options.outputDirectory, `${name}.json`),
      `${JSON.stringify(value, null, 2)}\n`,
      'utf8',
    )
  )))
  console.log(JSON.stringify({
    outputDirectory: options.outputDirectory,
    reviewRecords: review.records.length,
    sources: output.sources.length,
    cities: output.cities.length,
    universities: output.universities.length,
    programs: output.programs.length,
    admissionCycles: output.admissionCycles.length,
    materializedReviewPrograms: [...programs.values()].filter(
      (item) => item.verificationScope === 'identity',
    ).length,
    skipped: skipped.length,
    skippedDetails: skipped,
  }))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}

export {
  classifyDiscipline,
  normalizeDegreeLevel,
  normalizeTeachingLanguages,
  slugify,
}
