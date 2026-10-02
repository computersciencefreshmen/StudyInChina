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

test('cloud admin controls explain unavailable execution and work on desktop and mobile', async ({ page }) => {
  const snapshot = adminSnapshot()
  snapshot.runs = []
  snapshot.capabilities = { localMonitoring: false, startVerification: false, credentialSource: 'unconfigured', reason: '线上核验执行器未连接。' }
  snapshot.telemetry = { source: 'unavailable', observedAt: null, stale: false }
  let holdRefresh = false
  let completeRefresh = () => {}
  const refreshGate = new Promise<void>(resolve => { completeRefresh = resolve })
  const verificationRequests: string[] = []
  await page.route('**/api/admin/session', route => route.fulfill({ json: route.request().method() === 'DELETE' ? { ok: true } : adminSession }))
  await page.route('**/api/admin/status', async route => {
    if (holdRefresh) await refreshGate
    await route.fulfill({ json: snapshot })
  })
  await page.route('**/api/admin/events', route => route.fulfill({ status: 200, contentType: 'text/event-stream', body: `event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n` }))
  await page.route('**/api/admin/verification', route => { verificationRequests.push(route.request().method()); return route.fulfill({ status: 503, json: { error: 'Unavailable' } }) })
  await page.goto('/admin')
  const nav = page.getByRole('navigation', { name: '管理员导航' })
  for (const label of ['核验任务', '数据目录', 'Token 用量', '工作台']) {
    await nav.getByRole('button', { name: label, exact: true }).click()
    await expect(page.getByRole('heading', { name: label === '工作台' ? '让每一条数据，更可信。' : label, exact: true })).toBeVisible()
  }
  const connection = page.getByRole('button', { name: '核验连接说明' })
  await connection.click()
  const explanation = page.getByRole('dialog', { name: '核验连接说明' })
  await expect(explanation).toBeVisible()
  await expect(page.getByRole('button', { name: '关闭连接说明' })).toBeFocused()
  await page.getByRole('button', { name: '关闭连接说明' }).press('Shift+Tab')
  await expect(page.getByRole('button', { name: '知道了' })).toBeFocused()
  await page.getByRole('button', { name: '知道了' }).press('Escape')
  await expect(explanation).toHaveCount(0)
  await expect(connection).toBeFocused()
  await nav.getByRole('button', { name: 'Token 用量' }).click()
  const usage = page.getByRole('heading', { name: '用量总览' }).locator('..').locator('..').locator('..')
  await expect(usage.locator('dl dd')).toHaveText(['—', '—', '—', '—', '—', '—'])
  await expect(usage).toContainText('采集时间：未连接')
  holdRefresh = true
  await page.getByRole('button', { name: '同步最新数据' }).click()
  await expect(page.getByRole('button', { name: '正在同步数据' })).toBeDisabled()
  await expect(page.getByRole('status')).toHaveText('正在同步最新数据…')
  completeRefresh()
  holdRefresh = false
  await expect(page.getByRole('status')).toContainText('已同步最新数据')
  await expect(page.getByRole('heading', { name: 'Token 用量', exact: true })).toBeVisible()
  await nav.getByRole('button', { name: '数据目录' }).click()
  for (const [label, path] of [['高校', 'universities'], ['专业', 'programs'], ['奖学金', 'scholarships'], ['城市', 'cities']]) {
    await expect(page.getByRole('link', { name: `查看${label}` })).toHaveAttribute('href', `/zh/${path}`)
  }
  await page.getByRole('link', { name: '查看高校' }).click()
  await expect(page).toHaveURL(/\/zh\/universities$/)
  await page.goBack()
  await page.getByRole('button', { name: '管理员账户' }).click()
  const account = page.getByRole('region', { name: '账户设置' })
  await account.getByRole('combobox', { name: '界面主题' }).click()
  await page.getByRole('option', { name: '深夜墨绿' }).click()
  await expect(account).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'night')
  await page.reload()
  await expect(page.getByRole('button', { name: '管理员账户' })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'night')
  await page.getByRole('button', { name: '管理员账户' }).click()
  await page.getByRole('region', { name: '账户设置' }).getByRole('button', { name: '退出登录' }).click()
  await expect(page.getByLabel('管理员访问口令')).toBeVisible()
  expect(verificationRequests).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('remote telemetry displays saved response totals and freshness without local execution', async ({ page }) => {
  const snapshot = adminSnapshot()
  snapshot.capabilities = { localMonitoring: false, startVerification: false, credentialSource: 'unconfigured', reason: null }
  snapshot.telemetry = { source: 'remote', observedAt: '2026-09-30T09:00:00Z', stale: true }
  Object.assign(snapshot.usage, { inputTokens: 1234567, outputTokens: 8910, totalTokens: 1243477, cacheReadTokens: 456, cacheWriteTokens: 78, requests: 150 })
  snapshot.runs[0].tokenUsage = { ...snapshot.usage }
  await page.route('**/api/admin/session', route => route.fulfill({ json: adminSession }))
  await page.route('**/api/admin/status', route => route.fulfill({ json: snapshot }))
  await page.route('**/api/admin/events', route => route.fulfill({ status: 200, contentType: 'text/event-stream', body: `event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n` }))
  await page.goto('/admin')
  await page.getByRole('navigation', { name: '管理员导航' }).getByRole('button', { name: 'Token 用量' }).click()
  const usage = page.getByRole('heading', { name: '用量总览' }).locator('..').locator('..').locator('..')
  await expect(usage.locator('dl dd')).toHaveText(['1,234,567', '8,910', '456', '78', '1,243,477', '150'])
  await expect(usage).toContainText('执行器同步记录 · 记录待更新')
  await expect(usage).toContainText('采集时间：9/30 17:00')
  await expect(page.getByText('150 次已保存响应')).toBeVisible()
  const switcher = page.getByRole('group', { name: '管理员五主题切换' })
  await expect(switcher.getByRole('button')).toHaveCount(5)
  for (const [id, name] of themes) {
    const choice = switcher.getByRole('button', { name: new RegExp(name) })
    await choice.click()
    await expect(choice).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('html')).toHaveAttribute('data-theme', id)
    await expect(usage.locator('dl dd')).toHaveText(['1,234,567', '8,910', '456', '78', '1,243,477', '150'])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
  await page.getByRole('button', { name: '核验连接说明' }).click()
  await expect(page.getByRole('dialog')).toContainText('当前执行器暂时无法接受新任务')
})
