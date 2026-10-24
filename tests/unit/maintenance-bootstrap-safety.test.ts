import { createHash, webcrypto } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, rmdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname, basename } from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildLegacyGuards, buildMaintenanceTargets } from '../../scripts/automation/build-maintenance-bootstrap'
import { loadMaintenanceBundle, buildMaintenanceScope } from '../../scripts/maintenance/build-scope'
import type { DataBundle } from '../../src/lib/data/types'
import type { MaintenanceScope } from '../../scripts/maintenance/contracts'

const sha = (value: string) => createHash('sha256').update(value).digest('hex')
let bundle: DataBundle, scope: MaintenanceScope
const temporary: string[] = []
beforeAll(async () => { vi.stubGlobal('crypto', webcrypto); bundle = loadMaintenanceBundle(process.cwd()); scope = await buildMaintenanceScope(bundle, { scopeId: 'bootstrap-tests', createdAt: '2026-10-24T00:00:00.000Z' }) })
afterEach(() => { for (const directory of temporary.splice(0)) {
  const absolute = resolve(directory)
  if (dirname(absolute) !== resolve(tmpdir()) || !basename(absolute).startsWith('maintenance-bootstrap-test-')) throw Error('Unexpected cleanup path')
  rmSync(absolute, { recursive: true, force: true })
} })
function legacyRoot() {
  const root = mkdtempSync(join(tmpdir(), 'maintenance-bootstrap-test-')); temporary.push(root)
  for (const directory of ['.tmp/minimax-verification/full-record-request-reservations', '.tmp/minimax-enrichment/request-reservations']) mkdirSync(join(root, directory), { recursive: true })
  return root
}

describe('maintenance seed scope and legacy history', () => {
  it('uses each existing cycle year/intake and leaves yearless scholarships unassigned', () => {
    const targets = buildMaintenanceTargets(bundle, scope)
    const cycles = targets.filter(target => target.entityType === 'admission-cycle')
    expect(cycles.length).toBeGreaterThan(0)
    for (const target of cycles) {
      const cycle = bundle.admissionCycles.find(cycle => cycle.id === target.recordId)!
      expect(target.year).toBe(cycle.academicYear); expect(target.intake).toBe(cycle.intake)
      expect(target.identity).toHaveProperty('degreeLevel')
      expect(target.identity.programId).toBe(cycle.programId)
      expect(target.sourceIds.every(id => /^[a-f0-9]{64}$/u.test(id))).toBe(true)
    }
    const yearless = targets.filter(target => target.entityType === 'scholarship' && !Object.values(bundle.scholarships.find(award => award.id === target.recordId)!.name).some(name => /20\d{2}/u.test(name ?? '')))
    expect(yearless.length).toBeGreaterThan(0)
    expect(yearless.every(target => target.year === null)).toBe(true)
    expect(targets.every(target => !Object.values(target.fields).some(value => value && typeof value === 'object'))).toBe(true)
    const disabledUrls = new Set(scope.schools.flatMap(school => school.sourceSeeds.filter(seed => !seed.enabled).map(seed => seed.url)))
    const enabledUrls = new Set(scope.schools.flatMap(school => school.sourceSeeds.filter(seed => seed.enabled).map(seed => seed.url)))
    const onlyDisabled = [...disabledUrls].filter(url => !enabledUrls.has(url)).map(sha)
    expect(targets.every(target => target.sourceIds.every(id => !onlyDisabled.includes(id)))).toBe(true)
  })

  it('maintains strictly imported new official pages without accepting arbitrary source additions', () => {
    const next = structuredClone(bundle), program = next.programs.find(record => record.status === 'verified')!
    const school = scope.schools.find(school => school.universityId === program.universityId)!
    const url = `https://${school.officialHosts[0]}/new-admissions-source-for-maintenance-test`
    const acceptedId = `src-maintenance-identity-${sha(url).slice(0, 24)}`
    const template = next.sources.find(source => source.official)!
    next.sources.push({ ...template, id: acceptedId, url })
    program.sourceIds = [acceptedId]
    expect(buildMaintenanceTargets(next, scope).some(target => target.recordId === program.id && target.sourceIds.includes(sha(url)))).toBe(true)
    next.sources.at(-1)!.id = 'unreviewed-manual-source'
    program.sourceIds = ['unreviewed-manual-source']
    expect(buildMaintenanceTargets(next, scope).some(target => target.recordId === program.id)).toBe(false)
    next.sources.at(-1)!.id = acceptedId
    next.sources.at(-1)!.url = 'https://unrelated.example/unknown'
    program.sourceIds = [acceptedId]
    expect(buildMaintenanceTargets(next, scope).some(target => target.recordId === program.id)).toBe(false)
  })

  it('does not interpret absent or empty prior reservations as a free replay allowance', () => {
    const root = legacyRoot()
    expect(() => buildLegacyGuards(root, bundle)).toThrow('history is empty')
    rmdirSync(join(root, '.tmp/minimax-enrichment/request-reservations'))
    expect(() => buildLegacyGuards(root, bundle)).toThrow('directory is missing')
  })

  it('attributes known record/source reservations precisely without manufacturing a global stop', () => {
    const root = legacyRoot(), program = bundle.programs.find(program => program.status === 'stale')!
    const url = bundle.sources.find(source => source.id === program.sourceIds[0])!.url
    writeFileSync(join(root, '.tmp/minimax-verification/full-record-request-reservations', `${'a'.repeat(64)}.json`), JSON.stringify({ scope: {
      taskId: `programs:${program.id}`, sources: [{ url, finalUrl: url, sha256: 'b'.repeat(64) }], privatePrompt: 'This must never be exported',
    } }))
    const result = buildLegacyGuards(root, bundle)
    expect(result.inventory).toMatchObject({ attributed: 1, globalStops: 0 })
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]).toMatchObject({ universityId: program.universityId, recordId: program.id, sourceId: sha(url), snapshotSha256: 'b'.repeat(64), state: 'stop', fields: '*' })
    expect(JSON.stringify(result)).not.toContain('privatePrompt')
    expect(JSON.stringify(result)).not.toContain('This must never be exported')
  })

  it('reconstructs source-only history from an exact contained run capture rather than globally stopping unrelated work', () => {
    const root = legacyRoot(), run = join(root, 'quality', 'prior-run', 'sources')
    mkdirSync(run, { recursive: true })
    const url = 'https://example.edu.cn/official-catalogue'
    writeFileSync(join(run, `${'c'.repeat(64)}.json`), JSON.stringify({ status: 'captured', official: true, url, sha256: 'd'.repeat(64) }))
    writeFileSync(join(root, '.tmp/minimax-enrichment/request-reservations', `${'e'.repeat(64)}.json`), JSON.stringify({ runDirectory: 'quality/prior-run' }))
    const result = buildLegacyGuards(root, bundle)
    expect(result.inventory).toMatchObject({ files: 2, attributed: 1, globalStops: 0 })
    expect(result.entries[0]).toMatchObject({ universityId: null, recordId: null, sourceId: sha(url), snapshotSha256: 'd'.repeat(64) })
  })
})
