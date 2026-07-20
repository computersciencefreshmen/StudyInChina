import { expect, test } from '@playwright/test'

const locales = ['en', 'zh', 'ru', 'de', 'fr', 'es'] as const
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

test('preview locales redirect to the equivalent English route without publishing incomplete pages', async ({ page }) => {
  const response = await page.goto('/pt/programs?degree=master', { waitUntil: 'domcontentloaded' })

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

test('the homepage exposes disciplines backed by the public program catalogue', async ({ page }) => {
  await page.goto('/en', { waitUntil: 'domcontentloaded' })

  await expect(page.getByTestId('program-publication-note')).toHaveCount(0)
  expect(await page.locator('a[href^="/en/programs?discipline="]').count()).toBeGreaterThan(0)
})

test('the public program catalogue excludes draft templates', async ({ page }) => {
  await page.goto('/en/programs', { waitUntil: 'domcontentloaded' })
  const search = page.locator('#program-search')

  await expect(search).toBeVisible()
  await expect(page.getByTestId('program-publication-note')).toHaveCount(0)
  expect(await page.locator('.record-card').count()).toBeGreaterThan(0)
  await search.fill('Tsinghua University Computer Science and Technology')
  await expect(page.locator('.record-card')).toHaveCount(0)
})

test('a verified program page exposes complete facts, official sources and application route', async ({ page }) => {
  const response = await page.goto('/en/programs/fudan-university-2026-autumn-chinese-language-program', { waitUntil: 'domcontentloaded' })

  expect(response?.ok()).toBe(true)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('2026 Autumn Chinese Language Program')
  await expect(page.getByRole('heading', { name: 'Curriculum highlights' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Eligibility' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Application materials' })).toBeVisible()
  await expect(page.getByRole('link', { name: /View official application portal/ })).toHaveAttribute('href', /istudent\.fudan\.edu\.cn/)
  await expect(page.getByRole('link', { name: /Fudan University Chinese Language Program/ })).toHaveAttribute('href', /fudan\.edu\.cn/)
})

test('a multi-cycle program promotes the next upcoming intake', async ({ page }) => {
  const response = await page.goto('/en/programs/shanghai-jiao-tong-university-chinese-language-program-language', { waitUntil: 'domcontentloaded' })

  expect(response?.ok()).toBe(true)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Long-term Chinese Language Course')
  await expect(page.getByText('Opening soon', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Dec 15, 2026', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: /View official application portal/ })).toHaveAttribute('href', /applychinese\.sjtu\.edu\.cn/)
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
