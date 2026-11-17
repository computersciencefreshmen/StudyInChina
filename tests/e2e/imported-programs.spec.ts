import { expect, test } from '@playwright/test'
import { LATEST_RELEASE_ANNOUNCEMENT_ID, RELEASE_ANNOUNCEMENT_STORAGE_KEY } from '../../src/i18n/release-announcement'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ key, id }) => localStorage.setItem(key, id), {
    key: RELEASE_ANNOUNCEMENT_STORAGE_KEY, id: LATEST_RELEASE_ANNOUNCEMENT_ID,
  })
})

test('captured imports show source facts, work on mobile and remain distinct from source links', async ({ page, request }) => {
  const response = await request.get('/api/v1/imported-programs')
  expect(response.ok()).toBe(true)
  const result = await response.json()
  expect(result.items.length).toBeGreaterThan(0)
  expect(result.items.length).toBeLessThanOrEqual(40)
  expect(result.items.every((item: { status: string; official: boolean }) => item.status === 'extracted' && item.official === false)).toBe(true)

  await page.goto('/zh/programs/imported', { waitUntil: 'networkidle' })
  await expect(page.getByRole('heading', { name: '第三方项目目录', exact: true })).toBeVisible()
  await expect(page.getByTestId('imported-program-card')).toHaveCount(result.items.length)
  await expect(page.getByTestId('imported-program-card').first()).toContainText(result.items[0].fields.duration)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)

  await page.getByRole('link', { name: '查看已采集详情', exact: false }).first().click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(result.items[0].name)
  await expect(page.getByRole('heading', { name: '申请要求', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '申请材料', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: '查看来源页面', exact: false })).toHaveAttribute('href', result.items[0].sourceUrl)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)

  await page.goto('/zh/programs/imported?view=links&provider=sicas', { waitUntil: 'networkidle' })
  const cards = page.getByTestId('imported-program-card')
  expect(await cards.count()).toBeGreaterThan(0)
  expect(await cards.count()).toBeLessThanOrEqual(40)
  await expect(cards.first()).toContainText('招生年份未知')
  await expect(cards.first().getByRole('link', { name: '查看已采集详情', exact: false })).toHaveCount(0)
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
  const sourceLinks = await request.get('/api/v1/imported-programs?view=links&provider=sicas')
  const sourceResult = await sourceLinks.json()
  const linkId = sourceResult.items[0].id
  expect((await request.get(`/api/v1/imported-programs/${linkId}`)).status()).toBe(404)
  expect((await request.get(`/en/programs/imported/${linkId}`)).status()).toBe(404)
})

test('source directory search filters on the server and rejects invalid API pages', async ({ page, request }) => {
  await page.goto('/en/programs/imported?view=links', { waitUntil: 'networkidle' })
  await page.getByRole('searchbox').fill('Peking')
  await page.getByRole('button', { name: 'Filter programs', exact: true }).click()
  await page.waitForURL(/query=Peking/)
  const cards = page.getByTestId('imported-program-card')
  expect(await cards.count()).toBeGreaterThan(0)
  for (const card of await cards.all()) await expect(card).toContainText(/Peking/i)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  expect((await request.get('/api/v1/imported-programs?page=-1')).status()).toBe(400)
  expect((await request.get('/api/v1/imported-programs?view=verified')).status()).toBe(400)
})
