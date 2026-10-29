import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import nextConfig from '../../next.config'

const picomatch = createRequire(resolve(process.cwd(), 'next.config.ts'))('next/dist/compiled/picomatch') as
  (pattern: string) => (value: string) => boolean
const includes = nextConfig.outputFileTracingIncludes ?? {}
const globalPatterns = includes['/*'] ?? []
const bundled = (path: string) => globalPatterns.some(pattern => picomatch(pattern)(path))
const ignore = createRequire(resolve(process.cwd(), 'next.config.ts'))('ignore') as
  () => { add(patterns: string): { ignores(path: string): boolean } }

describe('scoped identity receipt deployment traces', () => {
  it('keeps receipt ancestors traversable by the Vercel input collector', () => {
    const collector = ignore().add('.env.local\n.env.*.local\n' + readFileSync(resolve(process.cwd(), '.vercelignore'), 'utf8'))
    for (const receipt of ['quality/minimum-one/2026-10-27/batch009/identity-import-receipt.json',
      'quality/maintenance/batches/future-batch/identity-receipt.json']) {
      const parts = receipt.split('/')
      // Vercel's collector checks directory paths without a trailing slash.
      for (let i = 1; i <= parts.length; i++) expect(collector.ignores(parts.slice(0, i).join('/')), receipt).toBe(false)
    }
    for (const path of ['quality/minimum-one/2026-10-27/batch009/export.json',
      'quality/minimum-one/2026-10-27/batch009/raw/source.bin', 'quality/maintenance/batches/future-batch/raw/source.html',
      'quality/minimax-harvest/model-output.json', '.pipeline-build/private/source.bin', '.env.local']) expect(collector.ignores(path), path).toBe(true)
  })
  it('packages every current scoped receipt and both supported future writer layouts', () => {
    const ledger = JSON.parse(readFileSync(resolve(process.cwd(), 'content/data/identity-acceptances.json'), 'utf8')) as
      { entries: Array<{ verifiedName?: unknown; receiptPath: string }> }
    for (const entry of ledger.entries.filter(entry => entry.verifiedName !== undefined)) expect(bundled(entry.receiptPath), entry.receiptPath).toBe(true)
    expect(bundled('quality/minimum-one/2026-10-27/batch007/identity-import-receipt.json')).toBe(true)
    expect(bundled('quality/minimum-one/2026-10-27/batch008/identity-import-receipt.json')).toBe(true)
    expect(bundled('quality/maintenance/batches/future-batch/identity-receipt.json')).toBe(true)
  })
  it('does not expand receipt inclusion to captures, exports, private tools or credentials', () => {
    for (const path of ['quality/minimum-one/2026-10-27/batch007/source.pdf',
      'quality/minimum-one/2026-10-27/batch007/export.json', 'quality/maintenance/batches/future-batch/raw/source.html',
      '.pipeline-build/private/identity-import-receipt.json', '.official-harvest/raw/source.pdf', '.env.local']) expect(bundled(path), path).toBe(false)
    expect(includes['/api/v1/minimax-verification']).toContain('./content/verification/minimax.json')
  })
})
