import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve, dirname, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { validateContentData } from '../../scripts/validate-data'
import type { DataBundle } from '../../src/lib/data/types'
import type { IdentityAcceptance } from '../../src/lib/data/identity-acceptance'

const today = '2026-10-25', programId = 'program-guangdong-university-of-foreign-studies-chinese-language-bachelor'
const dataFiles = ['sources', 'cities', 'universities', 'programs', 'admission-cycles', 'scholarships', 'identity-acceptances']
let root: string

function cleanup(path: string) {
  const absolute = resolve(path)
  if (dirname(absolute) !== resolve(tmpdir()) || !basename(absolute).startsWith('data-expiry-proof-test-')) throw new Error('Unexpected cleanup target')
  rmSync(absolute, { recursive: true, force: true })
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'data-expiry-proof-test-'))
  const read = <T,>(name: string): T => JSON.parse(readFileSync(join(process.cwd(), 'content/data', `${name}.json`), 'utf8')) as T
  const cities = read<DataBundle['cities']>('cities'), universities = read<DataBundle['universities']>('universities')
  const program = read<DataBundle['programs']>('programs').find(program => program.id === programId)!
  const cycles = read<DataBundle['admissionCycles']>('admission-cycles').filter(cycle => cycle.programId === programId)
  const identity = read<{ entries: IdentityAcceptance[] }>('identity-acceptances').entries.find(entry => entry.entityType === 'program' && entry.recordId === programId)!
  expect(program).toMatchObject({ status: 'verified', reviewAfter: '2026-10-24' })
  expect(identity).toBeDefined()
  // Retain the actual fixed cohort and one real expired identity with its original proof.
  // Expiry semantics do not require reparsing the other 2,056 rich programme records.
  const sourceIds = new Set([...cities, ...universities, program, ...cycles].flatMap(record => record.sourceIds))
  const data = { sources: read<DataBundle['sources']>('sources').filter(source => sourceIds.has(source.id)),
    cities, universities, programs: [program], 'admission-cycles': cycles, scholarships: [],
    'identity-acceptances': { schemaVersion: 1, entries: [identity] } }
  mkdirSync(join(root, 'content/data'), { recursive: true })
  for (const [name, value] of Object.entries(data)) writeFileSync(join(root, 'content/data', `${name}.json`), `${JSON.stringify(value)}\n`)
  mkdirSync(join(root, 'content/maintenance'), { recursive: true })
  copyFileSync(join(process.cwd(), 'content/maintenance/scope-272.v1.json'), join(root, 'content/maintenance/scope-272.v1.json'))
  mkdirSync(dirname(join(root, identity.receiptPath)), { recursive: true })
  copyFileSync(join(process.cwd(), identity.receiptPath), join(root, identity.receiptPath))
})

afterAll(() => { if (root) cleanup(root) })

describe('calendar expiry in directory releases', () => {
  it('keeps strict raw authoring validation as the default', async () => {
    await expect(validateContentData(root, today)).rejects.toThrow('past their review date')
  })
  it('accepts expiry only with valid directory proof and preserves exact raw bytes', async () => {
    const path = join(root, 'content/data/programs.json'), before = readFileSync(path)
    const result = await validateContentData(root, today, { directorySafeExpiry: true })
    expect(result.overdueRawVerifiedIds).toContain(programId)
    expect(result.counts.programs).toBe(1)
    expect(result.directory?.integrityPassed).toBe(true)
    expect(result.directory?.cohortSchools).toBe(272)
    expect(result.directory?.directoryCounts.programs).toBe(1)
    expect(result.directory?.currentFactsCounts.programs).toBe(0)
    expect(readFileSync(path).equals(before)).toBe(true)
  })
  it('does not bypass missing directory integrity evidence', async () => {
    const missingProofRoot = mkdtempSync(join(tmpdir(), 'data-expiry-proof-test-'))
    try {
      mkdirSync(join(missingProofRoot, 'content/data'), { recursive: true })
      for (const file of dataFiles) copyFileSync(join(root, 'content/data', `${file}.json`), join(missingProofRoot, 'content/data', `${file}.json`))
      mkdirSync(join(missingProofRoot, 'content/maintenance'), { recursive: true })
      copyFileSync(join(root, 'content/maintenance/scope-272.v1.json'), join(missingProofRoot, 'content/maintenance/scope-272.v1.json'))
      // The ledger still refers to the real receipt, which this copy intentionally lacks.
      await expect(validateContentData(missingProofRoot, today, { directorySafeExpiry: true })).rejects.toThrow('ENOENT')
    } finally {
      cleanup(missingProofRoot)
    }
  })
})
