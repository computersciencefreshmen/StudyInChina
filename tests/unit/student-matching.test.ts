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
  it('program inquiries require explicit consent, the real record context and a reply email', () => {
    const inquiry = { category: 'program-inquiry', message: 'Which materials do I need?', pageUrl: 'https://example.test/en/contact',
      replyEmail: 'student@example.com', consent: true, recordId: row.id, turnstileToken: 'test' }
    expect(feedbackRequestSchema.safeParse(inquiry).success).toBe(true)
    for (const change of [{ consent: false }, { recordId: undefined }, { replyEmail: undefined }])
      expect(feedbackRequestSchema.safeParse({ ...inquiry, ...change }).success).toBe(false)
  })
})
