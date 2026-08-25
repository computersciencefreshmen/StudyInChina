import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ProgramCard } from '@/components/features/RecordCards'
import { FactValue } from '@/components/ui/FactValue'
import { launchLocales } from '@/i18n/config'
import { getFactStatusMessage } from '@/i18n/fact-status'
import { getMessages } from '@/i18n/messages'
import type { FactStatus, FieldMeta } from '@/lib/catalog-api/types'
import type { AdmissionCycle, Program } from '@/lib/data/types'

const auditMeta = {
  sourceIds: ['source-official'],
  verifiedAt: '2026-08-08',
  reviewAfter: '2026-09-08',
  status: 'verified' as const,
}

const program: Program = {
  ...auditMeta,
  id: 'program-fact-value-test',
  slug: 'program-fact-value-test',
  universityId: 'university-fact-value-test',
  name: { en: 'International Chinese Education', zh: '国际中文教育' },
  degreeLevel: 'master',
  discipline: 'chinese-education',
  teachingLanguages: ['Chinese'],
  durationMonths: 24,
  programUrl: 'https://example.edu.cn/program',
  applyUrl: 'https://apply.example.edu.cn/program',
  languageRequirements: [],
  verificationScope: 'facts',
}

const cycle: AdmissionCycle = {
  ...auditMeta,
  id: 'cycle-fact-value-test',
  programId: program.id,
  academicYear: '2026-2027',
  intake: 'autumn',
  opensOn: '2026-01-01',
  closesOn: '2026-09-01',
  dateStatus: 'published',
  tuitionCny: 28_000,
  tuitionPeriod: 'academic-year',
  tuitionStatus: 'confirmed',
  applicationFeeCny: 600,
}

const statuses: FactStatus[] = [
  'known',
  'officially_not_announced',
  'not_applicable',
  'source_unavailable',
  'conflict',
  'stale',
]

const meta = (status: FactStatus): FieldMeta => ({
  status,
  officialUrl: 'https://example.edu.cn/program',
  sourceTitle: 'Official program page',
  checkedAt: '2026-08-08',
})

describe('FactValue', () => {
  it('provides complete status explanations in all six public locales', () => {
    for (const locale of launchLocales) {
      for (const status of statuses) {
        const message = getFactStatusMessage(locale, status)
        expect(message.label.trim()).not.toBe('')
        expect(message.description.trim()).not.toBe('')
      }
    }
  })

  it('shows a known value and exposes every non-known state without relying on color', () => {
    const { container } = render(<div>
      <FactValue locale="en" status="known" value="24 months" />
      {statuses.filter((status) => status !== 'known').map((status) => (
        <FactValue key={status} locale="en" status={status} />
      ))}
    </div>)

    expect(screen.getByText('24 months')).toHaveAttribute('data-fact-status', 'known')
    for (const status of statuses.filter((item) => item !== 'known')) {
      const element = container.querySelector(`[data-fact-status="${status}"]`)
      expect(element).toBeVisible()
      expect(element).toHaveAttribute('title', getFactStatusMessage('en', status).description)
      expect(element).toHaveTextContent(getFactStatusMessage('en', status).label)
    }
  })
})

describe('ProgramCard fact safety', () => {
  it('renders the four decision facts when their current values are known', () => {
    const { container } = render(<ProgramCard
      program={program}
      cycle={cycle}
      locale="en"
      messages={getMessages('en')}
      today="2026-08-08"
    />)

    expect(container.querySelectorAll('[data-fact-status="known"]')).toHaveLength(4)
    expect(screen.getByText('Sep 1, 2026')).toBeVisible()
    expect(screen.getByText('24 months')).toBeVisible()
  })

  it('does not present reference fees as current tuition or application fee', () => {
    const { container } = render(<ProgramCard
      program={program}
      cycle={{ ...cycle, tuitionStatus: 'reference' }}
      locale="en"
      messages={getMessages('en')}
      today="2026-08-08"
    />)

    expect(container.querySelectorAll('[data-fact-status="officially_not_announced"]')).toHaveLength(2)
    expect(screen.queryByText(/28,000/)).not.toBeInTheDocument()
    expect(screen.queryByText(/600/)).not.toBeInTheDocument()
  })

  it('hides old cycle facts while retaining a fresh program duration', () => {
    const { container } = render(<ProgramCard
      program={program}
      cycle={{ ...cycle, status: 'stale' }}
      locale="en"
      messages={getMessages('en')}
      today="2026-08-08"
    />)

    expect(container.querySelectorAll('[data-fact-status="stale"]')).toHaveLength(3)
    expect(screen.getByText('24 months')).toHaveAttribute('data-fact-status', 'known')
    expect(screen.queryByText('Sep 1, 2026')).not.toBeInTheDocument()
    expect(screen.queryByText(/28,000/)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Apply on official site/ })).not.toBeInTheDocument()
  })

  it('lets future API metadata explain source failures and conflicts without leaking values', () => {
    const apiProgram = {
      ...program,
      fieldMeta: { durationMonths: meta('source_unavailable') },
    }
    const apiCycle = {
      ...cycle,
      fieldMeta: {
        closesOn: meta('conflict'),
        tuitionCny: meta('conflict'),
        applicationFeeCny: meta('known'),
      },
    }
    const { container } = render(<ProgramCard
      program={apiProgram}
      cycle={apiCycle}
      locale="en"
      messages={getMessages('en')}
      today="2026-08-08"
    />)

    expect(container.querySelectorAll('[data-fact-status="conflict"]')).toHaveLength(2)
    expect(container.querySelectorAll('[data-fact-status="source_unavailable"]')).toHaveLength(1)
    expect(screen.queryByText('Sep 1, 2026')).not.toBeInTheDocument()
    expect(screen.queryByText(/28,000/)).not.toBeInTheDocument()
    expect(screen.queryByText('24 months')).not.toBeInTheDocument()
  })
})
