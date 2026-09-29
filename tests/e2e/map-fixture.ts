import type { Page } from '@playwright/test'

// Interaction tests must not pan/zoom bots against the community tile service.
// This explicitly synthetic tile tests rendering/controls, not provider geography.
export async function mockMapTiles(page: Page) {
  await page.route('https://tile.openstreetmap.org/**', route => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e4ece7"/><path d="M0 128H256M128 0V256" stroke="#ccd9d0"/><text x="12" y="24" fill="#657568" font-size="12">TEST MAP TILE</text></svg>',
  }))
}
