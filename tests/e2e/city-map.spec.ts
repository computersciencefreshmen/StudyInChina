import { expect, test } from '@playwright/test'
import { mockMapTiles } from './map-fixture'
import { LATEST_RELEASE_ANNOUNCEMENT_ID, RELEASE_ANNOUNCEMENT_STORAGE_KEY } from '../../src/i18n/release-announcement'

test.beforeEach(async ({ page }) => {
  await mockMapTiles(page)
  await page.addInitScript(({ key, id }) => localStorage.setItem(key, id), { key: RELEASE_ANNOUNCEMENT_STORAGE_KEY, id: LATEST_RELEASE_ANNOUNCEMENT_ID })
})

test('map and city list select the same location, zoom and retain provider attribution', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/en/cities?view=map', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('.city-map-pin').first()).toBeVisible()
  expect(await page.locator('.city-map-pin').count()).toBeGreaterThan(10)
  await page.locator('.city-map-results button').filter({ hasText: 'Beijing' }).click()
  const detail = page.locator('.city-map-detail')
  await expect(detail.getByRole('heading', { name: 'Beijing', exact: true })).toBeVisible()
  await expect(page.locator('.city-map-pin.is-selected')).toHaveCount(1)
  await expect(detail.getByRole('link', { name: 'Open Google Maps' })).toHaveAttribute('href', /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/)
  const tile = page.locator('.leaflet-tile').first()
  const oldSource = await tile.getAttribute('src')
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await expect.poll(async () => page.locator('.leaflet-tile').first().getAttribute('src')).not.toBe(oldSource)
  await page.getByRole('button', { name: 'Show all results' }).click()
  await expect(page.locator('.city-map-canvas__attribution').getByRole('link', { name: /OpenStreetMap/ })).toBeVisible()
  await page.getByLabel('Search cities').fill('Shanghai')
  await expect(page.locator('.city-map-results li')).toHaveCount(1)
  await expect(page.locator('.city-map-pin')).toHaveCount(1)
  await page.locator('.city-map-pin').click()
  await expect(detail.getByRole('heading', { name: 'Shanghai', exact: true })).toBeVisible()
  expect(errors).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
})

test('tile failures keep the city list and selected guide usable', async ({ page }) => {
  await page.route('https://tile.openstreetmap.org/**', route => route.abort())
  await page.goto('/en/cities?view=map&q=Beijing', { waitUntil: 'domcontentloaded' })
  await expect(page.getByText('The basemap is unavailable. City markers and the list remain usable.')).toBeVisible()
  await page.locator('.city-map-results button').click()
  await expect(page.getByRole('link', { name: /Explore city & universities/ })).toHaveAttribute('href', '/en/cities/beijing')
})
