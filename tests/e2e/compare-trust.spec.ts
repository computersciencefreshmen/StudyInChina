import { expect, test } from '@playwright/test'
import { directoryData } from './catalog-fixture'
import { localize } from '../../src/lib/data/format'
import { FAVORITES_KEY } from '../../src/lib/favorites'
import { LATEST_RELEASE_ANNOUNCEMENT_ID, RELEASE_ANNOUNCEMENT_STORAGE_KEY } from '../../src/i18n/release-announcement'

test('saved programs compare review dates and retain direct official evidence', async ({ page }) => {
  const retained = directoryData.programs.find(program => program.status === 'stale')!
  const current = directoryData.programs.find(program => program.status === 'verified')!
  expect(retained, 'comparison must include a genuinely accepted expired identity').toBeDefined()
  expect(current, 'comparison must retain a current programme alongside it').toBeDefined()
  const ids = [retained.id, current.id]
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
  const retainedCard = comparison.getByRole('heading', { name: localize(retained.name, 'zh'), exact: true }).locator('..')
  await expect(retainedCard.getByRole('link', { name: /前往官网申请/ })).toHaveCount(0)
  // Accepted identity does not restore its expired admission dates, fees, or application link.
  const response = await page.request.get(`/api/v1/programs/compare?view=directory&ids=${encodeURIComponent(ids.join(','))}`)
  expect(response.ok()).toBe(true)
  const body = await response.json()
  expect(body.data.missingIds).toEqual([])
  expect(body.data.items.find((item: { program: { id: string } }) => item.program.id === retained.id)).toMatchObject({
    program: { id: retained.id, status: 'stale', durationMonths: null, applyUrl: null }, currentCycle: null,
  })
  await expect(comparison.getByText('下次复核日期', { exact: true })).toHaveCount(2)
  await expect(comparison.getByRole('link', { name: /官方来源/ })).toHaveCount(2)
  for (const link of await comparison.getByRole('link', { name: /官方来源/ }).all()) {
    await expect(link).toHaveAttribute('href', /^https:\/\//)
  }
  // Wait for the restored UI; background analytics need not become idle.
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('checkbox')).toHaveCount(2)
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '[]'), FAVORITES_KEY)).toEqual(ids)
  expect(errors).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
})
