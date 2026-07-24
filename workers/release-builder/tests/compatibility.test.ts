import assert from 'node:assert/strict'
import test from 'node:test'
import { bundleSchema } from '../../../src/lib/data/schema'
import {
  buildCompatibilityArtifact,
  ensureImmutableCompatibilityArtifact,
} from '../src/compatibility'
import { RELEASE_TABLES, type ReleaseArtifact, type SqlRow } from '../src/types'

function fixture(): ReleaseArtifact {
  const releaseId = 'catalog-release-compat-test'
  const tables = Object.fromEntries(
    RELEASE_TABLES.map((table) => [table, [] as SqlRow[]]),
  ) as ReleaseArtifact['tables']
  const audit = {
    release_id: releaseId,
    gate_status: 'publishable',
    verified_at: '2026-07-24',
    review_after: '2026-08-20',
    content_sha256: 'a'.repeat(64),
  }
  tables.catalog_records.push(
    { ...audit, record_id: 'city-beijing', record_kind: 'location', slug: 'beijing' },
    { ...audit, record_id: 'university-test', record_kind: 'organization', slug: 'test-university' },
    { ...audit, record_id: 'program-test', record_kind: 'program', slug: 'test-doctorate' },
  )
  tables.source_summaries.push({
    release_id: releaseId,
    source_id: 'source-program-test',
    url: 'https://example.edu.cn/programs/test-doctorate',
    title: 'Official doctoral catalogue',
    publisher: 'Test University',
    source_kind: 'program',
    language_code: 'zh',
    authority_level: 'primary_official',
    checked_at: '2026-07-24T08:00:00.000Z',
  })
  for (const recordId of ['city-beijing', 'university-test', 'program-test']) {
    tables.record_sources.push({
      release_id: releaseId,
      record_id: recordId,
      field_path: '*',
      locale: '',
      source_id: 'source-program-test',
      evidence_role: 'primary',
    })
  }
  tables.localized_content.push(
    {
      release_id: releaseId,
      record_id: 'city-beijing',
      locale: 'zh',
      field_name: 'name',
      text_value: '北京市',
      translation_status: 'reviewed',
      source_locale: null,
    },
    {
      release_id: releaseId,
      record_id: 'university-test',
      locale: 'en',
      field_name: 'name',
      text_value: 'Test University',
      translation_status: 'reviewed',
      source_locale: null,
    },
    {
      release_id: releaseId,
      record_id: 'program-test',
      locale: 'zh',
      field_name: 'name',
      text_value: '测试博士项目',
      translation_status: 'reviewed',
      source_locale: null,
    },
  )
  tables.locations.push({
    release_id: releaseId,
    location_id: 'city-beijing',
    parent_location_id: null,
    location_type: 'city',
    country_code: 'CN',
    region_code: null,
    latitude: null,
    longitude: null,
  })
  tables.organizations.push({
    release_id: releaseId,
    organization_id: 'university-test',
    organization_type: 'university',
    official_url: 'https://example.edu.cn',
  })
  tables.institutions.push({
    release_id: releaseId,
    institution_id: 'university-test',
    city_id: 'city-beijing',
    institution_type: 'comprehensive',
    admissions_url: 'https://example.edu.cn/admissions',
    featured: 1,
  })
  tables.programs.push({
    release_id: releaseId,
    program_id: 'program-test',
    institution_id: 'university-test',
    academic_unit_id: null,
    parent_program_id: null,
    program_type: 'degree',
    degree_level: 'doctorate',
    credential_type: null,
    attendance_mode: 'full_time',
    delivery_mode: 'on_campus',
    duration_min: 36,
    duration_max: null,
    duration_unit: 'months',
    official_url: 'https://example.edu.cn/programs/test-doctorate',
  })
  tables.record_field_status.push(
    {
      release_id: releaseId,
      record_id: 'program-test',
      field_path: 'duration_min',
      locale: '',
      field_status: 'known',
      required_for_publish: 0,
      value_json: '36',
      verified_at: '2026-07-24',
      review_after: '2026-08-20',
    },
    {
      release_id: releaseId,
      record_id: 'program-test',
      field_path: 'duration_unit',
      locale: '',
      field_status: 'known',
      required_for_publish: 0,
      value_json: '"months"',
      verified_at: '2026-07-24',
      review_after: '2026-08-20',
    },
  )
  return {
    format: 'studyinchina.catalog.release',
    formatVersion: 1,
    manifest: {
      releaseId,
      dataVersion: 1,
      schemaVersion: 1,
      dataDate: '2026-07-24',
      generatedAt: '2026-07-24T08:00:00.000Z',
      sourcePipelineRunId: 'publication-test',
      counts: {
        sources: 1,
        cities: 1,
        universities: 1,
        programs: 1,
        admissionCycles: 0,
        scholarships: 0,
      },
    },
    tableDigests: Object.fromEntries(
      RELEASE_TABLES.map((table) => [table, '0'.repeat(64)]),
    ) as ReleaseArtifact['tableDigests'],
    tables,
  }
}

test('normalized identity facts produce a deterministic schema-valid compatibility envelope', async () => {
  const first = await buildCompatibilityArtifact(fixture())
  const second = await buildCompatibilityArtifact(fixture())
  assert.deepEqual(first, second)
  const envelope = JSON.parse(first.text) as { data: unknown }
  const data = bundleSchema.parse(envelope.data)
  assert.equal(data.programs[0]?.degreeLevel, 'doctorate')
  assert.equal(data.programs[0]?.discipline, 'other')
  assert.deepEqual(data.programs[0]?.teachingLanguages, [])
  assert.equal(data.programs[0]?.applyUrl, null)
  assert.notEqual(data.programs[0]?.applyUrl, data.programs[0]?.programUrl)
  assert.equal(data.cities[0]?.province, null)
  assert.equal(data.cities[0]?.overview, null)
  assert.equal(data.cities[0]?.climate, null)
  assert.equal(data.universities[0]?.summary, null)
})

test('compatibility generation fails closed when an institution city is missing', async () => {
  const artifact = fixture()
  artifact.tables.institutions[0]!.city_id = 'city-missing'
  await assert.rejects(
    buildCompatibilityArtifact(artifact),
    /references invalid city city-missing/u,
  )
})

test('compatibility R2 writes are idempotent and collisions fail closed', async () => {
  const artifact = await buildCompatibilityArtifact(fixture())
  const objects = new Map<string, Uint8Array>()
  let puts = 0
  const bucket = {
    async get(key: string) {
      const value = objects.get(key)
      return value
        ? { arrayBuffer: async () => value.slice().buffer }
        : null
    },
    async head() { return null },
    async put(key: string, value: string | ArrayBuffer | ArrayBufferView) {
      puts += 1
      const bytes = typeof value === 'string'
        ? new TextEncoder().encode(value)
        : value instanceof ArrayBuffer
          ? new Uint8Array(value)
          : new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
      objects.set(key, bytes.slice())
    },
  }
  await ensureImmutableCompatibilityArtifact(bucket, artifact)
  await ensureImmutableCompatibilityArtifact(bucket, artifact)
  assert.equal(puts, 1)
  objects.set(artifact.key, new TextEncoder().encode('{}'))
  await assert.rejects(
    ensureImmutableCompatibilityArtifact(bucket, artifact),
    /already bound to different bytes/u,
  )
})
