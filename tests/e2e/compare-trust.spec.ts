import { expect, test, type Locator, type Page } from '@playwright/test'
import { currentData, directoryData, rawData, TODAY, readPublicProgramIds } from './catalog-fixture'
import { selectDetailedPublicPrograms } from '../../src/lib/data/public-program-quality'
import { formatProgramDuration } from '../../src/lib/data/duration'
import { selectAdmissionCycle } from '../../src/lib/data/admission'
import { localize } from '../../src/lib/data/format'
import { FAVORITES_KEY } from '../../src/lib/favorites'
import { LATEST_RELEASE_ANNOUNCEMENT_ID, RELEASE_ANNOUNCEMENT_STORAGE_KEY } from '../../src/i18n/release-announcement'

const publicData = selectDetailedPublicPrograms(directoryData, TODAY, rawData)

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

test('saved reviewed programs compare actual current annual evidence and survive reload', async ({ page }) => {
  const programs = publicData.programs.slice(0, 2)
  expect(programs).toHaveLength(2)
  const ids = programs.map(program => program.id)
  await seedFavorites(page, ids)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const loaded = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/programs/compare')
  await page.goto('/zh/favorites', { waitUntil: 'networkidle' })
  const response = await loaded
  expect(response.ok()).toBe(true)
  const body = await response.json()
  expect(body.meta.release.evaluatedForDate).toBe(TODAY)
  expect(body.data.missingIds).toEqual([])
  expect(body.data.items.map((item: { program: { id: string } }) => item.program.id)).toEqual(ids)
  const comparison = await selectComparison(page)
  for (const program of programs) {
    const card = comparison.getByRole('heading', { name: localize(program.name, 'zh'), exact: true }).locator('..')
    await expect(card.getByText('学制', { exact: true }).locator('..').locator('[data-fact-status="known"]'))
      .toHaveText(formatProgramDuration(program, 'zh', '个月')!)
    const item = body.data.items.find((item: { program: { id: string } }) => item.program.id === program.id)
    const cycle = selectAdmissionCycle(publicData.admissionCycles, program.id, TODAY)!
    expect(cycle, program.id).toBeDefined()
    expect(item.currentCycle.id).toBe(cycle.id)
    expect(item.currentCycle.academicYear).toBe(cycle.academicYear)
    expect(item.currentCycle.closesOn).toBe(cycle.closesOn)
    if (cycle.closesOn) await expect(card.locator(`time[datetime="${cycle.closesOn}"]`)).toBeVisible()
  }
  await expectOfficialEvidence(comparison)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('checkbox')).toHaveCount(2)
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '[]'), FAVORITES_KEY)).toEqual(ids)
  expect(errors).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
})

test('real-date APIs and saved comparisons exclude expired identities without leaking their facts', async ({ page }) => {
  const expired = directoryData.programs.filter(program => program.status === 'stale' && program.reviewAfter < TODAY
    && program.durationMonths === null && program.applyUrl === null
    && !directoryData.admissionCycles.some(cycle => cycle.programId === program.id)).slice(0, 2)
  expect(expired, 'use genuinely accepted expired identities as negative evidence').toHaveLength(2)
  const missingIds = expired.map(program => program.id)
  const visibleIds = publicData.programs.slice(0, 2).map(program => program.id)
  expect(visibleIds).toHaveLength(2)
  const ids = [...missingIds, ...visibleIds]
  // No route interception and no browser clock override: exercise the real public gate.
  for (const [view, data] of [['', currentData], ['&view=directory', directoryData]] as const) {
    const availableIds = new Set(selectDetailedPublicPrograms(data, TODAY, rawData).programs.map(program => program.id))
    const expectedMissingIds = ids.filter(id => !availableIds.has(id))
    const expectedVisibleIds = ids.filter(id => availableIds.has(id))
    const response = await page.request.get(`/api/v1/programs/compare?ids=${encodeURIComponent(ids.join(','))}${view}`)
    expect(response.ok()).toBe(true)
    const body = await response.json()
    expect(body.meta.release.evaluatedForDate).toBe(TODAY)
    expect(body.data.missingIds).toEqual(expectedMissingIds)
    expect(body.data.items.map((item: { program: { id: string } }) => item.program.id)).toEqual(expectedVisibleIds)
    for (const program of expired) expect(body.data.items.some((item: { program: { id: string } }) => item.program.id === program.id)).toBe(false)
  }
  expect((await readPublicProgramIds(page.request)).sort())
    .toEqual(publicData.programs.map(program => program.id).sort())
  await seedFavorites(page, ids)
  const loaded = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/programs/compare')
  await page.goto('/zh/favorites', { waitUntil: 'networkidle' })
  const body = await (await loaded).json()
  expect(body.data.missingIds).toEqual(missingIds)
  expect(body.data.items.map((item: { program: { id: string } }) => item.program.id)).toEqual(visibleIds)
  const comparison = await selectComparison(page)
  for (const program of expired) {
    await expect(comparison.getByRole('heading', { name: localize(program.name, 'zh'), exact: true })).toHaveCount(0)
    await expect(comparison.locator(`a[href$="/${program.slug}"]`)).toHaveCount(0)
  }
  await expectOfficialEvidence(comparison)
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '[]'), FAVORITES_KEY)).toEqual(ids)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
})
