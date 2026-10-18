import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { buildLocalCatalogMirror } from '../../scripts/catalog/build-local-mirror'
import { bundleSchema } from '../../src/lib/data/schema'

const temporary: string[] = []
afterEach(() => {
  for (const directory of temporary.splice(0)) {
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error('Temporary cleanup escaped its root')
    rmSync(directory, { recursive: true, force: true })
  }
})

function fixture(wording = '18 weeks', localized = '18周') {
  const audit = { sourceIds: ['official'], status: 'verified', verifiedAt: '2026-10-18', reviewAfter: '2026-10-25' }
  const program = { ...audit, id: 'program', slug: 'program', universityId: 'school', name: { en: 'Preparation' },
    degreeLevel: 'foundation', discipline: 'other', teachingLanguages: ['Chinese'], durationMonths: null,
    durationMonthsMax: null, durationText: { en: wording, zh: localized },
    programUrl: 'https://example.edu.cn/program', applyUrl: 'https://example.edu.cn/apply',
    languageRequirements: [{ test: 'HSK', minimum: 'HSK2~3 or equivalent' }], verificationScope: 'facts',
    supplementaryDetails: { eligibility: [{ en: 'Under 24; guardian authorization under 18.' }],
      applicationMaterials: [{ en: 'Original and notarized diploma.' }, { en: 'Signed medical form.' }] } }
  return bundleSchema.parse({
    sources: [{ id: 'official', url: program.programUrl, title: 'Official programme', publisher: 'School', kind: 'program', language: 'en', official: true, accessedAt: '2026-10-18' }],
    cities: [{ ...audit, id: 'city', slug: 'city', name: { en: 'City' }, province: null, region: null, coordinates: null, overview: null, climate: null, foodHighlights: [], sights: [] }],
    universities: [{ ...audit, id: 'school', slug: 'school', name: { en: 'School' }, cityId: 'city', region: null, officialUrl: 'https://example.edu.cn/', admissionsUrl: null, summary: null, featured: false }],
    programs: [program],
    admissionCycles: [{ ...audit, id: 'cycle', programId: 'program', academicYear: '2026-2027', intake: 'spring',
      opensOn: '2026-10-01', closesOn: '2027-01-15', dateStatus: 'published', tuitionCny: 13800,
      tuitionPeriod: 'program', tuitionStatus: 'reference', evidenceBasis: 'cycle-specific', factScope: 'complete',
      applicationFeeCny: 500, notes: { en: 'Reference tuition only; application fee is non-refundable. Scholarship applicants pay CNY800.' } }],
    scholarships: [],
  })
}

function options() {
  const directory = mkdtempSync(join(tmpdir(), 'studyinchina-local-mirror-'))
  temporary.push(directory)
  return { outputRoot: join(directory, 'mirrors'), receiptDirectory: join(directory, 'quality'),
    migrationDirectory: resolve('infra/d1/catalog/migrations'), evaluatedForDate: '2026-10-18', expectedPublicPrograms: 1 }
}

describe('local-only catalogue database mirror', () => {
  it.each([{ wording: '18 weeks', localized: '18周' }, { wording: '2 semesters', localized: '2学期' }])(
    'reopens exact $wording, null durations, reference fees and lossless material/notes roundtrip', ({ wording, localized }) => {
    const bundle = fixture(wording, localized), config = options(), result = buildLocalCatalogMirror(bundle, config)
    expect(result.manifest.validation).toMatchObject({ integrityCheck: 'ok', foreignKeyViolations: 0, textualDurations: 2, referenceTuitionFees: 1 })
    expect(result.manifest.migrations).toHaveLength(12)
    const envelope = JSON.parse(readFileSync(join(result.outputDirectory, 'compat-envelope.json'), 'utf8'))
    expect(envelope.data).toEqual(bundle)
    expect(envelope.data.programs[0].supplementaryDetails.applicationMaterials).toHaveLength(2)
    expect(envelope.data.admissionCycles[0].notes.en).toContain('application fee is non-refundable')
    const database = new DatabaseSync(join(result.outputDirectory, 'catalog.sqlite'), { readOnly: true })
    try {
      expect(database.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
      expect(database.prepare('SELECT duration_min, duration_max, duration_unit FROM programs WHERE program_id = ?').get('program'))
        .toEqual({ duration_min: null, duration_max: null, duration_unit: null })
      expect(database.prepare("SELECT text_value FROM localized_content WHERE record_id = ? AND field_name = 'durationText' AND locale = 'zh'").get('program'))
        .toEqual({ text_value: localized })
      expect(database.prepare("SELECT value_status, amount_min_minor FROM fee_items WHERE fee_type = 'tuition'").get())
        .toEqual({ value_status: 'reference', amount_min_minor: 1380000 })
    } finally { database.close() }
    const restored = new DatabaseSync(':memory:')
    try {
      restored.exec(readFileSync(join(result.outputDirectory, 'normalized.sql'), 'utf8'))
      expect(restored.prepare('PRAGMA foreign_key_check').all()).toEqual([])
      expect(restored.prepare('SELECT COUNT(*) AS count FROM programs').get()).toEqual({ count: 1 })
    } finally { restored.close() }
    const persisted = JSON.parse(readFileSync(result.manifestPath, 'utf8'))
    expect(createHash('sha256').update(readFileSync(join(result.outputDirectory, 'catalog.sqlite'))).digest('hex'))
      .toBe(persisted.files.database.sha256)
    expect(() => buildLocalCatalogMirror(bundle, config)).toThrow('Immutable mirror identity already exists')
  })

  it('rejects a wrong public count and an orphan relationship without publishing a success receipt', () => {
    const bundle = fixture(), config = options()
    expect(() => buildLocalCatalogMirror(bundle, { ...config, expectedPublicPrograms: 2 })).toThrow('Public programme count mismatch')
    bundle.programs[0].universityId = 'missing-school'
    expect(() => buildLocalCatalogMirror(bundle, { ...config, expectedPublicPrograms: 0 }))
      .toThrow('Unknown university missing-school on program')
    expect(existsSync(config.receiptDirectory)).toBe(false)
  })
})
