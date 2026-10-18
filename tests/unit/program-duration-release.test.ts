import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildLegacyRelease } from '../../scripts/catalog/build-release'
import { CatalogApiService, releaseFromBundle } from '@/lib/catalog-api/service'
import { parseD1ProgramList } from '@/lib/catalog/d1-list'
import { parseD1ProgramComparison } from '@/lib/catalog/d1-compare'
import { deriveCatalogRelease } from '@/lib/catalog/release'
import { bundleSchema } from '@/lib/data/schema'
import type { DataBundle } from '@/lib/data/types'

function fixture(): DataBundle {
  const audit = { sourceIds: ['source'], status: 'verified' as const, verifiedAt: '2026-10-17', reviewAfter: '2026-11-16' }
  return bundleSchema.parse({
    sources: [{ id: 'source', url: 'https://example.edu/program', title: 'Official programme', publisher: 'Example', kind: 'program', language: 'en', official: true, accessedAt: '2026-10-17' }],
    cities: [{ ...audit, id: 'city', slug: 'city', name: { en: 'City' }, province: null, region: null, coordinates: null, overview: null, climate: null, foodHighlights: [], sights: [] }],
    universities: [{ ...audit, id: 'school', slug: 'school', name: { en: 'School' }, cityId: 'city', region: null, officialUrl: 'https://example.edu/', admissionsUrl: null, summary: null, featured: false }],
    programs: [{ ...audit, id: 'program', slug: 'program', universityId: 'school', name: { en: 'Chinese study' }, degreeLevel: 'language', discipline: 'chinese-education', teachingLanguages: ['Chinese'], durationMonths: null, durationText: { en: '16 weeks', zh: '16周' }, programUrl: 'https://example.edu/program', applyUrl: 'https://example.edu/apply', languageRequirements: [{ test: 'other', minimum: 'Beginners' }], verificationScope: 'facts' }],
    admissionCycles: [], scholarships: [],
  })
}

describe('official duration through catalogue projections', () => {
  it.each([
    { minimum: 16, unit: 'weeks', wording: '16 weeks' },
    { minimum: 2, unit: 'semesters', wording: '2 semesters' },
  ])('preserves native D1 $unit wording through list and comparison without guessing months', ({ minimum, unit, wording }) => {
    const bundle = fixture(), source = bundle.sources[0]
    const meta = { status: 'known', officialUrl: source.url, sourceTitle: source.title, checkedAt: '2026-10-17', verifiedAt: '2026-10-17', reviewAfter: '2026-11-16', sourceIds: ['source'] }
    const record = {
      id: 'program', slug: 'program',
      attributes: { name: { en: 'Chinese study' }, programType: 'language', degreeLevel: null,
        duration: { minimum, maximum: null, unit }, durationText: { en: wording },
        officialUrl: source.url, disciplineCodes: ['chinese-education'], teachingLanguageCodes: ['zh'] },
      relationships: { institution: { id: 'school', slug: 'school', name: { en: 'School' } } },
      fieldMeta: { name: meta, durationText: meta },
      sources: [{ id: source.id, url: source.url, title: source.title, checkedAt: '2026-10-17' }],
    }
    const release = deriveCatalogRelease(bundle, 'd1')
    const list = parseD1ProgramList({ data: [record], meta: { release, limit: 20, nextCursor: null } }, '2026-10-17')
    expect(list.items[0].program).toMatchObject({ durationMonths: null, durationText: { en: wording } })
    const compared = parseD1ProgramComparison({ data: { items: [{ program: record, currentCycle: null, linkedScholarshipCount: 0 }] }, meta: { release } }, ['program'], '2026-10-17')
    expect(compared.data.items[0].program).toMatchObject({ durationMonths: null, durationText: { en: wording } })
    expect(compared.data.items[0].program.fieldMeta.durationText.status).toBe('known')
  })

  it('preserves exact wording in compatibility payload, localized content, and D1 field facts with null numeric columns', () => {
    const bundle = fixture(), built = buildLegacyRelease(bundle), db = new DatabaseSync(':memory:')
    try {
      for (const name of ['0001_release_core.sql', '0002_programs_scholarships.sql', '0003_search_views.sql', '0004_atomic_release_cutover.sql', '0005_public_projection_hardening.sql', '0009_release_compatibility_artifacts.sql']) db.exec(readFileSync(join(process.cwd(), 'infra/d1/catalog/migrations', name), 'utf8'))
      db.exec(built.sql)
      expect(JSON.parse(built.envelope).data.programs[0]).toMatchObject({ durationMonths: null, durationText: { en: '16 weeks' } })
      expect(db.prepare('SELECT duration_min, duration_max, duration_unit FROM programs WHERE program_id=?').get('program')).toEqual({ duration_min: null, duration_max: null, duration_unit: null })
      const fact = db.prepare("SELECT field_status,value_json FROM record_field_status WHERE record_id=? AND field_path='durationText'").get('program') as { field_status: string; value_json: string }
      expect(fact.field_status).toBe('known')
      expect(JSON.parse(fact.value_json)).toEqual(bundle.programs[0].durationText)
      expect(db.prepare("SELECT text_value FROM localized_content WHERE record_id=? AND field_name='durationText' AND locale='en'").get('program')).toEqual({ text_value: '16 weeks' })
    } finally { db.close() }
  })

  it('returns known wording and unknown months in JSON API and saved comparison', () => {
    const bundle = fixture(), api = new CatalogApiService(bundle, releaseFromBundle(bundle, '2026-10-17'), '2026-10-17')
    const program = api.getProgram('program')!.data
    expect(program.durationText).toEqual({ en: '16 weeks', zh: '16周' })
    expect(program.durationMonths).toBeNull()
    expect(program.fieldMeta.durationText.status).toBe('known')
    expect(program.fieldMeta.durationMonths.status).toBe('officially_not_announced')
    expect(api.comparePrograms(['program']).data.items[0].program.durationText).toEqual(program.durationText)
  })

  it('hides stale textual duration through the same dynamic-fact gate as numeric months', () => {
    const bundle = fixture(), api = new CatalogApiService(bundle, releaseFromBundle(bundle, '2026-10-17'), '2026-11-17')
    const program = api.getProgram('program')!.data
    expect(program.durationText).toBeUndefined()
    expect(program.fieldMeta.durationText.status).toBe('stale')
  })
})
