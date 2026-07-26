import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'
import type {
  TsinghuaFact,
  TsinghuaMoney,
} from './tsinghua-program-detail-adapter'

export const TSINGHUA_2026_TUITION_URL =
  'https://yzbm.tsinghua.edu.cn/publish/s05/s0501/detail/dae20f4e-6f7a-42ee-9dad-24597411b6a4'

const OFFICIAL_HOST = 'yzbm.tsinghua.edu.cn'
const MAX_QUOTE_LENGTH = 600

export type TsinghuaTuitionRule = {
  ruleId: string
  academicYear: string
  degreeLevel: 'master' | 'doctorate' | null
  departmentCodes: string[]
  programCodes: string[]
  disciplinePrefixes: string[]
  description: string
  tuition: TsinghuaFact<TsinghuaMoney>
}

export type TsinghuaTuitionCatalog = {
  academicYear: string
  checkedAt: string
  officialUrl: string
  currency: 'CNY'
  rules: TsinghuaTuitionRule[]
}

function cleanText(value: string): string {
  return value
    .replace(/\u00a0/gu, ' ')
    .replace(/[ \t]+/gu, ' ')
    .replace(/\s*\n\s*/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

function checkedAt(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) throw new Error('checkedAt must be an ISO timestamp')
  return parsed.toISOString()
}

function officialUrl(value: string): string {
  const parsed = new URL(value)
  if (
    parsed.protocol !== 'https:'
    || parsed.hostname.toLowerCase() !== OFFICIAL_HOST
    || parsed.username
    || parsed.password
    || parsed.port
  ) {
    throw new Error(`Tsinghua tuition URL must use https://${OFFICIAL_HOST}`)
  }
  parsed.hash = ''
  return parsed.href
}

function tableMatrix(table: HTMLTableElement): string[][] {
  const rows = [...table.querySelectorAll('tr')]
  const grid: string[][] = Array.from({ length: rows.length }, () => [])
  for (const [rowIndex, row] of rows.entries()) {
    let columnIndex = 0
    for (const cell of [...row.querySelectorAll(':scope > th, :scope > td')]) {
      while (grid[rowIndex]![columnIndex] !== undefined) columnIndex += 1
      const value = cleanText(cell.textContent ?? '')
      const rowSpan = Math.max(
        1,
        Number.parseInt(cell.getAttribute('rowspan') ?? '1', 10) || 1,
      )
      const columnSpan = Math.max(
        1,
        Number.parseInt(cell.getAttribute('colspan') ?? '1', 10) || 1,
      )
      for (let rowOffset = 0; rowOffset < rowSpan; rowOffset += 1) {
        const targetRow = rowIndex + rowOffset
        if (!grid[targetRow]) grid[targetRow] = []
        for (let columnOffset = 0; columnOffset < columnSpan; columnOffset += 1) {
          grid[targetRow]![columnIndex + columnOffset] = value
        }
      }
      columnIndex += columnSpan
    }
  }
  return grid.map((row) => row.map((value) => value ?? ''))
}

function primaryTuition(value: string): TsinghuaMoney | null {
  const match =
    /(?:RMB\s*)?(\d{1,3}(?:,\d{3})+|\d{4,9})\s*[\(（]([^）)]*(?:每学年|Year|全项目|Full\s*Program)[^）)]*)[）)]/iu
      .exec(value)
  if (!match?.[1] || !match[2]) return null
  const amount = Number(match[1].replaceAll(',', ''))
  if (!Number.isSafeInteger(amount) || amount <= 0) return null
  const billingPeriod = /每学年|(?:^|\W)year(?:\W|$)/iu.test(match[2])
    ? 'academic_year' as const
    : /全项目|full\s*program/iu.test(match[2])
      ? 'full_program' as const
      : null
  return billingPeriod ? { amount, currency: 'CNY', billingPeriod } : null
}

function matches(value: string, pattern: RegExp): string[] {
  return [...new Set([...value.matchAll(pattern)].map((match) => match[0]))].sort()
}

function degreeLevel(value: string): 'master' | 'doctorate' | null {
  if (/(?:博士|\bDoctor(?:al)?\b|\bPhD\b)/iu.test(value)) return 'doctorate'
  if (/(?:硕士|\bMaster(?:'s)?\b)/iu.test(value)) return 'master'
  return null
}

export function parseTsinghuaTuitionCatalogHtml(input: {
  html: string
  checkedAt: string
  officialUrl?: string
}): TsinghuaTuitionCatalog {
  const url = officialUrl(input.officialUrl ?? TSINGHUA_2026_TUITION_URL)
  const capturedAt = checkedAt(input.checkedAt)
  const document = new JSDOM(input.html).window.document
  const pageText = cleanText(document.body?.textContent ?? '')
  const yearMatch =
    /Tuition Fees of Graduate Programs for International Students\s+(20\d{2})/iu.exec(pageText)
    ?? /(?:国际研究生学费列表|国际研究生专业\/项目学费)\D*(20\d{2})/u.exec(pageText)
  if (!yearMatch?.[1]) throw new Error('Tsinghua tuition page did not declare an academic year')
  if (!/(?:Unit:\s*RMB\s*Yuan|以人民币元为单位)/iu.test(pageText)) {
    throw new Error('Tsinghua tuition page did not declare RMB Yuan as its unit')
  }
  const academicYear = yearMatch[1]
  const rules: TsinghuaTuitionRule[] = []
  const tables = [...document.querySelectorAll('table')]
  for (const [tableIndex, table] of tables.entries()) {
    for (const [rowIndex, cells] of tableMatrix(table).entries()) {
      const description = [...new Set(cells.filter(Boolean))].join(' | ')
      const classification = description.replace(/\d{1,3}(?:,\d{3})+/gu, '')
      const tuition = primaryTuition(description)
      if (!tuition) continue
      const locator =
        `css:table:nth-of-type(${tableIndex + 1}) tr:nth-of-type(${rowIndex + 1})`
      rules.push({
        ruleId: `tsinghua-tuition:${academicYear}:${tableIndex + 1}:${rowIndex + 1}`,
        academicYear,
        degreeLevel: degreeLevel(description),
        departmentCodes: matches(classification, /\b\d{3}\b/gu),
        programCodes: matches(classification, /\b(?:\d{6}|\d{4}[A-Z]\d)\b/giu),
        disciplinePrefixes: matches(classification, /\b\d{2}\b/gu),
        description,
        tuition: {
          value: tuition,
          fieldMeta: {
            status: 'known',
            officialUrl: url,
            sourceTitle:
              `Tsinghua University Tuition Fees of Graduate Programs ${academicYear}`,
            checkedAt: capturedAt,
            locator,
            quote: description.slice(0, MAX_QUOTE_LENGTH),
          },
        },
      })
    }
  }
  if (!rules.length) throw new Error('Tsinghua tuition page contained no parseable fee rows')
  return {
    academicYear,
    checkedAt: capturedAt,
    officialUrl: url,
    currency: 'CNY',
    rules,
  }
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function main(): Promise<void> {
  const inputPath = argument('--input-html')
  const capturedAt = argument('--checked-at')
  if (!inputPath || !capturedAt) {
    throw new Error('--input-html and --checked-at are required')
  }
  const result = parseTsinghuaTuitionCatalogHtml({
    html: readFileSync(resolve(inputPath), 'utf8'),
    checkedAt: capturedAt,
    officialUrl: argument('--official-url'),
  })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
