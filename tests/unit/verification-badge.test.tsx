import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VerificationBadge } from '@/components/ui/VerificationBadge'

afterEach(() => { vi.unstubAllEnvs() })

describe('verification dates are calendar dates', () => {
  it.each(['America/Los_Angeles', 'Asia/Shanghai', 'UTC'])('preserves the official date in %s', (timeZone) => {
    vi.stubEnv('TZ', timeZone)
    expect(new Intl.DateTimeFormat('en').resolvedOptions().timeZone).toBe(timeZone)

    render(<VerificationBadge status="verified" verifiedAt="2026-09-28" locale="en" />)

    expect(screen.getByText('Verified · Checked Sep 28, 2026')).toBeVisible()
  })

  it('preserves the date when an unsupported locale falls back to English', () => {
    vi.stubEnv('TZ', 'America/Los_Angeles')
    render(<VerificationBadge status="verified" verifiedAt="2026-09-28" locale="invalid_locale" />)

    expect(screen.getByText('Verified · Checked Sep 28, 2026')).toBeVisible()
  })
})
