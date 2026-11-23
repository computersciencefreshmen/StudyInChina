import { createHash } from 'node:crypto'

export const TRANSLATION_VERSION = 'v1' as const
export const TRANSLATION_LOCALES = ['zh', 'en', 'ru', 'de', 'fr', 'es'] as const
export const TRANSLATION_FIELDS = ['title', 'requirements', 'materials', 'description'] as const
export type ProgramTranslationLocale = typeof TRANSLATION_LOCALES[number]
export type ProgramTranslationField = typeof TRANSLATION_FIELDS[number]
type SourceInput = { name?: string; fields: Partial<Record<Exclude<ProgramTranslationField, 'title'>, string>> }

export function programTranslationSource(row: SourceInput, field: ProgramTranslationField, locale: ProgramTranslationLocale) {
  if (field !== 'title') {
    const source = row.fields[field]
    // Whole-field placeholders contain no admissions facts to translate or review.
    if (source && /^(?:updating|to be updated|正在更新|更新中|待更新)[.。!！\s]*$/iu.test(source.normalize('NFKC').trim())) return undefined
    return source
  }
  return locale === 'en' && row.name && /\p{Script=Han}/u.test(row.name) ? row.name : undefined
}
export type ProgramTranslationRecord = {
  schemaVersion: 1
  version: typeof TRANSLATION_VERSION
  key: string
  sourceHash: string
  targetLocale: ProgramTranslationLocale
  text: string
  method: 'minimax' | 'source'
  model: string | null
  translatedAt: string
  validation: 'passed'
  factPolicy?: 'literal-v2'
}

export type TranslationProtection = { text: string; spans: string[]; factPolicy?: 'literal-v2' }
const MAX_SOURCE = 500_000
const MARKER_PREFIX = '__SC_'
const marker = (index: number) => `${MARKER_PREFIX}${String(index).padStart(6, '0')}__`
const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')
const localeValid = (value: unknown): value is ProgramTranslationLocale =>
  typeof value === 'string' && TRANSLATION_LOCALES.includes(value as ProgramTranslationLocale)

// Preserve atomic facts and their qualifiers while leaving actual admissions
// prose available to translate. These lexical checks cannot prove all semantic
// equivalence; retained original text remains available as the authoritative copy.
const NUMBER = String.raw`[\p{N}]+(?:[.,，/–—:\-][\p{N}]+)*`
const WRITTEN_NUMBER = String.raw`(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|[零〇一二两三四五六七八九十百千万]+)`
const QUANTITY = `(?:${NUMBER}|${WRITTEN_NUMBER})`
const UNIT = String.raw`(?:academic\s+years?|years?(?:\s+old)?|months?|semesters?|weeks?|days?|hours?|credits?|points?|年制|学年|学期|个月|周岁|年|月|日|天|周|岁|分|元|%)`
const COMPARATOR = String.raw`(?:at\s+(?:least|most)|no\s+(?:less|more)\s+than|not\s+(?:less|more)\s+than|(?:less|more|greater|higher|lower)\s+than|minimum(?:\s+of)?|maximum(?:\s+of)?|above|below|under|over|>=|<=|≥|≤|>|<|不得超过|不低于|不少于|不高于|不多于|不超过|至少|最多|最低|最高|大于|小于|超过)`
const EXAM = String.raw`\b(?:HSK(?:K)?|IELTS|TOEFL(?:\s+(?:iBT|PBT))?|TOEIC|CEFR|JLPT|GPA)(?=\b|\p{N})`
const SCORE = String.raw`(?:[ABC][12]|${NUMBER})`
const QUALIFIER = String.raw`\b(?:must\s+not|not\s+required|no\s+need(?:\s+to)?|need\s+not|unless|without|cannot|never|must|shall|not|no|required?|requires?|exempt(?:ed|ion)?|waivers?|above|below|at\s+(?:least|most)|no\s+(?:less|more)\s+than|not\s+(?:less|more)\s+than|(?:less|more|greater|higher|lower)\s+than|minimum|maximum)\b|(?:不低于|不少于|不高于|不多于|不超过|至少|最多|最低|最高|不得|必须|无需|无须|不必|不能|不可|不符合|不适用|不允许|不接受|未达到|未满|免除|免试|豁免|除非|除外)`
const MONTH = String.raw`(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)`
const FACT_PATTERNS = [
  String.raw`https?:\/\/[^\s<>"']+|www\.[^\s<>"']+|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}`,
  String.raw`${NUMBER}\s*年\s*(?:${NUMBER}\s*月\s*)?(?:${NUMBER}\s*日)?`,
  String.raw`\b${MONTH}\.?\s+${NUMBER}(?:\s*,\s*${NUMBER})?\b|\b${NUMBER}\s+${MONTH}\.?(?:\s*,?\s*${NUMBER})?\b`,
  String.raw`(?:\b(?:RMB|CNY|USD|EUR|GBP|HKD)\b|人民币|美元|欧元|英镑|[￥¥$€£])\s*${NUMBER}(?:\s*(?:per\s+)?${UNIT})?|${NUMBER}\s*(?:RMB|CNY|USD|EUR|GBP|HKD|人民币|美元|欧元|英镑|元)`,
  String.raw`${EXAM}(?:\s*[:：-]?\s*(?:(?:level|band|grade|score(?:\s+of)?)\s*)?(?:${COMPARATOR}\s*)?${SCORE}(?:\s*(?:or\s+(?:above|higher)|\+))?)?`,
  String.raw`${COMPARATOR}\s*${QUANTITY}(?:\s*${UNIT})?`,
  String.raw`${QUANTITY}\s*${UNIT}`,
  String.raw`\bnon[-\s]+(?:Chinese|English)\b|\b(?:native\s+)?(?:English|Chinese|Russian|French|German|Spanish)(?:[-\s]+(?:taught|speakers?))?\b|非中国籍|母语|中文|英文|汉语|英语`,
  QUALIFIER,
  String.raw`\b[ABC][12]\b|${NUMBER}|[<>≤≥≦≧=￥¥$€£]`,
].map(pattern => new RegExp(pattern, 'giu'))
// Generic language/unit words are not forbidden here: legitimate translated
// prose may contain them. Scores, new links, operators and new negations are.
const ADDED_CRITICAL = new RegExp(String.raw`\p{N}|https?:\/\/|www\.|[<>≤≥≦≧=￥¥$€£]|${EXAM}|${QUALIFIER}|\b(?:nicht|keine?|pas|jamais|sans)\b|\b(?:не|нет|без)\b`, 'iu')
const EXPLICIT_TRUNCATION = /\[(?:truncated|omitted|translation omitted)\]|<\/?(?:truncated|omitted)>/iu
// Keep numerical values, links, tests, currency codes and operators byte-exact.
// Translate grammatical qualifiers in context; their meaning and units require independent review.
const LITERALS = new RegExp(String.raw`https?:\/\/[^\s<>"']+|www\.[^\s<>"']+|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|${EXAM}|\b(?:CNY|RMB|USD|EUR|GBP|HKD)\b|${NUMBER}|[<>≤≥≦≧=￥¥$€£%]`, 'giu')

function assertSource(source: string) {
  if (typeof source !== 'string' || !source.trim() || source.length > MAX_SOURCE || source.includes(MARKER_PREFIX)) {
    throw new Error('translation_source_invalid')
  }
}

export function translationKey(source: string, locale: ProgramTranslationLocale): string {
  assertSource(source)
  if (!localeValid(locale)) throw new Error('translation_locale_invalid')
  // Sorted, fixed keys are shared by the writer and reader. Whitespace is part
  // of the exact source hash, so changed wording cannot receive an old translation.
  return digest(JSON.stringify({ sourceHash: digest(source), targetLocale: locale, version: TRANSLATION_VERSION }))
}

export function translationPath(source: string, locale: ProgramTranslationLocale): string {
  return `translations/${TRANSLATION_VERSION}/${locale}/${translationKey(source, locale)}.json`
}

export function protectTranslationText(source: string, factPolicy?: 'literal-v2'): TranslationProtection {
  assertSource(source)
  const matches: { start: number; end: number }[] = []
  for (const pattern of factPolicy === 'literal-v2' ? [LITERALS] : FACT_PATTERNS) {
    pattern.lastIndex = 0
    for (const match of source.matchAll(pattern)) matches.push({ start: match.index, end: match.index + match[0].length })
  }
  const ranges: { start: number; end: number }[] = []
  for (const match of matches.sort((a, b) => a.start - b.start || b.end - a.end)) {
    const previous = ranges.at(-1)
    if (previous && match.start < previous.end) previous.end = Math.max(previous.end, match.end)
    else ranges.push({ ...match })
  }
  const spans: string[] = []
  let text = '', cursor = 0
  for (const range of ranges) {
    text += source.slice(cursor, range.start) + marker(spans.length)
    spans.push(source.slice(range.start, range.end)); cursor = range.end
  }
  text += source.slice(cursor)
  return { text, spans, ...(factPolicy && { factPolicy }) }
}

function textBounds(text: string, source: string) {
  if (typeof text !== 'string' || !text.trim() || text.length > Math.min(MAX_SOURCE * 4, Math.max(2_000, source.length * 8))
    || EXPLICIT_TRUNCATION.test(text)) throw new Error('translation_output_invalid')
}

function remainingText(text: string, spans: string[], factPolicy?: 'literal-v2'): string {
  if (factPolicy === 'literal-v2') {
    const actual = (text.match(LITERALS) || []).sort()
    if (JSON.stringify(actual) !== JSON.stringify([...spans].sort()) || text.includes(MARKER_PREFIX))
      throw new Error('translation_fact_missing_or_changed')
    return text.replace(LITERALS, ' ')
  }
  let remaining = text
  // Longer facts first handle overlapping value fragments. ASCII word/value
  // boundaries prevent an original "18" from being satisfied by a new "118".
  for (const span of [...spans].sort((a, b) => b.length - a.length)) {
    const escaped = span.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const boundary = new RegExp(`${/^[A-Za-z0-9_]/.test(span) ? '(?<![A-Za-z0-9_])' : ''}${escaped}${/[A-Za-z0-9_]$/.test(span) ? '(?![A-Za-z0-9_])' : ''}`, 'u')
    const at = remaining.search(boundary)
    if (at < 0) throw new Error('translation_fact_missing_or_changed')
    remaining = remaining.slice(0, at) + ' ' + remaining.slice(at + span.length)
  }
  if (ADDED_CRITICAL.test(remaining) || remaining.includes(MARKER_PREFIX) || /__SC[_\d]*__/.test(remaining)) {
    throw new Error('translation_added_critical_content')
  }
  return remaining
}

function validateTargetScript(text: string, source: string, locale: ProgramTranslationLocale, protection: TranslationProtection) {
  const outside = remainingText(text, protection.spans, protection.factPolicy)
  const originalOutside = remainingText(source, protection.spans, protection.factPolicy)
  const originalLetters = originalOutside.match(/\p{L}/gu) || []
  if (originalLetters.length < 10) return
  const letters = outside.match(/\p{L}/gu) || []
  const han = (outside.match(/\p{Script=Han}/gu) || []).length
  const cyrillic = (outside.match(/\p{Script=Cyrillic}/gu) || []).length
  if (locale === 'zh' && (han < 2 || han / Math.max(1, letters.length) < 0.2)) throw new Error('translation_target_script_mismatch')
  if (locale === 'ru' && (cyrillic < 2 || cyrillic / Math.max(1, letters.length) < 0.4)) throw new Error('translation_target_script_mismatch')
  if (locale === 'en' && ((outside.match(/[A-Za-z]/g) || []).length < 4
    || (outside.match(/[A-Za-z]/g) || []).length / Math.max(1, letters.length) < 0.8)) throw new Error('translation_target_script_mismatch')
}

function validateText(text: string, source: string, protection: TranslationProtection) {
  textBounds(text, source)
  const outside = remainingText(text, protection.spans, protection.factPolicy).trim()
  // A provider stop_reason=max_tokens is also rejected by the caller. This catches
  // silently empty/short translations without imposing a word-for-word ratio.
  const originalOutside = remainingText(source, protection.spans, protection.factPolicy).trim()
  if (originalOutside.length > 30 && outside.length < Math.min(12, Math.ceil(originalOutside.length * 0.1))) {
    throw new Error('translation_output_truncated')
  }
}

export function restoreTranslationText(masked: string, protection: TranslationProtection): string {
  if (typeof masked !== 'string' || !protection || !Array.isArray(protection.spans) || typeof protection.text !== 'string') {
    throw new Error('translation_output_invalid')
  }
  let translated = masked
  for (let index = 0; index < protection.spans.length; index++) {
    const token = marker(index)
    if (translated.split(token).length !== 2) throw new Error('translation_placeholder_mismatch')
    translated = translated.replace(token, protection.spans[index])
  }
  // The protection object is always computed from the retained source, never
  // supplied by model output. Reconstruct it to validate output bounds and facts.
  let source = protection.text
  for (let index = 0; index < protection.spans.length; index++) source = source.replace(marker(index), protection.spans[index])
  assertSource(source)
  validateText(translated, source, protection)
  return translated
}

export function validateTranslationRecord(value: unknown, source: string, locale: ProgramTranslationLocale): ProgramTranslationRecord | null {
  try {
    assertSource(source)
    if (!localeValid(locale) || !value || typeof value !== 'object' || Array.isArray(value)) return null
    const row = value as Record<string, unknown>
    const key = translationKey(source, locale)
    if (row.schemaVersion !== 1 || row.version !== TRANSLATION_VERSION || row.key !== key || row.sourceHash !== digest(source)
      || row.targetLocale !== locale || row.validation !== 'passed' || typeof row.text !== 'string'
      || typeof row.translatedAt !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(row.translatedAt) || !Number.isFinite(Date.parse(row.translatedAt))
      || !['minimax', 'source'].includes(String(row.method))) return null
    if (row.method === 'source') {
      if (row.model !== null || row.text !== source) return null
    } else {
      if (typeof row.model !== 'string' || !/^MiniMax-[A-Za-z0-9._-]{1,80}$/.test(row.model)) return null
      if (row.factPolicy !== undefined && row.factPolicy !== 'literal-v2') return null
      const protection = protectTranslationText(source, row.factPolicy)
      validateText(row.text, source, protection)
      validateTargetScript(row.text, source, locale, protection)
    }
    return { schemaVersion: 1, version: TRANSLATION_VERSION, key, sourceHash: digest(source), targetLocale: locale,
      text: row.text, method: row.method as ProgramTranslationRecord['method'], model: row.model as string | null,
      translatedAt: row.translatedAt, validation: 'passed', ...(row.factPolicy === 'literal-v2' && { factPolicy: 'literal-v2' as const }) }
  } catch { return null }
}

export function sourceIsTargetLanguage(source: string, locale: ProgramTranslationLocale): boolean {
  if (typeof source !== 'string' || !source.trim() || source.length > MAX_SOURCE) return false
  const letters = source.match(/\p{L}/gu) || []
  if (letters.length < 4) return false
  const han = source.match(/\p{Script=Han}/gu) || []
  if (locale === 'zh') return han.length >= 4 && han.length / letters.length >= 0.35
  if (locale !== 'en' || han.length > 0 || letters.filter(letter => /[A-Za-z]/.test(letter)).length / letters.length < 0.99) return false
  const words = source.toLowerCase().match(/[a-z]+/g) || []
  const english = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'for', 'in', 'with', 'is', 'are', 'be', 'must', 'applicants', 'application', 'documents', 'should', 'required', 'provide'])
  const matches = words.filter(word => english.has(word))
  return words.length >= 5 && new Set(matches).size >= 3 && matches.length / words.length >= 0.2
}
