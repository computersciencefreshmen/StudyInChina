import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { atomicJson } from '../../scripts/ingestion/atomic-json'

let directory: string
beforeAll(async () => { directory = await mkdtemp(join(tmpdir(), 'studyinchina-atomic-json-')) })
afterAll(async () => { await rm(directory, { recursive: true, force: true }) })
const denied = (code: string) => Object.assign(new Error(`replace ${code}`), { code })

describe('atomic JSON replacement', () => {
  it('retries transient Windows locks while readers retain complete previous JSON', async () => {
    const path = join(directory, 'transient.json')
    await writeFile(path, '{"version":"original"}\n')
    const replace = vi.fn<typeof rename>().mockRejectedValueOnce(denied('EPERM')).mockRejectedValueOnce(denied('EBUSY')).mockImplementation(rename)
    const wait = vi.fn(async () => { expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ version: 'original' }) })
    await atomicJson(path, { version: 'replacement' }, { platform: 'win32', rename: replace, wait })
    expect(replace).toHaveBeenCalledTimes(3)
    expect(wait.mock.calls).toEqual([[50], [100]])
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ version: 'replacement' })
    expect((await readdir(directory)).filter(name => name.startsWith('transient.json.'))).toEqual([])
  })

  it.each(['EPERM', 'EBUSY', 'EACCES'])('bounds persistent Windows %s and preserves the original file', async code => {
    const path = join(directory, `permanent-${code}.json`)
    const original = '{"version":"original"}\n'
    await writeFile(path, original)
    const failure = denied(code)
    const replace = vi.fn<typeof rename>().mockRejectedValue(failure)
    const wait = vi.fn(async () => {})
    await expect(atomicJson(path, { version: 'replacement' }, { platform: 'win32', rename: replace, wait })).rejects.toBe(failure)
    expect(replace).toHaveBeenCalledTimes(6)
    expect(wait.mock.calls).toEqual([[50], [100], [200], [400], [750]])
    expect(await readFile(path, 'utf8')).toBe(original)
    expect((await readdir(directory)).filter(name => name.startsWith(`permanent-${code}.json.`))).toEqual([])
  })

  it.each([{ platform: 'linux' as const, code: 'EPERM' }, { platform: 'win32' as const, code: 'ENOSPC' }])('does not retry unrelated failures ($platform/$code)', async ({ platform, code }) => {
    const path = join(directory, `no-retry-${platform}-${code}.json`)
    await writeFile(path, '{"version":"original"}\n')
    const failure = denied(code)
    const replace = vi.fn<typeof rename>().mockRejectedValue(failure)
    const wait = vi.fn(async () => {})
    await expect(atomicJson(path, { version: 'replacement' }, { platform, rename: replace, wait })).rejects.toBe(failure)
    expect(replace).toHaveBeenCalledTimes(1)
    expect(wait).not.toHaveBeenCalled()
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ version: 'original' })
  })
})
