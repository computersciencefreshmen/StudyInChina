import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const TSINGHUA_MASTER_CATALOG_URL =
  'https://yzbm.tsinghua.edu.cn/publish/s05/s0503/detail/2807549e-b29c-43a9-9be9-755383c88eb5/1'
export const TSINGHUA_DOCTORATE_CATALOG_URL =
  'https://yzbm.tsinghua.edu.cn/publish/s05/s0503/detail/47028a21-4973-41c1-8426-4aab1af2b8c2/2'
export const TSINGHUA_CATALOG_QUERY_URL =
  'https://yzbm.tsinghua.edu.cn/publish/s05/s0503/querydetail'
export const DEFAULT_REQUEST_DELAY_MS = 5_000
export const DEFAULT_MAX_ATTEMPTS = 3

const TSINGHUA_HOST = 'yzbm.tsinghua.edu.cn'
const INSTITUTION_ID = 'uni-tsinghua-university'
const MAX_ATTEMPTS = 5
const MAX_EVIDENCE_QUOTE_LENGTH = 600
const CATALOG_UUID =
  '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'

type JsonRecord = Record<string, unknown>
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>
type Sleep = (milliseconds: number) => Promise<void>
type TsinghuaAdmissionType = '1' | '2'

export type TsinghuaDegreeLevel = 'master' | 'doctorate'

export type TsinghuaDepartment = {
  code: string
  nameEn: string | null
  nameZh: string | null
}

export type TsinghuaProgramEntity = {
  entityKey: string
  entityType: 'program'
  institutionId: typeof INSTITUTION_ID
  programType: 'degree'
  degreeLevel: TsinghuaDegreeLevel
  majorCode: string
  nameEn: string | null
  nameZh: string | null
  department: TsinghuaDepartment
  degreeAwardType: 'academic' | 'professional' | 'unknown'
  academicYear: string | null
  researchDirectionCount: number
  officialUrl: string
  officialEndpoint: typeof TSINGHUA_CATALOG_QUERY_URL
  sourceCheckedAt: string
  evidence: {
    locator: string
    quote: string
    officialUrl: string
    checkedAt: string
  }
}

export type TsinghuaCatalogHarvest = {
  catalogId: string
  catalogUrl: string
  checkedAt: string
  degreeLevel: TsinghuaDegreeLevel
  admissionType: TsinghuaAdmissionType
  sourceMode: 'live' | 'fixture' | 'dry-run'
  requestDelayMs: number
  departments: TsinghuaDepartment[]
  requestsPlanned: number
  entities: TsinghuaProgramEntity[]
}

export type TsinghuaCatalogHarvesterOptions = {
  catalogUrl?: string
  checkedAt?: string
  degreeLevel?: TsinghuaDegreeLevel
  delayMs?: number
  maxAttempts?: number
  dryRun?: boolean
  detailHtml?: string
  responsesByDepartment?: Readonly<Record<string, unknown>>
  fetchImpl?: FetchLike
  sleep?: Sleep
}

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const normalized = String(value).trim()
  return normalized || null
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function decodeHtmlEntitiesOnce(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/giu, (entity, token: string) => {
    const normalized = token.toLowerCase()
    const named: Record<string, string> = {
      amp: '&',
      apos: "'",
      gt: '>',
      lt: '<',
      nbsp: ' ',
      quot: '"',
    }
    if (named[normalized]) return named[normalized]
    const radix = normalized.startsWith('#x') ? 16 : 10
    const digits = normalized.startsWith('#x')
      ? normalized.slice(2)
      : normalized.startsWith('#')
        ? normalized.slice(1)
        : ''
    if (!digits) return entity
    const codePoint = Number.parseInt(digits, radix)
    if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return entity
    return String.fromCodePoint(codePoint)
  })
}

function decodeHtmlEntities(value: string): string {
  let decoded = value
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const next = decodeHtmlEntitiesOnce(decoded)
    if (next === decoded) break
    decoded = next
  }
  return decoded
}

function cleanHtmlText(value: string): string {
  return decodeHtmlEntities(
    value
      .replace(/<!--[\s\S]*?-->/gu, ' ')
      .replace(/<br\s*\/?>/giu, ' ')
      .replace(/<[^>]+>/gu, ' '),
  ).replace(/\s+/gu, ' ').trim()
}

function attributeValue(attributes: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const match = new RegExp(
    `\\b${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\\x60]+))`,
    'iu',
  ).exec(attributes)
  return decodeHtmlEntities(match?.[1] ?? match?.[2] ?? match?.[3] ?? '').trim() || null
}

function languageSpan(fragment: string, language: 'en' | 'zh_CN'): string | null {
  const pattern = /<span\b([^>]*)>([\s\S]*?)<\/span\s*>/giu
  for (const match of fragment.matchAll(pattern)) {
    if (attributeValue(match[1] ?? '', 'lang') !== language) continue
    return cleanHtmlText(match[2] ?? '') || null
  }
  return null
}

type OfficialCatalogDescriptor = {
  url: URL
  catalogId: string
  admissionType: TsinghuaAdmissionType
  degreeLevel: TsinghuaDegreeLevel
}

function validateDegreeLevel(value: unknown): TsinghuaDegreeLevel | undefined {
  if (value === undefined) return undefined
  if (value === 'master' || value === 'doctorate') return value
  throw new Error('degreeLevel must be master or doctorate')
}

function officialCatalogDescriptor(
  value: string,
  expectedDegreeLevel?: TsinghuaDegreeLevel,
): OfficialCatalogDescriptor {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.hostname !== TSINGHUA_HOST) {
    throw new Error(`Tsinghua catalog URL must use https://${TSINGHUA_HOST}`)
  }
  const match = new RegExp(
    `^/publish/s05/s0503/detail/(${CATALOG_UUID})/([12])/?$`,
    'iu',
  ).exec(url.pathname)
  if (!match?.[1] || (match[2] !== '1' && match[2] !== '2')) {
    throw new Error('Tsinghua catalog URL must contain an xxbm UUID and end in /1 or /2')
  }
  url.hash = ''
  const admissionType = match[2]
  const degreeLevel = admissionType === '1' ? 'master' : 'doctorate'
  const expected = validateDegreeLevel(expectedDegreeLevel)
  if (expected && expected !== degreeLevel) {
    throw new Error(
      `degreeLevel ${expected} conflicts with catalog URL admission type /${admissionType}`,
    )
  }
  return {
    url,
    catalogId: match[1].toLowerCase(),
    admissionType,
    degreeLevel,
  }
}

function validateCheckedAt(value: string): string {
  if (Number.isNaN(Date.parse(value))) throw new Error('checkedAt must be an ISO timestamp')
  return value
}

function validateDelay(value: number): number {
  if (!Number.isInteger(value) || value < DEFAULT_REQUEST_DELAY_MS) {
    throw new Error(`delayMs must be an integer >= ${DEFAULT_REQUEST_DELAY_MS}`)
  }
  return value
}

function validateMaxAttempts(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > MAX_ATTEMPTS) {
    throw new Error(`maxAttempts must be an integer from 1 to ${MAX_ATTEMPTS}`)
  }
  return value
}

function normalizedKeyPart(value: string): string {
  const normalized = value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
  if (!normalized) throw new Error(`Cannot build a stable key from ${JSON.stringify(value)}`)
  return normalized
}

export function parseTsinghuaDepartments(html: string): TsinghuaDepartment[] {
  const list = /<ul\b([^>]*)>([\s\S]*?)<\/ul\s*>/giu
  let departmentListHtml: string | null = null
  for (const match of html.matchAll(list)) {
    if (attributeValue(match[1] ?? '', 'id') === 'zsyx') {
      departmentListHtml = match[2] ?? ''
      break
    }
  }
  if (departmentListHtml === null) {
    throw new Error('Official Tsinghua catalog did not contain the #zsyx department list')
  }

  const departments = new Map<string, TsinghuaDepartment>()
  for (const match of departmentListHtml.matchAll(/<li\b([^>]*)>([\s\S]*?)<\/li\s*>/giu)) {
    const code = attributeValue(match[1] ?? '', 'data-value')
    if (!code) continue
    const fragment = match[2] ?? ''
    const department: TsinghuaDepartment = {
      code,
      nameEn: languageSpan(fragment, 'en'),
      nameZh: languageSpan(fragment, 'zh_CN'),
    }
    const existing = departments.get(code)
    if (!existing || (!existing.nameEn && department.nameEn) || (!existing.nameZh && department.nameZh)) {
      departments.set(code, department)
    }
  }
  if (departments.size === 0) {
    throw new Error('Official Tsinghua catalog contained no department codes')
  }
  return [...departments.values()].sort((left, right) => left.code.localeCompare(right.code))
}

function degreeAwardType(value: unknown): TsinghuaProgramEntity['degreeAwardType'] {
  if (asString(value) === '1') return 'academic'
  if (asString(value) === '2') return 'professional'
  return 'unknown'
}

function evidenceQuote(
  department: TsinghuaDepartment,
  majorCode: string,
  nameEn: string | null,
  nameZh: string | null,
  awardType: TsinghuaProgramEntity['degreeAwardType'],
): string {
  const departmentName = decodeHtmlEntities(
    department.nameEn ?? department.nameZh ?? 'Department',
  )
  const majorName = decodeHtmlEntities(nameEn ?? nameZh ?? majorCode)
  const award = awardType === 'unknown' ? '' : ` (${awardType} degree)`
  return `${department.code} ${departmentName} — ${majorCode} ${majorName}${award}`
    .slice(0, MAX_EVIDENCE_QUOTE_LENGTH)
}

export function normalizeTsinghuaDepartmentResponse(input: {
  payload: unknown
  requestedDepartment: TsinghuaDepartment
  catalogUrl?: string
  degreeLevel?: TsinghuaDegreeLevel
  checkedAt: string
}): TsinghuaProgramEntity[] {
  const catalog = officialCatalogDescriptor(
    input.catalogUrl ?? TSINGHUA_MASTER_CATALOG_URL,
    input.degreeLevel,
  )
  const catalogUrl = catalog.url.href
  const checkedAt = validateCheckedAt(input.checkedAt)
  const root = asRecord(input.payload)
  const datas = asRecord(root?.datas)
  if (!root || !datas || (root.code !== undefined && Number(root.code) !== 200)) {
    throw new Error(`Invalid Tsinghua response for department ${input.requestedDepartment.code}`)
  }

  const academicYear = asString(datas.zsnd)
  const entities = new Map<string, TsinghuaProgramEntity>()
  const responseAdmissionType = asString(datas.zslx)
  if (responseAdmissionType && responseAdmissionType !== catalog.admissionType) {
    throw new Error(
      `Tsinghua response zslx ${responseAdmissionType} conflicts with catalog URL /${catalog.admissionType}`,
    )
  }
  const responseCatalogId = asString(datas.xxbm)
  if (responseCatalogId && responseCatalogId.toLowerCase() !== catalog.catalogId) {
    throw new Error('Tsinghua response xxbm conflicts with catalog URL UUID')
  }
  for (const departmentValue of asArray(datas.zsmlYxs)) {
    const departmentRecord = asRecord(departmentValue)
    if (!departmentRecord) continue
    const department: TsinghuaDepartment = {
      code: asString(departmentRecord.zsyxsdm) ?? input.requestedDepartment.code,
      nameEn: asString(departmentRecord.zsyxsywmc) ?? input.requestedDepartment.nameEn,
      nameZh: asString(departmentRecord.zsyxsmc) ?? input.requestedDepartment.nameZh,
    }
    for (const majorValue of asArray(departmentRecord.exportZsmlYxZys)) {
      const major = asRecord(majorValue)
      if (!major) continue
      const majorCode = asString(major.zszydm)
      const nameEn = asString(major.zszyywmc)
      const nameZh = asString(major.zszymc)
      if (!majorCode || (!nameEn && !nameZh)) continue
      const entityKey = [
        'tsinghua',
        catalog.degreeLevel,
        normalizedKeyPart(department.code),
        normalizedKeyPart(majorCode),
      ].join(':')
      const awardType = degreeAwardType(major.xwlx)
      const researchDirectionCount = asArray(major.exportZsmlYxZyYjfxs).length
      const locator = [
        'json:datas.zsmlYxs',
        `[zsyxsdm=${department.code}]`,
        `.exportZsmlYxZys[zszydm=${majorCode}]`,
      ].join('')
      const entity: TsinghuaProgramEntity = {
        entityKey,
        entityType: 'program',
        institutionId: INSTITUTION_ID,
        programType: 'degree',
        degreeLevel: catalog.degreeLevel,
        majorCode,
        nameEn: nameEn ? decodeHtmlEntities(nameEn) : null,
        nameZh: nameZh ? decodeHtmlEntities(nameZh) : null,
        department: {
          ...department,
          nameEn: department.nameEn ? decodeHtmlEntities(department.nameEn) : null,
          nameZh: department.nameZh ? decodeHtmlEntities(department.nameZh) : null,
        },
        degreeAwardType: awardType,
        academicYear,
        researchDirectionCount,
        officialUrl: catalogUrl,
        officialEndpoint: TSINGHUA_CATALOG_QUERY_URL,
        sourceCheckedAt: checkedAt,
        evidence: {
          locator,
          quote: evidenceQuote(department, majorCode, nameEn, nameZh, awardType),
          officialUrl: catalogUrl,
          checkedAt,
        },
      }
      const existing = entities.get(entityKey)
      if (!existing || entity.researchDirectionCount > existing.researchDirectionCount) {
        entities.set(entityKey, entity)
      }
    }
  }
  return [...entities.values()].sort((left, right) => left.entityKey.localeCompare(right.entityKey))
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500
}

async function requestWithRetry<T>(input: {
  fetchImpl: FetchLike
  url: string
  init?: RequestInit
  maxAttempts: number
  retryDelayMs: number
  sleep: Sleep
  read: (response: Response) => Promise<T>
}): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= input.maxAttempts; attempt += 1) {
    try {
      const response = await input.fetchImpl(input.url, input.init)
      if (!response.ok) {
        const error = new Error(`Tsinghua request failed with HTTP ${response.status}`)
        if (!retryableStatus(response.status)) throw error
        lastError = error
      } else {
        return await input.read(response)
      }
    } catch (error) {
      lastError = error
      if (
        error instanceof Error &&
        /^Tsinghua request failed with HTTP 4/u.test(error.message) &&
        !/HTTP (?:408|425|429)/u.test(error.message)
      ) {
        throw error
      }
    }
    if (attempt < input.maxAttempts) await input.sleep(input.retryDelayMs)
  }
  throw lastError instanceof Error ? lastError : new Error('Tsinghua request failed')
}

function queryBody(
  catalogId: string,
  admissionType: TsinghuaAdmissionType,
  departmentCode: string,
): URLSearchParams {
  return new URLSearchParams({
    xxbm: catalogId,
    zslx: admissionType,
    yxsdm: departmentCode,
    showUsage: 'false',
  })
}

export async function harvestTsinghuaCatalog(
  options: TsinghuaCatalogHarvesterOptions = {},
): Promise<TsinghuaCatalogHarvest> {
  const catalog = officialCatalogDescriptor(
    options.catalogUrl ?? TSINGHUA_MASTER_CATALOG_URL,
    options.degreeLevel,
  )
  const checkedAt = validateCheckedAt(options.checkedAt ?? new Date().toISOString())
  const delayMs = validateDelay(options.delayMs ?? DEFAULT_REQUEST_DELAY_MS)
  const maxAttempts = validateMaxAttempts(options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS)
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolveSleep) => {
    setTimeout(resolveSleep, milliseconds)
  }))
  const fetchImpl = options.fetchImpl ?? fetch

  const detailHtml = options.detailHtml ?? await requestWithRetry({
    fetchImpl,
    url: catalog.url.href,
    maxAttempts,
    retryDelayMs: delayMs,
    sleep,
    read: (response) => response.text(),
  })
  const departments = parseTsinghuaDepartments(detailHtml)
  if (options.dryRun) {
    return {
      catalogId: catalog.catalogId,
      catalogUrl: catalog.url.href,
      degreeLevel: catalog.degreeLevel,
      admissionType: catalog.admissionType,
      checkedAt,
      sourceMode: 'dry-run',
      requestDelayMs: delayMs,
      departments,
      requestsPlanned: departments.length,
      entities: [],
    }
  }

  const entities = new Map<string, TsinghuaProgramEntity>()
  const fixtureMode = options.responsesByDepartment !== undefined
  for (const department of departments) {
    let payload: unknown
    if (fixtureMode) {
      if (!(department.code in options.responsesByDepartment!)) {
        throw new Error(`Missing fixture response for Tsinghua department ${department.code}`)
      }
      payload = options.responsesByDepartment![department.code]
    } else {
      await sleep(delayMs)
      payload = await requestWithRetry({
        fetchImpl,
        url: TSINGHUA_CATALOG_QUERY_URL,
        init: {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
            referer: catalog.url.href,
          },
          body: queryBody(catalog.catalogId, catalog.admissionType, department.code),
        },
        maxAttempts,
        retryDelayMs: delayMs,
        sleep,
        read: (response) => response.json(),
      })
    }
    for (const entity of normalizeTsinghuaDepartmentResponse({
      payload,
      requestedDepartment: department,
      catalogUrl: catalog.url.href,
      degreeLevel: catalog.degreeLevel,
      checkedAt,
    })) {
      const existing = entities.get(entity.entityKey)
      if (!existing || entity.researchDirectionCount > existing.researchDirectionCount) {
        entities.set(entity.entityKey, entity)
      }
    }
  }

  return {
    catalogId: catalog.catalogId,
    catalogUrl: catalog.url.href,
    degreeLevel: catalog.degreeLevel,
    admissionType: catalog.admissionType,
    checkedAt,
    sourceMode: fixtureMode ? 'fixture' : 'live',
    requestDelayMs: delayMs,
    departments,
    requestsPlanned: departments.length,
    entities: [...entities.values()].sort((left, right) => left.entityKey.localeCompare(right.entityKey)),
  }
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function integerArgument(name: string, fallback: number): number {
  const value = argument(name)
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) throw new Error(`${name} must be an integer`)
  return parsed
}

function degreeLevelArgument(): TsinghuaDegreeLevel | undefined {
  return validateDegreeLevel(argument('--degree-level'))
}

function fixtureResponses(
  detailHtml: string,
  responseDirectory: string,
): Readonly<Record<string, unknown>> {
  const responses: Record<string, unknown> = {}
  for (const department of parseTsinghuaDepartments(detailHtml)) {
    const responsePath = join(responseDirectory, `${department.code}.json`)
    if (!existsSync(responsePath)) {
      throw new Error(`Missing fixture response: ${responsePath}`)
    }
    responses[department.code] = JSON.parse(readFileSync(responsePath, 'utf8')) as unknown
  }
  return responses
}

async function main(): Promise<void> {
  const inputHtmlPath = argument('--input-html')
  const responseDirectory = argument('--input-responses')
  const dryRun = process.argv.includes('--dry-run')
  if (responseDirectory && !inputHtmlPath) {
    throw new Error('--input-responses requires --input-html')
  }
  if (inputHtmlPath && !responseDirectory && !dryRun) {
    throw new Error('--input-html requires --input-responses unless --dry-run is set')
  }

  const detailHtml = inputHtmlPath ? readFileSync(resolve(inputHtmlPath), 'utf8') : undefined
  const responsesByDepartment = responseDirectory && detailHtml
    ? fixtureResponses(detailHtml, resolve(responseDirectory))
    : undefined
  const result = await harvestTsinghuaCatalog({
    catalogUrl: argument('--catalog-url'),
    degreeLevel: degreeLevelArgument(),
    checkedAt: argument('--checked-at'),
    delayMs: integerArgument('--delay-ms', DEFAULT_REQUEST_DELAY_MS),
    maxAttempts: integerArgument('--max-attempts', DEFAULT_MAX_ATTEMPTS),
    dryRun,
    detailHtml,
    responsesByDepartment,
  })
  const serialized = `${JSON.stringify(result, null, 2)}\n`
  const outputPath = argument('--output')
  if (outputPath) {
    const absoluteOutputPath = resolve(outputPath)
    mkdirSync(dirname(absoluteOutputPath), { recursive: true })
    writeFileSync(absoluteOutputPath, serialized, 'utf8')
    process.stdout.write(`${absoluteOutputPath}\n`)
  } else {
    process.stdout.write(serialized)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
