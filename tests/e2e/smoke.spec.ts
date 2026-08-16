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
      const header = page.locator('header.atlas-site-header')
      await expect(header).toHaveCount(1)
      await expect(header).toBeVisible()
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

test('the skip link moves keyboard focus into the main content', async ({ page }) => {
  await page.goto('/en', { waitUntil: 'domcontentloaded' })

  const skipLink = page.locator('.atlas-skip-link')
  await expect(skipLink).toHaveCount(1)
  await page.keyboard.press('Tab')
  await expect(skipLink).toBeFocused()
  await page.keyboard.press('Enter')

  await expect(page).toHaveURL(/#main-content$/)
  await expect(page.locator('main#main-content')).toBeFocused()
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
  await search.fill('Tsinghua University Business Administration')
  await search.press('Enter')
  await page.waitForURL(/q=Tsinghua\+University\+Business\+Administration/)
  await expect(page.locator('.record-card')).toHaveCount(0)
})

test('catalogue filters remain shareable and removable through browser history', async ({ page }) => {
  await page.goto('/en/programs?degree=master&tuition=known', { waitUntil: 'domcontentloaded' })

  await expect(page.locator('form[role="search"] details')).toHaveAttribute('open', '')
  await expect(page.getByRole('link', { name: /Remove filter: Degree level/ })).toBeVisible()
  const tuitionFilter = page.getByRole('link', { name: /Remove filter: Tuition data/ })
  await expect(tuitionFilter).toBeVisible()
  await Promise.all([
    page.waitForURL((url) => url.searchParams.get('degree') === 'master' && !url.searchParams.has('tuition')),
    tuitionFilter.click(),
  ])

  await expect(page).toHaveURL(/degree=master/)
  expect(new URL(page.url()).searchParams.has('tuition')).toBe(false)
  await page.goBack({ waitUntil: 'domcontentloaded' })
  expect(new URL(page.url()).searchParams.get('tuition')).toBe('known')
})

test('the program catalogue exposes linked scholarships as a shareable evidence relationship', async ({ page }) => {
  await page.goto('/en/programs?scholarship=linked', { waitUntil: 'domcontentloaded' })

  await expect(page.locator('#program-scholarship')).toHaveValue('linked')
  await expect(page.getByRole('link', { name: /Remove filter: Scholarships/ })).toBeVisible()
  expect(await page.locator('.record-card').count()).toBeGreaterThan(0)
  expect(new URL(page.url()).searchParams.get('scholarship')).toBe('linked')
})

test('a thin verified program stays reachable but is excluded from search indexing', async ({ page }) => {
  const response = await page.goto('/en/programs/tsinghua-university-computer-science-bachelor', { waitUntil: 'domcontentloaded' })

  expect(response?.ok()).toBe(true)
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/i)
})

test('a complete program page exposes facts and a conservative official route', async ({ page }) => {
  const response = await page.goto('/en/programs/shanghai-jiao-tong-university-chinese-language-program-language', { waitUntil: 'domcontentloaded' })

  expect(response?.ok()).toBe(true)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Long-term Chinese Language Course')
  await expect(page.getByRole('heading', { name: 'Curriculum highlights' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Eligibility' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Application materials' })).toBeVisible()
  await expect(page.getByRole('link', { name: /Official source/ }).first()).toHaveAttribute('href', /ichinese\.sjtu\.edu\.cn/)
  await expect(page.getByRole('link', { name: /Apply on official site/ })).toHaveCount(0)
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0)
  await expect(page.locator('a[href="https://ichinese.sjtu.edu.cn/en/programs/10/detail"]')).toHaveAttribute('href', /ichinese\.sjtu\.edu\.cn/)
})

test('a multi-cycle program promotes the next upcoming intake', async ({ page }) => {
  const response = await page.goto('/en/programs/shanghai-jiao-tong-university-chinese-language-program-language', { waitUntil: 'domcontentloaded' })

  expect(response?.ok()).toBe(true)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Long-term Chinese Language Course')
  await expect(page.getByText('Opening soon', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Dec 15, 2026', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('link', { name: /Apply on official site/ })).toHaveCount(0)
  await expect(page.getByRole('link', { name: /Official source/ }).first()).toHaveAttribute('href', /ichinese\.sjtu\.edu\.cn/)
})

test('a future scholarship deadline does not claim that applications are already open', async ({ page }) => {
  const response = await page.goto('/en/scholarships/gdufs-iclt-one-semester-2027', { waitUntil: 'domcontentloaded' })

  expect(response?.ok()).toBe(true)
  await expect(page.getByText('Deadline ahead', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('link', { name: /Apply on official site/ })).toHaveCount(0)
  await expect(page.getByRole('link', { name: /Official application route/ }).first())
    .toHaveClass(/atlas-button--secondary/)
})

test('a draft program detail is not publicly routable', async ({ page }) => {
  const response = await page.goto('/en/programs/tsinghua-university-business-administration-master', { waitUntil: 'domcontentloaded' })

  expect(response?.status()).toBe(404)
  await expect(page.locator('main')).toBeVisible()
})

test('unknown localized paths return a real 404 response', async ({ page }) => {
  const response = await page.goto('/en/this-page-does-not-exist', { waitUntil: 'domcontentloaded' })

  expect(response?.status()).toBe(404)
  await expect(page.locator('main')).toBeVisible()
})
