import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'

import { bundleSchema } from '../../src/lib/data/schema'
import type {
  DataBundle,
  Program,
} from '../../src/lib/data/types'
import { htmlToText, normalizeEvidenceText } from '../../workers/ingestion/src/rules'

const execFileAsync = promisify(execFile)
const USER_AGENT = 'StudyInChinaCatalog/1.0 (+https://studyinchina.vercel.app/data-policy)'
const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
}
const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
}

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

type ReviewDocument = {
  records: ReviewRecord[]
}

export type EvidenceFact = {
  field: 'durationMonths' | 'durationMonthsMax' | 'tuitionCny' | 'tuitionPeriod'
    | 'applicationFeeCny' | 'opensOn' | 'closesOn'
  value: number | string
  evidence: string
}

type EnrichmentRecord = {
  institutionId: string
  programNameEn: string
  officialUrl: string
  programId: string | null
  status: 'candidate' | 'identity-confirmed' | 'no-grounded-facts' | 'fetch-failed' | 'program-not-found'
  facts: EvidenceFact[]
  issues: string[]
}

type Options = {
  reviewPath: string
  dataDirectory: string
  outputDirectory: string
  auditPath: string
  checkedAt: string
  maximumUrls: number
  minimumDomainIntervalMs: number
}

function parseArguments(arguments_: string[]): Options {
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
      ?? 'quality/international-program-review/expanded-250-2026-07-27.json',
    ),
    dataDirectory: resolve(values.get('data-dir') ?? 'content/data'),
    outputDirectory: resolve(values.get('output-dir') ?? '.pipeline-build/enriched-data'),
    auditPath: resolve(
      values.get('audit')
      ?? 'quality/international-program-review/fact-enrichment-2026-07-27.json',
    ),
    checkedAt: values.get('checked-at') ?? new Date().toISOString().slice(0, 10),
    maximumUrls: Number(values.get('max-urls') ?? '1000'),
    minimumDomainIntervalMs: Number(values.get('minimum-domain-interval-ms') ?? '5000'),
  }
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12)
}

function normalizedName(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en')
    .replace(/[^a-z0-9\u3400-\u9fff]+/gu, ' ')
    .trim()
}

function numberValue(value: string): number | null {
  const normalized = value.toLocaleLowerCase('en')
  if (NUMBER_WORDS[normalized]) return NUMBER_WORDS[normalized]
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function evidenceSlice(value: string): string {
  return normalizeEvidenceText(value).slice(0, 700)
}

function uniqueFact(
  facts: EvidenceFact[],
  field: EvidenceFact['field'],
): EvidenceFact | null {
  const candidates = facts.filter((fact) => fact.field === field)
  const values = new Set(candidates.map((fact) => JSON.stringify(fact.value)))
  return values.size === 1 ? candidates[0] ?? null : null
}

function relevantWindows(
  sourceText: string,
  record: ReviewRecord,
  recordsForUrl: number,
): string[] {
  const text = normalizeEvidenceText(sourceText)
  const names = [...new Set([
    record.programNameEn,
    record.programNameOriginal,
  ].map(normalizedName).filter((name) => name.length >= 6))]
  const lower = normalizedName(text)
  const windows: string[] = []
  for (const name of names) {
    let index = lower.indexOf(name)
    while (index >= 0) {
      windows.push(text.slice(Math.max(0, index - 1_500), index + name.length + 2_500))
      index = lower.indexOf(name, index + name.length)
      if (windows.length >= 6) break
    }
  }
  if (windows.length === 0 && recordsForUrl === 1) return [text]
  return [...new Set(windows)]
}

function parseEnglishDate(month: string, day: string, year: string): string | null {
  const monthNumber = MONTHS[month.toLocaleLowerCase('en')]
  const numericDay = Number(day)
  const numericYear = Number(year)
  if (!monthNumber || numericDay < 1 || numericDay > 31 || numericYear < 2025) return null
  const value = `${numericYear}-${String(monthNumber).padStart(2, '0')}-${String(numericDay).padStart(2, '0')}`
  return isCalendarDate(value) ? value : null
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value
}

export function extractGroundedFacts(
  sourceText: string,
  record: ReviewRecord,
  recordsForUrl = 1,
): EvidenceFact[] {
  const candidates: EvidenceFact[] = []
  for (const window of relevantWindows(sourceText, record, recordsForUrl)) {
    const durationPattern = /(?:duration(?:\s+of\s+study)?|program(?:me)?\s+duration|length\s+of\s+study|study\s+period|schooling\s+length|学制|学习年限|学习期限)\s*(?:is|为)?\s*[:：-]?\s*(one|two|three|four|five|six|\d+(?:\.\d+)?)\s*(years?|months?|semesters?|年|个月|学期)/giu
    for (const match of window.matchAll(durationPattern)) {
      const count = numberValue(match[1] ?? '')
      if (!count) continue
      const unit = (match[2] ?? '').toLocaleLowerCase('en')
      const months = unit.startsWith('year') || unit === '年'
        ? Math.round(count * 12)
        : unit.startsWith('semester') || unit === '学期'
          ? Math.round(count * 6)
          : Math.round(count)
      if (months < 1 || months > 120) continue
      candidates.push({
        field: 'durationMonths',
        value: months,
        evidence: evidenceSlice(match[0]),
      })
    }

    const tuitionPattern = /(?:tuition(?:\s+fee|\s+standard)?|学费)\s*(?:is|为)?\s*[:：-]?\s*(?:CNY|RMB|¥|￥)?\s*([\d,]{4,})(?:\s*(?:CNY|RMB|元))?\s*(?:\/|per\s+|每)?\s*(academic\s+year|year|semester|month|program|学年|年|学期|月|项目)/giu
    for (const match of window.matchAll(tuitionPattern)) {
      const amount = Number((match[1] ?? '').replaceAll(',', ''))
      if (!Number.isFinite(amount) || amount < 1_000 || amount > 500_000) continue
      const rawPeriod = (match[2] ?? '').toLocaleLowerCase('en')
      const period = rawPeriod.includes('semester') || rawPeriod === '学期'
        ? 'semester'
        : rawPeriod.includes('month') || rawPeriod === '月'
          ? 'month'
          : rawPeriod.includes('program') || rawPeriod === '项目'
            ? 'program'
            : 'academic-year'
      const quote = evidenceSlice(match[0])
      candidates.push({ field: 'tuitionCny', value: amount, evidence: quote })
      candidates.push({ field: 'tuitionPeriod', value: period, evidence: quote })
    }

    const applicationFeePattern = /(?:application\s+fee|报名费|申请费)\s*(?:is|为)?\s*[:：-]?\s*(?:CNY|RMB|¥|￥)?\s*([\d,]{2,5})(?:\s*(?:CNY|RMB|元))?/giu
    for (const match of window.matchAll(applicationFeePattern)) {
      const amount = Number((match[1] ?? '').replaceAll(',', ''))
      if (!Number.isFinite(amount) || amount < 50 || amount > 10_000) continue
      candidates.push({
        field: 'applicationFeeCny',
        value: amount,
        evidence: evidenceSlice(match[0]),
      })
    }

    const dateCuePattern = /(?:application\s+(?:period|deadline|opens?|starts?|ends?|closes?)|apply\s+(?:before|from|by)|报名时间|申请时间|申请截止(?:日期)?|截止日期)[^。.;]{0,100}/giu
    for (const cue of window.matchAll(dateCuePattern)) {
      const quote = cue[0] ?? ''
      const isOpen = /period|opens?|starts?|from|报名时间|申请时间/iu.test(quote)
        && !/deadline|ends?|closes?|before|by|截止|至|\bto\b/iu.test(quote)
      const englishPattern = new RegExp(
        `(${Object.keys(MONTHS).join('|')})\\s+(\\d{1,2})(?:st|nd|rd|th)?[,]?\\s+(20\\d{2})`,
        'giu',
      )
      const rangeDates = [
        ...[...quote.matchAll(/(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/gu)]
          .map((match) => `${match[1]}-${String(Number(match[2])).padStart(2, '0')}-${String(Number(match[3])).padStart(2, '0')}`),
        ...[...quote.matchAll(/(20\d{2})年(\d{1,2})月(\d{1,2})日/gu)]
          .map((match) => `${match[1]}-${String(Number(match[2])).padStart(2, '0')}-${String(Number(match[3])).padStart(2, '0')}`),
        ...[...quote.matchAll(englishPattern)]
          .map((match) => parseEnglishDate(match[1] ?? '', match[2] ?? '', match[3] ?? '')),
      ]
      // A malformed endpoint must not turn a range into a different single date.
      if (rangeDates.some((value) => value === null || !isCalendarDate(value))) continue
      if (rangeDates.length >= 2) {
        if (rangeDates[0]! > rangeDates[1]!) continue
        candidates.push({ field: 'opensOn', value: rangeDates[0]!, evidence: evidenceSlice(quote) })
        candidates.push({ field: 'closesOn', value: rangeDates[1]!, evidence: evidenceSlice(quote) })
        continue
      }
      const iso = /(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/u.exec(quote)
      const chinese = /(20\d{2})年(\d{1,2})月(\d{1,2})日/u.exec(quote)
      const english = new RegExp(englishPattern.source, 'iu').exec(quote)
      let value: string | null = null
      if (iso) {
        value = `${iso[1]}-${String(Number(iso[2])).padStart(2, '0')}-${String(Number(iso[3])).padStart(2, '0')}`
      } else if (chinese) {
        value = `${chinese[1]}-${String(Number(chinese[2])).padStart(2, '0')}-${String(Number(chinese[3])).padStart(2, '0')}`
      } else if (english) {
        value = parseEnglishDate(english[1] ?? '', english[2] ?? '', english[3] ?? '')
      }
      if (!value || !isCalendarDate(value)) continue
      candidates.push({
        field: isOpen ? 'opensOn' : 'closesOn',
        value,
        evidence: evidenceSlice(quote),
      })
    }
  }

  const accepted: EvidenceFact[] = []
  for (const field of [
    'durationMonths',
    'tuitionCny',
    'tuitionPeriod',
    'applicationFeeCny',
    'opensOn',
    'closesOn',
  ] as const) {
    const fact = uniqueFact(candidates, field)
    if (fact) accepted.push(fact)
  }
  if (accepted.some((fact) => fact.field === 'tuitionCny')
    !== accepted.some((fact) => fact.field === 'tuitionPeriod')) {
    return accepted.filter((fact) => fact.field !== 'tuitionCny' && fact.field !== 'tuitionPeriod')
  }
  return accepted
}

async function pdfToText(bytes: Uint8Array, temporaryDirectory: string, id: string): Promise<string> {
  await mkdir(temporaryDirectory, { recursive: true })
  const file = join(temporaryDirectory, `${id}.pdf`)
  await writeFile(file, bytes)
  const { stdout } = await execFileAsync('pdftotext', ['-layout', file, '-'], {
    encoding: 'utf8',
    maxBuffer: 12 * 1024 * 1024,
  })
  return normalizeEvidenceText(stdout)
}

async function fetchSourceText(url: string, temporaryDirectory: string): Promise<string> {
  await mkdir(temporaryDirectory, { recursive: true })
  const cacheFile = join(temporaryDirectory, `${hash(url)}.txt`)
  try {
    return await readFile(cacheFile, 'utf8')
  } catch {
    // A missing cache is expected on the first run.
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'text/html,application/pdf;q=0.9,*/*;q=0.1',
        'User-Agent': USER_AGENT,
      },
      redirect: 'follow',
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.length > 20 * 1024 * 1024) throw new Error('source exceeds 20MB')
    const contentType = response.headers.get('content-type')?.toLocaleLowerCase('en') ?? ''
    const pdf = contentType.includes('application/pdf')
      || /\.pdf(?:$|[?#])/iu.test(response.url)
      || (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)
    const text = pdf
      ? await pdfToText(bytes, temporaryDirectory, hash(url))
      : htmlToText(new TextDecoder().decode(bytes))
    await writeFile(cacheFile, text, 'utf8')
    return text
  } finally {
    clearTimeout(timeout)
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

function findProgram(bundle: DataBundle, record: ReviewRecord): Program | null {
  const wantedName = normalizedName(record.programNameEn)
  const candidates = bundle.programs.filter((program) => (
    program.universityId === record.institutionId
    && normalizedName(program.name.en ?? '') === wantedName
  ))
  if (candidates.length === 1) return candidates[0] ?? null
  const level = record.degreeLevel.toLocaleLowerCase('en')
  return candidates.find((program) => (
    program.degreeLevel === level
    || (record.programType === 'language' && program.degreeLevel === 'language')
  )) ?? null
}

/** Snippets propose field changes; they never certify unrelated canonical claims. */
export function stageFactCandidates(
  bundle: DataBundle,
  recordFacts: Array<{
    record: ReviewRecord
    program: Program
    facts: EvidenceFact[]
    identityConfirmed: boolean
  }>,
  checkedAt: string,
) {
  const proposals = recordFacts.map((item) => ({
    programId: item.program.id,
    institutionId: item.record.institutionId,
    officialUrl: item.record.officialUrl,
    observedAt: checkedAt,
    status: 'draft' as const,
    publicationEligible: false as const,
    identityConfirmed: item.identityConfirmed,
    // Do not merge old fees/dates, infer an intake year, or copy review-queue dates.
    facts: item.facts,
    issues: [
      'Unverified deterministic proposal; scoped source and field review required before certification.',
      ...(item.facts.some((fact) => fact.field === 'closesOn'
        && typeof fact.value === 'string' && fact.value < checkedAt)
        ? ['Expired deadline retained as historical evidence only; applications are not reopened.']
        : []),
    ],
  }))
  // The CLI retains its snapshot outputs, but no canonical row or audit stamp changes.
  return { bundle, proposals }
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2))
  const review = JSON.parse(await readFile(options.reviewPath, 'utf8')) as ReviewDocument
  const bundle = await readBundle(options.dataDirectory)
  const recordsByUrl = new Map<string, ReviewRecord[]>()
  for (const record of review.records) {
    const records = recordsByUrl.get(record.officialUrl) ?? []
    records.push(record)
    recordsByUrl.set(record.officialUrl, records)
  }
  const allUrls = [...recordsByUrl.keys()]
  const selectedUrls = Number.isFinite(options.maximumUrls) && options.maximumUrls > 0
    ? allUrls.slice(0, options.maximumUrls)
    : allUrls
  const temporaryDirectory = resolve('.pipeline-build/program-fact-pages')
  const sourceTexts = new Map<string, { text: string | null; issue: string | null }>()
  const lastRequestStartedAt = new Map<string, number>()

  for (const url of selectedUrls) {
    const host = new URL(url).hostname
    const previousStart = lastRequestStartedAt.get(host)
    if (previousStart !== undefined && options.minimumDomainIntervalMs > 0) {
      const remaining = options.minimumDomainIntervalMs - (Date.now() - previousStart)
      if (remaining > 0) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, remaining))
      }
    }
    lastRequestStartedAt.set(host, Date.now())
    try {
      sourceTexts.set(url, { text: await fetchSourceText(url, temporaryDirectory), issue: null })
    } catch (error) {
      sourceTexts.set(url, {
        text: null,
        issue: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const candidates: Array<{
    record: ReviewRecord
    program: Program
    facts: EvidenceFact[]
    identityConfirmed: boolean
  }> = []
  const auditRecords: EnrichmentRecord[] = []
  for (const url of selectedUrls) {
    const source = sourceTexts.get(url)!
    const records = recordsByUrl.get(url) ?? []
    for (const record of records) {
      const program = findProgram(bundle, record)
      if (!program) {
        auditRecords.push({
          institutionId: record.institutionId,
          programNameEn: record.programNameEn,
          officialUrl: url,
          programId: null,
          status: 'program-not-found',
          facts: [],
          issues: ['program identity not found in Catalog'],
        })
        continue
      }
      if (!source.text) {
        auditRecords.push({
          institutionId: record.institutionId,
          programNameEn: record.programNameEn,
          officialUrl: url,
          programId: program.id,
          status: 'fetch-failed',
          facts: [],
          issues: [source.issue ?? 'unknown fetch failure'],
        })
        continue
      }
      const facts = extractGroundedFacts(source.text, record, records.length)
      const normalizedSource = normalizedName(source.text)
      const identityConfirmed = [record.programNameEn, record.programNameOriginal]
        .map(normalizedName)
        .some((name) => name.length >= 6 && normalizedSource.includes(name))
      if (facts.length > 0 || identityConfirmed) {
        candidates.push({ record, program, facts, identityConfirmed })
      }
      auditRecords.push({
        institutionId: record.institutionId,
        programNameEn: record.programNameEn,
        officialUrl: url,
        programId: program.id,
        status: facts.length > 0
          ? 'candidate'
          : identityConfirmed ? 'identity-confirmed' : 'no-grounded-facts',
        facts,
        issues: facts.length > 0 || identityConfirmed
          ? ['Candidate observation only; canonical values and verification dates remain unchanged.']
          : [],
      })
    }
  }

  const staged = stageFactCandidates(bundle, candidates, options.checkedAt)
  const output = staged.bundle
  await mkdir(options.outputDirectory, { recursive: true })
  await mkdir(resolve(options.auditPath, '..'), { recursive: true })
  if (options.outputDirectory !== options.dataDirectory) {
    for (const [name, value] of [
      ['programs', output.programs],
      ['admission-cycles', output.admissionCycles],
    ] as const) {
      await writeFile(
        join(options.outputDirectory, `${name}.json`),
        `${JSON.stringify(value, null, 2)}\n`,
        'utf8',
      )
    }
  }
  await writeFile(
    join(options.outputDirectory, 'fact-proposals.json'),
    `${JSON.stringify({ mode: 'candidate-only', proposals: staged.proposals }, null, 2)}\n`,
    'utf8',
  )
  const summary = {
    mode: 'candidate-only',
    checkedAt: options.checkedAt,
    selectedUrls: selectedUrls.length,
    records: auditRecords.length,
    candidateRecords: staged.proposals.length,
    factCandidateRecords: auditRecords.filter((record) => record.status === 'candidate').length,
    certifiedPrograms: 0,
    certifiedCycles: 0,
    // Legacy counter: observations do not constitute certified enrichment.
    enriched: 0,
    identityConfirmed: auditRecords.filter(
      (record) => record.status === 'identity-confirmed',
    ).length,
    fetchFailed: auditRecords.filter((record) => record.status === 'fetch-failed').length,
    programNotFound: auditRecords.filter((record) => record.status === 'program-not-found').length,
    durationFacts: auditRecords.filter((record) => (
      record.facts.some((fact) => fact.field === 'durationMonths')
    )).length,
    tuitionFacts: auditRecords.filter((record) => (
      record.facts.some((fact) => fact.field === 'tuitionCny')
    )).length,
    deadlineFacts: auditRecords.filter((record) => (
      record.facts.some((fact) => fact.field === 'closesOn')
    )).length,
  }
  await writeFile(
    options.auditPath,
    `${JSON.stringify({ summary, records: auditRecords }, null, 2)}\n`,
    'utf8',
  )
  console.log(JSON.stringify(summary))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}

