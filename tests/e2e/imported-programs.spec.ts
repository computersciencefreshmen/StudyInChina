import { expect, test } from '@playwright/test'
import { LATEST_RELEASE_ANNOUNCEMENT_ID, RELEASE_ANNOUNCEMENT_STORAGE_KEY } from '../../src/i18n/release-announcement'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ key, id }) => localStorage.setItem(key, id), { key: RELEASE_ANNOUNCEMENT_STORAGE_KEY, id: LATEST_RELEASE_ANNOUNCEMENT_ID })
})

test('one Programs catalogue shows collected records, canonical details and source provenance', async ({ page, request }) => {
  const response = await request.get('/api/v1/programs?view=all')
  expect(response.ok()).toBe(true)
  const result = await response.json()
  expect(result.data.length).toBeGreaterThan(0)
  expect(result.data.length).toBeLessThanOrEqual(24)
  // Deadline sorting keeps collected entries after reviewed application dates.
  // The default first page varies as verified school coverage grows.
  const lastPage = await request.get(`/api/v1/programs?view=all&sort=deadline&page=${result.meta.pageCount}&revision=${encodeURIComponent(result.meta.revision)}`)
  expect(lastPage.ok()).toBe(true)
  const collected = await lastPage.json()
  expect(collected.meta.page).toBe(result.meta.pageCount)
  const captured = collected.data.find((item: { status: string }) => item.status === 'source-collected')
  expect(captured).toBeTruthy()
  expect(captured.official).toBe(false)
  expect(captured.admissionYear).toBeNull()
  await page.goto('/zh/programs', { waitUntil: 'networkidle' })
  await expect(page.locator('[data-program-preview]')).toHaveCount(result.data.length)
  await expect(page.getByTestId('imported-program-directory-link')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '第三方项目目录', exact: true })).toHaveCount(0)
  await page.goto(`/zh/programs/${captured.slug}`, { waitUntil: 'networkidle' })
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(captured.name)
  await expect(page.getByRole('link', { name: '来源页面', exact: false }).first()).toHaveAttribute('href', captured.sourceUrl)
  const detailed = (await (await request.get(`/api/v1/programs/${captured.slug}?view=all`)).json()).data
  for (const [label, key] of [['申请要求', 'requirements'], ['申请材料', 'materials']]) {
    const heading = page.getByRole('heading', { name: label, exact: true })
    if (detailed.fields[key]) await expect(heading).toBeVisible()
    else await expect(heading).toHaveCount(0)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  await page.goto(`/zh/programs/imported/${captured.id}`, { waitUntil: 'networkidle' })
  await expect(page).toHaveURL(new RegExp(`/zh/programs/${captured.slug}$`))
  const links = (await (await request.get('/api/v1/imported-programs?view=links&provider=sicas')).json()).items
  expect((await request.get(`/en/programs/${links[0].id}`)).status()).toBe(404)
  expect((await request.get(`/en/programs/imported/${links[0].id}`)).status()).toBe(404)
})

test('canonical search, 24-row pagination and legacy filter aliases stay in normal Programs', async ({ page, request }) => {
  const result = await (await request.get('/api/v1/programs?view=all')).json()
  expect(result.meta.total).toBeGreaterThan(result.data.length)
  const second = await (await request.get(`/api/v1/programs?view=all&page=2&revision=${encodeURIComponent(result.meta.revision)}`)).json()
  expect(second.meta.page).toBe(2)
  const firstIDs = new Set(result.data.map((item: { id: string }) => item.id))
  expect(second.data.every((item: { id: string }) => !firstIDs.has(item.id))).toBe(true)
  await page.goto('/en/programs/imported?query=Business', { waitUntil: 'networkidle' })
  await expect(page).toHaveURL(/\/en\/programs\?q=Business/)
  const cards = page.locator('[data-program-preview]')
  expect(await cards.count()).toBeGreaterThan(0)
  // Reviewed records also match discipline keywords, even when their visible title is Chinese.
  const searched = (await (await request.get('/api/v1/programs?view=all&q=Business')).json()).data
  await expect(cards).toHaveCount(searched.length)
  const detailPaths = await cards.locator('a[href^="/en/programs/"]').evaluateAll(links => links.map(link => link.getAttribute('href')))
  expect(detailPaths).toEqual(searched.map((item: { slug: string }) => `/en/programs/${encodeURIComponent(item.slug)}`))
  for (const card of await page.locator('[data-program-preview][data-source-status="source-collected"]').all()) await expect(card).toContainText(/Business/i)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  expect((await request.get('/api/v1/imported-programs?page=-1')).status()).toBe(400)
  expect((await request.get('/api/v1/imported-programs?view=verified')).status()).toBe(400)
})
