import { expect, test } from '@playwright/test'

type AxeResult = {
  violations: Array<{
    id: string
    impact: 'minor' | 'moderate' | 'serious' | 'critical' | null
    nodes: Array<{ target: string[] }>
  }>
}

const registeredSharedTargetSizeExceptions = [
  {
    root: '.atlas-site-header__nav',
    reason: 'Shared desktop navigation spacing is tracked in the site-header accessibility backlog.',
  },
  {
    root: '.atlas-language-switcher',
    reason: 'The shared compact language switcher is tracked separately from this city/guide release.',
  },
  {
    root: '.atlas-footer',
    reason: 'Shared footer link spacing is tracked in the global shell accessibility backlog.',
  },
] as const

test('city and flagship guide pages pass scoped WCAG A/AA checks', async ({ page }) => {
  for (const path of ['/en/cities', '/en/guides/visa-and-arrival']) {
    await page.goto(path, { waitUntil: 'domcontentloaded' })
    await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') })
    const result = await page.evaluate(async (registeredExceptions) => {
      const axe = (window as unknown as { axe: { run: (root: Document, options: object) => Promise<AxeResult> } }).axe
      const audit = await axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
      })

      return {
        ...audit,
        violations: audit.violations.map((violation) => violation.id !== 'target-size'
          ? violation
          : {
              ...violation,
              nodes: violation.nodes.filter((node) => !node.target.some((selector) => {
                let element: Element | null = null
                try {
                  element = document.querySelector(selector)
                } catch {
                  return false
                }
                return element !== null
                  && registeredExceptions.some(({ root }) => element?.closest(root))
              })),
            }).filter((violation) => violation.nodes.length > 0),
      }
    }, registeredSharedTargetSizeExceptions)
    const blocking = result.violations
      .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
      .map((violation) => ({ id: violation.id, targets: violation.nodes.flatMap((node) => node.target) }))

    expect(blocking, path + ' accessibility violations').toEqual([])
  }
})

test('city markers expose 44px targets and mobile defaults to the overlap-safe directory', async ({ page }) => {
  await page.goto('/en/cities?view=constellation', { waitUntil: 'domcontentloaded' })
  const markers = page.locator('.city-marker')
  const markerCount = await markers.count()
  expect(markerCount).toBeGreaterThan(10)

  for (let index = 0; index < markerCount; index += 1) {
    const box = await markers.nth(index).boundingBox()
    expect(box?.width).toBeGreaterThanOrEqual(44)
    expect(box?.height).toBeGreaterThanOrEqual(44)
  }

  const controls = page.locator('.city-view-switch button, .city-region-list button, .atlas-site-header__shortlist:visible')
  const count = await controls.count()
  expect(count).toBeGreaterThan(2)

  for (let index = 0; index < count; index += 1) {
    const box = await controls.nth(index).boundingBox()
    expect(box?.width).toBeGreaterThanOrEqual(24)
    expect(box?.height).toBeGreaterThanOrEqual(24)
  }

  if (test.info().project.name === 'mobile') {
    await page.goto('/en/cities', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('button', { name: 'Directory' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.city-directory')).toBeVisible()
  }
})
