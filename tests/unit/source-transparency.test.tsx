import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SourceTransparency } from '@/components/features/SourceTransparency'
import { launchLocales } from '@/i18n/config'
import { getMessages } from '@/i18n/messages'

const CHINESE_NOTICE = '信息由自动化系统收录并定期更新；申请条件、费用与截止日期以学校或奖学金官方网站实际情况为准。'

describe('SourceTransparency', () => {
  it('keeps complete source-transparency copy in every launch locale', () => {
    for (const locale of launchLocales) {
      const common = getMessages(locale).common
      expect(common.automatedCollectionNotice.trim()).not.toBe('')
      expect(common.sourcesLastChecked.trim()).not.toBe('')
      expect(common.reportInformationError.trim()).not.toBe('')
    }

    expect(getMessages('zh').common.automatedCollectionNotice).toBe(CHINESE_NOTICE)
  })

  it('renders a semantic check date, disclaimer, official link, and localized correction link', () => {
    const common = getMessages('zh').common
    const { container } = render(
      <SourceTransparency
        locale="zh"
        lastCheckedAt="2026-07-20"
        lastCheckedLabel={common.sourcesLastChecked}
        notice={common.automatedCollectionNotice}
        reportErrorLabel={common.reportInformationError}
        officialLink={{ href: 'https://example.edu.cn/program', label: common.officialSource }}
      />,
    )

    expect(screen.getByRole('note')).toHaveTextContent(CHINESE_NOTICE)
    expect(screen.getByText(common.sourcesLastChecked)).toBeVisible()
    expect(container.querySelector('time')).toHaveAttribute('datetime', '2026-07-20')
    expect(screen.getByRole('link', { name: common.officialSource })).toHaveAttribute(
      'href',
      'https://example.edu.cn/program',
    )
    expect(screen.getByRole('link', { name: common.reportInformationError })).toHaveAttribute(
      'href',
      '/zh/contact',
    )
  })
})
