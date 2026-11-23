import { createHash } from 'node:crypto'
import { sourceIsTargetLanguage, translationKey, translationPath, validateTranslationRecord,
  type ProgramTranslationField, type ProgramTranslationLocale } from './program-translation-contract'
import type { ThirdPartyProgram } from './third-party-programs'
import type { Program, University } from './data/types'

export const REVIEW_POLICY = 'semantic-v1' as const
export const REVIEW_MODEL = 'MiniMax-M3' as const
export type TranslationInput = Pick<ThirdPartyProgram, 'fields'> & Partial<Omit<ThirdPartyProgram, 'fields'>>
const digest = (s: string) => createHash('sha256').update(s).digest('hex')

export function officialTitleSource(program: Program, school: University) {
  const name = program.name.zh || program.name.en
  if (!name || !/\p{Script=Han}/u.test(name) || program.universityId !== school.id) return null
  return { id: program.id, slug: program.slug, schoolId: school.id, schoolName: school.name.en || school.name.zh || school.id,
    name, status: 'extracted' as const, fields: { degree: program.degreeLevel, language: [...program.teachingLanguages].sort().join(', ') } }
}

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
export function translationConflict(source: string, text: string, locale: ProgramTranslationLocale, field?: ProgramTranslationField) {
  if (field === 'title' && locale === 'en' && (/\p{Script=Han}/u.test(text) || !/[A-Za-z]/u.test(text))) return 'untranslated_title'
  if (locale !== 'zh') return null
  const prose = text.replace(/https?:\/\/\S+|[\w.+-]+@[\w.-]+/giu, '')
  if ((field === 'requirements' || field === 'materials') && /\p{Script=Han}/u.test(prose)) {
    // Condition words are prose. Names such as Chinese University of Hong Kong
    // and official exam names/acronyms are not matched by these local contexts.
    if (/\bnon-chinese\b/iu.test(prose)
      || /(?:的|学习|就读|修读|攻读)\s*Chinese\b(?=\s*(?:[。；.!?;]|$))|\bChinese\s*(?:熟练|水平|能力|语言|证书|考试|授课|课程|预科|培训)/iu.test(prose)) return 'untranslated_condition'
    // This observed rendering attaches the applicant's health to a diploma.
    if (prose.includes('持有成绩优异、身体健康的硕士学位毕业证书')) return 'scope'
    if (/\bassociate(?:['’]s)? degree graduate\b/iu.test(source) && /专升本/u.test(prose)
      && !/\b(?:top[- ]?up|upgrad\w*|bridg\w*)\b/iu.test(source)) return 'scope'
    // Some harvested prose concatenates a sentence and the next numbered item.
    const hskListBoundary = source.match(/\bHSK\s+(?:band|level)\s+([1-9])\.(\d{1,2})\.\s*\p{L}/iu)
    if (hskListBoundary && new RegExp(`HSK[^\\d]{0,8}${hskListBoundary[1]}[.．]${hskListBoundary[2]}(?!\\d)`, 'iu').test(prose)) return 'boundary'
  }
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
  if (scope.field === 'title' && (!record || record.method !== 'minimax' || locale !== 'en' ||
    /\p{Script=Han}/u.test(record.text) || !/[A-Za-z]/u.test(record.text))) return null
  if (!record || record.method === 'source') return record
  if (sourceIsTargetLanguage(source, locale) || translationConflict(source, record.text, locale, scope.field)) return null
  const review = (value as { review?: Record<string, unknown> }).review
  if (!scope.program || !scope.school || !review || review.policy !== REVIEW_POLICY || review.model !== REVIEW_MODEL
    || review.verdict !== 'PASS' || review.binding !== reviewBinding(source, record.text, locale, scope)
    || typeof review.checkedAt !== 'string' || !Number.isFinite(Date.parse(review.checkedAt))) return null
  return record
}
