import { mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyCatalogSnapshotFiles, CatalogSnapshotApplyError, catalogSnapshotFilenames, catalogSnapshotLockFilename, readCatalogSnapshotBaseline } from '../../scripts/automation/apply-catalog-snapshot'
import type { DataBundle } from '../../src/lib/data/types'

const directories: string[] = []
const audit = { sourceIds: ['source'], status: 'stale' as const, verifiedAt: '2026-09-01', reviewAfter: '2026-09-30' }
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'catalog-snapshot-apply-'))
  directories.push(directory)
  const bundle: DataBundle = {
    sources: [{ id: 'source', url: 'https://school.edu.cn/program', title: 'Official guide', publisher: 'School', kind: 'program', language: 'en', official: true, accessedAt: '2026-09-01' }],
    cities: [{ ...audit, id: 'city', slug: 'city', name: { en: 'City' }, province: null, region: null, coordinates: null, overview: null, climate: null, foodHighlights: [], sights: [] }],
    universities: [{ ...audit, id: 'school', slug: 'school', name: { en: 'School' }, cityId: 'city', region: null, officialUrl: 'https://school.edu.cn', admissionsUrl: null, summary: null, featured: false }],
    programs: [{ ...audit, id: 'program', slug: 'program', universityId: 'school', name: { en: 'Program' }, degreeLevel: 'language', discipline: 'chinese-education', teachingLanguages: ['Chinese'], durationMonths: 12, programUrl: 'https://school.edu.cn/program', applyUrl: null, languageRequirements: [] }],
    admissionCycles: [{ ...audit, id: 'cycle', programId: 'program', academicYear: '2026-2027', intake: 'autumn', opensOn: '2026-03-01', closesOn: '2026-06-01', dateStatus: 'published', tuitionCny: 12000, applicationFeeCny: 400 }],
    scholarships: [{ ...audit, id: 'scholarship', slug: 'scholarship', name: { en: 'Scholarship' }, providerType: 'university', universityIds: ['school'], programIds: ['program'], coverage: { tuition: 'full', accommodation: 'none', insurance: false, stipendCnyPerMonth: 0 }, deadline: null, applicationUrl: null, summary: null }],
  }
  for (const [key, filename] of Object.entries(catalogSnapshotFilenames)) writeFileSync(join(directory, `${filename}.json`), `${JSON.stringify(bundle[key as keyof DataBundle])}\n`)
  const before = readCatalogSnapshotBaseline(directory)
  const next = structuredClone(before.bundle)
  next.sources[0].accessedAt = '2026-09-16'
  next.cities[0].overview = { en: 'Official city profile' }
  next.universities[0].summary = { en: 'Updated school profile' }
  next.programs[0].durationMonths = 24
  next.admissionCycles[0].tuitionCny = 14000
  next.scholarships[0].coverage.stipendCnyPerMonth = 100
  return { directory, before, next }
}

function expectOriginals(before: ReturnType<typeof readCatalogSnapshotBaseline>, except: string[] = []) {
  for (const file of before.files) if (!except.includes(file.key)) expect(readFileSync(file.path)).toEqual(file.bytes)
}
function expectNoTemporaryFiles(directory: string) {
  expect(readdirSync(directory).filter(name => !name.endsWith('.json'))).toEqual([])
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('locked catalog snapshot application using real files', () => {
  it.each(['EPERM', 'EACCES', 'EBUSY'])('retries a proven unchanged Windows %s rename and keeps atomic replacement', code => {
    const { before, next, directory } = fixture()
    let failures = 0
    const waitForRetry = vi.fn()
    applyCatalogSnapshotFiles(before, next, { platform: 'win32', waitForRetry, replaceFile: (source, target) => {
      if (target === before.files[0].path && failures++ < 2) throw Object.assign(new Error('temporary-sharing-lock'), { code })
      renameSync(source, target)
    } })
    expect(waitForRetry.mock.calls).toEqual([[25], [50]])
    expect(readCatalogSnapshotBaseline(directory).bundle).toEqual(next)
    expectNoTemporaryFiles(directory)
  })

  it('bounds persistent Windows sharing failures to five attempts and rolls back earlier files', () => {
    const { before, next, directory } = fixture()
    let failedAttempts = 0
    const waitForRetry = vi.fn()
    expect(() => applyCatalogSnapshotFiles(before, next, { platform: 'win32', waitForRetry, replaceFile: (source, target) => {
      if (source.endsWith('.snapshot-tmp') && target === before.files[2].path) { failedAttempts++; throw Object.assign(new Error('persistent-sharing-lock'), { code: 'EPERM' }) }
      renameSync(source, target)
    } })).toThrow('persistent-sharing-lock; external_changes_preserved=none; rollback_failures=none')
    expect(failedAttempts).toBe(5)
    expect(waitForRetry.mock.calls).toEqual([[25], [50], [100], [150]])
    expectOriginals(before); expectNoTemporaryFiles(directory)
  })

  it('preserves an external edit made during a forward-rename retry wait', () => {
    const { before, next, directory } = fixture(), external = Buffer.from('concurrent-program-correction\n')
    let failedAttempts = 0
    let failure: unknown
    try {
      applyCatalogSnapshotFiles(before, next, { platform: 'win32', waitForRetry: () => writeFileSync(before.files[1].path, external), replaceFile: (source, target) => {
        if (source.endsWith('.snapshot-tmp') && target === before.files[1].path) { failedAttempts++; throw Object.assign(new Error('temporary-sharing-lock'), { code: 'EPERM' }) }
        renameSync(source, target)
      } })
    } catch (error) { failure = error }
    expect(failedAttempts).toBe(1)
    expect(failure).toBeInstanceOf(CatalogSnapshotApplyError)
    expect((failure as CatalogSnapshotApplyError).preservedExternalFiles).toEqual(['programs'])
    expect(readFileSync(before.files[1].path)).toEqual(external)
    expectOriginals(before, ['programs']); expectNoTemporaryFiles(directory)
  })

  it('uses the same guarded retries for rollback without overwriting an intervening edit', () => {
    const { before, next, directory } = fixture(), external = Buffer.from('concurrent-university-correction\n')
    let rollbackAttempts = 0
    let failure: unknown
    try {
      applyCatalogSnapshotFiles(before, next, { platform: 'win32', waitForRetry: () => writeFileSync(before.files[0].path, external), replaceFile: (source, target) => {
        if (source.endsWith('.snapshot-tmp') && target === before.files[1].path) throw Error('later-nontransient-failure')
        if (source.endsWith('.rollback-tmp')) { rollbackAttempts++; throw Object.assign(new Error('rollback-sharing-lock'), { code: 'EBUSY' }) }
        renameSync(source, target)
      } })
    } catch (error) { failure = error }
    expect(rollbackAttempts).toBe(1)
    expect(failure).toBeInstanceOf(CatalogSnapshotApplyError)
    expect((failure as CatalogSnapshotApplyError).preservedExternalFiles).toEqual(['universities'])
    expect((failure as CatalogSnapshotApplyError).rollbackFailures).toEqual([])
    expect(readFileSync(before.files[0].path)).toEqual(external)
    expectOriginals(before, ['universities']); expectNoTemporaryFiles(directory)
  })

  it('retries a temporary rollback sharing lock and restores the original bytes', () => {
    const { before, next, directory } = fixture()
    let rollbackAttempts = 0
    const waitForRetry = vi.fn()
    expect(() => applyCatalogSnapshotFiles(before, next, { platform: 'win32', waitForRetry, replaceFile: (source, target) => {
      if (source.endsWith('.snapshot-tmp') && target === before.files[1].path) throw Error('later-nontransient-failure')
      if (source.endsWith('.rollback-tmp') && rollbackAttempts++ === 0) throw Object.assign(new Error('rollback-sharing-lock'), { code: 'EBUSY' })
      renameSync(source, target)
    } })).toThrow('later-nontransient-failure; external_changes_preserved=none; rollback_failures=none')
    expect(rollbackAttempts).toBe(2); expect(waitForRetry).toHaveBeenCalledExactlyOnceWith(25)
    expectOriginals(before); expectNoTemporaryFiles(directory)
  })

  it('does not retry sharing errors on non-Windows platforms or non-transient errors on Windows', () => {
    for (const [platform, code] of [['linux', 'EPERM'], ['win32', 'ENOSPC']] as const) {
      const { before, next, directory } = fixture(), waitForRetry = vi.fn()
      const replaceFile = vi.fn(() => { throw Object.assign(new Error('immediate-failure'), { code }) })
      expect(() => applyCatalogSnapshotFiles(before, next, { platform, waitForRetry, replaceFile })).toThrow('immediate-failure')
      expect(replaceFile).toHaveBeenCalledTimes(1); expect(waitForRetry).not.toHaveBeenCalled()
      expectOriginals(before); expectNoTemporaryFiles(directory)
    }
  })

  it('does not retry an ambiguous rename that moved the stage before throwing', () => {
    const { before, next, directory } = fixture(), waitForRetry = vi.fn()
    let forwardCalls = 0
    expect(() => applyCatalogSnapshotFiles(before, next, { platform: 'win32', waitForRetry, replaceFile: (source, target) => {
      renameSync(source, target)
      if (source.endsWith('.snapshot-tmp')) { forwardCalls++; throw Object.assign(new Error('ambiguous-rename-outcome'), { code: 'EPERM' }) }
    } })).toThrow('ambiguous-rename-outcome')
    expect(forwardCalls).toBe(1); expect(waitForRetry).not.toHaveBeenCalled()
    expectOriginals(before); expectNoTemporaryFiles(directory)
  })

  it('reads a baseline without creating a lock or changing files', () => {
    const { before, directory } = fixture()
    expect(readCatalogSnapshotBaseline(directory).bundle).toEqual(before.bundle)
    expectOriginals(before)
    expectNoTemporaryFiles(directory)
  })

  it('stages all six files before the first replacement and returns local-only publication metadata', () => {
    const { before, next, directory } = fixture()
    let replacements = 0
    const result = applyCatalogSnapshotFiles(before, next, { replaceFile: (source, target) => {
      if (replacements++ === 0) {
        expect(readdirSync(directory).filter(name => name.endsWith('.snapshot-tmp'))).toHaveLength(6)
        expectOriginals(before)
      }
      renameSync(source, target)
    } })
    expect(result).toEqual({ filesReplaced: 6, atomicity: 'per-file-only', publication: 'local-files-awaiting-git-commit' })
    expect(readCatalogSnapshotBaseline(directory).bundle).toEqual(next)
    expectNoTemporaryFiles(directory)
  })

  it('fails without deleting an existing lock or modifying targets', () => {
    const { before, next, directory } = fixture()
    const lock = join(directory, catalogSnapshotLockFilename)
    writeFileSync(lock, 'another owner')
    expect(() => applyCatalogSnapshotFiles(before, next)).toThrow('snapshot_apply_locked')
    expect(readFileSync(lock, 'utf8')).toBe('another owner')
    expectOriginals(before)
    expect(readdirSync(directory)).toHaveLength(7)
  })

  it('detects byte changes even if the baseline JSON values are identical', () => {
    const { before, next, directory } = fixture()
    const modified = before.files[0]
    const external = Buffer.from(`${modified.bytes.toString()} \n`)
    writeFileSync(modified.path, external)
    expect(() => applyCatalogSnapshotFiles(before, next)).toThrow('snapshot_baseline_changed:universities')
    expect(readFileSync(modified.path)).toEqual(external)
    expectOriginals(before, ['universities'])
    expectNoTemporaryFiles(directory)
  })

  it('rolls back earlier replacements after a later rename fails', () => {
    const { before, next, directory } = fixture()
    let replacements = 0
    expect(() => applyCatalogSnapshotFiles(before, next, { replaceFile: (source, target) => {
      if (source.endsWith('.snapshot-tmp') && ++replacements === 3) throw new Error('simulated_disk_failure')
      renameSync(source, target)
    } })).toThrow('simulated_disk_failure')
    expectOriginals(before)
    expectNoTemporaryFiles(directory)
  })

  it('does not overwrite an external edit to a file already replaced when rollback runs', () => {
    const { before, next, directory } = fixture()
    const external = Buffer.from('external concurrent correction\n')
    let replacements = 0
    let failure: unknown
    try {
      applyCatalogSnapshotFiles(before, next, { replaceFile: (source, target) => {
        if (source.endsWith('.snapshot-tmp') && ++replacements === 2) {
          writeFileSync(before.files[0].path, external)
          throw new Error('simulated_failure_after_external_edit')
        }
        renameSync(source, target)
      } })
    } catch (error) { failure = error }
    expect(failure).toBeInstanceOf(CatalogSnapshotApplyError)
    expect((failure as CatalogSnapshotApplyError).preservedExternalFiles).toEqual(['universities'])
    expect(readFileSync(before.files[0].path)).toEqual(external)
    expectOriginals(before, ['universities'])
    expectNoTemporaryFiles(directory)
  })

  it('checks each still-unwritten target again and rolls back only its own earlier writes', () => {
    const { before, next, directory } = fixture()
    const external = Buffer.from('external program correction\n')
    expect(() => applyCatalogSnapshotFiles(before, next, { replaceFile: (source, target) => {
      renameSync(source, target)
      if (source.endsWith('.snapshot-tmp') && target === before.files[0].path) writeFileSync(before.files[1].path, external)
    } })).toThrow('snapshot_baseline_changed:programs')
    expect(readFileSync(before.files[1].path)).toEqual(external)
    expectOriginals(before, ['programs'])
    expectNoTemporaryFiles(directory)
  })

  it('excludes a competing apply while the first owns the lock', () => {
    const { before, next, directory } = fixture()
    let competed = false
    applyCatalogSnapshotFiles(before, next, { replaceFile: (source, target) => {
      if (!competed) {
        competed = true
        expect(() => applyCatalogSnapshotFiles(readCatalogSnapshotBaseline(directory), next)).toThrow('snapshot_apply_locked')
      }
      renameSync(source, target)
    } })
    expect(readCatalogSnapshotBaseline(directory).bundle).toEqual(next)
    expectNoTemporaryFiles(directory)
  })

  it('never removes a lock whose ownership changed externally', () => {
    const { before, next, directory } = fixture()
    const lock = join(directory, catalogSnapshotLockFilename)
    applyCatalogSnapshotFiles(before, next, { replaceFile: (source, target) => {
      renameSync(source, target)
      writeFileSync(lock, 'replacement owner')
    } })
    expect(readFileSync(lock, 'utf8')).toBe('replacement owner')
    expect(readCatalogSnapshotBaseline(directory).bundle).toEqual(next)
  })

  it('does not create a missing target directory while reading a baseline', () => {
    const directory = mkdtempSync(join(tmpdir(), 'catalog-snapshot-empty-'))
    directories.push(directory)
    mkdirSync(join(directory, 'unrelated'))
    expect(() => readCatalogSnapshotBaseline(join(directory, 'missing'))).toThrow()
    expect(readdirSync(directory)).toEqual(['unrelated'])
  })
})
