/** Shared pure scope rules for cloud extraction, import and applicant display. */
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
