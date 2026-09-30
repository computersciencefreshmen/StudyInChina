import { expect, test } from '@playwright/test'
import { LATEST_RELEASE_ANNOUNCEMENT_ID, RELEASE_ANNOUNCEMENT_STORAGE_KEY } from '../../src/i18n/release-announcement'
import { SITE_NOTIFICATIONS_KEY } from '../../src/lib/site-notifications'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ key, id }) => window.localStorage.setItem(key, id), {
    key: RELEASE_ANNOUNCEMENT_STORAGE_KEY, id: LATEST_RELEASE_ANNOUNCEMENT_ID,
  })
})

test('school and program follow entries save locally without email controls', async ({ page }, testInfo) => {
  let posts = 0
  page.on('request', request => { if (request.method() === 'POST') posts++ })
  await page.route('**/api/notifications', route => route.fulfill({ json: { available: true, observations: [], observedAt: Date.now(), revision: 'empty' } }))
  await page.goto('/zh/universities/tsinghua-university', { waitUntil: 'domcontentloaded' })
  const entry = page.getByRole('region', { name: '关注重要更新' })
  await expect(entry).toBeVisible()
  await entry.getByRole('button', { name: '在网站关注' }).click()
  await expect(entry.getByRole('button', { name: '取消站内关注' })).toHaveAttribute('aria-pressed', 'true')
  expect(await page.evaluate(key => JSON.parse(window.localStorage.getItem(key) || '{}').follows.length, SITE_NOTIFICATIONS_KEY)).toBe(1)
  await expect(entry.getByRole('textbox')).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await entry.screenshot({ path: '.tmp/follow-university-' + testInfo.project.name + '.png' })
  const programHref = await page.locator('main a[href^="/zh/programs/"]').first().getAttribute('href')
  expect(programHref).toBeTruthy()
  await page.goto(programHref!, { waitUntil: 'domcontentloaded' })
  await entry.getByRole('button', { name: '在网站关注' }).click()
  await expect(entry.getByRole('button', { name: '取消站内关注' })).toBeVisible()
  await expect(entry.getByRole('textbox')).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await entry.screenshot({ path: '.tmp/follow-program-' + testInfo.project.name + '.png' })
  expect(posts).toBe(0)
})

test('first visit establishes a baseline and later changes remain readable after reload', async ({ page }, testInfo) => {
  let fingerprint = 'before'
  const observation = { observationKey: 'program:example-program', id: 'example-program', kind: 'program', universityId: 'tsinghua', title: 'Test verified program update', slug: 'example-program', verified: true }
  await page.addInitScript(({ key }) => {
    if (!window.localStorage.getItem(key)) window.localStorage.setItem(key, JSON.stringify({ follows: [{ kind: 'university', id: 'tsinghua', label: '清华大学', followedAt: 0 }], readIds: [] }))
  }, { key: SITE_NOTIFICATIONS_KEY })
  await page.route('**/api/notifications', route => route.fulfill({ json: { available: true, observations: [{ ...observation, fingerprint }], observedAt: Date.now(), revision: fingerprint } }))
  await page.goto('/zh/notifications', { waitUntil: 'domcontentloaded' })
  await expect(page.getByText('暂时没有新的重要更新')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Test verified program update ↗' })).toHaveCount(0)
  await page.getByRole('combobox', { name: '通知汇总频率' }).click()
  await page.getByRole('option', { name: '每日汇总', exact: true }).click()
  expect(await page.evaluate(key => JSON.parse(window.localStorage.getItem(key) || '{}').summaryFrequency, SITE_NOTIFICATIONS_KEY)).toBe('daily')
  fingerprint = 'after'
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('combobox', { name: '通知汇总频率' })).toHaveAttribute('value', 'daily')
  await expect(page.getByRole('link', { name: 'Test verified program update ↗' })).toHaveCount(0)
  await page.getByRole('button', { name: '立即刷新', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Test verified program update ↗' })).toBeVisible()
  await page.getByRole('button', { name: '全部标为已读' }).click()
  await expect(page.getByText('已读', { exact: true })).toBeVisible()
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByText('已读', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '全部标为已读' })).toBeDisabled()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.locator('main').screenshot({ path: '.tmp/notification-center-' + testInfo.project.name + '.png' })
  await page.getByRole('button', { name: '取消关注: 清华大学' }).click()
  await expect(page.getByRole('heading', { name: '还没有站内关注' })).toBeVisible()
})
