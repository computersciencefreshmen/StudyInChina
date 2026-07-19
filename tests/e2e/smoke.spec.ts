import { expect, test } from '@playwright/test'

const locales = ['en', 'zh', 'ru'] as const
const coreRoutes = ['', 'universities', 'programs', 'scholarships', 'cities', 'guides'] as const

for (const locale of locales) {
  test(`${locale} core routes render inside the localized shell`, async ({ page }) => {
    for (const route of coreRoutes) {
      const response = await page.goto(`/${locale}${route ? `/${route}` : ''}`, { waitUntil: 'domcontentloaded' })

      expect(response?.ok(), `${locale}/${route || 'home'} should respond successfully`).toBe(true)
      await expect(page.locator('html')).toHaveAttribute('lang', locale)
      await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
      await expect(page.locator('header.atlas-site-header')).toBeVisible()
      await expect(page.locator('main#main-content')).toBeVisible()
    }
  })
}

test('the root route redirects using the accepted launch language', async ({ browser }) => {
  const context = await browser.newContext({
    locale: 'zh-CN',
    extraHTTPHeaders: { 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' },
  })
  const page = await context.newPage()

  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page).toHaveURL(/\/zh\/?$/)

  await context.close()
})

test('preview locales redirect to the equivalent English route without publishing untranslated pages', async ({ page }) => {
  const response = await page.goto('/es/programs?degree=master', { waitUntil: 'domcontentloaded' })

  expect(response?.ok()).toBe(true)
  await expect(page).toHaveURL(/\/en\/programs\?degree=master$/)
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
})

test('primary navigation opens the program catalogue', async ({ page }) => {
  await page.goto('/en', { waitUntil: 'domcontentloaded' })

  const visibleProgramLink = page.locator('header a[href="/en/programs"]:visible')
  if (await visibleProgramLink.count() === 0) {
    await page.locator('details.atlas-site-header__mobile-menu > summary').click()
  }
  await page.locator('header a[href="/en/programs"]:visible').first().click()

  await expect(page).toHaveURL(/\/en\/programs\/?$/)
  await expect(page.locator('[role="search"]')).toBeVisible()
})

test('the homepage does not publish unverified discipline links', async ({ page }) => {
  await page.goto('/en', { waitUntil: 'domcontentloaded' })

  await expect(page.getByTestId('program-publication-note')).toBeVisible()
  await expect(page.locator('a[href^="/en/programs?discipline="]')).toHaveCount(0)
})

test('the public program catalogue excludes draft templates', async ({ page }) => {
  await page.goto('/en/programs', { waitUntil: 'domcontentloaded' })
  const search = page.locator('#program-search')

  await expect(search).toBeVisible()
  await expect(page.getByTestId('program-publication-note')).toBeVisible()
  await expect(page.locator('.empty-box')).toBeVisible()
  await expect(page.locator('.record-card')).toHaveCount(0)
})

test('a draft program detail is not publicly routable', async ({ page }) => {
  const response = await page.goto('/en/programs/tsinghua-university-computer-science-bachelor', { waitUntil: 'domcontentloaded' })

  expect(response?.status()).toBe(404)
  await expect(page.locator('main')).toBeVisible()
})

test('unknown localized paths return a real 404 response', async ({ page }) => {
  const response = await page.goto('/en/this-page-does-not-exist', { waitUntil: 'domcontentloaded' })

  expect(response?.status()).toBe(404)
  await expect(page.locator('main')).toBeVisible()
})
