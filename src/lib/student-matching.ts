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

const educationLevels = [
  ['doctorate', /\b(?:ph\.?\s?d|doctorate|doctoral degree|doctor of philosophy)\b|博士(?!后)/iu],
  ['master', /\b(?:master(?:'s)?(?=\s*(?:$|(?:in|of|degree)\b|[|,;(]))|m\.?\s?(?:sc|eng)|mba|m\.?a\.?\s+in)\b|硕士/iu],
  ['bachelor', /\b(?:bachelor(?:'s)?(?=\s*(?:$|(?:in|of|degree)\b|[|,;(]))|b\.?\s?(?:sc|eng)|b\.?a\.?\s+in)\b|本科|学士/iu],
  ['secondary', /\bhigh school(?: diploma)?\b|高中/iu],
] as const

const educationHeading = /^(?:education(?:al background| and qualifications)?|academic (?:background|qualifications)|教育(?:经历|背景)?|学习经历|学历背景)(?:\s*:\s*|$)/iu
const otherHeading = /^(?:work(?: experience)?|(?:professional|research|teaching|employment|internship) experience|experience|employment(?: history)?|projects?|publications?|skills|languages?|references?|(?:career )?objectives?|awards?|certifications?|工作(?:经历|经验)|实习经历|项目经历|研究经历|获奖情况|技能|语言能力|自我评价|求职意向)(?:\s*:\s*|$)/iu
const explicitEducation = /^(?:highest (?:completed )?(?:degree|qualification)|最高(?:学历|学位))\s*:\s*/iu
const unfinished = /\b(?:expected|anticipated|pursuing|pursue|candidates?|students?|ongoing|present|currently|in progress|incomplete|withdrawn|withdraw|dropped out|dropout|not (?:completed|awarded|graduated)|did(?: not|n't) (?:graduate|complete)|never graduated|no degree|applying|seeking|prerequisites?|requirements?|mentored|advised|supervised)\b|预计|预期|在读|在学|至今|尚未|未(?:取得|获得|毕业|完成)|肄业|退学|申请|拟攻读|导师/iu
const completed = /\b(?:graduated|awarded|conferred|earned|obtained|completed)\b|(?:已毕业|毕业于|获(?:得)?(?:学士|硕士|博士)学位)|毕业(?:$|[\s,(，。])/iu
const dateRange = /\b((?:19|20)\d{2})(?:[./-]\d{1,2})?(?:年(?:\d{1,2}月)?)?\s*(?:[-–—~至]|to)\s*(?:[a-z]{3,9}\.?\s+)?((?:19|20)\d{2})\b/iu

function educationInCV(lines: string[], year: number) {
  let inEducation = false
  const completedLevels = new Set<string>()
  const labelledLevels = new Set<string>()
  for (const [i, raw] of lines.entries()) {
    if (educationHeading.test(raw)) inEducation = true
    if (otherHeading.test(raw)) inEducation = false
    const body = raw.replace(educationHeading, '')
    const labelled = explicitEducation.test(body)
    if (!body || (!labelled && !inEducation)) continue
    const entry = body.replace(explicitEducation, '')
    const found = educationLevels.filter(([, pattern]) => pattern.test(entry))
    if (found.length !== 1) continue
    // A continuation belongs to this entry only when it starts with a date
    // or status. Another degree or section starts a separate entry.
    const next = lines[i + 1] ?? ''
    const nextIsStatus = /^(?:[|(\s]*(?:\d{4}|(?:expected|anticipated|pursuing|in progress|currently|graduated|awarded|earned|completed)\b|(?:在读|预计|毕业|已毕业)))/iu.test(next)
    const detail = nextIsStatus && !educationLevels.some(([, pattern]) => pattern.test(next)) ? entry + ' ' + next : entry
    if (unfinished.test(detail) || [...detail.matchAll(/(?:19|20)\d{2}/gu)].some(match => Number(match[0]) > year)) continue
    const range = detail.match(dateRange)
    const ended = range && Number(range[1]) <= Number(range[2]) && Number(range[2]) < year
    if (labelled) labelledLevels.add(found[0][0])
    else if (completed.test(detail) || ended) completedLevels.add(found[0][0])
  }
  if (labelledLevels.size > 1) return undefined
  if (labelledLevels.size === 1) return labelledLevels.values().next().value
  return educationLevels.find(([level]) => completedLevels.has(level))?.[0]
}

/** Only editable suggestions leave the parser. Exams and salary do not establish study preferences. */
export function cvSuggestions(text: string, year = new Date().getUTCFullYear()): Partial<StudentProfile> {
  text = text.normalize('NFKC').replace(/[’‘]/gu, "'")
  const fields: Partial<StudentProfile> = {}
  const education = educationInCV(text.split(/\r\n|[\r\n\f]/u).map(line => line.trim()), year)
  if (education) fields.education = education
  const language = text.match(/(?:preferred teaching language|意向授课语言)\s*[:：]\s*(english|chinese|英语|中文|汉语)/iu)?.[1]?.toLowerCase()
  if (language) fields.language = language === 'english' || language === '英语' ? 'English' : 'Chinese'
  return fields
}
