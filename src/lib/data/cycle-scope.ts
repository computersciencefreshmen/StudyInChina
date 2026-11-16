/** Shared pure scope rules for cloud extraction, import and applicant display. */
/** Preserve the official label: a single admission year never implies a range. */
export function parseAdmissionYear(value: unknown): { kind: 'year' | 'range'; start: number; end: number } | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{4})(?:-(\d{4}))?$/u.exec(value)
  if (!match) return null
  const start = Number(match[1]), end = Number(match[2] ?? match[1])
  if (match[2] && end !== start + 1) return null
  return { kind: match[2] ? 'range' : 'year', start, end }
}
export function isCurrentAdmissionYear(value: unknown, today: string): boolean {
  const year = parseAdmissionYear(value), current = Number(today.slice(0, 4))
  return Boolean(year && year.end >= current && year.start <= current + 1)
}
export function admissionIntakeYear(value: string, intake: string): string | null {
  const year = parseAdmissionYear(value)
  return year ? String(year.kind === 'range' && intake === 'spring' ? year.end : year.start).padStart(4, '0') : null
}
const entryMarker = '入学|报到|开学|entry|enrol(?:ment|lment)?|commencement|program(?:me)?\\s+starts'
const applicationMarker = /application|deadline|registration|(?:admissions?|enrol(?:ment|lment)?)\s+(?:open|begin|start|close)|申请|报名|截止|受理/iu
const clauses = (quote: string) => quote.split(/[;；。.，\n]/u)
const literalYear = (year: string) => `(?<![\\d/.-])${year}(?![\\d/.-])`
const standaloneYear = (year: string) => `${literalYear(year)}(?!\\s*年\\s*[一二三四五六七八九十〇零\\d]{1,3}\\s*月)`

/** Bind the year to its own admissions label, not an unrelated deadline or a
 * different year's heading elsewhere in the source quote. */
export function quotedAdmissionYear(value: string, quote: string): boolean {
  if (parseAdmissionYear(value)?.kind !== 'year') return false
  const year = standaloneYear(value)
  const label = 'admission(?:s|\\s+year)?|academic\\s*year|intake|entry\\s+year|enrol(?:ment|lment)?\\s+year|招生|入学年度|入学年|学年'
  const gap = '[^\\d;；。\\n]{0,50}'
  return clauses(quote).some(clause => {
    if (applicationMarker.test(clause)) return false
    if (new RegExp(`(?:${entryMarker})${gap}${literalYear(value)}`, 'iu').test(clause)) return true
    return new RegExp(`(?:${label})${gap}${year}|${year}${gap}(?:${label})`, 'iu').test(clause)
  })
}

/** A single-year scope needs the year with its intake season, or an explicitly
 * labelled entry date. An application date cannot establish the intake year. */
export function quotedAdmissionIntake(value: string, intake: string, quote: string): boolean {
  const year = admissionIntakeYear(value, intake), parsed = parseAdmissionYear(value)
  if (!year || !parsed) return false
  const legacySeason = intake === 'spring' ? /spring|春季|March|3月/iu : intake === 'autumn' ? /autumn|fall|秋季|September|9月/iu : null
  if (parsed.kind === 'range') return new RegExp(`\\b${year}\\b`, 'u').test(quote) && (!legacySeason || legacySeason.test(quote))
  if (intake !== 'spring' && intake !== 'autumn') return quotedAdmissionYear(value, quote)
  const season = intake === 'spring' ? 'spring|春季' : 'autumn|fall|秋季'
  const month = intake === 'spring' ? '0?3月|march' : '0?9月|september'
  return clauses(quote).some(clause => {
    if (applicationMarker.test(clause)) return false
    const entryDate = new RegExp(`(?:${entryMarker})[^\\d;；。\\n]{0,40}(?:${literalYear(year)}\\s*(?:年\\s*)?(?:${month})|(?:${month})\\s+(?:\\d{1,2},?\\s*)?${literalYear(year)})`, 'iu')
    if (entryDate.test(clause)) return true
    return new RegExp(`(?:${season})\\s*(?:(?:intake|of)\\s+)?${standaloneYear(year)}|${standaloneYear(year)}\\s*(?:年\\s*)?(?:${season})`, 'iu').test(clause)
  })
}
export const TEACHING_LANGUAGES = ['English', 'Chinese', 'Russian', 'French', 'German', 'Spanish', 'Arabic', 'Portuguese'] as const
export type CycleTeachingLanguage = typeof TEACHING_LANGUAGES[number]
export type CycleTrackScope = { teachingLanguage?: string; applicationRound?: string }
const languageAliases: Record<string, string> = {
  English: '英语|英文', Chinese: '汉语|中文', Russian: '俄语|俄文', French: '法语|法文',
  German: '德语|德文', Spanish: '西班牙语', Arabic: '阿拉伯语', Portuguese: '葡萄牙语',
}
const languagePatterns: Record<string, RegExp> = Object.fromEntries(TEACHING_LANGUAGES.map(language => [language,
  new RegExp(`\\b${language}\\b\\s*(?:[-–]\\s*)?(?:taught|medium|track|program(?:me)?s?|round|batch)\\b|\\b(?:taught|teaching language|medium of instruction)\\s*(?:in|:)?\\s*${language}\\b|(?:${languageAliases[language]})\\s*(?:授课|教学|项目|班|方向)`, 'iu'),
]))
export const normalizeScopeText = (value: string) => value.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase()
export function mentionedTeachingLanguages(quote: string): string[] {
  return Object.entries(languagePatterns).filter(([, pattern]) => pattern.test(quote)).map(([language]) => language)
}
export function quotedTrackScope(scope: CycleTrackScope, quote: string, allowUniversal = false): boolean {
  const universalLanguages = allowUniversal && /all (?:teaching )?languages|regardless of (?:teaching )?language|所有授课语言|不分授课语言/iu.test(quote)
  if (scope.teachingLanguage && !universalLanguages && (!languagePatterns[scope.teachingLanguage]?.test(quote) || mentionedTeachingLanguages(quote).some(language => language !== scope.teachingLanguage))) return false
  const universalRounds = allowUniversal && /all (?:application )?rounds|所有申请批次|各申请批次/iu.test(quote)
  if (scope.applicationRound && !universalRounds && !normalizeScopeText(quote).includes(normalizeScopeText(scope.applicationRound))) return false
  return true
}
export function trackMatchesProgram(scope: CycleTrackScope, languages: unknown): boolean {
  const known = Array.isArray(languages) ? languages.filter((language): language is string => typeof language === 'string') : []
  return scope.teachingLanguage ? !known.length || known.includes(scope.teachingLanguage) : known.length <= 1
}
export function annualCycleIdentityKey(programId: string, year: string, intake: string, scope: CycleTrackScope = {}): string {
  const legacy = `${programId}|${year}|${intake}`
  return scope.teachingLanguage || scope.applicationRound
    ? `${legacy}|${scope.teachingLanguage ?? ''}|${scope.applicationRound ? normalizeScopeText(scope.applicationRound) : ''}` : legacy
}
