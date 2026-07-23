import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { isRobotsPathAllowed } from '../../workers/ingestion/src/robots'

export const DEFAULT_REQUEST_DELAY_MS = 5_000
export const DEFAULT_MAX_ATTEMPTS = 3
export const SCHOLARSHIP_HARVESTER_USER_AGENT =
  'StudyInChinaDataBot/1.0 (+https://studyinchina.example/data-policy)'

const MAX_ATTEMPTS = 5
const MAX_HTML_BYTES = 10 * 1024 * 1024
const MAX_EVIDENCE_QUOTE_LENGTH = 500

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>
type Sleep = (milliseconds: number) => Promise<void>
type Clock = () => number

export type ScholarshipSchemeType =
  | 'government'
  | 'university'
  | 'language'
  | 'donation'
  | 'exchange'
  | 'program_specific'
  | 'other'

export type ScholarshipEntity = {
  entityKey: string
  entityType: 'scholarship'
  institutionId: string
  nameZh: string | null
  nameEn: string | null
  schemeType: ScholarshipSchemeType
  officialUrl: string
  sourceCheckedAt: string
  evidence: {
    locator: string
    quote: string
    officialUrl: string
    checkedAt: string
  }
}

type ScholarshipName = Pick<ScholarshipEntity, 'nameZh' | 'nameEn'> & {
  schemeType?: ScholarshipSchemeType
}

type InlineIdentity = ScholarshipName & {
  evidenceTexts: readonly string[]
}

type AnchorOverride = ScholarshipName & {
  anchorText: string
}

export type ScholarshipIndexSource = {
  id: string
  institutionId: string
  officialUrl: string
  allowedHosts: readonly string[]
  fixtureFile: string
  anchorIdentityAllowlist?: readonly string[]
  additionalIdentitySignals?: readonly string[]
  anchorOverrides?: readonly AnchorOverride[]
  inlineIdentities?: readonly InlineIdentity[]
}

export type ScholarshipSourceStatus =
  | 'ok'
  | 'planned'
  | 'fixture_missing'
  | 'robots_blocked'
  | 'robots_unavailable'
  | 'fetch_failed'
  | 'parse_failed'

export type ScholarshipSourceHarvest = {
  sourceId: string
  institutionId: string
  officialUrl: string
  status: ScholarshipSourceStatus
  candidateCount: number
  reason: string | null
}

export type ScholarshipIndexHarvest = {
  checkedAt: string
  sourceMode: 'live' | 'fixture' | 'dry-run'
  requestDelayMs: number
  institutionsCovered: string[]
  verifiedCandidateCount: number
  sources: ScholarshipSourceHarvest[]
  entities: ScholarshipEntity[]
}

export type ScholarshipIndexHarvesterOptions = {
  checkedAt?: string
  sources?: readonly ScholarshipIndexSource[]
  fixturesBySourceId?: Readonly<Record<string, string>>
  fetchImpl?: FetchLike
  sleep?: Sleep
  now?: Clock
  delayMs?: number
  maxAttempts?: number
  userAgent?: string
  dryRun?: boolean
}

const PKU_HOST = 'isd.pku.edu.cn'
const ZJU_HOSTS = [
  'iczu.zju.edu.cn',
  'zje.zju.edu.cn',
  'zibs.zju.edu.cn',
  'oc.zju.edu.cn',
  'ism.zju.edu.cn',
] as const
const THU_GRAD_HOST = 'yz.tsinghua.edu.cn'
const THU_STUDENT_HOST = 'is.tsinghua.edu.cn'

export const DEFAULT_SCHOLARSHIP_INDEX_SOURCES: readonly ScholarshipIndexSource[] = [
  {
    id: 'pku-scholarship-index',
    institutionId: 'uni-peking-university',
    officialUrl: 'https://isd.pku.edu.cn/en/scholarship.php',
    allowedHosts: [PKU_HOST],
    fixtureFile: 'pku',
    additionalIdentitySignals: ['China Studies Program'],
    anchorOverrides: [
      {
        anchorText: 'Type A',
        nameEn: 'Chinese Government Scholarship (Type A)',
        nameZh: null,
        schemeType: 'government',
      },
      {
        anchorText: 'Type B',
        nameEn: 'Chinese Government Scholarship (Type B)',
        nameZh: null,
        schemeType: 'government',
      },
    ],
    inlineIdentities: [
      {
        evidenceTexts: ['Beijing Government Scholarship'],
        nameEn: 'Beijing Government Scholarship',
        nameZh: null,
        schemeType: 'government',
      },
      {
        evidenceTexts: [
          'PKU Scholarship for International Students',
          'Peking University Scholarship for International Students',
        ],
        nameEn: 'Peking University Scholarship for International Students',
        nameZh: null,
        schemeType: 'university',
      },
    ],
  },
  {
    id: 'pku-cgs-program-index',
    institutionId: 'uni-peking-university',
    officialUrl: 'https://isd.pku.edu.cn/en/list.php?cate=20&cate2=6',
    allowedHosts: [PKU_HOST],
    fixtureFile: 'pku',
    additionalIdentitySignals: [
      'China Link Scholarship Program',
      'Silk Road Program',
      'Advanced Graduate Program',
    ],
    anchorOverrides: [
      {
        anchorText: 'Type A',
        nameEn: 'Chinese Government Scholarship (Type A)',
        nameZh: null,
        schemeType: 'government',
      },
      {
        anchorText: 'Type B',
        nameEn: 'Chinese Government Scholarship (Type B)',
        nameZh: null,
        schemeType: 'government',
      },
    ],
  },
  {
    id: 'pku-china-studies-index',
    institutionId: 'uni-peking-university',
    officialUrl: 'https://isd.pku.edu.cn/en/list.php?cate=21&cate2=7',
    allowedHosts: [PKU_HOST],
    fixtureFile: 'pku',
    additionalIdentitySignals: ['China Studies Program'],
  },
  {
    id: 'pku-language-scholarship-index',
    institutionId: 'uni-peking-university',
    officialUrl: 'https://isd.pku.edu.cn/en/list.php?cate=21&cate2=8',
    allowedHosts: [PKU_HOST],
    fixtureFile: 'pku',
    additionalIdentitySignals: ['China Studies Program'],
  },
  {
    id: 'pku-donation-scholarship-index',
    institutionId: 'uni-peking-university',
    officialUrl: 'https://isd.pku.edu.cn/en/list.php?cate=24',
    allowedHosts: [PKU_HOST],
    fixtureFile: 'pku',
  },
  {
    id: 'zju-scholarship-index',
    institutionId: 'uni-zhejiang-university',
    officialUrl: 'https://iczu.zju.edu.cn/admissions/jxjjz/list.htm',
    allowedHosts: ZJU_HOSTS,
    fixtureFile: 'zju',
    additionalIdentitySignals: [
      '中国-东盟国家海洋国际研究生项目',
      '新汉学计划',
    ],
  },
  {
    id: 'fudan-new-student-scholarship-index',
    institutionId: 'uni-fudan-university',
    officialUrl: 'https://iso.fudan.edu.cn/xsjxj/list.htm',
    allowedHosts: ['iso.fudan.edu.cn'],
    fixtureFile: 'fudan',
    additionalIdentitySignals: ['新汉学计划'],
  },
  {
    id: 'tsinghua-graduate-scholarship-index',
    institutionId: 'uni-tsinghua-university',
    officialUrl:
      'https://yz.tsinghua.edu.cn/en/Financial_Aid/Scholarship_Application.htm',
    allowedHosts: [THU_GRAD_HOST],
    fixtureFile: 'tsinghua',
    inlineIdentities: [
      {
        evidenceTexts: ['Beijing Government Scholarship for International Students'],
        nameEn: 'Beijing Government Scholarship for International Students',
        nameZh: null,
        schemeType: 'government',
      },
      {
        evidenceTexts: ['Tsinghua University Tuition Scholarship'],
        nameEn: 'Tsinghua University Tuition Scholarship',
        nameZh: null,
        schemeType: 'university',
      },
    ],
  },
  {
    id: 'tsinghua-nondegree-scholarship-list',
    institutionId: 'uni-tsinghua-university',
    officialUrl: 'https://is.tsinghua.edu.cn/asdfasdf/adm/ns.htm',
    allowedHosts: [THU_STUDENT_HOST],
    fixtureFile: 'tsinghua',
    inlineIdentities: [
      {
        evidenceTexts: ['Credit Student Scholarship for China-US Humanities Exchange'],
        nameEn: 'Credit Student Scholarship for China-US Humanities Exchange',
        nameZh: null,
        schemeType: 'exchange',
      },
      {
        evidenceTexts: ['Credit Student Scholarship for China-Europe Exchange'],
        nameEn: 'Credit Student Scholarship for China-Europe Exchange',
        nameZh: null,
        schemeType: 'exchange',
      },
      {
        evidenceTexts: ['Scholarship for Campus Asia Program'],
        nameEn: 'Scholarship for Campus Asia Program',
        nameZh: null,
        schemeType: 'exchange',
      },
    ],
  },
  {
    id: 'sjtu-scholarship-index',
    institutionId: 'uni-shanghai-jiao-tong-university',
    officialUrl: 'https://isc.sjtu.edu.cn/cn/content.aspx?flag=82&info_lb=107',
    allowedHosts: ['isc.sjtu.edu.cn'],
    fixtureFile: 'sjtu',
    anchorIdentityAllowlist: [
      '国际中文教师教学金',
      '卓越奖学金',
      '上海市政府奖学金',
      '百贤亚洲未来领袖奖学金',
    ],
    anchorOverrides: [
      {
        anchorText: '国际中文教师教学金',
        nameZh: '国际中文教师奖学金',
        nameEn: null,
        schemeType: 'language',
      },
    ],
    inlineIdentities: [
      {
        evidenceTexts: ['中国政府奖学金'],
        nameZh: '中国政府奖学金',
        nameEn: null,
        schemeType: 'government',
      },
      {
        evidenceTexts: ['上海交通大学奖学金', '上海交大奖学金'],
        nameZh: '上海交通大学奖学金',
        nameEn: null,
        schemeType: 'university',
      },
    ],
  },
  {
    id: 'ustc-fellowship-index',
    institutionId: 'uni-university-of-science-and-technology-of-china',
    officialUrl: 'https://ic.ustc.edu.cn/en/admission.php',
    allowedHosts: ['ic.ustc.edu.cn'],
    fixtureFile: 'ustc',
    anchorIdentityAllowlist: [
      'USTC Fellowship for Undergraduate Programs',
      "USTC Fellowship for Master's Programs",
      'USTC Fellowship for Doctoral Programs',
      'USTC Fellowship for Non-degree Programs',
    ],
    inlineIdentities: [
      {
        evidenceTexts: ['ANSO Scholarship'],
        nameEn: 'ANSO Scholarship',
        nameZh: null,
        schemeType: 'program_specific',
      },
      {
        evidenceTexts: ['Chinese Goverment Scholarship', 'Chinese Government Scholarship'],
        nameEn: 'Chinese Government Scholarship',
        nameZh: null,
        schemeType: 'government',
      },
      {
        evidenceTexts: ['USTC Scholarship'],
        nameEn: 'USTC Scholarship',
        nameZh: null,
        schemeType: 'university',
      },
    ],
  },
] as const

const NAMED_HTML_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  apos: "'",
  gt: '>',
  hellip: '…',
  ldquo: '“',
  lt: '<',
  nbsp: ' ',
  quot: '"',
  rdquo: '”',
}

const GENERIC_IDENTITY_NAMES = new Set([
  'financial aid',
  'financial aid system',
  'fellowship',
  'full scholarships for certain programs',
  'government scholarship',
  'international scholarships',
  'scholarship',
  'scholarship application',
  'scholarship applications',
  'scholarship notices',
  'scholarship programs',
  'scholarships',
  'donation-based scholarships',
  'social donation scholarship',
  'tuition scholarships',
  'university scholarship',
  'ustc fellowship',
  '奖学金',
  '国际本科生奖学金',
  '国际博士研究生奖学金',
  '国际硕士研究生奖学金',
  '在校生奖学金',
  '新生奖学金',
  '本科生奖学金',
  '研究生奖学金',
  '社会捐赠奖学金',
])

const NON_IDENTITY_NOTICE =
  /\b(?:annual review|review results?|selection results?|award results?|extension|open letter|recipients?|awardees?|payment|stipend distribution|accommodation subsidy|policy|regulations?|handbook|frequently asked questions?)\b|(?:年审|年度评审|评审结果|入选结果|获奖结果|获奖名单|候选人名单|名单公示|结果公示|延期|延长资助|生活费发放|奖学金发放|住宿补贴|签到|政策介绍|管理规定|实施办法|网申开放)/iu

const GENERIC_OPEN_NOTICE =
  /scholarship applications? (?:are )?now open for prospective|recruitment announcement|announcement on the/iu

function decodeHtmlEntitiesOnce(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/giu, (entity, token: string) => {
    const normalized = token.toLowerCase()
    const named = NAMED_HTML_ENTITIES[normalized]
    if (named !== undefined) return named
    const radix = normalized.startsWith('#x') ? 16 : 10
    const digits = normalized.startsWith('#x')
      ? normalized.slice(2)
      : normalized.startsWith('#')
        ? normalized.slice(1)
        : ''
    if (!digits) return entity
    const codePoint = Number.parseInt(digits, radix)
    if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
      return entity
    }
    return String.fromCodePoint(codePoint)
  })
}

function decodeHtmlEntities(value: string): string {
  let result = value
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const decoded = decodeHtmlEntitiesOnce(result)
    if (decoded === result) break
    result = decoded
  }
  return result
}

function cleanText(value: string): string {
  return decodeHtmlEntities(
    value
      .replace(/<!--[\s\S]*?-->/gu, ' ')
      .replace(/<br\s*\/?>/giu, ' ')
      .replace(/<[^>]+>/gu, ' '),
  )
    .replace(/\s+/gu, ' ')
    .trim()
}

function attributeValue(attributes: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const match = new RegExp(
    `\\b${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\\x60]+))`,
    'iu',
  ).exec(attributes)
  const value = match?.[1] ?? match?.[2] ?? match?.[3]
  return value === undefined ? null : decodeHtmlEntities(value).trim() || null
}

function normalizedHost(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/u, '')
}

function assertAllowedHost(value: string): string {
  const host = normalizedHost(value)
  if (
    !host ||
    !host.includes('.') ||
    host.includes('*') ||
    host.includes('/') ||
    host.includes('@') ||
    host.includes(':') ||
    host === 'localhost' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(host)
  ) {
    throw new Error(`Invalid official host allowlist entry: ${value}`)
  }
  return host
}

export function assertOfficialHttpsUrl(
  value: string | URL,
  allowedHosts: readonly string[],
): URL {
  const url = value instanceof URL ? new URL(value.href) : new URL(value)
  url.hostname = normalizedHost(url.hostname)
  const normalizedAllowedHosts = allowedHosts.map(assertAllowedHost)
  if (url.protocol !== 'https:') throw new Error('Official URLs must use HTTPS')
  if (url.username || url.password) throw new Error('Official URLs cannot contain credentials')
  if (url.port && url.port !== '443') {
    throw new Error('Official URLs must use the default HTTPS port')
  }
  if (!normalizedAllowedHosts.includes(url.hostname)) {
    throw new Error(`Official URL host is not allowlisted: ${url.hostname}`)
  }
  url.hash = ''
  return url
}

function normalizedOfficialLink(
  href: string,
  sourceUrl: URL,
  allowedHosts: readonly string[],
): string | null {
  if (!href || /^(?:#|javascript:|mailto:|tel:|data:)/iu.test(href.trim())) return null
  try {
    return assertOfficialHttpsUrl(new URL(href, sourceUrl), allowedHosts).href
  } catch {
    return null
  }
}

function normalizedMatchKey(value: string): string {
  return cleanText(value)
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[>»›→↗]+$/gu, '')
    .replace(/[“”"'`]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
}

function stableKeyPart(value: string): string {
  const key = value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
  if (!key) throw new Error(`Cannot build entity key from ${JSON.stringify(value)}`)
  return key
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

function maskExcludedContainers(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/gu, ' ')
    .replace(
      /<(?:script|style|noscript|template|svg|canvas|nav|header|footer|form)\b[^>]*>[\s\S]*?<\/(?:script|style|noscript|template|svg|canvas|nav|header|footer|form)\s*>/giu,
      ' ',
    )
}

function stripEdgeQuotes(value: string): string {
  let output = value.trim()
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const next = output
      .replace(/^[\s"'“”‘’《》「」『』]+/gu, '')
      .replace(/[\s"'“”‘’《》「」『』]+$/gu, '')
      .trim()
    if (next === output) break
    output = next
  }
  return output
}

function normalizeIdentityTitle(rawTitle: string): string | null {
  if (NON_IDENTITY_NOTICE.test(rawTitle) || GENERIC_OPEN_NOTICE.test(rawTitle)) return null
  const cleanedRawTitle = cleanText(rawTitle)
  if (/(?:\.{3}|…)/u.test(cleanedRawTitle)) return null
  const cyclePrefix =
    /^\s*(?:(?:19|20)\d{2}(?:[-–—/](?:19|20)?\d{2})?\s*(?:年(?:度)?)?\s*)+/u
  const hadCyclePrefix = cyclePrefix.test(cleanedRawTitle)
  let title = cleanedRawTitle
    .replace(/\s+(?:19|20)\d{2}[-/.]\d{1,2}[-/.]\d{1,2}\s*$/u, '')
    .replace(cyclePrefix, '')
    .trim()

  const bilingual = /^(.+?)\s+(?:19|20)\d{2}\s*[“"]([^”"]+)[”"](?:申请启动)?$/u.exec(title)
  if (bilingual?.[1] && bilingual[2]) {
    title = bilingual[1].trim()
  }

  if (hadCyclePrefix) {
    title = title
      .replace(
        /^(?:Peking University|PKU|Tsinghua University|THU|Zhejiang University|ZJU|Fudan University|Fudan|Shanghai Jiao Tong University|SJTU|University of Science and Technology of China|USTC)\s+/iu,
        '',
      )
      .replace(/^(?:北京大学|清华大学|浙江大学|复旦大学|上海交通大学|中国科学技术大学)\s*/u, '')
  }

  title = title
    .replace(
      /^(?:Application (?:Information|Guide|Instructions?) (?:for|to)|Admission (?:Guide|Information) (?:for|to))\s+/iu,
      '',
    )
    .replace(
      /\s+(?:Call for Applications?|Application (?:Guide|Notice|Information|Instructions?)|Admission (?:Guide|Notice|Information))\s*$/iu,
      '',
    )
    .replace(/申请通知(?=[—–-])/u, '')
    .replace(/\s*(?:招生简章|申请通知|申请指南|招生通知|申请信息|招生信息|申请办法)\s*$/u, '')
    .replace(/[>»›→↗]+$/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()

  title = stripEdgeQuotes(
    title
      .replace(/^the\s+/iu, '')
      .replace(/^[“"]([^”"]+)[”"](?=\S)/u, '$1'),
  )
  if (!title) return null
  return title
}

function bilingualName(rawTitle: string, normalizedTitle: string): ScholarshipName {
  const withoutLeadingYear = cleanText(rawTitle)
    .replace(/^\s*(?:19|20)\d{2}\s*/u, '')
    .trim()
  const bilingual =
    /^(.+?)\s+(?:19|20)\d{2}\s*[“"]([^”"]+)[”"](?:申请启动)?$/u.exec(withoutLeadingYear)
  if (bilingual?.[1] && bilingual[2]) {
    return {
      nameEn: normalizeIdentityTitle(bilingual[1]),
      nameZh: normalizeIdentityTitle(bilingual[2]),
    }
  }
  if (/[\p{Script=Han}]/u.test(normalizedTitle)) {
    return { nameZh: normalizedTitle, nameEn: null }
  }
  return { nameZh: null, nameEn: normalizedTitle }
}

function isGenericIdentity(name: string): boolean {
  const key = normalizedMatchKey(name)
  if (GENERIC_IDENTITY_NAMES.has(key)) return true
  if (/^scholarships? from\b/iu.test(name)) return true
  if (/^(?:undergraduate|graduate|doctoral|master'?s?|new student|current student)\s+scholarships?$/iu.test(name)) {
    return true
  }
  if (/^(?:国际|学校|学院|院系|政府)?奖学金(?:项目|申请)?$/u.test(name)) return true
  return false
}

function includesSignal(name: string, source: ScholarshipIndexSource): boolean {
  if (/(?:scholarship|fellowship|助学金|奖学金)/iu.test(name)) return true
  const key = normalizedMatchKey(name)
  return (source.additionalIdentitySignals ?? []).some((signal) => {
    const signalKey = normalizedMatchKey(signal)
    return key === signalKey || key.includes(signalKey)
  })
}

function classifyScheme(name: string): ScholarshipSchemeType {
  if (/(?:government|政府|省政府|市政府|\bCSC\b|中国政府)/iu.test(name)) {
    return 'government'
  }
  if (
    /(?:Chinese Language|China Studies|新汉学|国际中文|汉语国际|汉语研修|中文教师)/iu.test(
      name,
    )
  ) {
    return 'language'
  }
  if (
    /(?:exchange|Campus Asia|China-US|China-Europe|亚洲校园|交换|交流)/iu.test(name)
  ) {
    return 'exchange'
  }
  if (/(?:Bai Xian|Asian Future Leaders|百贤|donation|捐赠)/iu.test(name)) {
    return 'donation'
  }
  if (
    /(?:Peking University|PKU|Tsinghua|Zhejiang University|ZJU|Fudan|Shanghai Jiao Tong|SJTU|USTC|北京大学|清华大学|浙江大学|复旦大学|上海交通大学|中科大|中国科学技术大学)/iu.test(
      name,
    )
  ) {
    return 'university'
  }
  if (
    /(?:Atomic Energy|Silk Road|Belt and Road|Marine|MBBS|ANSO|China Link|卓越|原子能|一带一路|海洋)/iu.test(
      name,
    )
  ) {
    return 'program_specific'
  }
  return 'other'
}

type EntityEvidenceInput = {
  source: ScholarshipIndexSource
  checkedAt: string
  name: ScholarshipName
  officialUrl: string
  locator: string
  quote: string
}

function toEntity(input: EntityEvidenceInput): ScholarshipEntity {
  const preferredName = input.name.nameEn ?? input.name.nameZh
  if (!preferredName) throw new Error('Scholarship identity must have an English or Chinese name')
  const schemeType = input.name.schemeType ?? classifyScheme(preferredName)
  return {
    entityKey: [
      input.source.institutionId,
      'scholarship',
      stableKeyPart(preferredName),
    ].join(':'),
    entityType: 'scholarship',
    institutionId: input.source.institutionId,
    nameZh: input.name.nameZh,
    nameEn: input.name.nameEn,
    schemeType,
    officialUrl: input.officialUrl,
    sourceCheckedAt: input.checkedAt,
    evidence: {
      locator: input.locator,
      quote: cleanText(input.quote).slice(0, MAX_EVIDENCE_QUOTE_LENGTH),
      officialUrl: input.source.officialUrl,
      checkedAt: input.checkedAt,
    },
  }
}

function boundedHtml(html: string): string {
  if (new TextEncoder().encode(html).byteLength > MAX_HTML_BYTES) {
    throw new Error(`Scholarship index HTML exceeds ${MAX_HTML_BYTES} bytes`)
  }
  return html
}

export function parseScholarshipIndexHtml(input: {
  html: string
  source: ScholarshipIndexSource
  checkedAt: string
}): ScholarshipEntity[] {
  const checkedAt = validateCheckedAt(input.checkedAt)
  const sourceUrl = assertOfficialHttpsUrl(
    input.source.officialUrl,
    input.source.allowedHosts,
  )
  const document = maskExcludedContainers(boundedHtml(input.html))
  const entities = new Map<string, ScholarshipEntity>()
  const overrides = new Map(
    (input.source.anchorOverrides ?? []).map((override) => [
      normalizedMatchKey(override.anchorText),
      override,
    ]),
  )
  const allowedAnchorNames = input.source.anchorIdentityAllowlist
    ? new Set(input.source.anchorIdentityAllowlist.map(normalizedMatchKey))
    : null

  let anchorNumber = 0
  for (const match of document.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/giu)) {
    anchorNumber += 1
    const attributes = match[1] ?? ''
    const href = attributeValue(attributes, 'href')
    if (!href) continue
    const officialUrl = normalizedOfficialLink(
      href,
      sourceUrl,
      input.source.allowedHosts,
    )
    if (!officialUrl) continue

    const anchorText = cleanText(match[2] ?? '')
    const titleText = attributeValue(attributes, 'title')
    const evidenceText =
      titleText && titleText.length > anchorText.length ? titleText : anchorText
    if (!evidenceText) continue
    if (
      allowedAnchorNames &&
      !allowedAnchorNames.has(normalizedMatchKey(anchorText)) &&
      !allowedAnchorNames.has(normalizedMatchKey(evidenceText))
    ) {
      continue
    }

    const override = overrides.get(normalizedMatchKey(anchorText))
      ?? overrides.get(normalizedMatchKey(evidenceText))
    let name: ScholarshipName
    if (override) {
      name = {
        nameZh: override.nameZh,
        nameEn: override.nameEn,
        schemeType: override.schemeType,
      }
    } else {
      const normalizedTitle = normalizeIdentityTitle(evidenceText)
      if (!normalizedTitle) continue
      if (isGenericIdentity(normalizedTitle)) continue
      if (!includesSignal(normalizedTitle, input.source)) continue
      name = bilingualName(evidenceText, normalizedTitle)
    }
    const preferredName = name.nameEn ?? name.nameZh
    if (!preferredName || isGenericIdentity(preferredName)) continue

    const entity = toEntity({
      source: input.source,
      checkedAt,
      name,
      officialUrl,
      locator:
        titleText && titleText.length > anchorText.length
          ? `html:a[${anchorNumber}]@title`
          : `html:a[${anchorNumber}]`,
      quote: evidenceText,
    })
    if (!entities.has(entity.entityKey)) entities.set(entity.entityKey, entity)
  }

  const visibleText = cleanText(document)
  for (const [mentionIndex, mention] of (input.source.inlineIdentities ?? []).entries()) {
    const match = mention.evidenceTexts
      .map((evidenceText) => {
        const index = visibleText
          .toLocaleLowerCase('en-US')
          .indexOf(evidenceText.toLocaleLowerCase('en-US'))
        return { evidenceText, index }
      })
      .filter(({ index }) => index >= 0)
      .sort((left, right) => left.index - right.index)[0]
    if (!match) continue
    const entity = toEntity({
      source: input.source,
      checkedAt,
      name: mention,
      officialUrl: sourceUrl.href,
      locator: `html:text-identity[${mentionIndex + 1}]`,
      quote: visibleText.slice(match.index, match.index + match.evidenceText.length),
    })
    if (!entities.has(entity.entityKey)) entities.set(entity.entityKey, entity)
  }

  return [...entities.values()].sort((left, right) =>
    left.entityKey.localeCompare(right.entityKey),
  )
}

class DomainThrottle {
  private readonly lastRequestAt = new Map<string, number>()

  constructor(
    private readonly delayMs: number,
    private readonly sleep: Sleep,
    private readonly now: Clock,
  ) {}

  async beforeRequest(hostname: string): Promise<void> {
    const last = this.lastRequestAt.get(hostname)
    if (last !== undefined) {
      const remaining = this.delayMs - (this.now() - last)
      if (remaining > 0) await this.sleep(remaining)
    }
    this.lastRequestAt.set(hostname, this.now())
  }
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500
}

type SafeResponse = {
  response: Response
  finalUrl: URL
}

async function fetchWithRetry(input: {
  fetchImpl: FetchLike
  url: URL
  allowedHosts: readonly string[]
  throttle: DomainThrottle
  maxAttempts: number
  userAgent: string
}): Promise<SafeResponse> {
  let lastError: unknown
  for (let attempt = 1; attempt <= input.maxAttempts; attempt += 1) {
    try {
      let currentUrl = assertOfficialHttpsUrl(input.url, input.allowedHosts)
      for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
        await input.throttle.beforeRequest(currentUrl.hostname)
        const response = await input.fetchImpl(currentUrl, {
          method: 'GET',
          redirect: 'manual',
          headers: {
            accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1',
            'user-agent': input.userAgent,
          },
        })
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          if (redirectCount === 5) throw new Error('Official source redirect limit exceeded')
          const location = response.headers.get('location')
          if (!location) throw new Error('Official source redirect omitted Location')
          currentUrl = assertOfficialHttpsUrl(
            new URL(location, currentUrl),
            input.allowedHosts,
          )
          continue
        }
        if (retryableStatus(response.status)) {
          lastError = new Error(`Official source returned HTTP ${response.status}`)
          break
        }
        return { response, finalUrl: currentUrl }
      }
    } catch (error) {
      lastError = error
    }
    if (attempt === input.maxAttempts) break
  }
  throw lastError instanceof Error ? lastError : new Error('Official source request failed')
}

type RobotsDecision =
  | { status: 'allowed' }
  | { status: 'blocked'; reason: string }
  | { status: 'unavailable'; reason: string }

async function robotsDecision(input: {
  sourceUrl: URL
  allowedHosts: readonly string[]
  fetchImpl: FetchLike
  throttle: DomainThrottle
  maxAttempts: number
  userAgent: string
}): Promise<RobotsDecision> {
  const robotsUrl = new URL('/robots.txt', input.sourceUrl)
  let result: SafeResponse
  try {
    result = await fetchWithRetry({
      ...input,
      url: robotsUrl,
    })
  } catch (error) {
    return {
      status: 'unavailable',
      reason: error instanceof Error ? error.message : String(error),
    }
  }
  if (result.response.status === 404 || result.response.status === 410) {
    return { status: 'allowed' }
  }
  if (!result.response.ok) {
    const status = result.response.status
    return {
      status: status === 401 || status === 403 ? 'blocked' : 'unavailable',
      reason: `robots.txt returned HTTP ${status}`,
    }
  }
  const text = await result.response.text()
  return isRobotsPathAllowed(text, input.sourceUrl, input.userAgent)
    ? { status: 'allowed' }
    : { status: 'blocked', reason: 'robots.txt disallows this source path' }
}

function sourceStatus(
  source: ScholarshipIndexSource,
  status: ScholarshipSourceStatus,
  candidateCount = 0,
  reason: string | null = null,
): ScholarshipSourceHarvest {
  return {
    sourceId: source.id,
    institutionId: source.institutionId,
    officialUrl: source.officialUrl,
    status,
    candidateCount,
    reason,
  }
}

export async function harvestScholarshipIndexes(
  options: ScholarshipIndexHarvesterOptions = {},
): Promise<ScholarshipIndexHarvest> {
  const sources = options.sources ?? DEFAULT_SCHOLARSHIP_INDEX_SOURCES
  const checkedAt = validateCheckedAt(options.checkedAt ?? new Date().toISOString())
  const delayMs = validateDelay(options.delayMs ?? DEFAULT_REQUEST_DELAY_MS)
  const maxAttempts = validateMaxAttempts(options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS)
  const userAgent = options.userAgent ?? SCHOLARSHIP_HARVESTER_USER_AGENT
  const sleep = options.sleep ?? ((milliseconds) => new Promise<void>((resolveSleep) => {
    setTimeout(resolveSleep, milliseconds)
  }))
  const now = options.now ?? Date.now
  const fetchImpl = options.fetchImpl ?? fetch
  const throttle = new DomainThrottle(delayMs, sleep, now)
  const fixtureMode = options.fixturesBySourceId !== undefined
  const statuses: ScholarshipSourceHarvest[] = []
  const entities = new Map<string, ScholarshipEntity>()

  if (options.dryRun) {
    for (const source of sources) {
      assertOfficialHttpsUrl(source.officialUrl, source.allowedHosts)
      statuses.push(sourceStatus(source, 'planned'))
    }
    return {
      checkedAt,
      sourceMode: 'dry-run',
      requestDelayMs: delayMs,
      institutionsCovered: [],
      verifiedCandidateCount: 0,
      sources: statuses,
      entities: [],
    }
  }

  for (const source of sources) {
    let html: string
    if (fixtureMode) {
      const fixture = options.fixturesBySourceId?.[source.id]
      if (fixture === undefined) {
        statuses.push(sourceStatus(source, 'fixture_missing', 0, 'No fixture registered'))
        continue
      }
      html = fixture
    } else {
      let sourceUrl: URL
      try {
        sourceUrl = assertOfficialHttpsUrl(source.officialUrl, source.allowedHosts)
      } catch (error) {
        statuses.push(sourceStatus(
          source,
          'fetch_failed',
          0,
          error instanceof Error ? error.message : String(error),
        ))
        continue
      }
      const robots = await robotsDecision({
        sourceUrl,
        allowedHosts: source.allowedHosts,
        fetchImpl,
        throttle,
        maxAttempts,
        userAgent,
      })
      if (robots.status !== 'allowed') {
        statuses.push(sourceStatus(
          source,
          robots.status === 'blocked' ? 'robots_blocked' : 'robots_unavailable',
          0,
          robots.reason,
        ))
        continue
      }
      try {
        const result = await fetchWithRetry({
          fetchImpl,
          url: sourceUrl,
          allowedHosts: source.allowedHosts,
          throttle,
          maxAttempts,
          userAgent,
        })
        if (!result.response.ok) {
          statuses.push(sourceStatus(
            source,
            'fetch_failed',
            0,
            `Official source returned HTTP ${result.response.status}`,
          ))
          continue
        }
        const contentType = result.response.headers.get('content-type')?.toLowerCase() ?? ''
        if (
          contentType &&
          !contentType.includes('text/html') &&
          !contentType.includes('application/xhtml+xml') &&
          !contentType.includes('text/plain')
        ) {
          statuses.push(sourceStatus(
            source,
            'fetch_failed',
            0,
            `Unsupported source content type: ${contentType}`,
          ))
          continue
        }
        html = await result.response.text()
      } catch (error) {
        statuses.push(sourceStatus(
          source,
          'fetch_failed',
          0,
          error instanceof Error ? error.message : String(error),
        ))
        continue
      }
    }

    try {
      const candidates = parseScholarshipIndexHtml({ html, source, checkedAt })
      statuses.push(sourceStatus(source, 'ok', candidates.length))
      for (const candidate of candidates) {
        const existing = entities.get(candidate.entityKey)
        if (!existing || existing.officialUrl === existing.evidence.officialUrl) {
          entities.set(candidate.entityKey, candidate)
        }
      }
    } catch (error) {
      statuses.push(sourceStatus(
        source,
        'parse_failed',
        0,
        error instanceof Error ? error.message : String(error),
      ))
    }
  }

  const sortedEntities = [...entities.values()].sort((left, right) =>
    left.entityKey.localeCompare(right.entityKey),
  )
  const institutionsCovered = [...new Set(
    sortedEntities.map((entity) => entity.institutionId),
  )].sort()
  return {
    checkedAt,
    sourceMode: fixtureMode ? 'fixture' : 'live',
    requestDelayMs: delayMs,
    institutionsCovered,
    verifiedCandidateCount: sortedEntities.length,
    sources: statuses,
    entities: sortedEntities,
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

function selectedSources(): readonly ScholarshipIndexSource[] {
  const value = argument('--sources')
  if (!value) return DEFAULT_SCHOLARSHIP_INDEX_SOURCES
  const requested = new Set(value.split(',').map((item) => item.trim()).filter(Boolean))
  const sources = DEFAULT_SCHOLARSHIP_INDEX_SOURCES.filter((source) =>
    requested.has(source.id),
  )
  const missing = [...requested].filter((id) => !sources.some((source) => source.id === id))
  if (missing.length > 0) throw new Error(`Unknown source IDs: ${missing.join(', ')}`)
  return sources
}

function fixturesFromDirectory(
  directory: string,
  sources: readonly ScholarshipIndexSource[],
): Readonly<Record<string, string>> {
  const fixtures: Record<string, string> = {}
  for (const source of sources) {
    const path = join(directory, `${source.fixtureFile}.html`)
    if (!existsSync(path)) continue
    fixtures[source.id] = readFileSync(path, 'utf8')
  }
  return fixtures
}

async function main(): Promise<void> {
  const sources = selectedSources()
  const inputDirectory = argument('--input-dir')
  const outputPath = argument('--output')
  const harvest = await harvestScholarshipIndexes({
    sources,
    checkedAt: argument('--checked-at'),
    delayMs: integerArgument('--delay-ms', DEFAULT_REQUEST_DELAY_MS),
    maxAttempts: integerArgument('--max-attempts', DEFAULT_MAX_ATTEMPTS),
    dryRun: process.argv.includes('--dry-run'),
    fixturesBySourceId: inputDirectory
      ? fixturesFromDirectory(resolve(inputDirectory), sources)
      : undefined,
  })
  const output = `${JSON.stringify(harvest, null, 2)}\n`
  if (outputPath) {
    const absoluteOutput = resolve(outputPath)
    mkdirSync(dirname(absoluteOutput), { recursive: true })
    writeFileSync(absoluteOutput, output, 'utf8')
  } else {
    process.stdout.write(output)
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
