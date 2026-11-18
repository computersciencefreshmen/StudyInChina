export type StudentProfile = { education: string; language: string; budget: string; intake: string }
export type MatchSignal<T> = { value: T; url: string } | null
export type MatchOpportunity = {
  id: string; slug: string; cycleId: string; name: string; university: string; year: string; track: string; round: string
  education: MatchSignal<string[]>; language: MatchSignal<string[]>; budget: MatchSignal<number>; intake: MatchSignal<string>
  languageConditions: MatchSignal<string[]>
}
export type MatchReason = { key: keyof StudentProfile; state: 'met' | 'conflict' | 'unknown'; url?: string }

/** Match only explicit academic credentials. A free-text exception or another requirement needs individual review. */
function requiredEducation(clauses: string[]): string | null {
  if (clauses.length !== 1) return null
  const text = clauses[0].trim().toLowerCase().replace(/[.’。]/g, c => c === '’' ? "'" : '')
  const patterns: Record<string, RegExp> = {
    secondary: /^(?:(?:applicants? must (?:hold|have) |a )?(?:a )?high school diploma(?: is required)?|高中毕业(?:证书)?|高中毕业生)$/,
    bachelor: /^(?:(?:applicants? must (?:hold|have) |a )?(?:a )?bachelor'?s degree(?: is required)?|须具有学士学位|学士学位)$/,
    master: /^(?:(?:applicants? must (?:hold|have) |a )?(?:a )?master'?s degree(?: is required)?|须具有硕士学位|硕士学位)$/,
  }
  return Object.entries(patterns).find(([, pattern]) => pattern.test(text))?.[0] ?? null
}

export function matchOpportunity(profile: StudentProfile, row: MatchOpportunity): MatchReason[] {
  const reasons: MatchReason[] = []
  const add = (key: keyof StudentProfile, matched: boolean | null) => {
    if (profile[key]) reasons.push({ key, state: matched === null ? 'unknown' : matched ? 'met' : 'conflict', url: row[key]?.url })
  }
  const prerequisite = row.education && requiredEducation(row.education.value)
  // A higher credential alone does not prove which specific prior credentials the applicant holds.
  add('education', !prerequisite ? null : prerequisite === profile.education ? true :
    ['secondary', 'bachelor', 'master', 'doctorate'].indexOf(profile.education) < ['secondary', 'bachelor', 'master'].indexOf(prerequisite) ? false : null)
  add('language', row.language ? row.language.value.includes(profile.language) : null)
  add('budget', !row.budget || !/^\d{1,9}$/.test(profile.budget) ? null : row.budget.value <= Number(profile.budget))
  add('intake', row.intake ? row.intake.value === profile.intake : null)
  return reasons
}

export function shortlist(profile: StudentProfile, rows: MatchOpportunity[], includeConflicts = false) {
  const ranked = rows.map(row => ({ row, reasons: matchOpportunity(profile, row) }))
    .filter(({ reasons }) => reasons.length && (includeConflicts ? reasons.some(reason => reason.state === 'conflict') :
      !reasons.some(reason => reason.state === 'conflict') && reasons.some(reason => reason.state === 'met')))
    .sort((a, b) => b.reasons.filter(r => r.state === 'met').length - a.reasons.filter(r => r.state === 'met').length
      || a.row.name.localeCompare(b.row.name) || a.row.cycleId.localeCompare(b.row.cycleId))
  const selected = new Set<string>()
  return ranked.filter(({ row }) => {
    if (selected.has(row.id)) return false
    selected.add(row.id)
    return true
  }).slice(0, 5)
}

/** Suggestions only. Do not infer a target language from an exam or a maximum budget from arbitrary salary numbers. */
export function cvSuggestions(text: string): Partial<StudentProfile> {
  const fields: Partial<StudentProfile> = {}
  const degree = text.match(/(?:highest (?:completed )?(?:degree|qualification)|最高(?:学历|学位))\s*[:：]\s*(doctorate|phd|master(?:'s)?|bachelor(?:'s)?|high school|博士|硕士|本科|学士|高中)/iu)?.[1]?.toLowerCase()
  if (degree) fields.education = /phd|doctorate|博士/.test(degree) ? 'doctorate' : /master|硕士/.test(degree) ? 'master' : /bachelor|本科|学士/.test(degree) ? 'bachelor' : 'secondary'
  const language = text.match(/(?:preferred teaching language|意向授课语言)\s*[:：]\s*(english|chinese|英语|中文|汉语)/iu)?.[1]?.toLowerCase()
  if (language) fields.language = language === 'english' || language === '英语' ? 'English' : 'Chinese'
  return fields
}
