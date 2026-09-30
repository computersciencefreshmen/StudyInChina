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

async function openMobileMenu(page: import('@playwright/test').Page, project: string) {
  if (project === 'mobile') await page.locator('.atlas-site-header__mobile-menu > summary').click()
}

test('the user can apply a studio theme, change it in the header, and retain it across reloads', async ({ page }, testInfo) => {
  await page.goto('/themes', { waitUntil: 'networkidle' })
  await page.getByRole('group', { name: '网站主题' }).getByRole('button', { name: /深夜墨绿/ }).click()
  await page.getByRole('button', { name: '使用这个主题' }).click()
  expect(await page.evaluate(() => localStorage.getItem('studycn-theme'))).toBe('night')
  await page.goto('/en/universities', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'night')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'night')
  await openMobileMenu(page, testInfo.project.name)
  const theme = page.getByRole('combobox', { name: 'Theme', exact: true })
  await expect(theme).toHaveAttribute('value', 'night')
  await theme.click()
  await page.getByRole('option', { name: 'Ocean Studio', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'ocean')
  expect(await page.evaluate(() => localStorage.getItem('studycn-theme'))).toBe('ocean')
  await page.goto('/en/programs', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'ocean')
  await page.screenshot({ path: `.tmp/public-theme-ocean-${testInfo.project.name}.png` })
})

test('public headers fit all six languages on desktop and mobile', async ({ page }, testInfo) => {
  for (const locale of ['zh', 'en', 'ru', 'de', 'fr', 'es']) {
    await page.goto(`/${locale}/universities`, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('.atlas-site-header__brand')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    for (const selector of ['.atlas-site-header__brand', '.atlas-site-header__tools', '.atlas-site-header__nav', '.atlas-site-header__mobile-menu > summary']) {
      const element = page.locator(selector)
      if (await element.isVisible()) {
        const rect = await element.boundingBox()
        expect(rect!.x).toBeGreaterThanOrEqual(0)
        expect(rect!.x + rect!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
      }
    }
    if (testInfo.project.name === 'mobile') {
      await openMobileMenu(page, testInfo.project.name)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    }
  }
})
