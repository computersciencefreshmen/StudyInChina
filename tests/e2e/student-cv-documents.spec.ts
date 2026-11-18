import { expect, test } from '@playwright/test'
import { join } from 'node:path'
import { LATEST_RELEASE_ANNOUNCEMENT_ID, RELEASE_ANNOUNCEMENT_STORAGE_KEY } from '../../src/i18n/release-announcement'

const fixtureDir = join(process.cwd(), 'tests/fixtures/student-cv')
const privateMarker = 'cv-local-fixture-76ea124a'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ key, id }) => localStorage.setItem(key, id),
    { key: RELEASE_ANNOUNCEMENT_STORAGE_KEY, id: LATEST_RELEASE_ANNOUNCEMENT_ID })
  await page.goto('/en/match', { waitUntil: 'domcontentloaded' })
  const form = page.locator('form').filter({ has: page.locator('input[type=file]') })
  const budget = form.getByLabel('Annual tuition budget (CNY)')
  const confirm = form.getByRole('button', { name: 'Confirm choices and find programs' })
  // Exercise the hydrated form before selecting a file. Other page requests can still be in flight.
  await expect(async () => {
    await budget.fill('')
    await budget.fill('1')
    await expect(confirm).toBeEnabled({ timeout: 500 })
  }).toPass({ timeout: 15000 })
  await budget.fill('')
  await expect(confirm).toBeDisabled()
})

for (const document of ['text-layer.pdf', 'education-table.docx']) {
  test(`prefills a real ${document} locally and recommends only after confirmation`, async ({ page, context }) => {
    const file = page.locator('input[type=file]'), form = page.locator('form').filter({ has: file })
    const recommendations = page.locator('main h2 a[href*="/programs/"]')
    const sensitiveRequests: string[] = [], uploads: string[] = []
    context.on('request', request => {
      const payload = request.postDataBuffer(), url = request.url()
      if ([document, privateMarker].some(value => url.includes(value) || payload?.includes(Buffer.from(value))))
        sensitiveRequests.push(request.method() + ' ' + new URL(url).pathname)
      // No endpoint needs a request body for either CV prefill or matching.
      if (!['GET','HEAD','OPTIONS'].includes(request.method())) uploads.push(request.method() + ' ' + new URL(url).pathname)
    })

    await expect(recommendations).toHaveCount(0)
    await file.setInputFiles(join(fixtureDir, document))
    await expect(form.getByLabel('Highest completed qualification')).toHaveValue('bachelor')
    await expect(form.getByLabel('Teaching language')).toHaveValue('English')
    await expect(recommendations).toHaveCount(0)
    await form.getByRole('button', { name: 'Confirm choices and find programs' }).click()
    await expect(recommendations.first()).toBeVisible()
    expect(await recommendations.count()).toBeLessThanOrEqual(5)
    await expect(page.locator('main').getByRole('link', { name: /official source/i }).first()).toBeVisible()
    expect(sensitiveRequests).toEqual([])
    expect(uploads).toEqual([])
  })
}

test('image-only PDF cannot invent profile fields and manual matching remains available', async ({ page }) => {
  const file = page.locator('input[type=file]'), form = page.locator('form').filter({has:file})
  await file.setInputFiles(join(fixtureDir, 'image-only.pdf'))
  await expect(form.getByRole('status')).toContainText(/scanned|text layer|selectable text|readable text/i)
  await expect(form.getByLabel('Highest completed qualification')).toHaveValue('')
  await expect(form.getByLabel('Teaching language')).toHaveValue('')
  await form.getByLabel('Teaching language').selectOption('English')
  await form.getByRole('button', { name: 'Confirm choices and find programs' }).click()
  await expect(page.locator('main h2 a[href*="/programs/"]').first()).toBeVisible()
})

test('old Word format offers a supported conversion path', async ({ page }) => {
  const file = page.locator('input[type=file]'), form = page.locator('form').filter({has:file})
  await file.setInputFiles({ name:'legacy.doc', mimeType:'application/msword',
    buffer:Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]) })
  await expect(form.getByRole('status')).toContainText(/\.docx|Word 2007/i)
  await expect(form.getByLabel('Highest completed qualification')).toHaveValue('')
  await expect(form.getByRole('button', { name:'Confirm choices and find programs' })).toBeDisabled()
})

