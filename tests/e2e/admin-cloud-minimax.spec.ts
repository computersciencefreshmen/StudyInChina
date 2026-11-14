import { test, expect } from '@playwright/test'
import { adminSnapshot } from '../fixtures/admin-workbench'
import { cloudSnapshot, CLOUD_NOW } from '../fixtures/cloud-minimax'

test('administrator cloud monitor stays readable on this viewport without a desktop executor, including failed-refresh aging', async ({ page }, testInfo) => {
  const snapshot = adminSnapshot()
  snapshot.generatedAt = new Date(CLOUD_NOW).toISOString()
  snapshot.cloudMiniMax = cloudSnapshot()
  snapshot.telemetry = { source: 'unavailable', observedAt: null, stale: true }
  snapshot.capabilities.localMonitoring = false
  snapshot.capabilities.startVerification = false
  snapshot.capabilities.automationControl = false
  snapshot.automation = null
  await page.clock.install({ time: new Date(CLOUD_NOW) })
  await page.route('**/api/admin/session', route => route.fulfill({ json: { configured: true, authenticated: true, expiresAt: new Date(CLOUD_NOW + 8 * 3600000).toISOString() } }))
  await page.route('**/api/admin/status', route => route.fulfill({ json: snapshot }))
  await page.route('**/api/admin/events', route => route.fulfill({ status: 503, body: 'test-only unavailable stream' }))
  await page.goto('/admin')
  const panel = page.getByRole('region', { name: '云端 MiniMax' })
  await expect(panel.getByText('云端账本已连接')).toBeVisible()
  await expect(panel.getByText('72%')).toBeVisible()
  await expect(panel.getByText('∞', { exact: true })).toBeVisible()
  await expect(panel.getByText('今日实际尝试').locator('..')).toContainText('3')
  await expect(panel.getByText(/积分余额未由此接口提供/)).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  const quotaCards = panel.locator('article')
  for (const card of await quotaCards.all()) {
    const bounds = await card.boundingBox()
    expect(bounds!.width).toBeGreaterThan(100)
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual((await page.evaluate(() => innerWidth)) + 1)
  }
  await page.getByRole('button', { name: 'Token 用量', exact: true }).click()
  await expect(panel.getByRole('table')).toContainText('MiniMax-M3.1-Flash')
  await panel.getByText('最近云端调用与任务').click()
  await expect(panel.getByText(/结果未知 · model_outcome_unknown/)).toBeVisible()
  await testInfo.attach('cloud-minimax-panel', { body: await panel.screenshot(), contentType: 'image/png' })
  // Browser time keeps advancing while the server returns only the old snapshot.
  await page.clock.fastForward(135_000)
  await expect(panel.getByText('账本缓存 · 待更新')).toBeVisible()
  await expect(panel.getByText(/历史观测 · 已过期或读取失败/)).toBeVisible()
})
