import { expect, test } from '@playwright/test'
import {
  LATEST_RELEASE_ANNOUNCEMENT_ID,
  RELEASE_ANNOUNCEMENT_STORAGE_KEY,
} from '../../src/i18n/release-announcement'

const rankingKeys = ['qsRankMax', 'theRankMax', 'usNewsRankMax', 'arwuRankMax'] as const

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ key, id }) => window.localStorage.setItem(key, id), {
    key: RELEASE_ANNOUNCEMENT_STORAGE_KEY,
    id: LATEST_RELEASE_ANNOUNCEMENT_ID,
  })
})

for (const route of ['universities', 'programs', 'scholarships']) {
  test(`${route} submits four ranking filters and preserves removable browser history`, async ({ page }, testInfo) => {
    await page.goto(`/en/${route}`, { waitUntil: 'domcontentloaded' })
    const form = page.getByRole('search')
    for (const key of rankingKeys) {
      const field = form.locator(`[role="combobox"][name="${key}"]`)
      await expect(field).toBeVisible()
      await field.click()
      await page.getByRole('option', { name: 'Top 100', exact: true }).click()
    }
    await form.getByRole('button', { name: 'Apply filters', exact: true }).click()
    await page.waitForURL((url) => rankingKeys.every((key) => url.searchParams.get(key) === '100'))
    expect(await page.locator('.record-card').count()).toBeGreaterThan(0)
    if (route === 'universities') {
      await form.locator('[role="combobox"][name="qsRankMax"]').scrollIntoViewIfNeeded()
      await page.screenshot({ path: `.tmp/ranking-filters-${testInfo.project.name}.png`, fullPage: false })
    }
    const qsChip = page.getByRole('link', { name: /Remove filter: QS world ranking/ })
    await expect(qsChip).toBeVisible()
    await qsChip.click()
    await page.waitForURL((url) => !url.searchParams.has('qsRankMax'))
    for (const key of rankingKeys.slice(1)) expect(new URL(page.url()).searchParams.get(key)).toBe('100')
    await page.goBack({ waitUntil: 'domcontentloaded' })
    for (const key of rankingKeys) await expect(form.locator(`[role="combobox"][name="${key}"]`)).toHaveAttribute('value', '100')
    await expect(qsChip).toBeVisible()
  })
}

test('institution API returns linked evidence for all four combined ranking filters', async ({ request }) => {
  const response = await request.get('/api/v1/institutions?qsRankMax=100&theRankMax=100&usNewsRankMax=100&arwuRankMax=100')
  expect(response.ok()).toBe(true)
  const body = await response.json()
  expect(body.data.length).toBeGreaterThan(0)
  for (const institution of body.data) {
    expect(institution.rankings.map((ranking: { system: string }) => ranking.system).sort())
      .toEqual(['arwu', 'qs', 'the', 'usnews'])
    for (const ranking of institution.rankings) {
      expect(ranking.rankMax).toBeLessThanOrEqual(100)
      expect(ranking.sourceUrl).toMatch(/^https:\/\//)
    }
  }
})
