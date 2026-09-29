import { expect, test } from '@playwright/test'
import sources from '../../content/data/sources.json'
import cities from '../../content/data/cities.json'
import universities from '../../content/data/universities.json'
import programs from '../../content/data/programs.json'
import scholarships from '../../content/data/scholarships.json'
import admissionCycles from '../../content/data/admission-cycles.json'
import { bundleSchema } from '../../src/lib/data/schema'
import { selectPublishedData } from '../../src/lib/data/publication'
import { getTodayDate } from '../../src/lib/data/freshness'
import { LATEST_RELEASE_ANNOUNCEMENT_ID, RELEASE_ANNOUNCEMENT_STORAGE_KEY } from '../../src/i18n/release-announcement'

const data = selectPublishedData(bundleSchema.parse({
  sources, cities, universities, programs, scholarships, admissionCycles,
}), getTodayDate())

for (const collection of ['universities', 'programs', 'scholarships'] as const) {
  test(`${collection} detail separates evidence review from application deadlines`, async ({ page }) => {
    await page.addInitScript(({ key, id }) => localStorage.setItem(key, id), {
      key: RELEASE_ANNOUNCEMENT_STORAGE_KEY, id: LATEST_RELEASE_ANNOUNCEMENT_ID,
    })
    const record = data[collection].find(item => item.status === 'verified') ?? data[collection][0]
    expect(record).toBeDefined()
    const response = await page.goto(`/zh/${collection}/${record.slug}`, { waitUntil: 'networkidle' })
    expect(response?.status()).toBe(200)
    // Date-sensitive details must never reuse yesterday's static HTML.
    expect(response?.headers()['cache-control']).toContain('no-store')
    const panel = page.getByRole('region', { name: '信息来源与时效' })
    await expect(panel).toBeVisible()
    await expect(panel.getByText('记录核验日期').first()).toBeVisible()
    await expect(panel.getByText('下次复核日期').first()).toBeVisible()
    await expect(panel.getByText(/并非申请截止日期/)).toBeVisible()
    const evidenceLink = panel.getByRole('link', { name: /查看官方证据/ })
    await expect(evidenceLink).toHaveAttribute('href', '#official-evidence')
    await evidenceLink.click()
    await expect(page.locator('#official-evidence')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  })
}
