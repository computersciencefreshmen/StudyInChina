import { createHash } from 'node:crypto'
import { sourceIsTargetLanguage, translationKey, translationPath, validateTranslationRecord,
  type ProgramTranslationField, type ProgramTranslationLocale } from './program-translation-contract'
import type { ThirdPartyProgram } from './third-party-programs'

export const REVIEW_POLICY = 'semantic-v1' as const
export const REVIEW_MODEL = 'MiniMax-M3' as const
type TranslationInput = Pick<ThirdPartyProgram, 'fields'> & Partial<Omit<ThirdPartyProgram, 'fields'>>
const digest = (s: string) => createHash('sha256').update(s).digest('hex')

export function translationScope(row: TranslationInput, field: ProgramTranslationField) {
  return { field, program: row.id ?? null, school: row.schoolId ?? null, name: row.name ?? null,
    schoolName: row.schoolName ?? null, degree: row.fields.degree ?? null, track: row.fields.language ?? null,
    year: row.admissionYear ?? null, start: row.fields.startDate ?? null, deadline: row.fields.deadline ?? null }
}
export type TranslationScope = ReturnType<typeof translationScope>

export function reviewLocation(source: string, locale: ProgramTranslationLocale, scope: TranslationScope) {
  return digest(JSON.stringify([REVIEW_POLICY, translationKey(source, locale), scope.field, scope.program, scope.school,
    scope.name, scope.schoolName, scope.degree, scope.track, scope.year, scope.start, scope.deadline]))
}

export function publicationPath(source: string, locale: ProgramTranslationLocale, scope: TranslationScope) {
  if (sourceIsTargetLanguage(source, locale)) return translationPath(source, locale)
  return `translations/approved/${REVIEW_POLICY}/${locale}/${reviewLocation(source, locale, scope)}.json`
}

export function reviewBinding(source: string, text: string, locale: ProgramTranslationLocale, scope: TranslationScope) {
  return digest(JSON.stringify([reviewLocation(source, locale, scope), digest(text), REVIEW_MODEL]))
}

/** Narrow, reproducible counterexamples; all other prose still needs a separate reviewer. */
export function translationConflict(source: string, text: string, locale: ProgramTranslationLocale) {
  if (locale !== 'zh') return null
  const prose = text.replace(/https?:\/\/\S+|[\w.+-]+@[\w.-]+/giu, '')
  if (/\p{Script=Han}/u.test(prose) && /\b(?:not|above|under|unless|required|exempt(?:ed)?|at least|at most)\b/iu.test(prose)) return 'untranslated_condition'
  if (/\b(?:not (?:available|open|eligible)|ineligible)\b/iu.test(source) && /可申请|可以申请|符合申请资格|开放/u.test(prose)
    && !/[不无未非免禁拒除]/u.test(prose)) return 'negation'
  const strictMaximum = source.match(/\b(?:under|less than|younger than)\s+(\d{1,3})\s+years?\b/iu)
  if (strictMaximum && new RegExp(`(?:不超过|不大于|至多|最多)\\s*${strictMaximum[1]}\\s*(?:周?岁|年)`, 'u').test(prose)) return 'boundary'
  if (/\b(?:waiver|waived|exempt(?:ion|ed)?)\b/iu.test(source) && !/(?:免|例外|除外|不必|无需|不用|不要求|不需要|可不|waiver|exempt)/iu.test(prose)) return 'exemption'
  if (/\bper semester\b/iu.test(source) && !/\b(?:total|entire|whole)\b/iu.test(source)
    && /全程|全学程|整个学程/u.test(prose) && !/学期/u.test(prose)) return 'amount_period'
  if (/\bHSK\b[^.;\n]{0,18}\bor\s+IELTS\b/iu.test(source)
    && /HSK[^。；\n]{0,18}(?:且|和|及|同时)[^。；\n]{0,5}IELTS/iu.test(prose)) return 'and_or'
  return null
}

/** A fluent translation never proves that the underlying admissions claim is current or official. */
export function validatePublishedTranslation(value: unknown, source: string, locale: ProgramTranslationLocale, scope: TranslationScope) {
  const record = validateTranslationRecord(value, source, locale)
  if (!record || record.method === 'source') return record
  if (sourceIsTargetLanguage(source, locale) || translationConflict(source, record.text, locale)) return null
  const review = (value as { review?: Record<string, unknown> }).review
  if (!scope.program || !scope.school || !review || review.policy !== REVIEW_POLICY || review.model !== REVIEW_MODEL
    || review.verdict !== 'PASS' || review.binding !== reviewBinding(source, record.text, locale, scope)
    || typeof review.checkedAt !== 'string' || !Number.isFinite(Date.parse(review.checkedAt))) return null
  return record
}
