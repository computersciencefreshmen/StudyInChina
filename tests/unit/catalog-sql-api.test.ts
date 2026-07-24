import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildLegacyRelease, readLegacyBundle } from '../../scripts/catalog/build-release'
import worker from '../../workers/catalog-api/src/index'
import type {
  CatalogApiEnv,
  D1PreparedStatement,
  D1Result,
  R2ObjectBody,
} from '../../workers/catalog-api/src/types'
import type {
  ApiEnvelopeDto,
  InstitutionDto,
  DegreeLevel,
  ProgramCycleDto,
  ProgramDto,
  ProgramType,
  ScholarshipCycleDto,
  ScholarshipDto,
} from '../../workers/catalog-api/src/sql-types'

type QueryLog = { sql: string; values: unknown[] }

class SqliteD1Statement implements D1PreparedStatement {
  constructor(
    private readonly database: DatabaseSync,
    private readonly queries: QueryLog[],
    private readonly sql: string,
    private readonly values: unknown[] = [],
  ) {}

  bind(...values: unknown[]) {
    return new SqliteD1Statement(this.database, this.queries, this.sql, values)
  }

  async first<T = Record<string, unknown>>() {
    this.queries.push({ sql: this.sql, values: this.values })
    const result = this.database.prepare(this.sql).get(...this.sqliteValues())
    return (result ?? null) as T | null
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    this.queries.push({ sql: this.sql, values: this.values })
    try {
      const results = this.database.prepare(this.sql).all(...this.sqliteValues()) as T[]
      return { success: true, results }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  private sqliteValues() {
    return this.values as Array<string | number | bigint | Uint8Array | null>
  }
}

function applyCatalogMigrations(database: DatabaseSync) {
  const directory = join(process.cwd(), 'infra', 'd1', 'catalog', 'migrations')
  for (const file of readdirSync(directory).filter((name) => name.endsWith('.sql')).sort()) {
    database.exec(readFileSync(join(directory, file), 'utf8'))
  }
}

describe('Catalog D1 normalized v1 API', () => {
  let database: DatabaseSync
  let environment: CatalogApiEnv
  let r2Reads: number
  let queries: QueryLog[]
  let compatibilityEnvelope: string

  beforeAll(() => {
    database = new DatabaseSync(':memory:')
    database.exec('PRAGMA foreign_keys = ON')
    applyCatalogMigrations(database)
    const artifacts = buildLegacyRelease(readLegacyBundle())
    compatibilityEnvelope = artifacts.envelope
    database.exec(artifacts.sql)
    database.prepare(`
      INSERT OR IGNORE INTO release_compatibility_artifacts (
        release_id, artifact_format, artifact_key, content_sha256, byte_length, created_at
      ) VALUES (?, 'studyinchina.frontend.bundle.v1', ?, ?, ?, ?)
    `).run(
      artifacts.release.id,
      artifacts.r2Key,
      artifacts.contentSha256,
      new TextEncoder().encode(compatibilityEnvelope).byteLength,
      artifacts.release.generatedAt,
    )
    r2Reads = 0
    queries = []
    environment = {
      CATALOG_DB: {
        prepare(sql: string) {
          return new SqliteD1Statement(database, queries, sql)
        },
      },
      RELEASES_BUCKET: {
        async get(key: string): Promise<R2ObjectBody | null> {
          r2Reads += 1
          if (!key.endsWith('/compat-envelope.json')) return null
          return {
            body: new Response(compatibilityEnvelope).body,
            size: new TextEncoder().encode(compatibilityEnvelope).byteLength,
          }
        },
      },
      CATALOG_API_TOKEN: 'shadow-secret',
    }
  })

  afterAll(() => database.close())

  it('queries the active release through current_* views with stable cursor pagination', async () => {
    const representableProgramTypes: ProgramType[] = [
      'degree', 'language', 'foundation', 'exchange', 'visiting', 'short_term', 'other',
    ]
    const doctorate: DegreeLevel = 'doctorate'
    expect(representableProgramTypes).toContain('exchange')
    expect(representableProgramTypes).toContain('visiting')
    expect(representableProgramTypes).toContain('short_term')
    expect(doctorate).toBe('doctorate')
    const firstResponse = await worker.fetch(
      new Request('https://catalog.test/api/v1/programs?limit=2'),
      environment,
    )
    const first = await firstResponse.json() as ApiEnvelopeDto<ProgramDto[]>
    expect(firstResponse.status).toBe(200)
    expect(first.meta.apiVersion).toBe('v1')
    expect(first.data).toHaveLength(2)
    expect(first.meta.nextCursor).toEqual(expect.any(String))
    expect(first.data[0]).toMatchObject({
      type: 'program',
      attributes: { programType: expect.any(String) },
      fieldMeta: {
        programType: {
          status: 'known',
          officialUrl: expect.stringMatching(/^https:\/\//u),
          sourceTitle: expect.any(String),
          checkedAt: expect.any(String),
        },
      },
    })
    expect(first.data[0]).not.toHaveProperty('universityId')
    expect(first.data[0]).not.toHaveProperty('status')

    const secondResponse = await worker.fetch(
      new Request(`https://catalog.test/api/v1/programs?limit=2&cursor=${encodeURIComponent(first.meta.nextCursor!)}`),
      environment,
    )
    const second = await secondResponse.json() as ApiEnvelopeDto<ProgramDto[]>
    expect(secondResponse.status).toBe(200)
    expect(second.data).toHaveLength(2)
    expect(second.data.map((item) => item.id)).not.toContain(first.data[0]!.id)
    expect(second.data.map((item) => item.id)).not.toContain(first.data[1]!.id)
    expect(r2Reads).toBe(0)
    expect(queries.some(({ sql }) => sql.includes('FROM current_programs AS program'))).toBe(true)
  })

  it('uses FTS5 only with current_search_documents and supports the locked filters', async () => {
    const seedResponse = await worker.fetch(
      new Request('https://catalog.test/api/v1/programs?limit=1'),
      environment,
    )
    const seed = await seedResponse.json() as ApiEnvelopeDto<ProgramDto[]>
    const program = seed.data[0]!
    const englishName = program.attributes.name.en ?? Object.values(program.attributes.name)[0]!
    const searchTerm = englishName.split(/\s+/u).find((term) => term.length > 2) ?? englishName
    const before = queries.length
    const searchResponse = await worker.fetch(
      new Request(`https://catalog.test/api/v1/programs?q=${encodeURIComponent(searchTerm)}&limit=10`),
      environment,
    )
    const search = await searchResponse.json() as ApiEnvelopeDto<ProgramDto[]>
    expect(searchResponse.status).toBe(200)
    expect(search.data.map((item) => item.id)).toContain(program.id)
    const ftsQuery = queries.slice(before).find(({ sql }) => sql.includes('search_fts MATCH'))
    expect(ftsQuery?.sql).toContain('JOIN current_search_documents AS search_document')
    expect(ftsQuery?.sql).toContain('search_fts MATCH ?')
    expect(ftsQuery?.sql).not.toMatch(/JOIN\s+search_documents\b/u)
    expect(ftsQuery?.values.some((value) => String(value).includes(searchTerm))).toBe(true)

    const filteredResponse = await worker.fetch(
      new Request(`https://catalog.test/api/v1/programs?type=${program.attributes.programType}${program.attributes.degreeLevel ? `&degree=${program.attributes.degreeLevel}` : ''}&institution=${program.relationships.institution.id}&limit=10`),
      environment,
    )
    const filtered = await filteredResponse.json() as ApiEnvelopeDto<ProgramDto[]>
    expect(filteredResponse.status).toBe(200)
    expect(filtered.data.map((item) => item.id)).toContain(program.id)
    expect(r2Reads).toBe(0)
  })

  it('serves normalized institution, program-cycle, and scholarship projections from D1', async () => {
    const institutionResponse = await worker.fetch(
      new Request('https://catalog.test/api/v1/institutions?limit=1'),
      environment,
    )
    const institutions = await institutionResponse.json() as ApiEnvelopeDto<InstitutionDto[]>
    expect(institutionResponse.status).toBe(200)
    expect(institutions.data[0]).toMatchObject({
      type: 'institution',
      relationships: { programs: { count: expect.any(Number) } },
    })

    const withCycle = database.prepare(`
      SELECT record.slug
      FROM current_programs AS program
      JOIN current_program_cycles AS cycle
        ON cycle.release_id = program.release_id AND cycle.program_id = program.program_id
      JOIN current_catalog_records AS record
        ON record.release_id = program.release_id AND record.record_id = program.program_id
      WHERE record.slug IS NOT NULL
      ORDER BY record.slug
      LIMIT 1
    `).get() as { slug: string }
    const cycleResponse = await worker.fetch(
      new Request(`https://catalog.test/api/v1/programs/${withCycle.slug}/cycles`),
      environment,
    )
    const cycles = await cycleResponse.json() as ApiEnvelopeDto<ProgramCycleDto[]>
    expect(cycleResponse.status).toBe(200)
    expect(cycles.data[0]).toMatchObject({ type: 'program_cycle' })

    const scholarshipResponse = await worker.fetch(
      new Request('https://catalog.test/api/v1/scholarships?limit=1'),
      environment,
    )
    const scholarships = await scholarshipResponse.json() as ApiEnvelopeDto<ScholarshipDto[]>
    expect(scholarshipResponse.status).toBe(200)
    expect(scholarships.data[0]).toMatchObject({
      type: 'scholarship',
      fieldMeta: { deadline: { status: expect.any(String) } },
    })
    const scholarshipCyclesResponse = await worker.fetch(
      new Request(`https://catalog.test/api/v1/scholarships/${scholarships.data[0]!.slug}/cycles`),
      environment,
    )
    const scholarshipCycles = await scholarshipCyclesResponse.json() as ApiEnvelopeDto<ScholarshipCycleDto[]>
    expect(scholarshipCyclesResponse.status).toBe(200)
    expect(scholarshipCycles.data[0]).toMatchObject({
      type: 'scholarship_cycle',
      attributes: { legacyProjection: true },
    })
    expect(r2Reads).toBe(0)
  })

  it('lists and resolves an unannounced zero-cycle scholarship without fabricated values', async () => {
    database.exec('BEGIN')
    try {
      const scholarship = database.prepare(`
        SELECT visible.scholarship_id, record.slug
        FROM current_scholarships AS visible
        JOIN current_catalog_records AS record
          ON record.release_id = visible.release_id
         AND record.record_id = visible.scholarship_id
        WHERE record.slug IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM scholarship_cycles AS cycle
            WHERE cycle.release_id = visible.release_id
              AND cycle.scholarship_id = visible.scholarship_id
          )
        ORDER BY visible.scholarship_id
        LIMIT 1
      `).get() as { scholarship_id: string; slug: string }
      database.prepare(`
        DELETE FROM record_field_status
        WHERE record_id = ?
          AND (
            field_path IN ('deadline', 'closes_on')
            OR field_path LIKE 'coverage.%'
          )
      `).run(scholarship.scholarship_id)

      const listResponse = await worker.fetch(
        new Request('https://catalog.test/api/v1/scholarships?limit=100'),
        environment,
      )
      const list = await listResponse.json() as ApiEnvelopeDto<ScholarshipDto[]>
      const listed = list.data.find((item) => item.id === scholarship.scholarship_id)!
      expect(listResponse.status).toBe(200)
      expect(listed.attributes).toMatchObject({
        deadline: null,
        coverage: { tuition: null, accommodation: null, insurance: null, stipendCnyPerMonth: null },
      })
      expect(listed.fieldMeta).toMatchObject({
        deadline: { status: 'officially_not_announced' },
        'coverage.tuition': { status: 'officially_not_announced' },
        'coverage.accommodation': { status: 'officially_not_announced' },
        'coverage.insurance': { status: 'officially_not_announced' },
        'coverage.stipendCnyPerMonth': { status: 'officially_not_announced' },
      })

      const detailResponse = await worker.fetch(
        new Request(`https://catalog.test/api/v1/scholarships/${scholarship.slug}`),
        environment,
      )
      const detail = await detailResponse.json() as ApiEnvelopeDto<ScholarshipDto>
      expect(detailResponse.status).toBe(200)
      expect(detail.data).toEqual(listed)
    } finally {
      database.exec('ROLLBACK')
    }
  })

  it('lists identity-only programs as not announced without exposing a cycle or route', async () => {
    database.exec('BEGIN')
    try {
      const program = database.prepare(`
        SELECT visible.program_id, visible.institution_id, record.slug
        FROM current_programs AS visible
        JOIN current_catalog_records AS record
          ON record.release_id = visible.release_id
         AND record.record_id = visible.program_id
        WHERE visible.program_type NOT IN ('exchange', 'visiting', 'short_term')
          AND record.slug IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM current_program_cycles AS cycle
            WHERE cycle.release_id = visible.release_id
              AND cycle.program_id = visible.program_id
          )
        ORDER BY visible.program_id
        LIMIT 1
      `).get() as { program_id: string; institution_id: string; slug: string }
      database.prepare(`
        UPDATE program_cycles
        SET cycle_status = 'archived'
        WHERE program_id = ?
      `).run(program.program_id)
      database.prepare(`
        UPDATE programs
        SET duration_min = NULL, duration_max = NULL, duration_unit = NULL
        WHERE program_id = ?
      `).run(program.program_id)
      database.prepare(`
        DELETE FROM record_field_status
        WHERE record_id = ?
          AND field_path IN (
            'duration_min', 'durationMonths', 'duration_max', 'durationMonthsMax',
            'duration_unit', 'apply_url', 'applyUrl', 'teachingLanguages',
            'teaching_languages'
          )
      `).run(program.program_id)
      database.prepare(`
        DELETE FROM program_teaching_languages WHERE program_id = ?
      `).run(program.program_id)


      const response = await worker.fetch(new Request(
        `https://catalog.test/api/v1/programs?institution=${program.institution_id}&applicationState=not-announced&limit=100`,
      ), environment)
      const programs = await response.json() as ApiEnvelopeDto<ProgramDto[]>
      expect(response.status).toBe(200)
      expect(programs.data.map((item) => item.id)).toContain(program.program_id)

      const listed = programs.data.find((item) => item.id === program.program_id)!
      expect(listed.attributes).toMatchObject({
        duration: { minimum: null, maximum: null, unit: null },
        teachingLanguageCodes: [],
        applyUrl: null,
      })
      expect(listed.fieldMeta).toMatchObject({
        'duration.minimum': { status: 'officially_not_announced' },
        'duration.maximum': { status: 'officially_not_announced' },
        'duration.unit': { status: 'officially_not_announced' },
        teachingLanguageCodes: { status: 'officially_not_announced' },
        applyUrl: { status: 'officially_not_announced' },
      })

      const detailResponse = await worker.fetch(
        new Request(`https://catalog.test/api/v1/programs/${program.slug}`),
        environment,
      )
      const detail = await detailResponse.json() as ApiEnvelopeDto<ProgramDto>
      expect(detailResponse.status).toBe(200)
      expect(detail.data).toEqual(listed)

      const cyclesResponse = await worker.fetch(
        new Request(`https://catalog.test/api/v1/programs/${program.slug}/cycles`),
        environment,
      )
      const cycles = await cyclesResponse.json() as ApiEnvelopeDto<ProgramCycleDto[]>
      expect(cyclesResponse.status).toBe(200)
      expect(cycles.data).toEqual([])
    } finally {
      database.exec('ROLLBACK')
    }
  })

  it('rejects oversized limits and cursors bound to another resource', async () => {
    const oversized = await worker.fetch(
      new Request('https://catalog.test/api/v1/programs?limit=101'),
      environment,
    )
    expect(oversized.status).toBe(400)

    const programsResponse = await worker.fetch(
      new Request('https://catalog.test/api/v1/programs?limit=1'),
      environment,
    )
    const programs = await programsResponse.json() as ApiEnvelopeDto<ProgramDto[]>
    const wrongResource = await worker.fetch(
      new Request(`https://catalog.test/api/v1/institutions?cursor=${encodeURIComponent(programs.meta.nextCursor!)}`),
      environment,
    )
    expect(wrongResource.status).toBe(400)
  })

  it('keeps opportunities through day 30 and hides them everywhere on day 31', async () => {
    database.exec('BEGIN')
    try {
      const program = database.prepare(`
        SELECT visible.program_id, record.slug
        FROM current_programs AS visible
        JOIN current_catalog_records AS record
          ON record.release_id = visible.release_id AND record.record_id = visible.program_id
        WHERE EXISTS (
          SELECT 1
          FROM program_cycles AS cycle
          JOIN application_routes AS route
            ON route.release_id = cycle.release_id AND route.owner_record_id = cycle.program_cycle_id
          JOIN application_windows AS window
            ON window.release_id = route.release_id
           AND window.application_route_id = route.application_route_id
          WHERE cycle.release_id = visible.release_id AND cycle.program_id = visible.program_id
        )
        ORDER BY visible.program_id
        LIMIT 1
      `).get() as { program_id: string; slug: string }

      const setDeadline = (modifier: string) => {
        const deadline = database.prepare(
          `SELECT date('now', '+8 hours', ?) AS value`,
        ).get(modifier)!.value as string
        database.prepare(`
          UPDATE application_windows
          SET closes_on = ?, rolling = 0
          WHERE application_route_id IN (
            SELECT route.application_route_id
            FROM application_routes AS route
            JOIN program_cycles AS cycle
              ON cycle.release_id = route.release_id
             AND cycle.program_cycle_id = route.owner_record_id
            WHERE cycle.program_id = ?
          )
        `).run(deadline, program.program_id)
        database.prepare(`
          UPDATE record_field_status
          SET field_status = 'known', value_json = json_quote(?), review_after = '9999-12-31'
          WHERE field_path = 'closes_on'
            AND record_id IN (
              SELECT window.application_window_id
              FROM application_windows AS window
              JOIN application_routes AS route
                ON route.release_id = window.release_id
               AND route.application_route_id = window.application_route_id
              JOIN program_cycles AS cycle
                ON cycle.release_id = route.release_id
               AND cycle.program_cycle_id = route.owner_record_id
              WHERE cycle.program_id = ?
            )
        `).run(deadline, program.program_id)
      }

      setDeadline('-30 days')
      expect(database.prepare(
        'SELECT COUNT(*) AS count FROM current_programs WHERE program_id = ?',
      ).get(program.program_id)!.count).toBe(1)
      expect(database.prepare(
        'SELECT COUNT(*) AS count FROM current_search_documents WHERE record_id = ?',
      ).get(program.program_id)!.count).toBeGreaterThan(0)

      setDeadline('-31 days')
      expect(database.prepare(
        'SELECT COUNT(*) AS count FROM current_programs WHERE program_id = ?',
      ).get(program.program_id)!.count).toBe(0)
      expect(database.prepare(
        'SELECT COUNT(*) AS count FROM current_program_cycles WHERE program_id = ?',
      ).get(program.program_id)!.count).toBe(0)
      expect(database.prepare(
        'SELECT COUNT(*) AS count FROM current_search_documents WHERE record_id = ?',
      ).get(program.program_id)!.count).toBe(0)

      const detail = await worker.fetch(
        new Request(`https://catalog.test/api/v1/programs/${program.slug}`),
        environment,
      )
      expect(detail.status).toBe(404)
    } finally {
      database.exec('ROLLBACK')
    }
  })

  it('reads the legacy R2 envelope only through the authenticated shadow endpoint', async () => {
    expect(r2Reads).toBe(0)
    const response = await worker.fetch(new Request(
      'https://catalog.test/internal/v1/catalog-bundle',
      { headers: { authorization: 'Bearer shadow-secret' } },
    ), environment)
    expect(response.status).toBe(200)
    expect(r2Reads).toBe(1)
    expect(createHash('sha256').update(await response.text()).digest('hex')).toBe(
      database.prepare(`
        SELECT content_sha256 FROM release_compatibility_artifacts
        WHERE release_id = (SELECT release_id FROM current_release)
      `).get()!.content_sha256,
    )
  })
})
