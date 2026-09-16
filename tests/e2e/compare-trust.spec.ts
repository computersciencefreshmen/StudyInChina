import { expect, test } from '@playwright/test'
import programs from '../../content/data/programs.json'
import { FAVORITES_KEY } from '../../src/lib/favorites'
import { LATEST_RELEASE_ANNOUNCEMENT_ID, RELEASE_ANNOUNCEMENT_STORAGE_KEY } from '../../src/i18n/release-announcement'

test('saved programs compare review dates and retain direct official evidence', async ({ page }) => {
  const ids = [
    programs.find(p => p.id.includes('hit') && p.id.includes('winter'))!.id,
    programs.find(p => p.id.includes('xmu-long-term-chinese-language-spring-2027'))!.id,
  ]
  await page.addInitScript(({ key, ids, announcementKey, announcementId }) => {
    localStorage.setItem(key, JSON.stringify(ids))
    localStorage.setItem(announcementKey, announcementId)
  }, { key: FAVORITES_KEY, ids, announcementKey: RELEASE_ANNOUNCEMENT_STORAGE_KEY, announcementId: LATEST_RELEASE_ANNOUNCEMENT_ID })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/zh/favorites', { waitUntil: 'networkidle' })
  const checkboxes = page.getByRole('checkbox')
  await expect(checkboxes).toHaveCount(2)
  await checkboxes.nth(0).check()
  await checkboxes.nth(1).check()
  const comparison = page.locator('.compare-grid')
  await expect(comparison).toBeVisible()
  await expect(comparison.getByText('下次复核日期', { exact: true })).toHaveCount(2)
  await expect(comparison.getByRole('link', { name: /官方来源/ })).toHaveCount(2)
  for (const link of await comparison.getByRole('link', { name: /官方来源/ }).all()) {
    await expect(link).toHaveAttribute('href', /^https:\/\//)
  }
  // Wait for the restored UI; background analytics need not become idle.
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('checkbox')).toHaveCount(2)
  expect(errors).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
})
