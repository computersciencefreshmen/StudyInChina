import { describe, expect, it } from 'vitest'
import { cvSuggestions, matchOpportunity, shortlist, type MatchOpportunity } from '@/lib/student-matching'
import { feedbackRequestSchema } from '@/lib/feedback/schema'

const url = 'https://admissions.example.edu/2027'
const fact = <T>(value: T) => ({ value, url })
const row: MatchOpportunity = { id: 'p1', slug: 'arts', cycleId: 'p1-2027-autumn', name: 'Arts', university: 'A',
  year: '2027', track: 'English', round: 'regular', budget: fact(24000), intake: fact('2027-autumn'),
  education: fact(["Applicants must hold a bachelor's degree."]), language: fact(['English']), languageConditions: null }
const profile = { education: 'bachelor', budget: '24000', intake: '2027-autumn', language: 'English' }

describe('evidence-bound profile matching', () => {
  it('explains matches from the exact published opportunity and compares a confirmed annual budget inclusively', () => {
    expect(matchOpportunity(profile, row)).toHaveLength(4)
    expect(matchOpportunity(profile, row).every(r => r.state === 'met' && r.url === url)).toBe(true)
    expect(matchOpportunity({ ...profile, budget: '23999' }, row).find(r => r.key === 'budget')?.state).toBe('conflict')
    expect(matchOpportunity({ ...profile, intake: '2027-spring' }, row).find(r => r.key === 'intake')?.state).toBe('conflict')
  })
  it('keeps missing cost and conditional eligibility unknown, and ranks unique programmes across multiple intakes', () => {
    const conditional = { ...row, budget: null, education: fact(["A bachelor's degree or equivalent work experience."]) }
    expect(matchOpportunity(profile, conditional).filter(r => r.state === 'unknown').map(r => r.key)).toEqual(['education', 'budget'])
    const incompatible = { ...row, id: 'p2', cycleId: 'p2-2027', language: fact(['Chinese']) }
    expect(shortlist(profile, [conditional, row, incompatible]).map(result => result.row)).toEqual([row])
    expect(shortlist(profile, [conditional, row, incompatible], true).map(result => result.row)).toEqual([incompatible])
  })
  it('proposes only explicitly labeled CV facts and ignores unstructured scores, email and salary', () => {
    expect(cvSuggestions('Highest completed degree: Bachelor\nPreferred teaching language: Chinese\nSalary CNY 60000')).toEqual({ education: 'bachelor', language: 'Chinese' })
    expect(cvSuggestions('I advised a PhD candidate. IELTS 6.5. Person@example.com')).toEqual({})
  })
  it('recognizes completed credentials within ordinary English and Chinese education entries', () => {
    expect(cvSuggestions('EDUCATION\nB.Eng., Mechanical Engineering, Example University\nGraduated June 2024', 2026)).toEqual({ education: 'bachelor' })
    expect(cvSuggestions('教育背景：\n2019.09–2023.06 示例大学 信息工程 本科\n2025–至今 示例大学 硕士在读', 2026)).toEqual({ education: 'bachelor' })
    expect(cvSuggestions("Academic Qualifications\nBachelor of Science | 2015–2019\nMaster’s in Biology | awarded July 2022", 2026)).toEqual({ education: 'master' })
    expect(cvSuggestions('Education\nMSc Data Science\nExpected graduation, 2027\nBSc Mathematics | Awarded 2024', 2026)).toEqual({ education: 'bachelor' })
  })
  it('leaves unfinished, unbound, conflicting and future credentials unfilled', () => {
    for (const text of [
      'Highest degree: PhD candidate (expected 2028)', '最高学历：硕士在读',
      'Education\nPhD in Biology\nExpected December 2026', '教育背景\n2019年至2023年 示例大学 学士 肄业',
      'Education\nMSc Statistics | Graduated 2029', 'Education\nMSc Statistics | did not graduate, 2019–2024',
      'Education\nGPA 3.9\nResearch Experience\nAdvised PhD students 2019–2023',
      'Career Objective\nSeeking MBA admission\nExpected 2028', 'Education\nMBA or PhD | awarded 2024',
      'Highest degree: Master\n最高学历：本科',
    ]) expect(cvSuggestions(text, 2026)).toEqual({})
  })
  it('program inquiries require explicit consent, the real record context and a reply email', () => {
    const inquiry = { category: 'program-inquiry', message: 'Which materials do I need?', pageUrl: 'https://example.test/en/contact',
      replyEmail: 'student@example.com', consent: true, recordId: row.id, turnstileToken: 'test' }
    expect(feedbackRequestSchema.safeParse(inquiry).success).toBe(true)
    for (const change of [{ consent: false }, { recordId: undefined }, { replyEmail: undefined }])
      expect(feedbackRequestSchema.safeParse({ ...inquiry, ...change }).success).toBe(false)
  })
})
