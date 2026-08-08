import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ApplicationSummaryCard } from '@/components/features/ApplicationSummaryCard'
import { ProgramCard } from '@/components/features/RecordCards'
import { ScholarshipCard } from '@/components/features/ScholarshipCard'
import { Badge } from '@/components/ui'
import { launchLocales } from '@/i18n/config'
import {
  formatUniversityCoverage,
  getDecisionExperienceCopy,
} from '@/i18n/decision-experience'
import { getMessages } from '@/i18n/messages'
import type { AdmissionCycle, Program, Scholarship } from '@/lib/data/types'

const auditMeta = {
  sourceIds: ['source-official'],
  verifiedAt: '2026-08-08',
  reviewAfter: '2026-09-08',
  status: 'verified' as const,
}

const program: Program = {
  ...auditMeta,
  id: 'program-decision-test',
  slug: 'program-decision-test',
  universityId: 'university-decision-test',
  name: { en: 'International Chinese Education', zh: '国际中文教育', ru: 'Международное преподавание китайского языка' },
  degreeLevel: 'master',
  discipline: 'chinese-education',
  teachingLanguages: ['Chinese'],
  durationMonths: 24,
  programUrl: 'https://example.edu.cn/program',
  applyUrl: 'https://apply.example.edu.cn/program',
  languageRequirements: [],
  verificationScope: 'facts',
}

const openCycle: AdmissionCycle = {
  ...auditMeta,
  id: 'cycle-decision-test',
  programId: program.id,
  academicYear: '2026-2027',
  intake: 'autumn',
  opensOn: '2026-01-01',
  closesOn: '2026-09-01',
  dateStatus: 'published',
  tuitionCny: 28000,
  tuitionPeriod: 'academic-year',
  tuitionStatus: 'confirmed',
  applicationFeeCny: 600,
}

const scholarship: Scholarship = {
  ...auditMeta,
  id: 'scholarship-decision-test',
  slug: 'scholarship-decision-test',
  name: { en: 'University Excellence Scholarship', zh: '大学优秀生奖学金', ru: 'Стипендия за отличную успеваемость' },
  providerType: 'university',
  universityIds: ['university-one', 'university-two'],
  programIds: [],
  coverage: {
    tuition: 'full',
    accommodation: 'partial',
    insurance: true,
    stipendCnyPerMonth: 2500,
  },
  deadline: '2026-10-15',
  applicationUrl: 'https://example.edu.cn/scholarship/apply',
  summary: { en: 'Official university funding route.', zh: '学校官方资助渠道。', ru: 'Официальная стипендиальная программа вуза.' },
}

describe('decision experience copy', () => {
  it('keeps the applicant decision labels complete in all six public locales', () => {
    for (const locale of launchLocales) {
      for (const value of Object.values(getDecisionExperienceCopy(locale))) {
        expect(value.trim()).not.toBe('')
      }
    }
  })

  it('localizes university coverage counts instead of showing a bare number', () => {
    expect(formatUniversityCoverage(2, 'zh', '全部')).toBe('2 所高校')
    expect(formatUniversityCoverage(1, 'en', 'All')).toBe('1 university')
    expect(formatUniversityCoverage(3, 'ru', 'Все')).toBe('3 университета')
    expect(formatUniversityCoverage(0, 'fr', 'Toutes')).toBe('Toutes')
  })
})

describe('decision-oriented cards', () => {
  it('shows the official apply CTA only for a verified open or rolling program cycle', () => {
    const { rerender } = render(
      <ProgramCard
        program={program}
        cycle={openCycle}
        locale="en"
        messages={getMessages('en')}
        today="2026-08-08"
      />,
    )

    expect(screen.getByRole('link', { name: /Apply on official site/ })).toHaveAttribute(
      'href',
      program.applyUrl,
    )
    expect(screen.getByText('Sep 1, 2026').closest('time')).toHaveAttribute(
      'datetime',
      '2026-09-01',
    )

    rerender(
      <ProgramCard
        program={program}
        cycle={{ ...openCycle, opensOn: '2026-09-15', closesOn: '2026-12-01' }}
        locale="en"
        messages={getMessages('en')}
        today="2026-08-08"
      />,
    )

    expect(screen.queryByRole('link', { name: /Apply on official site/ })).not.toBeInTheDocument()
    expect(screen.getByText('Opening soon')).toBeVisible()

    rerender(
      <ProgramCard
        program={program}
        cycle={{
          ...openCycle,
          dateStatus: 'not-announced',
          opensOn: null,
          closesOn: null,
          tuitionStatus: 'reference',
        }}
        locale="en"
        messages={getMessages('en')}
        today="2026-08-08"
      />,
    )
    expect(screen.getAllByText(/Reference amount—confirm with university/)).toHaveLength(2)
  })

  it('puts scholarship deadline and funding first and localizes its university scope', () => {
    const { rerender } = render(
      <ScholarshipCard scholarship={scholarship} locale="zh" messages={getMessages('zh')} today="2026-08-08" />,
    )

    expect(screen.getByText('2 所高校')).toBeVisible()
    expect(screen.getByText('资助重点')).toBeVisible()
    expect(screen.getByText('截止日期未到')).toBeVisible()
    expect(screen.getByRole('link', { name: /官方申请入口/ })).toHaveAttribute(
      'href',
      scholarship.applicationUrl,
    )
    expect(screen.getByRole('link', { name: /官方申请入口/ })).toHaveClass('atlas-button--secondary')

    rerender(
      <ScholarshipCard
        scholarship={{ ...scholarship, deadline: '2026-01-15' }}
        locale="zh"
        messages={getMessages('zh')}
        today="2026-08-08"
      />,
    )
    expect(screen.getByText('截止日期已过')).toBeVisible()
    expect(screen.getByRole('link', { name: /官方申请入口/ })).toHaveClass('atlas-button--secondary')
  })
})

describe('ApplicationSummaryCard', () => {
  it('renders a semantic heading, decision facts, status and official action', () => {
    render(
      <ApplicationSummaryCard
        eyebrow="Master"
        title="Application snapshot"
        status={<Badge tone="jade">Open now</Badge>}
        facts={[
          { label: 'Current cycle', value: '2026-2027' },
          { label: 'Deadline', value: <time dateTime="2026-09-01">September 1, 2026</time> },
        ]}
        notice="Confirm changing facts on the official source."
        actions={<a href="https://example.edu.cn/apply">Apply on official site</a>}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Application snapshot' })).toBeVisible()
    expect(screen.getByText('Open now')).toBeVisible()
    expect(screen.getByText('2026-2027')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Apply on official site' })).toHaveAttribute(
      'href',
      'https://example.edu.cn/apply',
    )
  })
})
