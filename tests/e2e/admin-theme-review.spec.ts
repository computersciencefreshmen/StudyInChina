import { expect, test } from '@playwright/test'
import { adminSession, adminSnapshot } from '../fixtures/admin-workbench'

const themes = [['cloud', '云白淡紫'], ['jade', '雾绿玉色'], ['ocean', '冰川蓝'], ['sand', '暖白陶色'], ['night', '深夜墨绿']] as const

test('five theme previews retain responsive layout, readable dropdown portals, and admin navigation', async ({ page }, testInfo) => {
  if (testInfo.project.name === 'chromium') await page.setViewportSize({ width: 1440, height: 1080 })
  await page.goto('/themes', { waitUntil: 'networkidle' })
  const website = page.getByRole('group', { name: '预览界面' }).getByRole('button', { name: '学生网站' })
  const admin = page.getByRole('group', { name: '预览界面' }).getByRole('button', { name: '管理员工作台' })
  await expect(page.getByRole('group', { name: '网站主题' }).getByRole('button')).toHaveCount(5)
  for (const [id, name] of themes) {
    await website.click()
    await page.getByRole('group', { name: '网站主题' }).getByRole('button', { name: new RegExp(name) }).click()
    const frame = page.locator(`[data-theme="${id}"]`)
    await expect(frame).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await frame.screenshot({ path: `.tmp/theme-${id}-website-${testInfo.project.name}.png` })
    await page.getByRole('combobox', { name: '软科世界大学排名', exact: true }).click()
    const popup = page.getByRole('listbox')
    await expect(popup).toBeVisible()
    await expect(popup).toHaveCSS('opacity', '1')
    const portal = await popup.evaluate(element => {
      const style = getComputedStyle(element)
      const selected = getComputedStyle(element.querySelector('[aria-selected="true"]')!)
      return { background: style.backgroundColor, ink: style.color, selectedInk: selected.color, sourceSurface: style.getPropertyValue('--atlas-paper-bright'), accent: style.getPropertyValue('--atlas-jade') }
    })
    expect(portal.sourceSurface).toBeTruthy()
    expect(portal.accent).toBeTruthy()
    if (id === 'night') {
      expect(portal.background).toBe('rgb(32, 41, 41)')
      expect(portal.ink).toBe('rgb(233, 240, 235)')
      expect(portal.selectedInk).toBe('rgb(176, 224, 187)')
      await page.screenshot({ path: `.tmp/theme-night-menu-${testInfo.project.name}.png` })
    }
    await page.getByRole('combobox', { name: '软科世界大学排名', exact: true }).press('Escape')
    await admin.click()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await expect(page.getByRole('button', { name: '开始核验' })).toBeDisabled()
    if (id === 'cloud') {
      await frame.screenshot({ path: `.tmp/theme-cloud-admin-${testInfo.project.name}.png` })
      const nav = page.getByRole('navigation', { name: '管理员导航' })
      for (const label of ['核验任务', '数据目录', 'Token 用量', '工作台']) {
        await nav.getByRole('button', { name: label, exact: label !== '核验任务' }).click()
        const heading = label === '工作台' ? '让每一条数据，更可信。' : label
        await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
      }
    }
  }
})

test('admin verification modal fits viewport, traps Tab, and keeps portal above the backdrop', async ({ page }, testInfo) => {
  await page.route('**/api/admin/session', route => route.fulfill({ json: adminSession }))
  await page.route('**/api/admin/status', route => route.fulfill({ json: adminSnapshot() }))
  await page.route('**/api/admin/events', route => route.fulfill({ status: 200, contentType: 'text/event-stream', body: `event: snapshot\ndata: ${JSON.stringify(adminSnapshot())}\n\n` }))
  await page.goto('/admin', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '开始核验' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  const rect = await dialog.boundingBox()
  expect(rect!.x).toBeGreaterThanOrEqual(0)
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
  const close = page.getByRole('button', { name: '关闭核验设置' })
  await close.press('Shift+Tab')
  await expect(page.getByRole('button', { name: '创建并开始核验' })).toBeFocused()
  await page.getByRole('button', { name: '创建并开始核验' }).press('Tab')
  await expect(close).toBeFocused()
  const model = page.getByRole('combobox', { name: '模型', exact: true })
  await model.click()
  const popup = page.getByRole('listbox')
  await expect(popup).toHaveCSS('z-index', '1500')
  await page.getByRole('option', { name: 'MiniMax-M3.1-Flash-Preview', exact: true }).click()
  await expect(page.getByRole('combobox', { name: '思考深度' })).toBeEnabled()
  await page.getByRole('combobox', { name: '思考深度' }).click()
  await page.screenshot({ path: `.tmp/admin-modal-${testInfo.project.name}.png` })
  await page.getByRole('combobox', { name: '思考深度' }).press('Escape')
  await expect(dialog).toBeVisible()
  await close.click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('button', { name: '开始核验' })).toBeFocused()
})
