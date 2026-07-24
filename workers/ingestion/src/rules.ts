import { stableJson } from './hash'
import { sanitizeRegexFlags } from './security'
import type {
  Evidence,
  ExtractionFact,
  ExtractionField,
  SourceManifestV1,
} from './types'

const HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
}
const MAX_REGEX_SCAN_CHARS = 2_000_000

function boundedRegexInputs(value: string): string[] {
  if (value.length <= MAX_REGEX_SCAN_CHARS) return [value]
  const half = Math.floor(MAX_REGEX_SCAN_CHARS / 2)
  return [value.slice(0, half), value.slice(-half)]
}

export function normalizeEvidenceText(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim()
}

export function htmlToText(html: string): string {
  return normalizeEvidenceText(
    html
      .replace(/<(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p\s*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity: string) => {
        const normalized = entity.toLowerCase()
        let codePoint: number | null = null
        if (normalized.startsWith('#x')) {
          codePoint = Number.parseInt(normalized.slice(2), 16)
        }
        if (normalized.startsWith('#') && !normalized.startsWith('#x')) {
          codePoint = Number.parseInt(normalized.slice(1), 10)
        }
        if (
          codePoint !== null &&
          Number.isInteger(codePoint) &&
          codePoint >= 0 &&
          codePoint <= 0x10ffff &&
          !(codePoint >= 0xd800 && codePoint <= 0xdfff)
        ) return String.fromCodePoint(codePoint)
        return HTML_ENTITIES[normalized] ?? `&${entity};`
      }),
  )
}

function decodePointerToken(token: string): string {
  return token.replaceAll('~1', '/').replaceAll('~0', '~')
}

export function readJsonPointer(value: unknown, pointer: string): unknown {
  if (pointer === '') return value
  if (!pointer.startsWith('/')) return undefined
  let current = value
  for (const rawToken of pointer.slice(1).split('/')) {
    if (current === null || typeof current !== 'object') return undefined
    const token = decodePointerToken(rawToken)
    current = (current as Record<string, unknown>)[token]
  }
  return current
}

export function isFieldValueValid(field: ExtractionField, value: unknown): boolean {
  if (value === null) return field.nullable === true
  switch (field.type) {
    case 'string':
      return typeof value === 'string' && value.trim().length > 0
    case 'number':
    case 'money':
      return typeof value === 'number' && Number.isFinite(value) && (field.type !== 'money' || value >= 0)
    case 'boolean':
      return typeof value === 'boolean'
    case 'date': {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
      const parsed = new Date(`${value}T00:00:00.000Z`)
      return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    }
    case 'string-array':
      return Array.isArray(value) && value.every((item) => typeof item === 'string')
    case 'object':
      return value !== null && typeof value === 'object' && !Array.isArray(value)
  }
}

function evidenceNumbers(value: string): number[] {
  return [...value.matchAll(/(?:^|[^\d])(-?\d[\d,]*(?:\.\d+)?)(?=$|[^\d])/g)]
    .map((match) => Number(match[1]?.replaceAll(',', '')))
    .filter(Number.isFinite)
}

export function criticalEvidenceIssue(
  field: ExtractionField,
  value: unknown,
  evidenceQuote: string,
  manifest: SourceManifestV1,
): string | null {
  if (!field.critical) return null
  const quote = normalizeEvidenceText(evidenceQuote)
  if (field.type === 'money' || field.type === 'number') {
    if (typeof value !== 'number') return 'critical numeric value is not a number'
    const matches = evidenceNumbers(quote).some((candidate) => Math.abs(candidate - value) < 0.000001)
    if (!matches) return 'critical numeric value is not present in its evidence quote'
  }
  if (field.type === 'date') {
    if (typeof value !== 'string') return 'critical date value is not a string'
    const [year, month, day] = value.split('-')
    const numericForms = [
      value,
      `${year}/${month}/${day}`,
      `${year}.${month}.${day}`,
      `${year}年${Number(month)}月${Number(day)}日`,
    ]
    const monthNames = [
      'january', 'february', 'march', 'april', 'may', 'june',
      'july', 'august', 'september', 'october', 'november', 'december',
    ]
    const englishForm = `${monthNames[Number(month) - 1]} ${Number(day)}, ${year}`
    const normalizedQuote = quote.toLowerCase()
    if (!numericForms.some((candidate) => quote.includes(candidate))
      && !normalizedQuote.includes(englishForm)) {
      return 'critical date value is not deterministically present in its evidence quote'
    }
  }
  if (/academic[_A-Z.-]*year/i.test(field.path) && typeof value === 'string') {
    const match = /^(\d{4})-(\d{4})$/.exec(value)
    if (!match || Number(match[2]) !== Number(match[1]) + 1) {
      return 'academic year must be a consecutive YYYY-YYYY range'
    }
  }
  if (/institution[_A-Z.-]*id$/i.test(field.path) && value !== manifest.institutionId) {
    return 'institution ownership does not match the source manifest'
  }
  if (/currency(?:[_A-Z.-]*code)?$/i.test(field.path)) {
    if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value)) {
      return 'currency code must be an ISO-style three-letter code'
    }
    if (!quote.toUpperCase().includes(value)) {
      return 'currency code is not present in its evidence quote'
    }
  }
  if (/(?:billing[_A-Z.-]*period|tuition[_A-Z.-]*period)$/i.test(field.path)) {
    const periods = new Set([
      'one_time', 'program', 'academic_year', 'semester', 'month', 'week', 'day', 'other',
    ])
    if (typeof value !== 'string' || !periods.has(value)) {
      return 'billing period is outside the controlled vocabulary'
    }
  }
  return null
}

function coerceValue(field: ExtractionField, value: unknown): unknown {
  if (value === null || value === undefined) return value
  if ((field.type === 'number' || field.type === 'money') && typeof value === 'string') {
    const normalized = value.replace(/[¥￥,\s]/g, '')
    if (/^-?\d+(?:\.\d+)?$/.test(normalized)) return Number(normalized)
  }
  if (field.type === 'boolean' && typeof value === 'string') {
    if (/^(true|yes|1)$/i.test(value.trim())) return true
    if (/^(false|no|0)$/i.test(value.trim())) return false
  }
  if (field.type === 'string') return String(value).trim()
  return value
}

export type RuleExtractionResult = {
  complete: boolean
  facts: ExtractionFact[]
  issues: string[]
}

export function extractWithRules(
  manifest: SourceManifestV1,
  rawText: string,
  contentType: string,
): RuleExtractionResult {
  const fields = new Map(manifest.extraction.fields.map((field) => [field.path, field]))
  const facts = new Map<string, ExtractionFact>()
  const issues: string[] = []
  let parsedJson: unknown

  for (const rule of manifest.extraction.rules ?? []) {
    const field = fields.get(rule.fieldPath)
    if (!field) continue
    let rawValue: unknown
    let evidence: Evidence

    if (rule.kind === 'regex') {
      try {
        const flags = sanitizeRegexFlags(rule.flags)
        const match = boundedRegexInputs(rawText)
          .map((input) => new RegExp(rule.pattern, flags).exec(input))
          .find((candidate) => candidate !== null) ?? null
        if (!match) continue
        const captureGroup = rule.captureGroup ?? 1
        rawValue = match[captureGroup]
        evidence = { quote: normalizeEvidenceText(match[0]), locator: `regex:${rule.pattern}` }
      } catch {
        issues.push(`Rule failed for ${rule.fieldPath}`)
        continue
      }
    } else {
      if (!contentType.toLowerCase().includes('json')) continue
      try {
        parsedJson ??= JSON.parse(rawText)
        rawValue = readJsonPointer(parsedJson, rule.pointer)
        if (rawValue === undefined) continue
        evidence = { quote: stableJson(rawValue), locator: `json-pointer:${rule.pointer}` }
      } catch {
        issues.push(`JSON rule failed for ${rule.fieldPath}`)
        continue
      }
    }

    const value = coerceValue(field, rawValue)
    if (!isFieldValueValid(field, value)) {
      issues.push(`Rule produced an invalid ${field.type} for ${field.path}`)
      continue
    }
    facts.set(field.path, { fieldPath: field.path, value, evidence })
  }

  for (const field of manifest.extraction.fields) {
    if (field.required && !facts.has(field.path)) issues.push(`Missing required field: ${field.path}`)
  }
  return {
    complete: issues.length === 0 && facts.size > 0,
    facts: [...facts.values()].sort((left, right) => left.fieldPath.localeCompare(right.fieldPath)),
    issues,
  }
}
