import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

export const DOUBLE_FIRST_CLASS_EXPECTED_COUNT = 147
export const DOUBLE_FIRST_CLASS_COHORT_ID = 'double-first-class-round-2-2022'
export const DOUBLE_FIRST_CLASS_PAGE_URL =
  'https://www.moe.gov.cn/srcsite/A22/s7065/202202/t20220211_598710.html'
export const DOUBLE_FIRST_CLASS_ATTACHMENT_URL =
  'https://www.moe.gov.cn/srcsite/A22/s7065/202202/W020220214318455516037.pdf'

const targetSchema = z.object({
  targetId: z.string().regex(/^dfc-2022-\d{3}$/),
  ordinal: z.number().int().min(1).max(DOUBLE_FIRST_CLASS_EXPECTED_COUNT),
  officialNameZh: z.string().min(2),
  catalogInstitutionId: z.string().regex(/^uni-[a-z0-9-]+$/).optional(),
}).strict()

export const doubleFirstClassRegistrySchema = z.object({
  format: z.literal('studyinchina.institution-target-registry'),
  formatVersion: z.literal(1),
  cohort: z.object({
    id: z.literal(DOUBLE_FIRST_CLASS_COHORT_ID),
    titleZh: z.literal('\u7b2c\u4e8c\u8f6e\u201c\u53cc\u4e00\u6d41\u201d\u5efa\u8bbe\u9ad8\u6821'),
    officialInstitutionCount: z.literal(DOUBLE_FIRST_CLASS_EXPECTED_COUNT),
  }).strict(),
  officialSource: z.object({
    titleZh: z.string().min(1),
    pageUrl: z.literal(DOUBLE_FIRST_CLASS_PAGE_URL),
    attachmentUrl: z.literal(DOUBLE_FIRST_CLASS_ATTACHMENT_URL),
    publishedAt: z.literal('2022-02-11'),
    checkedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict(),
  targets: z.array(targetSchema).length(DOUBLE_FIRST_CLASS_EXPECTED_COUNT),
}).strict()

export type DoubleFirstClassRegistry = z.infer<typeof doubleFirstClassRegistrySchema>

type CatalogUniversity = {
  id?: unknown
  name?: { zh?: unknown }
}

function assertRegistryInvariants(registry: DoubleFirstClassRegistry): void {
  const names = new Set<string>()
  const catalogIds = new Set<string>()
  registry.targets.forEach((target, index) => {
    const ordinal = index + 1
    const expectedTargetId = `dfc-2022-${String(ordinal).padStart(3, '0')}`
    if (target.ordinal !== ordinal || target.targetId !== expectedTargetId) {
      throw new Error(`Double First-Class target order mismatch at ${expectedTargetId}`)
    }
    if (names.has(target.officialNameZh)) {
      throw new Error(`Duplicate Double First-Class institution: ${target.officialNameZh}`)
    }
    names.add(target.officialNameZh)
    if (target.catalogInstitutionId) {
      if (catalogIds.has(target.catalogInstitutionId)) {
        throw new Error(`Duplicate catalog institution mapping: ${target.catalogInstitutionId}`)
      }
      catalogIds.add(target.catalogInstitutionId)
    }
  })
}

export function validateDoubleFirstClassRegistry(value: unknown): DoubleFirstClassRegistry {
  const registry = doubleFirstClassRegistrySchema.parse(value)
  assertRegistryInvariants(registry)
  return registry
}

export function parseOfficialDoubleFirstClassText(text: string): string[] {
  const names = text
    .split(/\r?\n/u)
    .flatMap((line) => {
      const match = line.match(/^\s*([^\uFF1A]+)\uFF1A/u)
      if (!match) return []
      const name = match[1]?.trim()
      return name && !name.startsWith('\u7b2c\u4e8c\u8f6e') ? [name] : []
    })

  if (names.length !== DOUBLE_FIRST_CLASS_EXPECTED_COUNT) {
    throw new Error(
      `Expected ${DOUBLE_FIRST_CLASS_EXPECTED_COUNT} official institutions, found ${names.length}`,
    )
  }
  if (new Set(names).size !== names.length) {
    throw new Error('Official Double First-Class institution names are not unique')
  }
  return names
}

export function buildDoubleFirstClassRegistry(
  officialNames: string[],
  catalogUniversities: CatalogUniversity[],
  contentSha256: string,
  checkedAt: string,
): DoubleFirstClassRegistry {
  const catalogByName = new Map<string, string>()
  for (const university of catalogUniversities) {
    const id = university.id
    const name = university.name?.zh
    if (typeof id === 'string' && typeof name === 'string') catalogByName.set(name, id)
  }
  const registry = {
    format: 'studyinchina.institution-target-registry' as const,
    formatVersion: 1 as const,
    cohort: {
      id: DOUBLE_FIRST_CLASS_COHORT_ID,
      titleZh: '\u7b2c\u4e8c\u8f6e\u201c\u53cc\u4e00\u6d41\u201d\u5efa\u8bbe\u9ad8\u6821' as const,
      officialInstitutionCount: DOUBLE_FIRST_CLASS_EXPECTED_COUNT,
    },
    officialSource: {
      titleZh: '\u7b2c\u4e8c\u8f6e\u201c\u53cc\u4e00\u6d41\u201d\u5efa\u8bbe\u9ad8\u6821\u53ca\u5efa\u8bbe\u5b66\u79d1\u540d\u5355',
      pageUrl: DOUBLE_FIRST_CLASS_PAGE_URL,
      attachmentUrl: DOUBLE_FIRST_CLASS_ATTACHMENT_URL,
      publishedAt: '2022-02-11' as const,
      checkedAt,
      contentSha256,
    },
    targets: officialNames.map((officialNameZh, index) => {
      const catalogInstitutionId = catalogByName.get(officialNameZh)
      return {
        targetId: `dfc-2022-${String(index + 1).padStart(3, '0')}`,
        ordinal: index + 1,
        officialNameZh,
        ...(catalogInstitutionId ? { catalogInstitutionId } : {}),
      }
    }),
  }
  return validateDoubleFirstClassRegistry(registry)
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function runCli(): void {
  const validatePath = option('--validate')
  if (validatePath) {
    const registry = validateDoubleFirstClassRegistry(
      JSON.parse(readFileSync(resolve(validatePath), 'utf8')) as unknown,
    )
    const mapped = registry.targets.filter((target) => target.catalogInstitutionId).length
    console.log(`Validated ${registry.targets.length} official targets; ${mapped} reuse catalog IDs.`)
    return
  }

  const textPath = option('--official-text')
  const pdfPath = option('--official-pdf')
  const outputPath = option('--output')
  const checkedAt = option('--checked-at')
  if (!textPath || !pdfPath || !outputPath || !checkedAt) {
    throw new Error(
      'Usage: --official-text <path> --official-pdf <path> --output <path> --checked-at <YYYY-MM-DD>',
    )
  }
  const names = parseOfficialDoubleFirstClassText(readFileSync(resolve(textPath), 'utf8'))
  const catalog = JSON.parse(
    readFileSync(resolve('content/data/universities.json'), 'utf8'),
  ) as CatalogUniversity[]
  const registry = buildDoubleFirstClassRegistry(
    names,
    catalog,
    sha256File(resolve(pdfPath)),
    checkedAt,
  )
  const output = resolve(outputPath)
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, `${JSON.stringify(registry, null, 2)}\n`, 'utf8')
  console.log(`Wrote ${registry.targets.length} official targets to ${output}`)
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    runCli()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
