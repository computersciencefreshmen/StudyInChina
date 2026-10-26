import { createHash, webcrypto } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import * as scopeModule from '../../scripts/maintenance/build-scope'
import * as snapshotModule from '../../scripts/automation/apply-catalog-snapshot'
import { bootstrapDirectoryIdentities } from '../../scripts/automation/bootstrap-directory-identities'
import { validateDirectory } from '../../scripts/quality/validate-directory'
import { canonicalIdentityJson, identityFingerprint } from '@/lib/data/identity-acceptance'
import { selectPublishedData } from '@/lib/data/publication'
import type { DataBundle } from '@/lib/data/types'
import type { MaintenanceScope } from '../../scripts/maintenance/contracts'
import { fieldRecordScopeSha256, fieldValueSha256, fieldVerificationContentSha256, type FieldVerification } from '@/lib/data/field-verification'

const date = '2026-10-24', acceptedAt = '2026-10-24T02:00:00.000Z'
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const roots: string[] = []
let bundle: DataBundle, scope: MaintenanceScope
beforeAll(async () => {
  vi.stubGlobal('crypto', webcrypto)
  bundle = scopeModule.loadMaintenanceBundle(process.cwd())
  scope = await scopeModule.buildMaintenanceScope(bundle, { scopeId: 'directory-integrity-tests', createdAt: acceptedAt })
})
afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) {
    const inside = relative(resolve(tmpdir()), resolve(root))
    if (!inside.startsWith('studyinchina-directory-') || inside.includes('..') || isAbsolute(inside)) throw Error('Unexpected test cleanup path')
    rmSync(root, { recursive: true, force: true })
  }
})
function temporaryRoot() { const root = mkdtempSync(join(tmpdir(), 'studyinchina-directory-')); roots.push(root); return root }
function write(path: string, value: unknown) { writeFileSync(path, JSON.stringify(value)) }
function validatorFixture() {
  const root = temporaryRoot(), data = join(root, 'content/data'), maintenance = join(root, 'content/maintenance'), quality = join(root, 'quality')
  for (const path of [data, maintenance, quality]) mkdirSync(path, { recursive: true })
  write(join(maintenance, 'scope-272.v1.json'), scope)
  const record = bundle.programs.find(program => program.status === 'stale')!
  const content = { format: 'fixture-reviewed-identity', recordId: record.id, acceptedAt }, receipt = { ...content, sha256: sha(canonicalIdentityJson(content)) }
  write(join(quality, 'review.json'), receipt)
  const entry = { entityType: 'program', recordId: record.id, identitySha256: identityFingerprint('program', record), sourceIds: record.sourceIds,
    acceptedAt, reviewer: 'fixture-reviewer', receiptPath: 'quality/review.json', receiptSha256: receipt.sha256 }
  write(join(data, 'identity-acceptances.json'), { schemaVersion: 1, entries: [entry] })
  vi.spyOn(scopeModule, 'loadMaintenanceBundle').mockReturnValue(bundle)
  return { root, data, entry, receipt }
}
function bootstrapFixture() {
  const root = temporaryRoot(), baseline = snapshotModule.readCatalogSnapshotBaseline(join(process.cwd(), 'content/data'))
  vi.spyOn(snapshotModule, 'readCatalogSnapshotBaseline').mockReturnValue(baseline)
  const prior = selectPublishedData(baseline.bundle, '2026-10-20')
  const proof = { pass: true, today: '2026-10-20', errors: [],
    publicCounts: Object.fromEntries(Object.entries(prior).map(([key, records]) => [key, records.length])),
    expectedInputManifest: { files: baseline.files.map(file => ({ path: file.path, bytes: file.bytes.length, sha256: file.sha256 })) } }
  const path = join(root, 'production-proof.json')
  const seal = () => { write(path, proof); return sha(readFileSync(path)) }
  return { root, baseline, prior, proof, path, seal }
}
function fieldFixture() {
  const f = validatorFixture(), record = bundle.programs.find(record => record.status !== 'draft' && record.status !== 'archived' && record.durationMonths !== null)!
  const source = bundle.sources.find(source => record.sourceIds.includes(source.id) && source.official)!
  const entry: FieldVerification = { entityType: 'program', recordId: record.id, fieldPath: 'durationMonths', value: record.durationMonths,
    valueSha256: fieldValueSha256(record.durationMonths), recordScopeSha256: fieldRecordScopeSha256('program', record), factStatus: 'known',
    sourceId: source.id, sourceUrl: source.url, snapshotSha256: 'a'.repeat(64), objectKey: 'private/checked-source.bin', locator: 'text:document', quote: 'Official source duration.',
    verifiedAt: '2026-10-01T00:00:00.000Z', reviewAfter: '2026-10-05', review: { method: 'dual-model', reviewerId: 'independent-reviewer' },
    receiptPath: 'quality/field-review.json', receiptSha256: '0'.repeat(64) }
  const content = { format: 'studyinchina.field-import-receipt', formatVersion: 1, batchId: 'field-fixture', acceptedAt: '2026-10-02T00:00:00.000Z',
    accepted: [{ proposalId: 'field-proposal', recordId: record.id, fieldPaths: [entry.fieldPath] }], held: [],
    fieldBindings: [{ entityType: entry.entityType, recordId: entry.recordId, fieldPath: entry.fieldPath, verificationSha256: fieldVerificationContentSha256(entry) }] }
  const save = (rebind = false) => {
    if (rebind) content.fieldBindings = [{ entityType: entry.entityType, recordId: entry.recordId, fieldPath: entry.fieldPath, verificationSha256: fieldVerificationContentSha256(entry) }]
    const receipt = { ...content, sha256: sha(canonicalIdentityJson(content)) }
    entry.receiptSha256 = receipt.sha256
    write(join(f.root, entry.receiptPath), receipt)
    write(join(f.data, 'field-verifications.json'), { schemaVersion: 1, entries: [entry] })
  }
  save()
  return { ...f, field: entry, fieldReceipt: content, save, record, source }
}

describe('directory integrity gate', () => {
  it('reports the fixed cohort and safe identity projection without claiming complete coverage', async () => {
    const f = validatorFixture(), result = await validateDirectory(f.root, date)
    expect(result.integrityPassed).toBe(true)
    expect(result.cohortSchools).toBe(272)
    expect(result.coverageComplete).toBe(false)
    expect(result.notice).toContain('does not certify complete school catalogues')
  })
  it('permits additional school identities while preserving every original maintenance school', async () => {
    const f = validatorFixture(), added = { ...bundle.universities[0], id: 'uni-additional-official-school', slug: 'additional-official-school' }
    vi.mocked(scopeModule.loadMaintenanceBundle).mockReturnValue({ ...bundle, universities: [...bundle.universities, added] })
    expect((await validateDirectory(f.root, date)).cohortSchools).toBe(272)
    vi.mocked(scopeModule.loadMaintenanceBundle).mockReturnValue({ ...bundle, universities: [...bundle.universities.slice(1), added] })
    await expect(validateDirectory(f.root, date)).rejects.toThrow('directory_fixed_cohort_changed')
  })
  it.each(['duplicate', 'changed-identity', 'changed-receipt', 'outside-path', 'changed-scope'])(
    'rejects %s instead of treating a broken trust ledger as complete', async kind => {
      const f = validatorFixture()
      if (kind === 'duplicate') write(join(f.data, 'identity-acceptances.json'), { schemaVersion: 1, entries: [f.entry, f.entry] })
      if (kind === 'changed-identity') write(join(f.data, 'identity-acceptances.json'), { schemaVersion: 1, entries: [{ ...f.entry, identitySha256: 'd'.repeat(64) }] })
      if (kind === 'changed-receipt') write(join(f.root, 'quality/review.json'), { ...f.receipt, recordId: 'different-record' })
      if (kind === 'outside-path') write(join(f.data, 'identity-acceptances.json'), { schemaVersion: 1, entries: [{ ...f.entry, receiptPath: '../outside-review.json' }] })
      if (kind === 'changed-scope') write(join(f.root, 'content/maintenance/scope-272.v1.json'), { ...scope, sha256: 'd'.repeat(64) })
      await expect(validateDirectory(f.root, date)).rejects.toThrow()
    })

  it('accepts an intact expired field receipt without renewing or exposing the old value', async () => {
    const f = fieldFixture(), result = await validateDirectory(f.root, date)
    expect(result.integrityPassed).toBe(true)
    expect(f.field.reviewAfter < date).toBe(true)
    expect(f.field.verifiedAt).toBe('2026-10-01T00:00:00.000Z')
  })

  it.each(['wrong-value', 'wrong-path', 'wrong-source', 'future-review', 'changed-evidence', 'unaccepted-field', 'changed-receipt'])(
    'rejects %s in a field ledger even if public redaction would hide it', async kind => {
      const f = fieldFixture()
      if (kind === 'wrong-value') { f.field.value = Number(f.field.value) + 1; f.field.valueSha256 = fieldValueSha256(f.field.value); f.save(true) }
      if (kind === 'wrong-path') { f.field.fieldPath = '__proto__.polluted'; f.fieldReceipt.accepted[0].fieldPaths = [f.field.fieldPath]; f.save(true) }
      if (kind === 'wrong-source') { f.field.sourceUrl = 'https://different.invalid/source'; f.save(true) }
      if (kind === 'future-review') { f.field.verifiedAt = '2026-10-25T00:00:00.000Z'; f.field.reviewAfter = '2026-10-28'; f.save(true) }
      if (kind === 'changed-evidence') { f.field.quote = 'Changed evidence after approval'; f.save() }
      if (kind === 'unaccepted-field') { f.fieldReceipt.accepted[0].fieldPaths = []; f.save() }
      if (kind === 'changed-receipt') write(join(f.root, f.field.receiptPath), { ...f.fieldReceipt, acceptedAt: '2026-10-03T00:00:00.000Z', sha256: f.field.receiptSha256 })
      await expect(validateDirectory(f.root, date)).rejects.toThrow()
      expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    })
})

describe('exact published identity bootstrap', () => {
  it('migrates only previously published identities and leaves all raw facts untouched', () => {
    const f = bootstrapFixture(), before = JSON.stringify(f.baseline.bundle)
    const result = bootstrapDirectoryIdentities(f.root, f.path, f.seal(), acceptedAt)
    const expected = f.prior.cities.length + f.prior.universities.length + f.prior.programs.length + f.prior.scholarships.length
    expect(result.ledger.entries).toHaveLength(expected)
    const priorProgramIds = new Set(f.prior.programs.map(record => record.id))
    expect(result.ledger.entries.filter(entry => entry.entityType === 'program').every(entry => priorProgramIds.has(entry.recordId))).toBe(true)
    expect(JSON.stringify(f.baseline.bundle)).toBe(before)
    expect(result.receipt.policy).toContain('No current opportunity')
  })
  it.each(['proof-checksum', 'incomplete-proof', 'snapshot-pin', 'publication-count'])(
    'rejects %s before granting any identity acceptance', kind => {
      const f = bootstrapFixture()
      if (kind === 'incomplete-proof') f.proof.errors.push('source proof incomplete' as never)
      if (kind === 'snapshot-pin') f.proof.expectedInputManifest.files[0].sha256 = 'd'.repeat(64)
      if (kind === 'publication-count') f.proof.publicCounts.programs++
      const digest = f.seal()
      expect(() => bootstrapDirectoryIdentities(f.root, f.path, kind === 'proof-checksum' ? 'd'.repeat(64) : digest, acceptedAt)).toThrow()
    })
  it('permits exactly CRLF checkout conversion when the production source pins LF bytes', () => {
    const f = bootstrapFixture()
    f.proof.expectedInputManifest.files = f.baseline.files.map(file => {
      const normalized = Buffer.from(file.bytes.toString('utf8').replaceAll('\r\n', '\n'))
      return { path: file.path, bytes: normalized.length, sha256: sha(normalized) }
    })
    expect(bootstrapDirectoryIdentities(f.root, f.path, f.seal(), acceptedAt).ledger.entries.length).toBeGreaterThan(0)
  })
})
