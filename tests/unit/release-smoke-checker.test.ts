import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { Readable } from 'node:stream'
import { beforeAll, describe, expect, it, vi } from 'vitest'

const checkerPath = resolve(process.cwd(), 'scripts/operations/check-release-smoke.mjs'), sha = 'a'.repeat(40)
const now = new Date('2026-10-25T00:00:00.000Z')
let coreAssert: (payload: unknown, expectedSha: string, now?: Date) => void
let checkReleaseSmokeInput: (input: AsyncIterable<Uint8Array>, expectedSha: string, now?: Date) => Promise<void>
let chinaCalendarDay: (now?: Date) => string
let MAX_RELEASE_SMOKE_BYTES: number
beforeAll(async () => { ({ assertReleaseSmoke: coreAssert, checkReleaseSmokeInput, chinaCalendarDay, MAX_RELEASE_SMOKE_BYTES } = await import(checkerPath)) })
const assertReleaseSmoke = (payload: unknown, expectedSha: string) => coreAssert(payload, expectedSha, now)
function release() {
  return { data: { id: 'catalog-directory-release', deploymentSha: sha, evaluatedForDate: '2026-10-25', directoryRevision: 'd'.repeat(64),
    directoryCounts: { programs: 783 }, publicCounts: { programs: 0 }, currentOpportunityCounts: { programs: 0 } } }
}

describe('dependency-free public release smoke', () => {
  it('accepts a 783-programme safe directory when every legacy current fact and opportunity has expired', async () => {
    expect(() => assertReleaseSmoke(release(), sha)).not.toThrow()
    await expect(checkReleaseSmokeInput(Readable.from([Buffer.from(JSON.stringify(release()))]), sha, now)).resolves.toBeUndefined()
    const current = release(); current.data.publicCounts.programs = 779; current.data.currentOpportunityCounts.programs = 25
    expect(() => assertReleaseSmoke(current, sha)).not.toThrow()
  })
  it.each([
    ['directoryCounts', undefined], ['directoryCounts', { programs: 0 }], ['directoryCounts', { programs: '783' }],
    ['directoryCounts', { programs: -1 }], ['directoryCounts', { programs: 1.5 }],
    ['publicCounts', undefined], ['publicCounts', { programs: -1 }], ['publicCounts', { programs: '0' }],
    ['currentOpportunityCounts', undefined], ['currentOpportunityCounts', { programs: -1 }], ['currentOpportunityCounts', { programs: null }],
    ['currentOpportunityCounts', { programs: Number.MAX_SAFE_INTEGER + 1 }],
    ['deploymentSha', 'b'.repeat(40)], ['deploymentSha', null], ['id', ''], ['id', '  '],
    ['directoryRevision', undefined], ['directoryRevision', 'raw-counts'], ['directoryRevision', 'd'.repeat(63)],
    ['evaluatedForDate', '2026-02-30'], ['evaluatedForDate', '2026-10-25T00:00:00Z'], ['evaluatedForDate', undefined],
  ])('rejects invalid or missing %s evidence (%j)', (field, value) => {
    const payload = release()
    Object.assign(payload.data, { [field as string]: value })
    expect(() => assertReleaseSmoke(payload, sha)).toThrow('release_smoke_invalid')
  })
  it('rejects raw-only counts and an invalid expected commit instead of treating them as projected availability', () => {
    expect(() => assertReleaseSmoke({ data: { id: 'raw-only', deploymentSha: sha, evaluatedForDate: '2026-10-25', rawCounts: { programs: 2057 } } }, sha)).toThrow()
    expect(() => assertReleaseSmoke(release(), 'main')).toThrow()
    expect(() => assertReleaseSmoke({ data: [] }, sha)).toThrow()
  })
  it('rejects yesterday immediately after China midnight while accepting the new evaluation day', () => {
    const beforeMidnight = new Date('2026-10-25T15:59:59.999Z'), afterMidnight = new Date('2026-10-25T16:00:00.000Z')
    expect(() => coreAssert(release(), sha, beforeMidnight)).not.toThrow()
    expect(() => coreAssert(release(), sha, afterMidnight)).toThrow('release_smoke_invalid')
    const nextDay = release(); nextDay.data.evaluatedForDate = '2026-10-26'
    expect(() => coreAssert(nextDay, sha, afterMidnight)).not.toThrow()
  })
  it('evaluates the China day after reading stdin if the response crosses midnight', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-10-25T15:59:59.999Z'))
      async function* response() {
        vi.setSystemTime(new Date('2026-10-25T16:00:00.000Z'))
        yield Buffer.from(JSON.stringify(release()))
      }
      await expect(checkReleaseSmokeInput(response(), sha)).rejects.toThrow('release_smoke_invalid')
    } finally { vi.useRealTimers() }
  })
  it('bounds streamed input before parsing and rejects malformed JSON without reflecting source text', async () => {
    await expect(checkReleaseSmokeInput(Readable.from([Buffer.alloc(MAX_RELEASE_SMOKE_BYTES), Buffer.from('x')]), sha)).rejects.toThrow('release_smoke_too_large')
    await expect(checkReleaseSmokeInput(Readable.from([Buffer.from('not json')]), sha)).rejects.toThrow()
    const actualDay = release(); actualDay.data.evaluatedForDate = chinaCalendarDay()
    const pass = spawnSync(process.execPath, [checkerPath, sha], { input: JSON.stringify(actualDay), encoding: 'utf8' })
    expect(pass.status).toBe(0)
    const rejected = spawnSync(process.execPath, [checkerPath, sha], { input: 'sensitive-provider-response', encoding: 'utf8' })
    expect(rejected.status).toBe(1)
    expect(rejected.stderr).not.toContain('sensitive-provider-response')
  })
})
