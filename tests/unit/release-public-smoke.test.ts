import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getTodayDate } from '../../src/lib/data/freshness'
import { loadSmokeExpectation, redactSmokeError } from '../../scripts/quality/release-public-smoke'

const root = process.cwd(), directories: string[] = []
function fixture() { mkdirSync(join(root, '.tmp'), { recursive: true }); const path = mkdtempSync(join(root, '.tmp', 'release-smoke-test-')); directories.push(path); return path }
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }) })

describe('release smoke evidence safety', () => {
  it('redacts literal and URL-encoded protection credentials from errors', () => {
    const secret = 'private/token+value', result = redactSmokeError(new Error(`request failed ${secret} ${encodeURIComponent(secret)}`), secret)
    expect(result).not.toContain(secret)
    expect(result).not.toContain(encodeURIComponent(secret))
    expect(result.match(/\[REDACTED\]/gu)).toHaveLength(2)
  })

  it('redacts protection-header values and bounds arbitrary exception output', () => {
    expect(redactSmokeError('x-vercel-protection-bypass: a-secret-value, response=401')).not.toContain('a-secret-value')
    expect(redactSmokeError('a'.repeat(10000))).toHaveLength(1500)
  })

  it('drops the entire Playwright call log including Cookie and Authorization', () => {
    const result = redactSmokeError(new Error('apiRequestContext.get: socket disconnected\nCall log:\n  - GET https://studyinchina.vercel.app/en\n  - Cookie: sso_nonce=private-cookie\n  - Authorization: Bearer private-auth\n  - x-vercel-protection-bypass: private-bypass'))
    expect(result).toBe('apiRequestContext.get: socket disconnected')
    for (const secret of ['private-cookie', 'private-auth', 'private-bypass', 'Call log', 'Cookie', 'Authorization']) expect(result).not.toContain(secret)
  })

  it('drops single-line sensitive header diagnostics even without a known bypass key', () => {
    for (const message of ['Cookie: sso_nonce=private-cookie', 'request failed; Authorization: Bearer private-auth', 'headers={"cookie":"private-cookie"}', 'Set-Cookie: private-session; Secure']) {
      expect(redactSmokeError(message)).toBe('[sensitive request diagnostics removed]')
    }
  })

  it('rejects evidence paths outside the workspace before reading files', () => {
    expect(() => loadSmokeExpectation(root, '../outside-smoke.json')).toThrow('input_path_outside_workspace')
  })

  it('rejects a stale date instead of silently checking a different publication day', () => {
    const directory = fixture(), input = join(directory, 'input.json')
    writeFileSync(input, JSON.stringify({ schemaVersion: 1, today: '2000-01-01' }))
    expect(() => loadSmokeExpectation(root, relative(root, input))).toThrow('smoke_input_date_is_not_current_china_calendar')
  })

  it('rejects a modified catalogue whose bytes are not pinned in the source plan', () => {
    const directory = fixture(), plan = join(directory, 'source-plan.json'), input = join(directory, 'input.json')
    writeFileSync(plan, JSON.stringify({ pins: [{ path: 'content/data/sources.json', sha256: '0'.repeat(64) }] }))
    writeFileSync(input, JSON.stringify({ schemaVersion: 1, today: getTodayDate(), dataDirectory: 'content/data', sourcePlan: relative(root, plan), batches: ['not-read.json'], staleSlugs: ['unpublished-sentinel'], expectedPrograms: 1, expectedUniversities: 1, expectedChangedPrograms: 1, expectedChangedUniversities: 1 }))
    expect(() => loadSmokeExpectation(root, relative(root, input))).toThrow('expected_data_not_bound_to_source_plan:sources')
  })

  it('rejects ambiguous duplicate pins in a source plan', () => {
    const directory = fixture(), plan = join(directory, 'source-plan.json'), input = join(directory, 'input.json')
    const pin = { path: 'content/data/sources.json', sha256: '0'.repeat(64) }
    writeFileSync(plan, JSON.stringify({ pins: [pin, pin] }))
    writeFileSync(input, JSON.stringify({ schemaVersion: 1, today: getTodayDate(), dataDirectory: 'content/data', sourcePlan: relative(root, plan), batches: ['not-read.json'], staleSlugs: ['unpublished-sentinel'], expectedPrograms: 1, expectedUniversities: 1, expectedChangedPrograms: 1, expectedChangedUniversities: 1 }))
    expect(() => loadSmokeExpectation(root, relative(root, input))).toThrow('source_plan_duplicate_or_invalid_pins')
  })
})
