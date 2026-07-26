import {
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const PKU_GRADUATE_GUIDE_PARSER_VERSION = 'pku-graduate-guide-v1'

export type PkuGuideEvidence = {
  page: number
  lineStart: number
  lineEnd: number
  locator: string
  quote: string
  officialUrl: string
  checkedAt: string
}

export type PkuArchivedApplicationWindow = {
  opensOn: string
  closesOn: string
  timezone: 'Asia/Shanghai'
  publicationStatus: 'publishable' | 'archived'
  exclusions: string[]
  evidence: PkuGuideEvidence
}

export type PkuGuideRequirement = {
  requirementType:
    | 'nationality'
    | 'health'
    | 'criminal_record'
    | 'education'
    | 'language_test'
  appliesTo: string[]
  rule: Record<string, unknown>
  evidence: PkuGuideEvidence
}

export type PkuGuideRequiredDocument = {
  documentType:
    | 'diploma'
    | 'transcript'
    | 'study_plan'
    | 'resume'
    | 'commitment_letter'
    | 'recommendation'
    | 'language_certificate'
    | 'passport'
    | 'research_achievements'
    | 'supplemental'
  required: boolean
  appliesTo: string[]
  copies: number | null
  evidence: PkuGuideEvidence
}

export type PkuGraduateGuideHarvest = {
  parserVersion: typeof PKU_GRADUATE_GUIDE_PARSER_VERSION
  sourceType: 'official_pdf'
  institutionId: 'uni-peking-university'
  sourceLanguage: 'zh'
  officialUrl: string
  checkedAt: string
  intakeYear: number
  scope: {
    degreeLevels: ['master', 'doctorate']
    campuses: string[]
  }
  durationRules: Array<{
    degreeLevel: 'master' | 'doctorate'
    durationMin: number
    durationMax: number
    durationUnit: 'academic_years'
    hasProgramExceptions: true
    evidence: PkuGuideEvidence
  }>
  applicationRoute: {
    routeType: 'university_portal'
    accessMode: 'public_individual'
    applicationUrl: string
    sourceUrlScheme: 'http'
    evidence: PkuGuideEvidence
  }
  applicationWindows: {
    publishable: PkuArchivedApplicationWindow[]
    historical: PkuArchivedApplicationWindow[]
  }
  applicationFee: {
    status: 'known'
    value: {
      amountMinor: number
      currencyCode: 'CNY'
      currencyExponent: 2
      billingPeriod: 'per_application_choice'
      refundable: false
    }
    evidence: PkuGuideEvidence
  }
  requirements: PkuGuideRequirement[]
  requiredDocuments: PkuGuideRequiredDocument[]
  tuitionSource: {
    status: 'source_registered'
    officialUrl: string
    note: 'Program-specific values require separate fee-table reconciliation'
  } | null
  reconciliation: {
    requiredFacts: number
    extractedFacts: number
    publishableWindows: number
    archivedWindows: number
    missingFacts: string[]
  }
}

export type ParsePkuGraduateGuideOptions = {
  officialUrl: string
  checkedAt: string
  minimumOpenDeadline?: string
  tuitionSourceUrl?: string
}

type PositionedLine = {
  page: number
  line: number
  text: string
}

type EvidenceMatch = {
  match: RegExpMatchArray
  evidence: PkuGuideEvidence
}

const DEFAULT_MINIMUM_OPEN_DEADLINE = '2026-08-26'
const REQUIRED_FACT_COUNT = 14

function normalizeText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\u00a0/gu, ' ')
    .replace(/\s+/gu, ' ')
    .replace(/([\p{Script=Han}])\s+(?=[\p{Script=Han}])/gu, '$1')
    .trim()
}

function isoTimestamp(value: string, label: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error(`${label} must be an ISO timestamp`)
  return date.toISOString()
}

function isoDate(value: string, label: string): string {
  if (
    !/^\d{4}-\d{2}-\d{2}$/u.test(value)
    || Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  ) {
    throw new Error(`${label} must be an ISO date`)
  }
  return value
}

function officialGuideUrl(value: string): string {
  const url = new URL(value)
  if (
    url.protocol !== 'https:'
    || url.hostname.toLowerCase() !== 'admission.pku.edu.cn'
    || !/^\/docs\/\d+\.pdf$/u.test(url.pathname)
    || url.username
    || url.password
    || url.port
  ) {
    throw new Error('officialUrl must be an official PKU admission PDF')
  }
  url.hash = ''
  return url.href
}

function officialTuitionUrl(value: string): string {
  const url = new URL(value)
  if (
    url.protocol !== 'https:'
    || !['isd.pku.edu.cn', 'www.isd.pku.edu.cn'].includes(url.hostname.toLowerCase())
    || !/\.pdf$/iu.test(url.pathname)
    || url.username
    || url.password
    || url.port
  ) {
    throw new Error('tuitionSourceUrl must be an official PKU ISD HTTPS PDF')
  }
  url.hash = ''
  return url.href
}

function positionedLines(layoutText: string): PositionedLine[] {
  return layoutText
    .replace(/^\uFEFF/u, '')
    .replace(/\r\n?/gu, '\n')
    .split('\f')
    .flatMap((page, pageIndex) => (
      page.split('\n').map((line, lineIndex) => ({
        page: pageIndex + 1,
        line: lineIndex + 1,
        text: normalizeText(line),
      }))
    ))
    .filter((line) => line.text !== '')
}

function findEvidence(
  lines: readonly PositionedLine[],
  pattern: RegExp,
  officialUrl: string,
  checkedAt: string,
  maxLines = 5,
): EvidenceMatch | null {
  for (let start = 0; start < lines.length; start += 1) {
    const first = lines[start]!
    for (
      let end = start;
      end < Math.min(lines.length, start + maxLines)
      && lines[end]!.page === first.page;
      end += 1
    ) {
      const quote = normalizeText(
        lines.slice(start, end + 1).map((line) => line.text).join(' '),
      )
      const match = quote.match(pattern)
      if (!match) continue
      const lineEnd = lines[end]!.line
      return {
        match,
        evidence: {
          page: first.page,
          lineStart: first.line,
          lineEnd,
          locator: `pdf:page=${first.page};lines=${first.line}-${lineEnd}`,
          quote,
          officialUrl,
          checkedAt,
        },
      }
    }
  }
  return null
}

function requireEvidence(
  lines: readonly PositionedLine[],
  pattern: RegExp,
  label: string,
  officialUrl: string,
  checkedAt: string,
  maxLines = 5,
): EvidenceMatch {
  const result = findEvidence(lines, pattern, officialUrl, checkedAt, maxLines)
  if (!result) throw new Error(`PKU guide is missing ${label}`)
  return result
}

function document(
  documentType: PkuGuideRequiredDocument['documentType'],
  evidence: PkuGuideEvidence,
  options: Partial<Pick<
    PkuGuideRequiredDocument,
    'required' | 'appliesTo' | 'copies'
  >> = {},
): PkuGuideRequiredDocument {
  return {
    documentType,
    required: options.required ?? true,
    appliesTo: options.appliesTo ?? ['master', 'doctorate'],
    copies: options.copies ?? null,
    evidence,
  }
}

export function parsePkuGraduateGuideText(
  layoutText: string,
  rawOptions: ParsePkuGraduateGuideOptions,
): PkuGraduateGuideHarvest {
  const officialUrl = officialGuideUrl(rawOptions.officialUrl)
  const checkedAt = isoTimestamp(rawOptions.checkedAt, 'checkedAt')
  const minimumOpenDeadline = isoDate(
    rawOptions.minimumOpenDeadline ?? DEFAULT_MINIMUM_OPEN_DEADLINE,
    'minimumOpenDeadline',
  )
  const lines = positionedLines(layoutText)
  const title = requireEvidence(
    lines,
    /北京大学\s*(\d{4})\s*年外国留学生研究生招生简章/u,
    'document title and intake year',
    officialUrl,
    checkedAt,
    2,
  )
  const duration = requireEvidence(
    lines,
    /硕士研究生的学制为\s*2\s*年或\s*3\s*年.*博士研究生的学制为\s*4\s*年或\s*5\s*年/u,
    'degree duration rules',
    officialUrl,
    checkedAt,
    5,
  )
  const dates = requireEvidence(
    lines,
    /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日至\s*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/u,
    'application window',
    officialUrl,
    checkedAt,
    3,
  )
  const opensOn = [
    dates.match[1],
    dates.match[2]!.padStart(2, '0'),
    dates.match[3]!.padStart(2, '0'),
  ].join('-')
  const closesOn = [
    dates.match[4],
    dates.match[5]!.padStart(2, '0'),
    dates.match[6]!.padStart(2, '0'),
  ].join('-')
  isoDate(opensOn, 'application opensOn')
  isoDate(closesOn, 'application closesOn')
  const portal = requireEvidence(
    lines,
    /http:\/\/www\.studyatpku\.com/u,
    'application portal',
    officialUrl,
    checkedAt,
    4,
  )
  const fee = requireEvidence(
    lines,
    /每个志愿的申请费为\s*800\s*元人民币/u,
    'application fee',
    officialUrl,
    checkedAt,
    3,
  )
  const nationality = requireEvidence(
    lines,
    /非中国籍公民.*有效外国护照/u,
    'nationality requirement',
    officialUrl,
    checkedAt,
    5,
  )
  const health = requireEvidence(
    lines,
    /身心健康.*无违法犯罪记录/u,
    'health and criminal-record requirement',
    officialUrl,
    checkedAt,
    3,
  )
  const masterEducation = requireEvidence(
    lines,
    /申请攻读硕士学位研究生应具有.*学士或以上学位/u,
    'master education requirement',
    officialUrl,
    checkedAt,
    5,
  )
  const doctorateEducation = requireEvidence(
    lines,
    /申请攻读博士学位研究生应具有.*硕士或以上学位/u,
    'doctorate education requirement',
    officialUrl,
    checkedAt,
    4,
  )
  const chineseLanguage = requireEvidence(
    lines,
    /理工类专业\s*6\s*级\s*200\s*分以上.*人文社科类专业\s*6\s*级\s*210\s*分以上/u,
    'Chinese language thresholds',
    officialUrl,
    checkedAt,
    5,
  )
  const englishLanguage = requireEvidence(
    lines,
    /TOEFL.*100\s*分以上.*GRE.*315\s*分以上/u,
    'English language thresholds',
    officialUrl,
    checkedAt,
    5,
  )
  const evidencePatterns = {
    diploma: /1\.\s*学位证书原件及学位认证报告/u,
    transcript: /2\.\s*毕业院校的正式成绩单/u,
    studyPlan: /3\.\s*个人陈述原件/u,
    resume: /4\.\s*个人简历及申请承诺书/u,
    recommendation: /5\.\s*两封.*推荐信/u,
    languageCertificate: /6\.\s*语言.*考试成绩单原件/u,
    passport: /7\.\s*护照首页/u,
    achievements: /8\.\s*个人研究成果/u,
    supplemental: /9\.\s*院系要求提交的其它补充文件/u,
  } as const
  const documentEvidence = Object.fromEntries(
    Object.entries(evidencePatterns).map(([key, pattern]) => [
      key,
      requireEvidence(
        lines,
        pattern,
        `${key} document`,
        officialUrl,
        checkedAt,
        4,
      ).evidence,
    ]),
  ) as Record<keyof typeof evidencePatterns, PkuGuideEvidence>

  const window: PkuArchivedApplicationWindow = {
    opensOn,
    closesOn,
    timezone: 'Asia/Shanghai',
    publicationStatus: closesOn < minimumOpenDeadline ? 'archived' : 'publishable',
    exclusions: ['english_taught_master_programs_with_separate_guides'],
    evidence: dates.evidence,
  }
  const publishable = window.publicationStatus === 'publishable' ? [window] : []
  const historical = window.publicationStatus === 'archived' ? [window] : []
  const requirements: PkuGuideRequirement[] = [
    {
      requirementType: 'nationality',
      appliesTo: ['master', 'doctorate'],
      rule: { citizenship: 'non_chinese', passport: 'valid' },
      evidence: nationality.evidence,
    },
    {
      requirementType: 'health',
      appliesTo: ['master', 'doctorate'],
      rule: { physicalAndMentalHealth: true },
      evidence: health.evidence,
    },
    {
      requirementType: 'criminal_record',
      appliesTo: ['master', 'doctorate'],
      rule: { noCriminalRecord: true },
      evidence: health.evidence,
    },
    {
      requirementType: 'education',
      appliesTo: ['master'],
      rule: { minimumDegree: 'bachelor' },
      evidence: masterEducation.evidence,
    },
    {
      requirementType: 'education',
      appliesTo: ['doctorate'],
      rule: { minimumDegree: 'master', directEntryException: 'science_and_engineering' },
      evidence: doctorateEducation.evidence,
    },
    {
      requirementType: 'language_test',
      appliesTo: ['chinese_taught_science'],
      rule: { test: 'HSK', level: 6, minimumScore: 200, writingMinimum: 65 },
      evidence: chineseLanguage.evidence,
    },
    {
      requirementType: 'language_test',
      appliesTo: ['chinese_taught_humanities_and_social_sciences'],
      rule: { test: 'HSK', level: 6, minimumScore: 210, writingMinimum: 65 },
      evidence: chineseLanguage.evidence,
    },
    {
      requirementType: 'language_test',
      appliesTo: ['english_taught_non_native_english'],
      rule: {
        alternatives: [
          { test: 'TOEFL_iBT', minimumScore: 100 },
          { test: 'GRE', minimumScore: 315 },
          { test: 'other_official_proof', programSpecificReview: true },
        ],
      },
      evidence: englishLanguage.evidence,
    },
  ]
  const requiredDocuments = [
    document('diploma', documentEvidence.diploma),
    document('transcript', documentEvidence.transcript),
    document('study_plan', documentEvidence.studyPlan),
    document('resume', documentEvidence.resume),
    document('commitment_letter', documentEvidence.resume),
    document('recommendation', documentEvidence.recommendation, { copies: 2 }),
    document('language_certificate', documentEvidence.languageCertificate),
    document('passport', documentEvidence.passport),
    document('research_achievements', documentEvidence.achievements, { required: false }),
    document('supplemental', documentEvidence.supplemental, { required: false }),
  ]
  const extractedFacts = [
    title,
    duration,
    dates,
    portal,
    fee,
    nationality,
    health,
    masterEducation,
    doctorateEducation,
    chineseLanguage,
    englishLanguage,
    documentEvidence.diploma,
    documentEvidence.transcript,
    documentEvidence.studyPlan,
  ].length

  return {
    parserVersion: PKU_GRADUATE_GUIDE_PARSER_VERSION,
    sourceType: 'official_pdf',
    institutionId: 'uni-peking-university',
    sourceLanguage: 'zh',
    officialUrl,
    checkedAt,
    intakeYear: Number(title.match[1]),
    scope: {
      degreeLevels: ['master', 'doctorate'],
      campuses: [
        'Yanyuan',
        'Changping',
        'Daxing School of Software and Microelectronics',
        'Shenzhen Graduate School',
      ],
    },
    durationRules: [
      {
        degreeLevel: 'master',
        durationMin: 2,
        durationMax: 3,
        durationUnit: 'academic_years',
        hasProgramExceptions: true,
        evidence: duration.evidence,
      },
      {
        degreeLevel: 'doctorate',
        durationMin: 4,
        durationMax: 5,
        durationUnit: 'academic_years',
        hasProgramExceptions: true,
        evidence: duration.evidence,
      },
    ],
    applicationRoute: {
      routeType: 'university_portal',
      accessMode: 'public_individual',
      applicationUrl: 'https://www.studyatpku.com/',
      sourceUrlScheme: 'http',
      evidence: portal.evidence,
    },
    applicationWindows: { publishable, historical },
    applicationFee: {
      status: 'known',
      value: {
        amountMinor: 80_000,
        currencyCode: 'CNY',
        currencyExponent: 2,
        billingPeriod: 'per_application_choice',
        refundable: false,
      },
      evidence: fee.evidence,
    },
    requirements,
    requiredDocuments,
    tuitionSource: rawOptions.tuitionSourceUrl
      ? {
          status: 'source_registered',
          officialUrl: officialTuitionUrl(rawOptions.tuitionSourceUrl),
          note: 'Program-specific values require separate fee-table reconciliation',
        }
      : null,
    reconciliation: {
      requiredFacts: REQUIRED_FACT_COUNT,
      extractedFacts,
      publishableWindows: publishable.length,
      archivedWindows: historical.length,
      missingFacts: [],
    },
  }
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function requiredArgument(name: string): string {
  const value = argument(name)
  if (!value) throw new Error(`Missing required argument ${name}`)
  return value
}

async function main(): Promise<void> {
  const outputPath = resolve(requiredArgument('--output'))
  const result = parsePkuGraduateGuideText(
    readFileSync(resolve(requiredArgument('--layout-text')), 'utf8'),
    {
      officialUrl: requiredArgument('--official-url'),
      checkedAt: requiredArgument('--checked-at'),
      minimumOpenDeadline: argument('--minimum-open-deadline'),
      tuitionSourceUrl: argument('--tuition-source-url'),
    },
  )
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify({
    output: outputPath,
    intakeYear: result.intakeYear,
    requirements: result.requirements.length,
    requiredDocuments: result.requiredDocuments.length,
    publishableWindows: result.reconciliation.publishableWindows,
    archivedWindows: result.reconciliation.archivedWindows,
  })}\n`)
}

const entryPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (entryPath === import.meta.url) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error)
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  })
}
