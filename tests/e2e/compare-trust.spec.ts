import { expect, test, type Locator, type Page } from '@playwright/test'
import { directoryData, rawData, TODAY } from './catalog-fixture'
import { CatalogApiService, releaseFromBundle } from '../../src/lib/catalog-api/service'
import { readIdentityAcceptances } from '../../src/lib/data/identity-acceptance-store'
import { readFieldVerifications } from '../../src/lib/data/field-verification-store'
import { selectDiscoveryData } from '../../src/lib/data/discovery'
import { selectPublishedData } from '../../src/lib/data/publication'
import { formatProgramDuration } from '../../src/lib/data/duration'
import { localize } from '../../src/lib/data/format'
import { FAVORITES_KEY } from '../../src/lib/favorites'
import { LATEST_RELEASE_ANNOUNCEMENT_ID, RELEASE_ANNOUNCEMENT_STORAGE_KEY } from '../../src/i18n/release-announcement'

const FIXTURE_DATE = '2026-10-28'
const identities = readIdentityAcceptances()
const historicalCurrent = selectPublishedData(rawData, FIXTURE_DATE, identities)
const historicalDirectory = selectDiscoveryData(rawData, FIXTURE_DATE, identities, readFieldVerifications())
const historicalService = new CatalogApiService(historicalDirectory,
  releaseFromBundle(historicalDirectory, FIXTURE_DATE, { evaluatedForDate: FIXTURE_DATE }), FIXTURE_DATE)

async function seedFavorites(page: Page, ids: string[]) {
  await page.addInitScript(({ key, ids, announcementKey, announcementId }) => {
    localStorage.setItem(key, JSON.stringify(ids))
    localStorage.setItem(announcementKey, announcementId)
  }, { key: FAVORITES_KEY, ids, announcementKey: RELEASE_ANNOUNCEMENT_STORAGE_KEY, announcementId: LATEST_RELEASE_ANNOUNCEMENT_ID })
}

async function selectComparison(page: Page) {
  const checkboxes = page.getByRole('checkbox')
  await expect(checkboxes).toHaveCount(2)
  await checkboxes.nth(0).check()
  await checkboxes.nth(1).check()
  const comparison = page.locator('.compare-grid')
  await expect(comparison).toBeVisible()
  return comparison
}

async function expectOfficialEvidence(comparison: Locator) {
  await expect(comparison.getByText('下次复核日期', { exact: true })).toHaveCount(2)
  const officialUrls = new Set(rawData.sources.filter(source => source.official).map(source => new URL(source.url).toString()))
  const links = comparison.getByRole('link', { name: /官方来源/ })
  await expect(links).toHaveCount(2)
  for (const link of await links.all()) {
    await expect(link).toHaveAttribute('href', /^https:\/\//)
    expect(officialUrls.has((await link.getAttribute('href'))!)).toBe(true)
  }
}

test('saved programs compare current and expired evidence on the original review day', async ({ page }) => {
  const retained = historicalDirectory.programs.find(program => program.status === 'stale' && program.reviewAfter < FIXTURE_DATE
    && program.durationMonths === null && program.applyUrl === null && !historicalDirectory.admissionCycles.some(cycle => cycle.programId === program.id))!
  const current = historicalCurrent.programs.find(program => formatProgramDuration(program, 'zh', '个月'))!
  expect(retained, 'comparison must include a genuinely accepted expired identity').toBeDefined()
  expect(current, 'comparison must retain a current programme alongside it').toBeDefined()
  const ids = [retained.id, current.id]
  // Freeze only this browser and its controlled API fixture. The production
  // server continues to evaluate real requests using the actual current day.
  await page.clock.setFixedTime(new Date(`${FIXTURE_DATE}T04:00:00Z`))
  await page.route('**/api/v1/programs/compare?**', async route => {
    const params = new URL(route.request().url()).searchParams
    expect(params.get('view')).toBe('directory')
    await route.fulfill({ json: historicalService.comparePrograms(params.get('ids')!.split(',')) })
  })
  await seedFavorites(page, ids)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const loaded = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/programs/compare')
  await page.goto('/zh/favorites', { waitUntil: 'networkidle' })
  const response = await loaded
  expect(response.ok()).toBe(true)
  const body = await response.json()
  const comparison = await selectComparison(page)
  const retainedCard = comparison.getByRole('heading', { name: localize(retained.name, 'zh'), exact: true }).locator('..')
  const currentCard = comparison.getByRole('heading', { name: localize(current.name, 'zh'), exact: true }).locator('..')
  await expect(retainedCard.getByRole('link', { name: /前往官网申请/ })).toHaveCount(0)
  // Accepted identity does not restore its expired admission dates, fees, or application link.
  expect(body.meta.release.evaluatedForDate).toBe(FIXTURE_DATE)
  expect(body.data.missingIds).toEqual([])
  expect(body.data.items.find((item: { program: { id: string } }) => item.program.id === retained.id)).toMatchObject({
    program: { id: retained.id, status: 'stale', durationMonths: null, applyUrl: null }, currentCycle: null,
  })
  expect(body.data.items.find((item: { program: { id: string } }) => item.program.id === current.id)).toMatchObject({
    program: { id: current.id, status: 'verified', reviewAfter: current.reviewAfter },
  })
  await expect(currentCard.getByText('学制', { exact: true }).locator('..').locator('[data-fact-status="known"]'))
    .toHaveText(formatProgramDuration(current, 'zh', '个月')!)
  await expect(retainedCard.getByText('学制', { exact: true }).locator('..').locator('[data-fact-status="stale"]')).toBeVisible()
  await expectOfficialEvidence(comparison)
  // Wait for the restored UI; background analytics need not become idle.
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('checkbox')).toHaveCount(2)
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '[]'), FAVORITES_KEY)).toEqual(ids)
  expect(errors).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
})

test('real-date APIs and saved comparisons keep expired identities without reviving current facts', async ({ page }) => {
  const expired = directoryData.programs.filter(program => program.status === 'stale' && program.reviewAfter < TODAY
    && program.durationMonths === null && program.applyUrl === null && !directoryData.admissionCycles.some(cycle => cycle.programId === program.id)).slice(0, 2)
  expect(expired, 'the real-date directory must retain accepted expired identities').toHaveLength(2)
  const ids = expired.map(program => program.id)
  // No route interception and no browser clock override in this test.
  const currentResponse = await page.request.get(`/api/v1/programs/compare?ids=${encodeURIComponent(ids.join(','))}`)
  expect(currentResponse.ok()).toBe(true)
  const currentBody = await currentResponse.json()
  expect(currentBody.meta.release.evaluatedForDate).toBe(TODAY)
  expect(currentBody.data.items).toEqual([])
  expect(currentBody.data.missingIds).toEqual(ids)

  const listResponse = await page.request.get('/api/v1/programs?limit=1')
  expect(listResponse.ok()).toBe(true)
  const listBody = await listResponse.json()
  // When the whole snapshot is expired this must be empty; future new evidence
  // may legitimately add current programmes without invalidating this contract.
  expect(listBody.data).toHaveLength(Math.min(1, selectPublishedData(rawData, TODAY, identities).programs.length))

  await seedFavorites(page, ids)
  const loaded = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/programs/compare')
  await page.goto('/zh/favorites', { waitUntil: 'networkidle' })
  const directoryResponse = await loaded
  expect(directoryResponse.ok()).toBe(true)
  const body = await directoryResponse.json()
  expect(body.meta.release.evaluatedForDate).toBe(TODAY)
  expect(body.data.missingIds).toEqual([])
  expect(body.data.items.map((item: { program: { id: string } }) => item.program.id)).toEqual(ids)
  for (const item of body.data.items) expect(item).toMatchObject({
    program: { status: 'stale', durationMonths: null, applyUrl: null }, currentCycle: null,
  })
  const comparison = await selectComparison(page)
  await expect(comparison.getByRole('link', { name: /前往官网申请/ })).toHaveCount(0)
  await expect(comparison.locator('[data-fact-status="known"]')).toHaveCount(0)
  await expectOfficialEvidence(comparison)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
})
