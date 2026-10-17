import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ProgramCard } from '@/components/features/RecordCards'
import { getMessages } from '@/i18n/messages'
import { formatProgramDuration, hasConfirmedProgramDuration, programIsoDuration } from '@/lib/data/duration'
import { programSchema } from '@/lib/data/schema'
import type { Program } from '@/lib/data/types'

const program: Program = {
  id: 'official-language', slug: 'official-language', universityId: 'university',
  name: { en: 'Chinese Language Programme' }, degreeLevel: 'language', discipline: 'chinese-education',
  teachingLanguages: ['Chinese'], durationMonths: null, durationText: { en: '16 weeks', zh: '16周' },
  programUrl: 'https://example.edu/program', applyUrl: 'https://example.edu/apply',
  languageRequirements: [{ test: 'other', minimum: 'Beginners accepted' }], verificationScope: 'complete',
  status: 'verified', verifiedAt: '2026-10-17', reviewAfter: '2026-11-16', sourceIds: ['official'],
  details: {
    faculty: { en: 'Language Centre' }, overview: { en: 'Chinese study' }, qualification: { en: 'Certificate' },
    studyMode: 'full-time', languagePolicy: { en: 'Chinese' }, curriculumHighlights: [{ en: 'Reading' }, { en: 'Writing' }],
    eligibility: [{ en: 'High school graduate' }], applicationMaterials: [{ en: 'Passport' }, { en: 'Diploma' }],
  },
}

describe('official programme duration wording', () => {
  it('retains 16 weeks through the complete programme schema with unknown months', () => {
    expect(programSchema.parse(program)).toMatchObject({ durationMonths: null, durationText: { en: '16 weeks' } })
    expect(hasConfirmedProgramDuration(program)).toBe(true)
    expect(formatProgramDuration(program, 'en', 'months')).toBe('16 weeks')
    expect(formatProgramDuration(program, 'zh', '个月')).toBe('16周')
    expect(programIsoDuration(program)).toBeUndefined()
  })

  it('retains two semesters exactly and falls back to an available official language', () => {
    const semesters = { ...program, durationText: { en: '2 semesters' } }
    expect(formatProgramDuration(semesters, 'fr', 'mois')).toBe('2 semesters')
    expect(semesters.durationMonths).toBeNull()
    expect(programIsoDuration(semesters)).toBeUndefined()
  })

  it('accepts a Chinese-only official semester statement and retains it in other locales', () => {
    const semesters = { ...program, durationText: { zh: '2学期' } }
    expect(programSchema.parse(semesters).durationText).toEqual({ zh: '2学期' })
    expect(formatProgramDuration(semesters, 'en', 'months')).toBe('2学期')
    expect(formatProgramDuration(semesters, 'zh', '个月')).toBe('2学期')
    expect(programIsoDuration(semesters)).toBeUndefined()
  })

  it('keeps legacy exact months and ranges unchanged', () => {
    const months = { ...program, durationText: undefined, durationMonths: 24 }
    expect(formatProgramDuration(months, 'en', 'months')).toBe('24 months')
    expect(programIsoDuration(months)).toBe('P24M')
    const range = { ...months, durationMonthsMax: 36 }
    expect(formatProgramDuration(range, 'en', 'months')).toBe('24–36 months')
    expect(programIsoDuration(range)).toBeUndefined()
  })

  it('rejects missing or blank complete duration rather than displaying null months', () => {
    const unknown = { ...program, durationText: undefined }
    expect(hasConfirmedProgramDuration(unknown)).toBe(false)
    expect(formatProgramDuration(unknown, 'en', 'months')).toBeNull()
    expect(programSchema.safeParse(unknown).success).toBe(false)
    expect(programSchema.safeParse({ ...program, durationText: { en: '   ' } }).success).toBe(false)
  })

  it('renders exact weeks in programme cards while monthly metadata remains unknown', () => {
    render(<ProgramCard program={{ ...program, fieldMeta: {
      durationMonths: { status: 'officially_not_announced', officialUrl: program.programUrl, sourceTitle: 'Official', checkedAt: '2026-10-17' },
      durationText: { status: 'known', officialUrl: program.programUrl, sourceTitle: 'Official', checkedAt: '2026-10-17' },
    } }} locale="en" messages={getMessages('en')} today="2026-10-17" />)
    expect(screen.getByText('16 weeks')).toBeVisible()
    expect(screen.queryByText(/null months|4 months|PnullM/)).not.toBeInTheDocument()
  })
})
