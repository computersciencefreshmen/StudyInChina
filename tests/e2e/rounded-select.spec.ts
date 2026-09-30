import { expect, test } from '@playwright/test'
import {
  LATEST_RELEASE_ANNOUNCEMENT_ID,
  RELEASE_ANNOUNCEMENT_STORAGE_KEY,
} from '../../src/i18n/release-announcement'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ key, id }) => window.localStorage.setItem(key, id), {
    key: RELEASE_ANNOUNCEMENT_STORAGE_KEY,
    id: LATEST_RELEASE_ANNOUNCEMENT_ID,
  })
})

test('rounded ranking popup fits the viewport and supports keyboard selection', async ({ page }, testInfo) => {
  await page.goto('/en/universities', { waitUntil: 'domcontentloaded' })
  const field = page.getByRole('combobox', { name: 'ShanghaiRanking (ARWU)', exact: true })
  await expect(field).toBeVisible()
  await field.click()
  const popup = page.getByRole('listbox')
  await expect(popup).toBeVisible()
  await expect(popup).toHaveCSS('opacity', '1')
  const corner = await popup.evaluate((element) => parseFloat(window.getComputedStyle(element).borderRadius))
  expect(corner).toBeGreaterThanOrEqual(12)
  const box = await popup.boundingBox()
  expect(box).not.toBeNull()
  const viewport = page.viewportSize()!
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width)
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height)
  await page.screenshot({ path: `.tmp/rounded-dropdown-${testInfo.project.name}.png` })
  await field.press('ArrowDown')
  await field.press('Enter')
  await expect(field).toHaveAttribute('value', '100')
  await expect(popup).toHaveCount(0)
  await expect(field).toBeFocused()
})
