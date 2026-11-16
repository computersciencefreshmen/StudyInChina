import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildLegacyRelease } from '../../scripts/catalog/build-release'
import type { AdmissionCycle, DataBundle } from '@/lib/data/types'

/** Explicit synthetic schema fixture: no current catalogue facts or reviews are renewed. */
function fixture(): DataBundle {
  const audit = { sourceIds: ['source-synthetic-rounds'], verifiedAt: '2026-11-17', reviewAfter: '2026-12-17', status: 'verified' as const }
  const program = { ...audit, id: 'program-synthetic-rounds', slug: 'synthetic-rounds', universityId: 'university-synthetic-rounds',
    name: { en: 'Synthetic Visual Arts' }, degreeLevel: 'master' as const, discipline: 'art-design' as const,
    teachingLanguages: ['English', 'Chinese'], durationMonths: 12, programUrl: 'https://example.edu.cn/rounds',
    applyUrl: 'https://example.edu.cn/legacy-portal', languageRequirements: [] }
  const cycle: AdmissionCycle = { ...audit, id: 'cycle-synthetic-round1', programId: program.id, academicYear: '2027',
    intake: 'autumn', teachingLanguage: 'English', applicationRound: 'Round 1',
    applyUrl: 'https://example.edu.cn/round1', opensOn: null,
    closesOn: '2027-04-01', dateStatus: 'published', tuitionCny: null, applicationFeeCny: null,
    factScope: 'partial', evidenceBasis: 'cycle-specific' }
  return {
    sources: [{ id: audit.sourceIds[0], url: program.programUrl, title: 'Synthetic two-round evidence', publisher: 'Synthetic fixture',
      kind: 'program', language: 'en', official: true, accessedAt: audit.verifiedAt }],
    cities: [{ ...audit, id: 'city-synthetic-rounds', slug: 'synthetic-rounds', name: { en: 'Synthetic city' },
      province: null, region: 'north', coordinates: null, overview: null, climate: null, foodHighlights: [], sights: [] }],
    universities: [{ ...audit, id: program.universityId, slug: 'synthetic-rounds', name: { en: 'Synthetic university' },
      cityId: 'city-synthetic-rounds', region: 'north', officialUrl: 'https://example.edu.cn', admissionsUrl: null, summary: null, featured: false }],
    programs: [program, { ...program, id: 'program-synthetic-other', slug: 'synthetic-other' }],
    admissionCycles: [cycle,
      { ...cycle, id: 'cycle-synthetic-round2', applicationRound: 'Round 2', applyUrl: 'https://example.edu.cn/round2', closesOn: '2027-06-01' },
      { ...cycle, id: 'cycle-synthetic-chinese', teachingLanguage: 'Chinese', applyUrl: null },
      { ...cycle, id: 'cycle-synthetic-range', academicYear: '2027-2028' },
      { ...cycle, id: 'cycle-synthetic-spring', intake: 'spring' },
      { ...cycle, id: 'cycle-synthetic-other-program', programId: 'program-synthetic-other' }],
    scholarships: [],
  }
}
function database() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  const directory = join(process.cwd(), 'infra/d1/catalog/migrations')
  for (const file of readdirSync(directory).filter(file => /^\d{4}_[a-z0-9_]+\.sql$/u.test(file)).sort()) {
    db.exec(readFileSync(join(directory, file), 'utf8'))
  }
  return db
}

describe('normalized catalogue cycle sequence preserves exact source rounds', () => {
  it('loads both rounds and language tracks, preserving every identity, fingerprint and compatibility payload', () => {
    const bundle = fixture(), before = JSON.stringify(bundle), artifact = buildLegacyRelease(bundle), db = database()
    try {
      // Previously the second and third source cycles collided at sequence=1,
      // so the unchanged atomic release-count guard rejected activation.
      db.exec(artifact.sql)
      db.exec(artifact.sql)
      expect(db.prepare('SELECT release_id FROM current_release').get()!.release_id).toBe(artifact.release.id)
      expect(db.prepare('SELECT COUNT(*) AS count FROM program_cycles').get()!.count).toBe(6)
      expect(db.prepare('SELECT program_cycle_id, sequence FROM program_cycles ORDER BY program_cycle_id').all()).toEqual([
        { program_cycle_id: 'cycle-synthetic-chinese', sequence: 3 },
        { program_cycle_id: 'cycle-synthetic-other-program', sequence: 1 },
        { program_cycle_id: 'cycle-synthetic-range', sequence: 1 },
        { program_cycle_id: 'cycle-synthetic-round1', sequence: 1 },
        { program_cycle_id: 'cycle-synthetic-round2', sequence: 2 },
        { program_cycle_id: 'cycle-synthetic-spring', sequence: 1 },
      ])
      const route = db.prepare(`SELECT route.apply_url, window.round_label FROM application_routes AS route
        JOIN application_windows AS window ON window.release_id = route.release_id
          AND window.application_route_id = route.application_route_id
        WHERE route.release_id = ? AND route.owner_record_id = ?`)
      expect(route.get(artifact.release.id, 'cycle-synthetic-round1')).toEqual({ apply_url: 'https://example.edu.cn/round1', round_label: 'Round 1' })
      expect(route.get(artifact.release.id, 'cycle-synthetic-round2')).toEqual({ apply_url: 'https://example.edu.cn/round2', round_label: 'Round 2' })
      expect(route.get(artifact.release.id, 'cycle-synthetic-chinese')).toEqual({ apply_url: null, round_label: 'Round 1' })
      for (const [id, expected] of [['cycle-synthetic-round1', 'https://example.edu.cn/round1'],
        ['cycle-synthetic-round2', 'https://example.edu.cn/round2'], ['cycle-synthetic-chinese', null]] as const) {
        const leaf = db.prepare(`SELECT value_json, field_status FROM record_field_status
          WHERE release_id = ? AND record_id = ? AND field_path = 'apply_url'`).get(artifact.release.id, `route-${id}`)!
        expect(leaf.value_json).toBe(expected === null ? null : JSON.stringify(expected))
      }
      const envelope = JSON.parse(artifact.envelope)
      expect(envelope.data).toEqual(bundle)
      for (const cycle of envelope.data.admissionCycles) {
        expect(db.prepare('SELECT content_sha256 FROM catalog_records WHERE release_id=? AND record_id=?')
          .get(artifact.release.id, cycle.id)!.content_sha256).toBe(createHash('sha256').update(JSON.stringify(cycle)).digest('hex'))
        expect(db.prepare('SELECT source_id FROM record_sources WHERE release_id=? AND record_id=?')
          .get(artifact.release.id, cycle.id)!.source_id).toBe('source-synthetic-rounds')
      }
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
      expect(db.prepare('PRAGMA integrity_check').get()!.integrity_check).toBe('ok')
      expect(JSON.stringify(bundle)).toBe(before)
      expect(buildLegacyRelease(bundle).sql).toBe(artifact.sql)
    } finally { db.close() }
  })

  it('keeps the original sequence=1 for a single cycle and changes no source object', () => {
    const bundle = fixture()
    bundle.admissionCycles = bundle.admissionCycles.slice(0, 1)
    delete bundle.admissionCycles[0].applyUrl
    delete bundle.admissionCycles[0].applicationRound
    delete bundle.admissionCycles[0].teachingLanguage
    const artifact = buildLegacyRelease(bundle), db = database()
    try {
      db.exec(artifact.sql)
      expect(db.prepare('SELECT program_cycle_id, sequence FROM program_cycles').all())
        .toEqual([{ program_cycle_id: 'cycle-synthetic-round1', sequence: 1 }])
      expect(db.prepare('SELECT apply_url FROM application_routes').get()!.apply_url).toBe('https://example.edu.cn/legacy-portal')
      expect(db.prepare('SELECT round_label FROM application_windows').get()!.round_label).toBeNull()
      expect(JSON.parse(artifact.envelope).data).toEqual(bundle)
    } finally { db.close() }
  })
})
