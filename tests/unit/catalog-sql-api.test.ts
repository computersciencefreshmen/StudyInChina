import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildLegacyRelease, readLegacyBundle } from '../../scripts/catalog/build-release'
import worker from '../../workers/catalog-api/src/index'
import { chinaCalendarDate } from '../../workers/catalog-api/src/sql-data'
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
  }, 30_000)

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
      new Request('https://catalog.test/api/v1/programs?limit=1'),
      environment,
    )
    const first = await firstResponse.json() as ApiEnvelopeDto<ProgramDto[]>
    expect(firstResponse.status).toBe(200)
    expect(first.meta.apiVersion).toBe('v1')
    expect(first.data).toHaveLength(1)
    expect(first.meta.total).toBeGreaterThan(first.data.length)
    expect(first.meta.facets?.universities?.length).toBeGreaterThan(1)
    expect(first.meta.facets?.cities?.length).toBeGreaterThan(1)
    expect(first.data[0]).toHaveProperty('currentCycle')
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
      new Request(`https://catalog.test/api/v1/programs?limit=1&cursor=${encodeURIComponent(first.meta.nextCursor!)}`),
      environment,
    )
    const second = await secondResponse.json() as ApiEnvelopeDto<ProgramDto[]>
    expect(secondResponse.status).toBe(200)
    expect(second.data).toHaveLength(1)
    expect(second.data.map((item) => item.id)).not.toContain(first.data[0]!.id)
    expect(r2Reads).toBe(0)
    expect(queries.some(({ sql }) => sql.includes('FROM current_programs AS program'))).toBe(true)
  }, 30_000)

  it('compares at most four programs from normalized SQL without reading the R2 bundle', async () => {
    const listResponse = await worker.fetch(
      new Request('https://catalog.test/api/v1/programs?limit=2'),
      environment,
    )
    const list = await listResponse.json() as ApiEnvelopeDto<ProgramDto[]>
    const ids = list.data.map((program) => program.id)
    expect(ids).toHaveLength(2)

    queries.length = 0
    const readsBefore = r2Reads
    const response = await worker.fetch(
      new Request(
        `https://catalog.test/api/v1/programs/compare?ids=${encodeURIComponent(`${ids.join(',')},prog-missing-record`)}`,
      ),
      environment,
    )
    const payload = await response.json() as ApiEnvelopeDto<{
      items: Array<{
        program: ProgramDto
        currentCycle: ProgramCycleDto | null
        linkedScholarshipCount: number
      }>
      missingIds: string[]
    }>

    expect(response.status, JSON.stringify(payload)).toBe(200)
    expect(payload.data.items.map((item) => item.program.id)).toEqual(ids)
    expect(payload.data.missingIds).toEqual(['prog-missing-record'])
    expect(payload.data.items.every((item) => (
      Number.isInteger(item.linkedScholarshipCount)
      && item.linkedScholarshipCount >= 0
      && item.program.attributes.officialUrl.startsWith('https://')
      && (item.program.attributes.applyUrl === null
        || item.program.attributes.applyUrl.startsWith('https://'))
    ))).toBe(true)
    expect(JSON.stringify(payload).length).toBeLessThan(150_000)
    expect(r2Reads).toBe(readsBefore)
    expect(queries.some(({ sql }) => sql.includes('target_programs AS MATERIALIZED'))).toBe(true)
  }, 30_000)

  it('filters programs to any explicitly linked scholarship without treating linked as a slug', async () => {
    queries.length = 0
    const response = await worker.fetch(
      new Request('https://catalog.test/api/v1/programs?scholarship=linked&limit=24'),
      environment,
    )
    const payload = await response.json() as ApiEnvelopeDto<ProgramDto[]>

    expect(response.status, JSON.stringify(payload)).toBe(200)
    expect(payload.data.length).toBeGreaterThan(0)
    const linkedScopeQueries = queries.filter(({ sql }) =>
      sql.includes('selected_scholarships AS MATERIALIZED'),
    )
    expect(linkedScopeQueries).toHaveLength(4)
    expect(linkedScopeQueries.every(({ sql }) =>
      (sql.match(/selected_scholarships AS MATERIALIZED/gu) ?? []).length === 1,
    )).toBe(true)
    expect(linkedScopeQueries.every(({ sql }) =>
      sql.includes('FROM current_scholarships AS scholarship'),
    )).toBe(true)
    expect(linkedScopeQueries.every(({ sql }) =>
      sql.includes('normalized_cycles AS MATERIALIZED'),
    )).toBe(true)
    expect(linkedScopeQueries.every(({ sql }) =>
      sql.includes('CROSS JOIN record_field_status AS scope'),
    )).toBe(true)
    expect(linkedScopeQueries.some(({ sql }) =>
      sql.includes("scope.field_path IN ('universityIds', 'institution_ids')"),
    )).toBe(false)
    expect(linkedScopeQueries.some(({ sql }) =>
      sql.includes('FROM current_programs AS scoped_program')
      || sql.includes('FROM current_scholarship_cycles AS'),
    )).toBe(false)
    expect(queries.some(({ values }) => values.includes('linked'))).toBe(false)
  }, 30_000)

  it('keeps legacy university attribution from broadening an explicit program subset', async () => {
    database.exec('BEGIN')
    try {
      const release = database.prepare(`
        SELECT current_release_id AS release_id
        FROM release_pointer
        WHERE singleton_id = 1
      `).get() as { release_id: string }
      const institution = database.prepare(`
        SELECT institution_id
        FROM current_programs
        WHERE release_id = ?
        GROUP BY institution_id
        HAVING COUNT(*) >= 2
        ORDER BY institution_id
        LIMIT 1
      `).get(release.release_id) as { institution_id: string }
      const programs = database.prepare(`
        SELECT program_id
        FROM current_programs
        WHERE release_id = ? AND institution_id = ?
        ORDER BY program_id
        LIMIT 2
      `).all(
        release.release_id,
        institution.institution_id,
      ) as Array<{ program_id: string }>
      const targetProgram = programs[0]!
      const siblingProgram = programs[1]!
      const scholarship = database.prepare(`
        SELECT visible.scholarship_id, record.slug
        FROM current_scholarships AS visible
        JOIN current_catalog_records AS record
          ON record.release_id = visible.release_id
         AND record.record_id = visible.scholarship_id
        WHERE visible.release_id = ?
          AND record.slug IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM current_scholarship_cycles AS cycle
            WHERE cycle.release_id = visible.release_id
              AND cycle.scholarship_id = visible.scholarship_id
          )
        ORDER BY visible.scholarship_id
        LIMIT 1
      `).get(release.release_id) as { scholarship_id: string; slug: string }

      database.prepare(`
        DELETE FROM record_field_status
        WHERE release_id = ?
          AND record_id = ?
          AND field_path IN ('programIds', 'program_ids', 'universityIds', 'institution_ids')
      `).run(release.release_id, scholarship.scholarship_id)
      const insertScope = database.prepare(`
        INSERT INTO record_field_status (
          release_id, record_id, field_path, locale, field_status,
          required_for_publish, value_json, verified_at, review_after
        ) VALUES (?, ?, ?, '', 'known', 0, ?, '2026-08-25', '2030-08-25')
      `)
      insertScope.run(
        release.release_id,
        scholarship.scholarship_id,
        'universityIds',
        JSON.stringify([institution.institution_id]),
      )
      insertScope.run(
        release.release_id,
        scholarship.scholarship_id,
        'programIds',
        JSON.stringify([]),
      )

      const compare = async () => {
        const response = await worker.fetch(
          new Request(
            `https://catalog.test/api/v1/programs/compare?ids=${encodeURIComponent(`${targetProgram.program_id},${siblingProgram.program_id}`)}`,
          ),
          environment,
        )
        const payload = await response.json() as ApiEnvelopeDto<{
          items: Array<{
            program: ProgramDto
            currentCycle: ProgramCycleDto | null
            linkedScholarshipCount: number
          }>
          missingIds: string[]
        }>
        expect(response.status, JSON.stringify(payload)).toBe(200)
        return new Map(payload.data.items.map((item) => [
          item.program.id,
          item.linkedScholarshipCount,
        ]))
      }

      const before = await compare()
      database.prepare(`
        UPDATE record_field_status
        SET value_json = ?
        WHERE release_id = ?
          AND record_id = ?
          AND field_path = 'programIds'
          AND locale = ''
      `).run(
        JSON.stringify([targetProgram.program_id]),
        release.release_id,
        scholarship.scholarship_id,
      )

      const filteredResponse = await worker.fetch(
        new Request(
          `https://catalog.test/api/v1/programs?scholarship=${encodeURIComponent(scholarship.slug)}&limit=100`,
        ),
        environment,
      )
      const filtered = await filteredResponse.json() as ApiEnvelopeDto<ProgramDto[]>
      expect(filteredResponse.status, JSON.stringify(filtered)).toBe(200)
      expect(filtered.data.map((program) => program.id)).toEqual([targetProgram.program_id])
      expect(filtered.data.map((program) => program.id)).not.toContain(siblingProgram.program_id)

      const after = await compare()
      expect(after.get(targetProgram.program_id)).toBe((before.get(targetProgram.program_id) ?? 0) + 1)
      expect(after.get(siblingProgram.program_id)).toBe(before.get(siblingProgram.program_id))
    } finally {
      database.exec('ROLLBACK')
    }
  }, 30_000)

  it('uses current normalized scholarship cycle scopes without legacy scope fields', async () => {
    database.exec('BEGIN')
    try {
      const release = database.prepare(`
        SELECT current_release_id AS release_id
        FROM release_pointer
        WHERE singleton_id = 1
      `).get() as { release_id: string }
      const scholarship = database.prepare(`
        SELECT scholarship_id
        FROM current_scholarships
        WHERE release_id = ?
        ORDER BY scholarship_id
        LIMIT 1
      `).get(release.release_id) as { scholarship_id: string }
      const source = database.prepare(`
        SELECT source_id
        FROM source_summaries
        WHERE release_id = ?
        ORDER BY source_id
        LIMIT 1
      `).get(release.release_id) as { source_id: string }
      const directProgram = database.prepare(`
        SELECT program_id, institution_id
        FROM current_programs
        WHERE release_id = ?
        ORDER BY program_id
        LIMIT 1
      `).get(release.release_id) as { program_id: string; institution_id: string }
      const institutionalScope = database.prepare(`
        SELECT institution_id, COUNT(*) AS program_count
        FROM current_programs
        WHERE release_id = ? AND institution_id <> ?
        GROUP BY institution_id
        HAVING COUNT(*) BETWEEN 2 AND 20
        ORDER BY institution_id
        LIMIT 1
      `).get(
        release.release_id,
        directProgram.institution_id,
      ) as { institution_id: string; program_count: number }
      const institutionalPrograms = database.prepare(`
        SELECT program_id
        FROM current_programs
        WHERE release_id = ? AND institution_id = ?
        ORDER BY program_id
      `).all(
        release.release_id,
        institutionalScope.institution_id,
      ) as Array<{ program_id: string }>
      const excludedProgram = institutionalPrograms[0]!
      const programCycleId = 'normalized-program-scope-test-cycle'
      const institutionCycleId = 'normalized-institution-scope-test-cycle'
      const verifiedAt = '2026-08-01'
      const reviewAfter = '2030-08-01'

      database.prepare(`
        DELETE FROM record_field_status
        WHERE release_id = ?
          AND field_path IN ('programIds', 'program_ids', 'universityIds', 'institution_ids')
      `).run(release.release_id)

      const addCycle = (
        cycleId: string,
        sequence: number,
        institutionScope: 'all' | 'listed',
        programScope: 'all' | 'listed',
      ) => {
        database.prepare(`
          INSERT INTO catalog_records (
            release_id, record_id, record_kind, slug, gate_status,
            verified_at, review_after, content_sha256
          ) VALUES (?, ?, 'scholarship_cycle', ?, 'publishable', ?, ?, ?)
        `).run(
          release.release_id,
          cycleId,
          cycleId,
          verifiedAt,
          reviewAfter,
          sequence === 1 ? 'a'.repeat(64) : 'b'.repeat(64),
        )
        database.prepare(`
          INSERT INTO record_sources (
            release_id, record_id, field_path, locale, source_id, evidence_role
          ) VALUES (?, ?, '*', '', ?, 'primary')
        `).run(release.release_id, cycleId, source.source_id)
        database.prepare(`
          INSERT INTO scholarship_cycles (
            release_id, scholarship_cycle_id, scholarship_id, academic_year,
            intake_code, sequence, cycle_status, institution_scope,
            program_scope, degree_scope, nationality_scope
          ) VALUES (?, ?, ?, '2026-2027', 'autumn', ?, 'announced', ?, ?, 'all', 'all')
        `).run(
          release.release_id,
          cycleId,
          scholarship.scholarship_id,
          sequence,
          institutionScope,
          programScope,
        )
        const insertScope = database.prepare(`
          INSERT INTO record_field_status (
            release_id, record_id, field_path, locale, field_status,
            required_for_publish, value_json, verified_at, review_after
          ) VALUES (?, ?, ?, '', 'known', 1, ?, ?, ?)
        `)
        for (const [fieldPath, value] of [
          ['institution_scope', institutionScope],
          ['program_scope', programScope],
          ['degree_scope', 'all'],
          ['nationality_scope', 'all'],
        ] as const) {
          insertScope.run(
            release.release_id,
            cycleId,
            fieldPath,
            JSON.stringify(value),
            verifiedAt,
            reviewAfter,
          )
        }
      }

      addCycle(programCycleId, 1, 'all', 'listed')
      addCycle(institutionCycleId, 2, 'listed', 'all')
      database.prepare(`
        INSERT INTO scholarship_cycle_programs (
          release_id, scholarship_cycle_id, program_id, inclusion
        ) VALUES (?, ?, ?, 'include')
      `).run(release.release_id, programCycleId, directProgram.program_id)
      database.prepare(`
        INSERT INTO scholarship_cycle_institutions (
          release_id, scholarship_cycle_id, institution_id, inclusion
        ) VALUES (?, ?, ?, 'include')
      `).run(release.release_id, institutionCycleId, institutionalScope.institution_id)
      database.prepare(`
        INSERT INTO scholarship_cycle_programs (
          release_id, scholarship_cycle_id, program_id, inclusion
        ) VALUES (?, ?, ?, 'exclude')
      `).run(release.release_id, institutionCycleId, excludedProgram.program_id)

      queries.length = 0
      const response = await worker.fetch(
        new Request('https://catalog.test/api/v1/programs?scholarship=linked&limit=100'),
        environment,
      )
      const payload = await response.json() as ApiEnvelopeDto<ProgramDto[]>
      const expectedProgramIds = [
        directProgram.program_id,
        ...institutionalPrograms.slice(1).map(({ program_id }) => program_id),
      ].sort()

      expect(response.status, JSON.stringify(payload)).toBe(200)
      expect(payload.data.map(({ id }) => id).sort()).toEqual(expectedProgramIds)
      expect(payload.meta.total).toBe(expectedProgramIds.length)
      expect(queries.some(({ sql }) => sql.includes('scholarship_cycle_programs'))).toBe(true)
      expect(queries.some(({ sql }) => sql.includes('scholarship_cycle_institutions'))).toBe(true)
    } finally {
      database.exec('ROLLBACK')
    }
  }, 30_000)

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
  }, 30_000)

  it('filters scholarship funding with exact metadata and query-bound cursors', async () => {
    const fundedResponse = await worker.fetch(
      new Request('https://catalog.test/api/v1/scholarships?funding=full-tuition&limit=1'),
      environment,
    )
    const funded = await fundedResponse.json() as ApiEnvelopeDto<ScholarshipDto[]>
    expect(fundedResponse.status).toBe(200)
    expect(funded.data).toHaveLength(1)
    expect(funded.data[0]!.attributes.coverage.tuition).toBe('full')
    expect(funded.meta.total).toBeGreaterThan(funded.data.length)
    expect(funded.meta.facets?.universities?.length).toBeGreaterThan(0)

    const mismatchedCursor = await worker.fetch(
      new Request(
        `https://catalog.test/api/v1/scholarships?funding=partial-tuition&limit=1&cursor=${encodeURIComponent(funded.meta.nextCursor!)}`,
      ),
      environment,
    )
    expect(mismatchedCursor.status).toBe(400)
  }, 30_000)

  it('sorts scholarship stipends and resolves the selected detail slug', async () => {
    const stipendResponse = await worker.fetch(
      new Request('https://catalog.test/api/v1/scholarships?funding=stipend&sort=stipend-desc&limit=20'),
      environment,
    )
    const stipend = await stipendResponse.json() as ApiEnvelopeDto<ScholarshipDto[]>
    const amounts = stipend.data.map((item) => item.attributes.coverage.stipendCnyPerMonth!)
    expect(stipendResponse.status).toBe(200)
    expect(amounts.length).toBeGreaterThan(1)
    expect(amounts.every((amount) => amount > 0)).toBe(true)
    expect(amounts).toEqual([...amounts].sort((left, right) => right - left))
    expect(stipend.data.every((item) => item.slug && /^[a-z0-9][a-z0-9-]*$/u.test(item.slug))).toBe(true)
    const sortedDetailResponse = await worker.fetch(
      new Request(`https://catalog.test/api/v1/scholarships/${stipend.data[0]!.slug}`),
      environment,
    )
    const sortedDetail = await sortedDetailResponse.json() as ApiEnvelopeDto<ScholarshipDto>
    expect(sortedDetailResponse.status).toBe(200)
    expect(sortedDetail.data.id).toBe(stipend.data[0]!.id)
  }, 30_000)

  it('filters scholarships by future deadline and normalized degree scope', async () => {
    const futureResponse = await worker.fetch(
      new Request('https://catalog.test/api/v1/scholarships?deadline=future&limit=100'),
      environment,
    )
    const future = await futureResponse.json() as ApiEnvelopeDto<ScholarshipDto[]>
    expect(futureResponse.status).toBe(200)
    expect(future.data.length).toBeGreaterThan(0)
    expect(future.data.every((item) =>
      item.attributes.deadline !== null && item.attributes.deadline >= chinaCalendarDate(),
    )).toBe(true)

    const beforeDegree = queries.length
    const degreeResponse = await worker.fetch(
      new Request('https://catalog.test/api/v1/scholarships?degree=master&limit=100'),
      environment,
    )
    expect(degreeResponse.status).toBe(200)
    expect(queries.slice(beforeDegree).some(({ sql }) =>
      sql.includes('matched_program.degree_level = ?')
      && sql.includes('scholarship_cycle_degree_levels'),
    )).toBe(true)
  }, 30_000)

  it('lists institutions with exact metadata, disciplines, sorting, and query-bound cursors', async () => {
    const defaultResponse = await worker.fetch(
      new Request('https://catalog.test/api/v1/institutions'),
      environment,
    )
    const defaults = await defaultResponse.json() as ApiEnvelopeDto<InstitutionDto[]>
    expect(defaultResponse.status).toBe(200)
    expect(defaults.data).toHaveLength(24)
    expect(defaults.meta.total).toBeGreaterThan(defaults.data.length)
    expect(defaults.meta.facets?.cities?.length).toBeGreaterThan(1)
    expect(defaults.meta.nextCursor).toEqual(expect.any(String))
    expect(defaults.data[0]!.attributes.disciplineCodes).toEqual(expect.any(Array))
    expect(defaults.data[0]!.fieldMeta.disciplineCodes.status).toBe('known')

    const secondResponse = await worker.fetch(
      new Request(
        `https://catalog.test/api/v1/institutions?sort=default&cursor=${encodeURIComponent(defaults.meta.nextCursor!)}`,
      ),
      environment,
    )
    const second = await secondResponse.json() as ApiEnvelopeDto<InstitutionDto[]>
    expect(secondResponse.status).toBe(200)
    expect(second.data.map((item) => item.id)).not.toContain(defaults.data[0]!.id)

    const mismatchedCursor = await worker.fetch(
      new Request(
        `https://catalog.test/api/v1/institutions?sort=programs-desc&cursor=${encodeURIComponent(defaults.meta.nextCursor!)}`,
      ),
      environment,
    )
    expect(mismatchedCursor.status).toBe(400)

    const programSortResponse = await worker.fetch(
      new Request('https://catalog.test/api/v1/institutions?sort=programs-desc&limit=100'),
      environment,
    )
    const programSort = await programSortResponse.json() as ApiEnvelopeDto<InstitutionDto[]>
    expect(programSortResponse.status).toBe(200)
    const programCounts = programSort.data.map((item) => item.relationships.programs.count)
    expect(programCounts).toEqual([...programCounts].sort((left, right) => right - left))
    expect(programSort.data.every((item) =>
      item.slug !== null && /^[a-z0-9][a-z0-9-]*$/u.test(item.slug)
    )).toBe(true)

    const scholarshipSortResponse = await worker.fetch(
      new Request('https://catalog.test/api/v1/institutions?sort=scholarships-desc&limit=100'),
      environment,
    )
    const scholarshipSort = await scholarshipSortResponse.json() as ApiEnvelopeDto<InstitutionDto[]>
    const scholarshipCounts = scholarshipSort.data.map(
      (item) => item.relationships.scholarships.count,
    )
    expect(scholarshipSortResponse.status).toBe(200)
    expect(scholarshipCounts).toEqual(
      [...scholarshipCounts].sort((left, right) => right - left),
    )

    const candidate = database.prepare(`
      SELECT
        institution.institution_id,
        city_record.slug AS city_slug,
        city.region_code,
        discipline.discipline_code
      FROM current_institutions AS institution
      JOIN current_locations AS city
        ON city.release_id = institution.release_id
       AND city.location_id = institution.city_id
      JOIN current_catalog_records AS city_record
        ON city_record.release_id = city.release_id
       AND city_record.record_id = city.location_id
      JOIN current_programs AS program
        ON program.release_id = institution.release_id
       AND program.institution_id = institution.institution_id
      JOIN current_program_disciplines AS discipline
        ON discipline.release_id = program.release_id
       AND discipline.program_id = program.program_id
      WHERE city_record.slug IS NOT NULL AND city.region_code IS NOT NULL
      ORDER BY institution.institution_id, discipline.discipline_code
      LIMIT 1
    `).get() as {
      institution_id: string
      city_slug: string
      region_code: string
      discipline_code: string
    }
    const filteredResponse = await worker.fetch(
      new Request(
        `https://catalog.test/api/v1/institutions?city=${candidate.city_slug}&region=${candidate.region_code}&discipline=${candidate.discipline_code}&limit=100`,
      ),
      environment,
    )
    const filtered = await filteredResponse.json() as ApiEnvelopeDto<InstitutionDto[]>
    expect(filteredResponse.status).toBe(200)
    expect(filtered.data.map((item) => item.id)).toContain(candidate.institution_id)
    expect(filtered.data.every((item) =>
      item.relationships.location.slug === candidate.city_slug
      && item.relationships.location.regionCode === candidate.region_code
      && item.attributes.disciplineCodes.includes(candidate.discipline_code)
    )).toBe(true)
    expect(filtered.meta.total).toBe(filtered.data.length)
    expect(filtered.meta.facets?.cities?.map((item) => item.value)).toEqual([
      candidate.city_slug,
    ])

    const invalidSort = await worker.fetch(
      new Request('https://catalog.test/api/v1/institutions?sort=featured'),
      environment,
    )
    expect(invalidSort.status).toBe(400)
    expect(r2Reads).toBe(0)
  }, 30_000)

  it('publishes current institution summaries and withholds all 14 missing admissions URLs', async () => {
    const missingAdmissions = readLegacyBundle().universities.filter(
      (university) => university.admissionsUrl === null,
    )
    expect(missingAdmissions).toHaveLength(14)

    const currentSummary = database.prepare(`
      SELECT record.slug, localized.locale, localized.text_value
      FROM current_institutions AS institution
      JOIN current_catalog_records AS record
        ON record.release_id = institution.release_id
       AND record.record_id = institution.institution_id
      JOIN current_localized_content AS localized
        ON localized.release_id = institution.release_id
       AND localized.record_id = institution.institution_id
       AND localized.field_name = 'summary'
      WHERE record.slug IS NOT NULL
      ORDER BY record.slug, localized.locale
      LIMIT 1
    `).get() as { slug: string; locale: string; text_value: string }
    const summaryResponse = await worker.fetch(
      new Request(`https://catalog.test/api/v1/institutions/${currentSummary.slug}`),
      environment,
    )
    const summary = await summaryResponse.json() as ApiEnvelopeDto<InstitutionDto>
    expect(summaryResponse.status).toBe(200)
    expect(summary.data.attributes.summary?.[currentSummary.locale]).toBe(currentSummary.text_value)
    expect(summary.data.fieldMeta.summary.status).toBe('known')

    const allInstitutions: InstitutionDto[] = []
    let cursor: string | null = null
    do {
      const url = new URL('https://catalog.test/api/v1/institutions')
      url.searchParams.set('limit', '100')
      if (cursor) url.searchParams.set('cursor', cursor)
      const response = await worker.fetch(new Request(url), environment)
      const page = await response.json() as ApiEnvelopeDto<InstitutionDto[]>
      expect(response.status).toBe(200)
      allInstitutions.push(...page.data)
      cursor = page.meta.nextCursor ?? null
    } while (cursor)

    const missingIds = new Set(missingAdmissions.map((university) => university.id))
    const publiclyEligibleMissing = missingAdmissions.filter(
      (university) => university.status === 'verified' || university.status === 'stale',
    )
    const publishedMissing = allInstitutions.filter(
      (institution) => missingIds.has(institution.id),
    )
    expect(publishedMissing).toHaveLength(publiclyEligibleMissing.length)
    expect(publishedMissing.every((institution) =>
      institution.attributes.admissionsUrl === null
      && institution.fieldMeta.admissionsUrl.status === 'officially_not_announced'
    )).toBe(true)

    const hiddenMissing = missingAdmissions.filter(
      (university) => !publiclyEligibleMissing.some((item) => item.id === university.id),
    )
    for (const university of hiddenMissing) {
      const hiddenResponse = await worker.fetch(
        new Request(`https://catalog.test/api/v1/institutions/${university.slug}`),
        environment,
      )
      expect(hiddenResponse.status).toBe(404)
    }

    const detailResponse = await worker.fetch(
      new Request(`https://catalog.test/api/v1/institutions/${publishedMissing[0]!.slug!}`),
      environment,
    )
    const detail = await detailResponse.json() as ApiEnvelopeDto<InstitutionDto>
    expect(detailResponse.status).toBe(200)
    expect(detail.data.attributes.officialUrl).toMatch(/^https:\/\//u)
    expect(detail.data.attributes.admissionsUrl).toBeNull()
    expect(detail.data.fieldMeta.admissionsUrl.status).toBe('officially_not_announced')
    expect(r2Reads).toBe(0)
  }, 30_000)

  it('restricts institution search to normalized name-title tokens', async () => {
    database.exec('BEGIN')
    try {
      const candidate = database.prepare(`
        SELECT
          institution.institution_id,
          organization_search.search_rowid AS organization_search_rowid,
          organization_search.title,
          program_search.search_rowid AS program_search_rowid
        FROM current_institutions AS institution
        JOIN current_search_documents AS organization_search
          ON organization_search.release_id = institution.release_id
         AND organization_search.record_id = institution.institution_id
         AND organization_search.record_kind = 'organization'
         AND organization_search.locale = 'en'
        JOIN current_programs AS program
          ON program.release_id = institution.release_id
         AND program.institution_id = institution.institution_id
        JOIN current_search_documents AS program_search
          ON program_search.release_id = program.release_id
         AND program_search.record_id = program.program_id
         AND program_search.record_kind = 'program'
         AND program_search.locale = 'en'
        ORDER BY institution.institution_id, program.program_id
        LIMIT 1
      `).get() as {
        institution_id: string
        organization_search_rowid: number
        title: string
        program_search_rowid: number
      }
      database.prepare(`
        UPDATE search_documents
        SET body = 'StaleSummaryLeakCanary', filter_text = 'CityNameLeakCanary'
        WHERE search_rowid = ?
      `).run(candidate.organization_search_rowid)
      database.prepare(`
        UPDATE record_field_status
        SET field_status = 'stale', value_json = NULL, review_after = '2020-01-01'
        WHERE record_id = ? AND field_path = 'summary'
      `).run(candidate.institution_id)
      database.prepare(`
        UPDATE search_documents
        SET title = 'ProgramNameLeakCanary'
        WHERE search_rowid = ?
      `).run(candidate.program_search_rowid)

      const search = async (query: string) => {
        const response = await worker.fetch(
          new Request(`https://catalog.test/api/v1/institutions?q=${encodeURIComponent(query)}`),
          environment,
        )
        return {
          response,
          envelope: await response.json() as ApiEnvelopeDto<InstitutionDto[]>,
        }
      }
      const nameResult = await search(candidate.title)
      expect(nameResult.response.status).toBe(200)
      expect(nameResult.envelope.data.map((institution) => institution.id))
        .toContain(candidate.institution_id)

      for (const query of [
        'StaleSummaryLeakCanary',
        'CityNameLeakCanary',
        'ProgramNameLeakCanary',
      ]) {
        const result = await search(query)
        expect(result.response.status).toBe(200)
        expect(result.envelope.data).toEqual([])
      }

      const tooManyTerms = await search(Array.from({ length: 21 }, () => 'term').join(' '))
      expect(tooManyTerms.response.status).toBe(400)
      expect(r2Reads).toBe(0)
    } finally {
      database.exec('ROLLBACK')
    }
  }, 30_000)
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
  }, 30_000)

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
  }, 15_000)

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
          SET opens_on = NULL, closes_on = ?, rolling = 0
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
