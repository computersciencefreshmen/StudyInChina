import { expect, test } from '@playwright/test'
import admissionCycles from '../../content/data/admission-cycles.json'
import cities from '../../content/data/cities.json'
import programs from '../../content/data/programs.json'
import scholarships from '../../content/data/scholarships.json'
import sources from '../../content/data/sources.json'
import universities from '../../content/data/universities.json'
import { getApplicationState, selectAdmissionCycle } from '../../src/lib/data/admission'
import { getTodayDate } from '../../src/lib/data/freshness'
import { selectPublishedData } from '../../src/lib/data/publication'
import { bundleSchema } from '../../src/lib/data/schema'
import {
  LATEST_RELEASE_ANNOUNCEMENT_ID,
  RELEASE_ANNOUNCEMENT_STORAGE_KEY,
} from '../../src/i18n/release-announcement'
import { isIndexableProgram } from '../../src/lib/seo/indexability'

const locales = ['en', 'zh', 'ru', 'de', 'fr', 'es'] as const
const coreRoutes = ['', 'universities', 'programs', 'scholarships', 'cities', 'guides'] as const
const releaseAnnouncementTestTitle = 'new catalogue releases announce data and product changes once'
const TODAY = getTodayDate()
const publicData = selectPublishedData(bundleSchema.parse({
  admissionCycles,
  cities,
  programs,
  scholarships,
  sources,
  universities,
}), TODAY)
const freshCompleteFixture = publicData.programs
  .flatMap((program) => {
    const cycle = selectAdmissionCycle(publicData.admissionCycles, program.id, TODAY)
    return cycle && isIndexableProgram(program, publicData.admissionCycles, TODAY)
      ? [{ program, cycle, applicationState: getApplicationState(cycle, TODAY) }]
      : []
  })
  .sort((left, right) => {
    const leftAccepting = left.applicationState === 'open' || left.applicationState === 'rolling'
    const rightAccepting = right.applicationState === 'open' || right.applicationState === 'rolling'
    const leftFreshThrough = left.program.reviewAfter.localeCompare(left.cycle.reviewAfter) < 0
      ? left.program.reviewAfter
      : left.cycle.reviewAfter
    const rightFreshThrough = right.program.reviewAfter.localeCompare(right.cycle.reviewAfter) < 0
      ? right.program.reviewAfter
      : right.cycle.reviewAfter
    return Number(leftAccepting) - Number(rightAccepting)
      || rightFreshThrough.localeCompare(leftFreshThrough)
      || left.program.slug.localeCompare(right.program.slug)
  })[0]

test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.title === releaseAnnouncementTestTitle) return
  await page.addInitScript(({ key, id }) => {
    window.localStorage.setItem(key, id)
  }, {
    key: RELEASE_ANNOUNCEMENT_STORAGE_KEY,
    id: LATEST_RELEASE_ANNOUNCEMENT_ID,
  })
})

test(releaseAnnouncementTestTitle, async ({ page }) => {
  await page.goto('/zh', { waitUntil: 'domcontentloaded' })

  const dialog = page.getByRole('dialog', { name: '选择更广，证据更清楚' })
  await expect(dialog).toBeVisible()
  await expect(page.getByRole('button', { name: '关闭更新' })).toBeFocused()
  await expect(dialog.getByText(publicData.universities.length.toLocaleString('en-US'))).toBeVisible()
  await expect(dialog.getByText(publicData.programs.length.toLocaleString('en-US'))).toBeVisible()
  await expect(dialog.getByText(publicData.scholarships.length.toLocaleString('en-US'))).toBeVisible()
  await expect(page.getByRole('link', { name: '查看开放申请项目' }))
    .toHaveAttribute('href', '/zh/programs?applicationState=open')

  await page.getByRole('button', { name: '关闭更新' }).click()
  await expect(dialog).toHaveCount(0)
  await expect.poll(() => page.evaluate(
    (key) => window.localStorage.getItem(key),
    RELEASE_ANNOUNCEMENT_STORAGE_KEY,
  )).toBe(LATEST_RELEASE_ANNOUNCEMENT_ID)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

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
  await page.goto('/en', { waitUntil: 'networkidle' })

  const skipLink = page.locator('.atlas-skip-link')
  await expect(skipLink).toHaveCount(1)
  await page.evaluate(() => {
    document.body.tabIndex = -1
    document.body.focus()
    document.body.removeAttribute('tabindex')
  })
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

test('a stale program identity remains reachable while expired dynamic facts are withheld', async ({ page }) => {
  const response = await page.goto('/en/programs/shanghai-jiao-tong-university-chinese-language-program-language', { waitUntil: 'domcontentloaded' })

  expect(response?.ok()).toBe(true)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Long-term Chinese Language Course')
  await expect(page.getByText(/Needs review/).first()).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Curriculum highlights', exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Eligibility', exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Application materials', exact: true })).toHaveCount(0)
  await expect(page.getByText('Opening soon', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Dec 15, 2026', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('link', { name: /Official source/ }).first()).toHaveAttribute('href', /ichinese\.sjtu\.edu\.cn/)
  await expect(page.getByRole('link', { name: /Apply on official site/ })).toHaveCount(0)
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/i)
})

test('a fresh complete program exposes grounded details and a state-aware official route', async ({ page }) => {
  expect(freshCompleteFixture, 'at least one fresh complete program must remain public').toBeDefined()
  if (!freshCompleteFixture) return

  const { program, cycle, applicationState } = freshCompleteFixture
  expect(program.name.en, program.id).toBeTruthy()
  const response = await page.goto(`/en/programs/${program.slug}`, { waitUntil: 'domcontentloaded' })

  expect(response?.ok()).toBe(true)
  await expect(page.getByRole('heading', { level: 1 })).toContainText(program.name.en ?? '')
  await expect(page.getByRole('heading', { name: 'Curriculum highlights', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Eligibility', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Application materials', exact: true })).toBeVisible()
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0)
  await expect(page.getByRole('link', { name: /Official source/ }).first())
    .toHaveAttribute('href', program.programUrl)
  if (cycle.closesOn) {
    await expect(page.locator(`time[datetime="${cycle.closesOn}"]`).first()).toBeVisible()
  }

  if ((applicationState === 'open' || applicationState === 'rolling') && program.applyUrl) {
    await expect(page.getByRole('link', { name: /Apply on official site/ }).first())
      .toHaveAttribute('href', program.applyUrl)
  } else {
    await expect(page.getByRole('link', { name: /Apply on official site/ })).toHaveCount(0)
  }
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
