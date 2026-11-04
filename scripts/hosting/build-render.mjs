import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { renderEnvironment, runNode } from './start-render.mjs'

const require = createRequire(import.meta.url)

export async function buildRender() {
  const environment = renderEnvironment()
  // Run after Blueprint's npm ci --include=dev. This read-only validator checks
  // every ledger receipt (including legacy paths), its hash and record binding.
  // Expired records remain quarantined under the existing China-calendar rules.
  await runNode(['--import', 'tsx', 'scripts/quality/validate-directory.ts'], environment)
  // Webpack is an explicit supported choice in the installed Next CLI. RENDER
  // selects the two-worker build limit in next.config.ts.
  await runNode([require.resolve('next/dist/bin/next'), 'build', '--webpack'], environment)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  buildRender().catch(error => { console.error(error.message); process.exitCode = error.exitCode ?? 1 })
}
