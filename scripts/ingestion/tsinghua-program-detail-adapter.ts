import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const DEFAULT_MINIMUM_PUBLISHABLE_DEADLINE = '2026-08-26'

const OFFICIAL_HOST = 'yzbm.tsinghua.edu.cn'
const SOURCE_BUNDLE_FORMAT = 'studyinchina.tsinghua-source-bundle'
const MAX_QUOTE_LENGTH = 600

type JsonRecord = Record<string, unknown>

export type TsinghuaFactStatus =
  | 'known'
  | 'officially_not_announced'
  | 'not_applicable'
  | 'source_unavailable'
  | 'conflict'
  | 'stale'

export type TsinghuaFieldMeta = {
  status: TsinghuaFactStatus
  officialUrl: string
  sourceTitle: string
  checkedAt: string
  locator?: string
  quote?: string
}

export type TsinghuaFact<T> = {
  value: T | null
  fieldMeta: TsinghuaFieldMeta
}

export type TsinghuaLocalizedText = {
  'zh-CN': string | null
  en: string | null
}

export type TsinghuaResearchTrack = {
  code: string
  name: TsinghuaFact<TsinghuaLocalizedText>
  attendanceMode: TsinghuaFact<'full_time' | 'part_time'>
  instructionLanguages: TsinghuaFact<Array<'Chinese' | 'English'>>
  chineseLanguageRequirement: TsinghuaFact<TsinghuaLocalizedText>
  englishLanguageRequirement: TsinghuaFact<TsinghuaLocalizedText>
  applicationRemarks: TsinghuaFact<string>
  applicationDeadline: TsinghuaFact<string>
  jointProgram: TsinghuaFact<boolean>
}

export type TsinghuaMoney = {
  amount: number
  currency: 'CNY'
  billingPeriod: 'academic_year' | 'full_program'
}

export type TsinghuaAdmissionCycle = {
  academicYear: TsinghuaFact<string>
  intakeSeason: TsinghuaFact<string>
  applicationDeadline: TsinghuaFact<string>
  applicableTrackCodes: string[]
  tuition: TsinghuaFact<TsinghuaMoney>
}

export type TsinghuaProgramDetails = {
  localizations: {
    'zh-CN': TsinghuaFact<string>
    en: TsinghuaFact<string>
  }
  departmentContact: TsinghuaFact<TsinghuaLocalizedText>
  programRemarks: TsinghuaFact<TsinghuaLocalizedText>
  tracks: TsinghuaResearchTrack[]
  publishableAdmissionCycles: TsinghuaAdmissionCycle[]
  tuition: TsinghuaFact<TsinghuaMoney>
}

export type TsinghuaDetailCoverage = {
  programs: number
  tracks: number
  bilingualProgramNames: number
  bilingualTrackNames: number
  attendanceModeKnown: number
  instructionLanguageKnown: number
  chineseRequirementKnown: number
  englishRequirementKnown: number
  deadlineKnown: number
  deadlineStale: number
  deadlineConflict: number
  publishableCycles: number
  tuitionKnown: number
}

export type EnrichedTsinghuaProgram = JsonRecord & {
  entityKey: string
  details: TsinghuaProgramDetails
}

export type EnrichedTsinghuaCatalog = JsonRecord & {
  minimumPublishableDeadline: string
  entities: EnrichedTsinghuaProgram[]
  detailCoverage: TsinghuaDetailCoverage
}

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as JsonRecord
}

function optionalRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value
}

function decodeEntitiesOnce(value: string): string {
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
    const codePoint = digits ? Number.parseInt(digits, radix) : Number.NaN
    return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
      ? String.fromCodePoint(codePoint)
      : entity
  })
}

function cleanText(value: string): string {
  let decoded = value
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const next = decodeEntitiesOnce(decoded)
    if (next === decoded) break
    decoded = next
  }
  return decoded
    .replace(/<br\s*\/?>/giu, '\n')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/\u00a0/gu, ' ')
    .replace(/[ \t]+/gu, ' ')
    .replace(/\s*\n\s*/gu, '\n')
    .trim()
}

function text(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  return cleanText(String(value)) || null
}

function timestamp(value: unknown, label: string): string {
  const normalized = text(value)
  const parsed = normalized ? new Date(normalized) : new Date(Number.NaN)
  if (Number.isNaN(parsed.getTime())) throw new Error(`${label} must be an ISO timestamp`)
  return parsed.toISOString()
}

function dateOnly(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new Error('minimumPublishableDeadline must use YYYY-MM-DD')
  }
  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(year!, month! - 1, day!))
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() + 1 !== month
    || parsed.getUTCDate() !== day
  ) {
    throw new Error('minimumPublishableDeadline must be a real calendar date')
  }
  return value
}

export function minimumPublishableDeadlineAfterOneMonth(
  checkedAt: string,
): string {
  const instant = new Date(timestamp(checkedAt, 'checkedAt'))
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(instant).map((part) => [part.type, part.value]),
  )
  const year = Number(parts.year)
  const month = Number(parts.month)
  const day = Number(parts.day)
  const targetYear = month === 12 ? year + 1 : year
  const targetMonth = month === 12 ? 1 : month + 1
  const lastTargetDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate()
  return dateOnly([
    String(targetYear).padStart(4, '0'),
    String(targetMonth).padStart(2, '0'),
    String(Math.min(day, lastTargetDay)).padStart(2, '0'),
  ].join('-'))
}

function officialUrl(value: unknown, label: string): string {
  let parsed: URL
  try {
    parsed = new URL(text(value) ?? '')
  } catch {
    throw new Error(`${label} must be an official Tsinghua HTTPS URL`)
  }
  if (
    parsed.protocol !== 'https:'
    || parsed.hostname.toLowerCase() !== OFFICIAL_HOST
    || parsed.username
    || parsed.password
    || parsed.port
  ) {
    throw new Error(`${label} must use https://${OFFICIAL_HOST}`)
  }
  parsed.hash = ''
  return parsed.href
}

function sourceTitle(academicYear: string | null): string {
  return `Tsinghua University International Graduate Programs Catalog${
    academicYear ? ` ${academicYear}` : ''
  }`
}

function fact<T>(input: {
  value: T | null
  status: TsinghuaFactStatus
  officialUrl: string
  checkedAt: string
  academicYear: string | null
  locator?: string
  quote?: string | null
}): TsinghuaFact<T> {
  return {
    value: input.value,
    fieldMeta: {
      status: input.status,
      officialUrl: input.officialUrl,
      sourceTitle: sourceTitle(input.academicYear),
      checkedAt: input.checkedAt,
      ...(input.locator ? { locator: input.locator } : {}),
      ...(input.quote
        ? { quote: cleanText(input.quote).slice(0, MAX_QUOTE_LENGTH) }
        : {}),
    },
  }
}

function localizedFact(input: {
  zh: unknown
  en: unknown
  locator: string
  officialUrl: string
  checkedAt: string
  academicYear: string | null
}): TsinghuaFact<TsinghuaLocalizedText> {
  const zh = text(input.zh)
  const en = text(input.en)
  return fact({
    value: zh || en ? { 'zh-CN': zh, en } : null,
    status: zh || en ? 'known' : 'officially_not_announced',
    officialUrl: input.officialUrl,
    checkedAt: input.checkedAt,
    academicYear: input.academicYear,
    locator: input.locator,
    quote: [zh, en].filter(Boolean).join(' / '),
  })
}

function stringFact(input: {
  value: unknown
  locator: string
  officialUrl: string
  checkedAt: string
  academicYear: string | null
}): TsinghuaFact<string> {
  const value = text(input.value)
  return fact({
    value,
    status: value ? 'known' : 'officially_not_announced',
    officialUrl: input.officialUrl,
    checkedAt: input.checkedAt,
    academicYear: input.academicYear,
    locator: input.locator,
    quote: value,
  })
}

function directionLocator(departmentCode: string, majorCode: string, code: string): string {
  return [
    'json:datas.zsmlYxs',
    `[zsyxsdm=${departmentCode}]`,
    `.exportZsmlYxZys[zszydm=${majorCode}]`,
    `.exportZsmlYxZyYjfxs[yjfxdm=${code}]`,
  ].join('')
}

type CommonFactInput = {
  locator: string
  officialUrl: string
  checkedAt: string
  academicYear: string | null
}

function attendanceFact(
  direction: JsonRecord,
  common: CommonFactInput,
): TsinghuaFact<'full_time' | 'part_time'> {
  const combined = [text(direction.xxfsmc), text(direction.xxfsywmc)]
    .filter(Boolean)
    .join(' / ')
  const fullTime = /(?:^|\b)full[\s-]*time(?:\b|$)|全日制/iu.test(combined)
  const partTime = /(?:^|\b)part[\s-]*time(?:\b|$)|非全日制/iu.test(combined)
  const value = partTime
    ? 'part_time' as const
    : fullTime
      ? 'full_time' as const
      : null
  return fact({
    ...common,
    value,
    status: !combined ? 'officially_not_announced' : value ? 'known' : 'conflict',
    locator: `${common.locator}.{xxfsmc,xxfsywmc}`,
    quote: combined,
  })
}

function languageFact(
  direction: JsonRecord,
  common: CommonFactInput,
): TsinghuaFact<Array<'Chinese' | 'English'>> {
  const combined = [
    text(direction.sfqywxmzw),
    text(direction.sfqywxmyw),
    text(direction.yjfxmc),
    text(direction.yjfxywmc),
  ].filter(Boolean).join(' / ')
  const values = new Set<'Chinese' | 'English'>()
  if (
    /English\s+(?:as\s+(?:the\s+)?)?(?:medium|language)\s+of\s+instruction|English\s+Program|fully\s+in\s+English|全英文|英语授课/iu
      .test(combined)
  ) {
    values.add('English')
  }
  if (/Chinese\s+Program|Chinese\s+as\s+(?:the\s+)?medium|中文项目|中文授课/iu.test(combined)) {
    values.add('Chinese')
  }
  if (/bilingual|中英(?:文)?双语/iu.test(combined)) {
    values.add('Chinese')
    values.add('English')
  }
  const value = [...values].sort() as Array<'Chinese' | 'English'>
  return fact({
    ...common,
    value: value.length ? value : null,
    status: value.length ? 'known' : 'officially_not_announced',
    locator: `${common.locator}.{sfqywxmzw,sfqywxmyw,yjfxmc,yjfxywmc}`,
    quote: combined,
  })
}

function parseBeijingDeadline(value: string): string | null {
  const match = /(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/u.exec(value)
  if (!match) return null
  const [, year, month, day, hour, minute, second] = match
  const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}+08:00`
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return null
  const expectedUtc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour) - 8,
    Number(minute),
    Number(second),
  )
  return parsed.getTime() === expectedUtc ? iso : null
}

function deadlineFact(
  direction: JsonRecord,
  minimumDeadline: string,
  common: CommonFactInput,
): TsinghuaFact<string> {
  const originals = [text(direction.bmjssjzw), text(direction.bmjssjyw)]
    .filter((value): value is string => Boolean(value))
  if (!originals.length) {
    return fact<string>({
      ...common,
      value: null,
      status: 'officially_not_announced',
      locator: `${common.locator}.{bmjssjzw,bmjssjyw}`,
    })
  }
  const parsed = originals.map(parseBeijingDeadline)
  const unique = [...new Set(parsed.filter((value): value is string => Boolean(value)))]
  if (parsed.some((value) => value === null) || unique.length !== 1) {
    return fact<string>({
      ...common,
      value: null,
      status: 'conflict',
      locator: `${common.locator}.{bmjssjzw,bmjssjyw}`,
      quote: originals.join(' / '),
    })
  }
  const deadline = unique[0]!
  const publishable =
    new Date(deadline).getTime()
    >= new Date(`${minimumDeadline}T00:00:00+08:00`).getTime()
  return fact({
    ...common,
    value: publishable ? deadline : null,
    status: publishable ? 'known' : 'stale',
    locator: `${common.locator}.{bmjssjzw,bmjssjyw}`,
    quote: originals.join(' / '),
  })
}

function unavailableTuition(common: CommonFactInput): TsinghuaFact<TsinghuaMoney> {
  return fact<TsinghuaMoney>({
    ...common,
    value: null,
    status: 'officially_not_announced',
    locator: `${common.locator}.tuition`,
  })
}

export function adaptTsinghuaProgramDetails(input: {
  department: unknown
  major: unknown
  academicYear: string | null
  catalogUrl: string
  checkedAt: string
  minimumPublishableDeadline?: string
}): TsinghuaProgramDetails {
  const department = record(input.department, 'department')
  const major = record(input.major, 'major')
  const catalogUrl = officialUrl(input.catalogUrl, 'catalogUrl')
  const checkedAt = timestamp(input.checkedAt, 'checkedAt')
  const minimumDeadline = dateOnly(
    input.minimumPublishableDeadline ?? DEFAULT_MINIMUM_PUBLISHABLE_DEADLINE,
  )
  const departmentCode = text(department.zsyxsdm)
  const majorCode = text(major.zszydm)
  if (!departmentCode || !majorCode) throw new Error('department and major codes are required')
  const majorLocator =
    `json:datas.zsmlYxs[zsyxsdm=${departmentCode}].exportZsmlYxZys[zszydm=${majorCode}]`
  const academicYear = input.academicYear

  const tracks = array(major.exportZsmlYxZyYjfxs, 'major.exportZsmlYxZyYjfxs')
    .map(optionalRecord)
    .filter((value): value is JsonRecord => value !== null)
    .map((direction): TsinghuaResearchTrack | null => {
      const code = text(direction.yjfxdm)
      if (!code) return null
      const locator = directionLocator(departmentCode, majorCode, code)
      const common = { locator, officialUrl: catalogUrl, checkedAt, academicYear }
      const jointText = [text(direction.sflslpxmzw), text(direction.sflslpxmyw)]
        .filter(Boolean)
        .join(' / ')
      return {
        code,
        name: localizedFact({
          zh: direction.yjfxmc,
          en: direction.yjfxywmc,
          locator: `${locator}.{yjfxmc,yjfxywmc}`,
          officialUrl: catalogUrl,
          checkedAt,
          academicYear,
        }),
        attendanceMode: attendanceFact(direction, common),
        instructionLanguages: languageFact(direction, common),
        chineseLanguageRequirement: localizedFact({
          zh: direction.zwhyyq,
          en: direction.ywhyyq,
          locator: `${locator}.{zwhyyq,ywhyyq}`,
          officialUrl: catalogUrl,
          checkedAt,
          academicYear,
        }),
        englishLanguageRequirement: localizedFact({
          zh: direction.zwyyyq,
          en: direction.ywyyyq,
          locator: `${locator}.{zwyyyq,ywyyyq}`,
          officialUrl: catalogUrl,
          checkedAt,
          academicYear,
        }),
        applicationRemarks: stringFact({
          value: direction.yjfxbz,
          locator: `${locator}.yjfxbz`,
          officialUrl: catalogUrl,
          checkedAt,
          academicYear,
        }),
        applicationDeadline: deadlineFact(direction, minimumDeadline, common),
        jointProgram: fact({
          value: jointText ? /joint\s+program|联合项目/iu.test(jointText) : null,
          status: jointText ? 'known' : 'officially_not_announced',
          officialUrl: catalogUrl,
          checkedAt,
          academicYear,
          locator: `${locator}.{sflslpxmzw,sflslpxmyw}`,
          quote: jointText,
        }),
      }
    })
    .filter((value): value is TsinghuaResearchTrack => value !== null)
    .sort((left, right) => left.code.localeCompare(right.code, 'en'))

  const academicYearValue = /^\d{4}$/u.test(academicYear ?? '') ? academicYear : null
  const academicYearStatus: TsinghuaFactStatus = academicYear === null
    ? 'officially_not_announced'
    : academicYearValue
      ? 'known'
      : 'conflict'
  const cycles = new Map<string, string[]>()
  for (const track of tracks) {
    const deadline = track.applicationDeadline.value
    if (track.applicationDeadline.fieldMeta.status !== 'known' || !deadline) continue
    cycles.set(deadline, [...(cycles.get(deadline) ?? []), track.code])
  }

  return {
    localizations: {
      'zh-CN': stringFact({
        value: major.zszymc,
        locator: `${majorLocator}.zszymc`,
        officialUrl: catalogUrl,
        checkedAt,
        academicYear,
      }),
      en: stringFact({
        value: major.zszyywmc,
        locator: `${majorLocator}.zszyywmc`,
        officialUrl: catalogUrl,
        checkedAt,
        academicYear,
      }),
    },
    departmentContact: localizedFact({
      zh: department.yxbz,
      en: department.yxywbz,
      locator: `json:datas.zsmlYxs[zsyxsdm=${departmentCode}].{yxbz,yxywbz}`,
      officialUrl: catalogUrl,
      checkedAt,
      academicYear,
    }),
    programRemarks: localizedFact({
      zh: major.zybz,
      en: major.zyywbz,
      locator: `${majorLocator}.{zybz,zyywbz}`,
      officialUrl: catalogUrl,
      checkedAt,
      academicYear,
    }),
    tracks,
    publishableAdmissionCycles: [...cycles.entries()]
      .sort(([left], [right]) => left.localeCompare(right, 'en'))
      .map(([deadline, trackCodes]) => ({
        academicYear: fact({
          value: academicYearValue,
          status: academicYearStatus,
          officialUrl: catalogUrl,
          checkedAt,
          academicYear,
          locator: 'json:datas.zsnd',
          quote: academicYear,
        }),
        intakeSeason: fact<string>({
          value: null,
          status: 'officially_not_announced',
          officialUrl: catalogUrl,
          checkedAt,
          academicYear,
          locator: 'json:datas',
        }),
        applicationDeadline: fact({
          value: deadline,
          status: 'known',
          officialUrl: catalogUrl,
          checkedAt,
          academicYear,
          locator: tracks
            .filter((track) => track.applicationDeadline.value === deadline)
            .map((track) => track.applicationDeadline.fieldMeta.locator)
            .filter(Boolean)
            .join(' | '),
          quote: tracks
            .filter((track) => track.applicationDeadline.value === deadline)
            .map((track) => track.applicationDeadline.fieldMeta.quote)
            .filter(Boolean)
            .join(' / '),
        }),
        applicableTrackCodes: [...new Set(trackCodes)].sort(),
        tuition: unavailableTuition({
          locator: majorLocator,
          officialUrl: catalogUrl,
          checkedAt,
          academicYear,
        }),
      })),
    tuition: unavailableTuition({
      locator: majorLocator,
      officialUrl: catalogUrl,
      checkedAt,
      academicYear,
    }),
  }
}

export function summarizeTsinghuaDetails(
  programs: ReadonlyArray<EnrichedTsinghuaProgram>,
): TsinghuaDetailCoverage {
  const tracks = programs.flatMap((program) => program.details.tracks)
  return {
    programs: programs.length,
    tracks: tracks.length,
    bilingualProgramNames: programs.filter((program) => (
      program.details.localizations['zh-CN'].fieldMeta.status === 'known'
      && program.details.localizations.en.fieldMeta.status === 'known'
    )).length,
    bilingualTrackNames: tracks.filter((track) => (
      Boolean(track.name.value?.['zh-CN']) && Boolean(track.name.value?.en)
    )).length,
    attendanceModeKnown: tracks.filter(
      (track) => track.attendanceMode.fieldMeta.status === 'known',
    ).length,
    instructionLanguageKnown: tracks.filter(
      (track) => track.instructionLanguages.fieldMeta.status === 'known',
    ).length,
    chineseRequirementKnown: tracks.filter(
      (track) => track.chineseLanguageRequirement.fieldMeta.status === 'known',
    ).length,
    englishRequirementKnown: tracks.filter(
      (track) => track.englishLanguageRequirement.fieldMeta.status === 'known',
    ).length,
    deadlineKnown: tracks.filter(
      (track) => track.applicationDeadline.fieldMeta.status === 'known',
    ).length,
    deadlineStale: tracks.filter(
      (track) => track.applicationDeadline.fieldMeta.status === 'stale',
    ).length,
    deadlineConflict: tracks.filter(
      (track) => track.applicationDeadline.fieldMeta.status === 'conflict',
    ).length,
    publishableCycles: programs.reduce(
      (total, program) => total + program.details.publishableAdmissionCycles.length,
      0,
    ),
    tuitionKnown: programs.filter(
      (program) => program.details.tuition.fieldMeta.status === 'known',
    ).length,
  }
}

function decodeResponseBody(value: unknown, label: string): JsonRecord {
  const response = record(value, label)
  if (response.httpStatus !== 200) throw new Error(`${label} must have HTTP 200`)
  const encoded = text(response.bodyBase64)
  if (!encoded) throw new Error(`${label}.bodyBase64 is required`)
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as unknown
  } catch {
    throw new Error(`${label}.bodyBase64 must contain valid UTF-8 JSON`)
  }
  return record(parsed, `${label}.body`)
}

export function enrichTsinghuaCatalogHarvest(input: {
  harvest: unknown
  sourceBundle: unknown
  minimumPublishableDeadline?: string
}): EnrichedTsinghuaCatalog {
  const harvest = record(input.harvest, 'harvest')
  const bundle = record(input.sourceBundle, 'sourceBundle')
  if (bundle.format !== SOURCE_BUNDLE_FORMAT || bundle.formatVersion !== 1) {
    throw new Error(`sourceBundle must use ${SOURCE_BUNDLE_FORMAT} v1`)
  }
  const harvestUrl = officialUrl(harvest.catalogUrl, 'harvest.catalogUrl')
  const bundleUrl = officialUrl(bundle.catalogUrl, 'sourceBundle.catalogUrl')
  if (harvestUrl !== bundleUrl) throw new Error('harvest and sourceBundle catalog URLs conflict')
  const checkedAt = timestamp(harvest.checkedAt, 'harvest.checkedAt')
  if (checkedAt !== timestamp(bundle.checkedAt, 'sourceBundle.checkedAt')) {
    throw new Error('harvest and sourceBundle checkedAt values conflict')
  }
  const minimumDeadline = dateOnly(
    input.minimumPublishableDeadline ?? DEFAULT_MINIMUM_PUBLISHABLE_DEADLINE,
  )
  const majors = new Map<string, { department: JsonRecord; major: JsonRecord; year: string | null }>()
  for (const [responseIndex, responseValue] of array(
    bundle.responses,
    'sourceBundle.responses',
  ).entries()) {
    const body = decodeResponseBody(responseValue, `sourceBundle.responses[${responseIndex}]`)
    if (body.code !== undefined && Number(body.code) !== 200) {
      throw new Error(`sourceBundle.responses[${responseIndex}] body code is not 200`)
    }
    const datas = record(body.datas, `sourceBundle.responses[${responseIndex}].body.datas`)
    const year = text(datas.zsnd)
    for (const departmentValue of array(
      datas.zsmlYxs,
      `sourceBundle.responses[${responseIndex}].body.datas.zsmlYxs`,
    )) {
      const department = record(departmentValue, 'department')
      const departmentCode = text(department.zsyxsdm)
      if (!departmentCode) continue
      for (const majorValue of array(department.exportZsmlYxZys, 'department.exportZsmlYxZys')) {
        const major = record(majorValue, 'major')
        const majorCode = text(major.zszydm)
        if (!majorCode) continue
        majors.set(`${departmentCode}\u0000${majorCode}`, { department, major, year })
      }
    }
  }

  const entities = array(harvest.entities, 'harvest.entities').map((value, index) => {
    const entity = record(value, `harvest.entities[${index}]`)
    const entityKey = text(entity.entityKey)
    const department = optionalRecord(entity.department)
    const departmentCode = text(department?.code)
    const majorCode = text(entity.majorCode)
    if (!entityKey || !departmentCode || !majorCode) {
      throw new Error(`harvest.entities[${index}] lacks its stable identity fields`)
    }
    const raw = majors.get(`${departmentCode}\u0000${majorCode}`)
    if (!raw) throw new Error(`no source-bundle details found for ${entityKey}`)
    return {
      ...entity,
      entityKey,
      details: adaptTsinghuaProgramDetails({
        department: raw.department,
        major: raw.major,
        academicYear: raw.year,
        catalogUrl: harvestUrl,
        checkedAt,
        minimumPublishableDeadline: minimumDeadline,
      }),
    }
  }).sort((left, right) => left.entityKey.localeCompare(right.entityKey, 'en'))

  if (entities.length !== majors.size) {
    throw new Error(
      `catalog reconciliation failed: ${entities.length} identities for ${majors.size} official majors`,
    )
  }
  return {
    ...harvest,
    catalogUrl: harvestUrl,
    checkedAt,
    minimumPublishableDeadline: minimumDeadline,
    entities,
    detailCoverage: summarizeTsinghuaDetails(entities),
  }
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function main(): Promise<void> {
  const harvestPath = argument('--input-harvest')
  const sourceBundlePath = argument('--input-source-bundle')
  if (!harvestPath || !sourceBundlePath) {
    throw new Error('--input-harvest and --input-source-bundle are required')
  }
  const output = enrichTsinghuaCatalogHarvest({
    harvest: JSON.parse(readFileSync(resolve(harvestPath), 'utf8')) as unknown,
    sourceBundle: JSON.parse(readFileSync(resolve(sourceBundlePath), 'utf8')) as unknown,
    minimumPublishableDeadline: argument('--minimum-deadline'),
  })
  const serialized = `${JSON.stringify(output, null, 2)}\n`
  const outputPath = argument('--output')
  if (outputPath) {
    const absolutePath = resolve(outputPath)
    mkdirSync(dirname(absolutePath), { recursive: true })
    writeFileSync(absolutePath, serialized, 'utf8')
    process.stdout.write(`${absolutePath}\n`)
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
