import { expect, test } from '@playwright/test'
import { projectPublicMiniMax } from '../../src/lib/minimax/public-monitor'
import { cloudSnapshot, CLOUD_NOW } from '../fixtures/cloud-minimax'

test('password-free monitor shows only safe metrics and fits a phone viewport', async ({ page }) => {
  await page.clock.install({ time: new Date(CLOUD_NOW) })
  const payload = projectPublicMiniMax(cloudSnapshot(), CLOUD_NOW)
  await page.route('**/api/minimax/status', route => route.fulfill({ json: payload }))
  await page.goto('/minimax')
  await expect(page).toHaveURL(/\/minimax$/u)
  await expect(page.getByRole('heading', { name: /MiniMax/u, level: 1 })).toBeVisible()
  await expect(page.getByText('云端账本观测新鲜')).toBeVisible()
  await expect(page.getByText('72%')).toBeVisible()
  await expect(page.getByText('∞', { exact: true })).toBeVisible()
  await expect(page.getByText('今日调用尝试')).toBeVisible()
  await expect(page.getByText('MiniMax-M3.1-Flash', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: /登录|开始|暂停|重试/u })).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/u)
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer')
  await page.unroute('**/api/minimax/status')
})
