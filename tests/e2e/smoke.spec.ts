import { expect, test } from '@playwright/test'
import { mockMapTiles } from './map-fixture'

test.beforeEach(async ({ page }) => { await mockMapTiles(page) })
import { TODAY, currentData, directoryData, rawData } from './catalog-fixture'
import { getApplicationState, selectAdmissionCycle } from '../../src/lib/data/admission'
import { isCurrentVerifiedRecord } from '../../src/lib/data/freshness'
import { getProgramDisplayDetails } from '../../src/lib/data/program-details'
import { scholarshipAppliesToProgram } from '../../src/lib/data/scholarship-scope'
import {
  getReleaseAnnouncement,
  LATEST_RELEASE_ANNOUNCEMENT_ID,
  RELEASE_ANNOUNCEMENT_STORAGE_KEY,
} from '../../src/i18n/release-announcement'
import { isIndexableProgram } from '../../src/lib/seo/indexability'

const locales = ['en', 'zh', 'ru', 'de', 'fr', 'es'] as const
const coreRoutes = ['', 'universities', 'programs', 'scholarships', 'cities', 'guides'] as const
const releaseAnnouncementTestTitle = 'new catalogue releases announce data and product changes once'
const publicData = directoryData
const groundedProgramFixture = currentData.programs
  .flatMap((program) => {
    const cycle = selectAdmissionCycle(currentData.admissionCycles, program.id, TODAY)
    const details = getProgramDisplayDetails(program)
    return cycle && details && details.curriculumHighlights.length && details.eligibility.length && details.applicationMaterials.length
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

  const dialog = page.getByRole('dialog', { name: getReleaseAnnouncement('zh').copy.title })
  await expect(dialog).toBeVisible()
  await expect(page.getByRole('button', { name: '关闭更新' })).toBeFocused()
  await expect(dialog.getByText(publicData.universities.length.toLocaleString('en-US'), { exact: true })).toBeVisible()
  await expect(dialog.getByText(publicData.programs.length.toLocaleString('en-US'), { exact: true })).toBeVisible()
  await expect(dialog.getByText(publicData.scholarships.length.toLocaleString('en-US'), { exact: true })).toBeVisible()
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
      if (['universities', 'programs', 'scholarships'].includes(route)) {
        // Large nested filter forms must remain in normal flow above their results.
        const filters = page.getByRole('search')
        await expect(filters).toHaveCSS('display', 'block')
        await expect(filters).toHaveCSS('position', 'static')
      }
    }
  })
}

test('the public root opens English while explicit locale routes remain available', async ({ browser }) => {
  const context = await browser.newContext({
    locale: 'zh-CN',
    extraHTTPHeaders: { 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' },
  })
  const page = await context.newPage()

  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page).toHaveURL(/\/en\/?$/)
  await page.goto('/zh', { waitUntil: 'domcontentloaded' })
  await expect(page).toHaveURL(/\/zh\/?$/)
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh')

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

  const header = page.getByRole('banner')
  await expect(header).toHaveCount(1)
  const visibleProgramLink = header.locator('a[href="/en/programs"]:visible')
  if (await visibleProgramLink.count() === 0) {
    await header.locator('details.atlas-site-header__mobile-menu > summary').click()
  }
  await expect(visibleProgramLink).toHaveCount(1)
  await visibleProgramLink.click()

  await expect(page).toHaveURL(/\/en\/programs\/?$/)
  await expect(page.getByRole('search')).toBeVisible()
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
  // Server-rendered links are visible before the client router has hydrated.
  await expect(page.locator('#program-degree')).toBeEnabled()
  await tuitionFilter.click()
  await expect.poll(() => new URL(page.url()).searchParams.get('degree')).toBe('master')
  await expect.poll(() => new URL(page.url()).searchParams.has('tuition')).toBe(false)

  await page.goBack({ waitUntil: 'domcontentloaded' })
  await expect.poll(() => new URL(page.url()).searchParams.get('tuition')).toBe('known')
})

test('the program catalogue exposes linked scholarships as a shareable evidence relationship', async ({ page }) => {
  const eligiblePrograms = publicData.programs.filter(program => publicData.scholarships.some(scholarship => (
    isCurrentVerifiedRecord(scholarship, TODAY) && scholarshipAppliesToProgram(scholarship, program)
  )))
  await page.goto('/en/programs?scholarship=linked', { waitUntil: 'domcontentloaded' })

  await expect(page.locator('#program-scholarship')).toHaveAttribute('value', 'linked')
  await expect(page.getByRole('link', { name: /Remove filter: Scholarships/ })).toBeVisible()
  await expect(page.locator('.record-card')).toHaveCount(Math.min(24, eligiblePrograms.length))
  if (eligiblePrograms.length) {
    const eligibleSlugs = new Set(eligiblePrograms.map(program => program.slug))
    for (const link of await page.locator('.record-card a[href^="/en/programs/"]').all()) {
      const href = await link.getAttribute('href')
      expect(eligibleSlugs.has(href!.slice('/en/programs/'.length)), href ?? '').toBe(true)
    }
  } else {
    await expect(page.getByText('No programs match these filters.', { exact: true })).toBeVisible()
  }
  expect(new URL(page.url()).searchParams.get('scholarship')).toBe('linked')
  await page.getByRole('link', { name: /Remove filter: Scholarships/ }).click()
  await expect.poll(() => new URL(page.url()).searchParams.has('scholarship')).toBe(false)
  await expect(page.locator('.record-card').first()).toBeVisible()
})

test('an accepted thin program stays reachable but is excluded from search indexing', async ({ page }) => {
  const program = publicData.programs.find(program => !getProgramDisplayDetails(program) && !isIndexableProgram(program, publicData.admissionCycles, TODAY))!
  expect(program, 'the fixture must be a real accepted directory identity').toBeDefined()
  const response = await page.goto(`/en/programs/${program.slug}`, { waitUntil: 'domcontentloaded' })

  expect(response?.ok()).toBe(true)
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/i)
})

test('a stale program identity remains reachable while expired dynamic facts are withheld', async ({ page }) => {
  const program = publicData.programs.find(program => program.status === 'stale')!
  expect(program, 'only a genuinely accepted stale identity may remain routable').toBeDefined()
  const response = await page.goto(`/en/programs/${program.slug}`, { waitUntil: 'domcontentloaded' })

  expect(response?.ok()).toBe(true)
  await expect(page.getByRole('heading', { level: 1 })).toContainText(program.name.en!)
  await expect(page.getByText(/Needs review/).first()).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Curriculum highlights', exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Eligibility', exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Application materials', exact: true })).toHaveCount(0)
  await expect(page.getByText('Opening soon', { exact: true })).toHaveCount(0)
  for (const cycle of rawData.admissionCycles.filter(cycle => cycle.programId === program.id && cycle.closesOn)) {
    await expect(page.locator(`[data-program-detail] time[datetime="${cycle.closesOn}"]`)).toHaveCount(0)
  }
  await expect(page.getByRole('link', { name: /Official source/ }).first()).toHaveAttribute('href', program.programUrl)
  await expect(page.getByRole('link', { name: /Apply on official site/ })).toHaveCount(0)
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/i)
})

test('a current program exposes its grounded detail fragments and a state-aware official route', async ({ page }) => {
  expect(groundedProgramFixture, 'at least one current programme has proven detail fragments').toBeDefined()
  if (!groundedProgramFixture) return

  const { program, cycle, applicationState } = groundedProgramFixture
  expect(program.name.en, program.id).toBeTruthy()
  const response = await page.goto(`/en/programs/${program.slug}`, { waitUntil: 'domcontentloaded' })

  expect(response?.ok()).toBe(true)
  await expect(page.getByRole('heading', { level: 1 })).toContainText(program.name.en ?? '')
  await expect(page.getByRole('heading', { name: 'Curriculum highlights', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Eligibility', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Application materials', exact: true })).toBeVisible()
  if (isIndexableProgram(program, publicData.admissionCycles, TODAY)) {
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0)
  } else {
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/i)
  }
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

test('scholarship deadline claims follow current evidence and never claim applications are open', async ({ page }) => {
  const scholarship = publicData.scholarships.find(item => (
    isCurrentVerifiedRecord(item, TODAY) && item.deadline && item.deadline > TODAY && item.applicationUrl
  )) ?? publicData.scholarships.find(item => item.status === 'stale')
  expect(scholarship, 'a current future scholarship or retained stale identity must be public').toBeDefined()
  if (!scholarship) return
  const response = await page.goto(`/en/scholarships/${scholarship.slug}`, { waitUntil: 'domcontentloaded' })

  expect(response?.ok()).toBe(true)
  await expect(page.getByRole('link', { name: /Apply on official site/ })).toHaveCount(0)
  if (isCurrentVerifiedRecord(scholarship, TODAY)) {
    await expect(page.getByText('Deadline ahead', { exact: true }).first()).toBeVisible()
    await expect(page.locator(`time[datetime="${scholarship.deadline}"]`).first()).toBeVisible()
    const officialRoute = page.getByRole('link', { name: /Official application route/ }).first()
    await expect(officialRoute).toHaveClass(/atlas-button--secondary/)
    await expect(officialRoute).toHaveAttribute('href', scholarship.applicationUrl!)
  } else {
    await expect(page.getByText('Needs review', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Deadline ahead', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('link', { name: /Official application route/ })).toHaveCount(0)
    const original = rawData.scholarships.find(item => item.id === scholarship.id)!
    if (original.deadline) await expect(page.locator(`time[datetime="${original.deadline}"]`)).toHaveCount(0)
    await expect(page.getByRole('link', { name: /Official source/ }).first()).toHaveAttribute('href', /^https:\/\//)
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/i)
  }
})

test('a draft program detail is not publicly routable', async ({ page }) => {
  const program = rawData.programs.find(program => program.status === 'draft')!
  expect(program).toBeDefined()
  const response = await page.goto(`/en/programs/${program.slug}`, { waitUntil: 'domcontentloaded' })

  expect(response?.status()).toBe(404)
  await expect(page.locator('main')).toBeVisible()
})

test('an unaccepted stale program identity is not revived by the directory', async ({ page }) => {
  const program = rawData.programs.find(program => program.status === 'stale' && !publicData.programs.some(accepted => accepted.id === program.id))!
  expect(program).toBeDefined()
  const response = await page.goto(`/en/programs/${program.slug}`, { waitUntil: 'domcontentloaded' })
  expect(response?.status()).toBe(404)
  await expect(page.locator('main')).toBeVisible()
})

test('unknown localized paths return a real 404 response', async ({ page }) => {
  const response = await page.goto('/en/this-page-does-not-exist', { waitUntil: 'domcontentloaded' })

  expect(response?.status()).toBe(404)
  await expect(page.locator('main')).toBeVisible()
})
