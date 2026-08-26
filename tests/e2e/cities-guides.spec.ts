import { expect, test } from '@playwright/test'

import {
  LATEST_RELEASE_ANNOUNCEMENT_ID,
  RELEASE_ANNOUNCEMENT_STORAGE_KEY,
} from '../../src/i18n/release-announcement'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ key, id }) => {
    window.localStorage.setItem(key, id)
  }, {
    key: RELEASE_ANNOUNCEMENT_STORAGE_KEY,
    id: LATEST_RELEASE_ANNOUNCEMENT_ID,
  })
})

test('city explorer switches views and narrows the directory without leaving the page', async ({ page }) => {
  await page.goto('/en/cities', { waitUntil: 'domcontentloaded' })
  if (test.info().project.name === 'mobile') {
    await expect(page.getByRole('button', { name: 'Directory' })).toHaveAttribute('aria-pressed', 'true')
  }

  const directoryButton = page.getByRole('button', { name: 'Directory' })
  await expect(directoryButton).toBeVisible()
  await directoryButton.click()
  await expect(directoryButton).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.city-directory a').first()).toBeVisible()

  await page.getByRole('button', { name: /South China/ }).click()
  await page.getByLabel('Sort').selectOption('name')
  await page.getByLabel('Search cities').fill('Guangzhou')
  await expect.poll(() => new URL(page.url()).searchParams.get('view')).toBe('directory')
  await expect.poll(() => new URL(page.url()).searchParams.get('region')).toBe('south')
  await expect.poll(() => new URL(page.url()).searchParams.get('sort')).toBe('name')
  await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('Guangzhou')
  await expect(page.locator('.city-directory a')).toHaveCount(1)
  await expect(page.locator('.city-directory a').first()).toHaveAttribute('href', '/en/cities/guangzhou')

  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('button', { name: 'Directory' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: /South China/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByLabel('Sort')).toHaveValue('name')
  await expect(page.getByLabel('Search cities')).toHaveValue('Guangzhou')
  await expect(page.locator('.city-directory a')).toHaveCount(1)

  await page.goBack({ waitUntil: 'domcontentloaded' })
  await expect.poll(() => new URL(page.url()).searchParams.get('sort')).toBeNull()
  await expect(page.getByLabel('Sort')).toHaveValue('universities')
  await page.goForward({ waitUntil: 'domcontentloaded' })
  await expect.poll(() => new URL(page.url()).searchParams.get('sort')).toBe('name')
  await expect(page.getByLabel('Sort')).toHaveValue('name')
})

test('a shared city URL is rendered with useful state before hydration', async ({ page }) => {
  await page.goto('/zh/cities?view=directory&region=south&sort=name&q=%E5%B9%BF%E5%B7%9E', {
    waitUntil: 'domcontentloaded',
  })

  await expect(page.getByRole('button', { name: '城市目录' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: /华南/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByLabel('排序')).toHaveValue('name')
  await expect(page.getByLabel('搜索城市')).toHaveValue('广州')
  await expect(page.locator('.city-directory a')).toHaveCount(1)
})

test('flagship guide exposes a keyboard table of contents, official sources and FAQ schema', async ({ page }) => {
  await page.goto('/en/guides/visa-and-arrival', { waitUntil: 'domcontentloaded' })

  const contents = page.getByRole('navigation', { name: 'On this page' })
  await expect(contents).toBeVisible()
  await contents.getByRole('link', { name: /Understand the X1/ }).click()
  await expect(page).toHaveURL(/#understand-x1-and-x2$/)
  await expect(page.locator('#understand-x1-and-x2')).toBeVisible()

  await expect(page.getByRole('heading', { name: 'Official sources' })).toBeVisible()
  const officialLinks = page.locator('.guide-sources a[href^="https://"]')
  expect(await officialLinks.count()).toBeGreaterThanOrEqual(4)
  await expect(page.getByRole('heading', { name: 'Frequently asked questions' })).toBeVisible()
  await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(2)
})
