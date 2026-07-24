import type { ActiveReleaseRow, D1Database } from './types'
import { decodeCursor, encodeCursor } from './sql-cursor'
import {
  applicationState,
  chinaCalendarDate,
  fts5Query,
  loadRecordDecorations,
  normalizeLanguageFilter,
  placeholders,
  queryAll,
  queryFirst,
  type RecordAuditRow,
  type RecordDecorations,
} from './sql-data'
import type {
  ApiEnvelopeDto,
  ApiMetaDto,
  ApplicationDto,
  InstitutionDto,
  InstitutionQuery,
  MoneyDto,
  ProgramCycleDto,
  ProgramDto,
  ProgramQuery,
  ProgramType,
  ReleaseInfoDto,
  ScholarshipCoverageItemDto,
  ScholarshipCycleDto,
  ScholarshipDto,
  ScholarshipQuery,
} from './sql-types'

export const AUTOMATED_COLLECTION_NOTICE =
  '信息由自动化系统收录并定期更新；申请条件、费用与截止日期以学校或奖学金官方网站实际情况为准。'

const DEFAULT_LIMIT = 24

type SortableRow = RecordAuditRow & {
  sort_slug: string
}

type InstitutionRow = SortableRow & {
  institution_type: string
  admissions_url: string
  featured: number
  official_url: string
  city_id: string
  city_slug: string | null
  country_code: string
  region_code: string | null
  program_count: number
  scholarship_count: number
}

type ProgramRow = SortableRow & {
  institution_id: string
  institution_slug: string | null
  program_type: ProgramType
  degree_level: 'bachelor' | 'master' | 'doctorate' | null
  credential_type: string | null
  attendance_mode: 'full_time' | 'part_time' | 'hybrid'
  delivery_mode: 'on_campus' | 'online' | 'hybrid'
  duration_min: number | null
  duration_max: number | null
  duration_unit: 'days' | 'weeks' | 'months' | 'semesters' | 'academic_years' | null
  official_url: string
  city_id: string
  city_slug: string | null
}

type ScholarshipRow = SortableRow & {
  provider_organization_id: string
  provider_slug: string | null
  provider_organization_type: string
  provider_official_url: string
  scheme_type: string
  official_url: string
}

type ProgramCodeRow = {
  program_id: string
  code: string
}

type ProgramCycleRow = RecordAuditRow & {
  slug: string | null
  program_cycle_id: string
  program_id: string
  academic_year: string
  intake_code: string
  sequence: number
  starts_on: string | null
  ends_on: string | null
  cycle_status: string
}

type ScholarshipCycleRow = RecordAuditRow & {
  slug: string | null
  scholarship_cycle_id: string
  scholarship_id: string
  academic_year: string
  intake_code: string
  sequence: number
  cycle_status: string
  institution_scope: string | null
  program_scope: string | null
  degree_scope: string | null
  nationality_scope: string | null
}

type RouteWindowRow = {
  owner_record_id: string
  route_type: string
  access_mode: string | null
  apply_url: string | null
  opens_on: string | null
  closes_on: string | null
  rolling: number | null
  application_state: 'open' | 'upcoming' | 'closed' | 'rolling' | 'not_announced' | null
}

type FeeRow = {
  owner_record_id: string
  fee_type: string
  amount_min_minor: number | null
  amount_max_minor: number | null
  currency_code: string | null
  currency_exponent: number | null
  billing_period: string | null
}

type CoverageRow = {
  scholarship_cycle_id: string
  coverage_id: string
  coverage_type: string
  coverage_mode: string | null
  amount_min_minor: number | null
  amount_max_minor: number | null
  currency_code: string | null
  currency_exponent: number | null
  period: string | null
  max_duration: number | null
  max_duration_unit: string | null
}

function addCondition(
  conditions: string[],
  values: unknown[],
  condition: string,
  ...parameters: unknown[]
) {
  conditions.push(condition)
  values.push(...parameters)
}

function pageLimit(value?: number) {
  return Math.min(Math.max(value ?? DEFAULT_LIMIT, 1), 100)
}

function moneyFromFee(row: FeeRow | undefined): MoneyDto | null {
  if (
    !row
    || (row.amount_min_minor === null
      && row.amount_max_minor === null
      && row.currency_code === null)
  ) return null
  return {
    amountMinimumMinor: row.amount_min_minor,
    amountMaximumMinor: row.amount_max_minor,
    currencyCode: row.currency_code,
    currencyExponent: row.currency_exponent,
    period: row.billing_period,
  }
}

function legacyMoney(value: number | null, period: string | null): MoneyDto | null {
  if (value === null) return null
  return {
    amountMinimumMinor: Math.round(value * 100),
    amountMaximumMinor: null,
    currencyCode: 'CNY',
    currencyExponent: 2,
    period,
  }
}

function routeApplication(
  route: RouteWindowRow | undefined,
  fallback: { opensOn: string | null; closesOn: string | null; applyUrl?: string | null },
  today: string,
): ApplicationDto {
  const opensOn = route?.opens_on ?? fallback.opensOn
  const closesOn = route?.closes_on ?? fallback.closesOn
  const rolling = route?.rolling === null || route?.rolling === undefined
    ? null
    : route.rolling === 1
  const storedState = route?.application_state === 'not_announced'
    ? 'not-announced'
    : route?.application_state
  const state = storedState === 'not-announced' && (opensOn !== null || closesOn !== null)
    ? applicationState(opensOn, closesOn, rolling, today)
    : storedState ?? applicationState(opensOn, closesOn, rolling, today)
  return {
    routeType: route?.route_type ?? null,
    accessMode: route?.access_mode ?? null,
    applyUrl: route?.apply_url ?? fallback.applyUrl ?? null,
    opensOn,
    closesOn,
    rolling,
    state,
  }
}

function pagination<Row extends SortableRow>(
  rows: Row[],
  limit: number,
  resource: 'institutions' | 'programs' | 'scholarships',
  releaseId: string,
) {
  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows
  const last = items.at(-1)
  return {
    items,
    nextCursor: hasMore && last
      ? encodeCursor(resource, releaseId, last.sort_slug, last.record_id)
      : null,
  }
}

function identityMeta(
  decorations: RecordDecorations,
  row: RecordAuditRow,
  key: string,
) {
  return decorations.meta(row, [key], true)
}

export function releaseInfo(release: ActiveReleaseRow): ReleaseInfoDto {
  const parsed: unknown = JSON.parse(release.counts_json)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid release counts.')
  }
  const counts = parsed as Record<string, unknown>
  const names = [
    'sources',
    'cities',
    'universities',
    'programs',
    'admissionCycles',
    'scholarships',
  ] as const
  for (const name of names) {
    if (!Number.isInteger(counts[name]) || Number(counts[name]) < 0) {
      throw new Error('Invalid release counts.')
    }
  }
  return {
    id: release.release_id,
    dataDate: release.data_date,
    generatedAt: release.generated_at,
    recordCounts: {
      sources: Number(counts.sources),
      cities: Number(counts.cities),
      universities: Number(counts.universities),
      programs: Number(counts.programs),
      admissionCycles: Number(counts.admissionCycles),
      scholarships: Number(counts.scholarships),
    },
  }
}

export class CatalogSqlApi {
  private readonly release: ReleaseInfoDto

  constructor(
    private readonly database: D1Database,
    activeRelease: ActiveReleaseRow,
    private readonly today = chinaCalendarDate(),
  ) {
    this.release = releaseInfo(activeRelease)
  }

  private envelope<T>(
    data: T,
    page?: { pageSize: number; nextCursor: string | null },
  ): ApiEnvelopeDto<T> {
    const meta: ApiMetaDto = {
      apiVersion: 'v1',
      release: this.release,
      notice: AUTOMATED_COLLECTION_NOTICE,
      ...(page ? { pageSize: page.pageSize, nextCursor: page.nextCursor } : {}),
    }
    return { data, meta }
  }

  currentRelease() {
    return this.envelope(this.release)
  }

  private async selectInstitutions(query: InstitutionQuery, exactSlug?: string) {
    const conditions = ['record.release_id = ?']
    const values: unknown[] = [this.release.id]
    if (exactSlug !== undefined) addCondition(conditions, values, 'record.slug = ?', exactSlug)
    if (query.q) {
      addCondition(conditions, values, `EXISTS (
        SELECT 1
        FROM search_fts
        JOIN current_search_documents AS search_document
          ON search_document.search_rowid = search_fts.rowid
        WHERE search_fts MATCH ?
          AND search_document.release_id = institution.release_id
          AND search_document.record_id = institution.institution_id
          AND search_document.record_kind = 'organization'
      )`, fts5Query(query.q))
    }
    if (query.city) {
      addCondition(
        conditions,
        values,
        '(institution.city_id = ? OR city_record.slug = ?)',
        query.city,
        query.city,
      )
    }
    if (query.region) addCondition(conditions, values, 'city.region_code = ?', query.region)
    if (query.discipline) {
      addCondition(conditions, values, `EXISTS (
        SELECT 1
        FROM current_programs AS related_program
        JOIN current_program_disciplines AS related_discipline
          ON related_discipline.release_id = related_program.release_id
         AND related_discipline.program_id = related_program.program_id
        WHERE related_program.release_id = institution.release_id
          AND related_program.institution_id = institution.institution_id
          AND related_discipline.discipline_code = ?
      )`, query.discipline)
    }
    if (query.cursor && exactSlug === undefined) {
      const cursor = decodeCursor(query.cursor, 'institutions', this.release.id)
      addCondition(
        conditions,
        values,
        `(COALESCE(record.slug, '') > ?
          OR (COALESCE(record.slug, '') = ? AND record.record_id > ?))`,
        cursor.sortKey,
        cursor.sortKey,
        cursor.id,
      )
    }
    const limit = exactSlug === undefined ? pageLimit(query.limit) + 1 : 1
    values.push(limit)
    return queryAll<InstitutionRow>(this.database, `
      SELECT
        record.record_id,
        COALESCE(record.slug, '') AS sort_slug,
        record.verified_at AS record_verified_at,
        record.review_after AS record_review_after,
        institution.institution_type,
        institution.admissions_url,
        institution.featured,
        organization.official_url,
        institution.city_id,
        city_record.slug AS city_slug,
        city.country_code,
        city.region_code,
        (
          SELECT COUNT(*)
          FROM current_programs AS counted_program
          WHERE counted_program.release_id = institution.release_id
            AND counted_program.institution_id = institution.institution_id
        ) AS program_count,
        (
          SELECT COUNT(DISTINCT counted_scholarship.scholarship_id)
          FROM current_scholarships AS counted_scholarship
          JOIN current_record_fields AS scope
            ON scope.release_id = counted_scholarship.release_id
           AND scope.record_id = counted_scholarship.scholarship_id
           AND scope.field_path IN ('universityIds', 'institution_ids')
          JOIN json_each(scope.value_json) AS scoped_institution ON 1 = 1
          WHERE counted_scholarship.release_id = institution.release_id
            AND CAST(scoped_institution.value AS TEXT) = institution.institution_id
        ) AS scholarship_count
      FROM current_institutions AS institution
      JOIN current_organizations AS organization
        ON organization.release_id = institution.release_id
       AND organization.organization_id = institution.institution_id
      JOIN current_catalog_records AS record
        ON record.release_id = institution.release_id
       AND record.record_id = institution.institution_id
      JOIN current_locations AS city
        ON city.release_id = institution.release_id
       AND city.location_id = institution.city_id
      JOIN current_catalog_records AS city_record
        ON city_record.release_id = city.release_id
       AND city_record.record_id = city.location_id
      WHERE ${conditions.join('\n        AND ')}
      ORDER BY COALESCE(record.slug, ''), record.record_id
      LIMIT ?
    `, values)
  }

  private async mapInstitutions(rows: InstitutionRow[]) {
    const decorations = await loadRecordDecorations(
      this.database,
      this.release.id,
      rows.flatMap((row) => [row.record_id, row.city_id]),
    )
    return rows.map((row): InstitutionDto => ({
      type: 'institution',
      id: row.record_id,
      slug: row.sort_slug || null,
      attributes: {
        name: decorations.localized(row.record_id, 'name') ?? {},
        summary: decorations.localized(row.record_id, 'summary'),
        institutionType: row.institution_type,
        officialUrl: row.official_url,
        admissionsUrl: row.admissions_url,
        featured: row.featured === 1,
      },
      relationships: {
        location: {
          id: row.city_id,
          slug: row.city_slug,
          name: decorations.localized(row.city_id, 'name') ?? {},
          countryCode: row.country_code,
          regionCode: row.region_code,
        },
        programs: { count: Number(row.program_count) },
        scholarships: { count: Number(row.scholarship_count) },
      },
      sources: decorations.sources(row.record_id),
      fieldMeta: {
        name: identityMeta(decorations, row, 'name'),
        summary: decorations.meta(row, ['summary', 'localized.summary']),
        institutionType: identityMeta(decorations, row, 'institution_type'),
        officialUrl: identityMeta(decorations, row, 'official_url'),
        admissionsUrl: identityMeta(decorations, row, 'admissions_url'),
        featured: identityMeta(decorations, row, 'featured'),
        location: identityMeta(decorations, row, 'city_id'),
        programCount: identityMeta(decorations, row, 'program_count'),
        scholarshipCount: identityMeta(decorations, row, 'scholarship_count'),
      },
    }))
  }

  async listInstitutions(query: InstitutionQuery = {}) {
    const limit = pageLimit(query.limit)
    const page = pagination(
      await this.selectInstitutions(query),
      limit,
      'institutions',
      this.release.id,
    )
    const data = await this.mapInstitutions(page.items)
    return this.envelope(data, { pageSize: data.length, nextCursor: page.nextCursor })
  }

  async getInstitution(slug: string) {
    const row = (await this.selectInstitutions({}, slug))[0]
    if (!row) return null
    return this.envelope((await this.mapInstitutions([row]))[0]!)
  }

  private async selectPrograms(query: ProgramQuery, exactSlug?: string) {
    const conditions = ['record.release_id = ?']
    const values: unknown[] = [this.release.id]
    if (exactSlug !== undefined) addCondition(conditions, values, 'record.slug = ?', exactSlug)
    if (query.q) {
      addCondition(conditions, values, `EXISTS (
        SELECT 1
        FROM search_fts
        JOIN current_search_documents AS search_document
          ON search_document.search_rowid = search_fts.rowid
        WHERE search_fts MATCH ?
          AND search_document.release_id = program.release_id
          AND search_document.record_id = program.program_id
          AND search_document.record_kind = 'program'
      )`, fts5Query(query.q))
    }
    if (query.institution) {
      addCondition(
        conditions,
        values,
        '(program.institution_id = ? OR institution_record.slug = ?)',
        query.institution,
        query.institution,
      )
    }
    if (query.city) {
      addCondition(
        conditions,
        values,
        '(institution.city_id = ? OR city_record.slug = ?)',
        query.city,
        query.city,
      )
    }
    if (query.type) addCondition(conditions, values, 'program.program_type = ?', query.type)
    if (query.degree) addCondition(conditions, values, 'program.degree_level = ?', query.degree)
    if (query.discipline) {
      addCondition(conditions, values, `EXISTS (
        SELECT 1 FROM current_program_disciplines AS discipline
        WHERE discipline.release_id = program.release_id
          AND discipline.program_id = program.program_id
          AND discipline.discipline_code = ?
      )`, query.discipline)
    }
    if (query.language) {
      addCondition(conditions, values, `EXISTS (
        SELECT 1 FROM current_program_teaching_languages AS language
        WHERE language.release_id = program.release_id
          AND language.program_id = program.program_id
          AND language.language_code = ?
      )`, normalizeLanguageFilter(query.language))
    }
    if (query.scholarship) {
      addCondition(conditions, values, `EXISTS (
        SELECT 1
        FROM current_scholarships AS scholarship
        JOIN current_catalog_records AS scholarship_record
          ON scholarship_record.release_id = scholarship.release_id
         AND scholarship_record.record_id = scholarship.scholarship_id
        JOIN current_record_fields AS scope
          ON scope.release_id = scholarship.release_id
         AND scope.record_id = scholarship.scholarship_id
         AND scope.field_path IN ('programIds', 'program_ids', 'universityIds', 'institution_ids')
        JOIN json_each(scope.value_json) AS scoped_record ON 1 = 1
        WHERE scholarship.release_id = program.release_id
          AND (scholarship.scholarship_id = ? OR scholarship_record.slug = ?)
          AND (
            (scope.field_path IN ('programIds', 'program_ids')
              AND CAST(scoped_record.value AS TEXT) = program.program_id)
            OR
            (scope.field_path IN ('universityIds', 'institution_ids')
              AND CAST(scoped_record.value AS TEXT) = program.institution_id)
          )
      )`, query.scholarship, query.scholarship)
    }

    const cycleConditions: string[] = []
    const cycleValues: unknown[] = []
    if (query.academicYear) addCondition(cycleConditions, cycleValues, 'cycle.academic_year = ?', query.academicYear)
    if (query.intake) addCondition(cycleConditions, cycleValues, 'cycle.intake_code = ?', query.intake)
    if (query.applicationState) {
      const expectedState = query.applicationState === 'not-announced'
        ? 'not_announced'
        : query.applicationState
      addCondition(cycleConditions, cycleValues, `(EXISTS (
          SELECT 1
          FROM current_application_routes AS route
          JOIN current_application_windows AS window
            ON window.release_id = route.release_id
           AND window.application_route_id = route.application_route_id
          WHERE route.release_id = cycle.release_id
            AND route.owner_record_id = cycle.program_cycle_id
            AND window.application_state = ?
        ) OR (
          CASE
            WHEN EXISTS (
              SELECT 1 FROM current_record_fields AS rolling_fact
              WHERE rolling_fact.release_id = cycle.release_id
                AND rolling_fact.record_id = cycle.program_cycle_id
                AND rolling_fact.field_path IN ('rolling', 'dateStatus')
                AND json_extract(rolling_fact.value_json, '$') IN (1, 'rolling')
            ) THEN 'rolling'
            WHEN NOT EXISTS (
              SELECT 1 FROM current_record_fields AS date_fact
              WHERE date_fact.release_id = cycle.release_id
                AND date_fact.record_id = cycle.program_cycle_id
                AND date_fact.field_path IN ('opens_on', 'opensOn', 'closes_on', 'closesOn')
            ) THEN 'not_announced'
            WHEN COALESCE((
              SELECT CAST(json_extract(close_fact.value_json, '$') AS TEXT)
              FROM current_record_fields AS close_fact
              WHERE close_fact.release_id = cycle.release_id
                AND close_fact.record_id = cycle.program_cycle_id
                AND close_fact.field_path IN ('closes_on', 'closesOn')
              LIMIT 1
            ), '9999-12-31') < date('now') THEN 'closed'
            WHEN COALESCE((
              SELECT CAST(json_extract(open_fact.value_json, '$') AS TEXT)
              FROM current_record_fields AS open_fact
              WHERE open_fact.release_id = cycle.release_id
                AND open_fact.record_id = cycle.program_cycle_id
                AND open_fact.field_path IN ('opens_on', 'opensOn')
              LIMIT 1
            ), '0000-01-01') > date('now') THEN 'upcoming'
            ELSE 'open'
          END = ?
        ))`, expectedState, expectedState)
    }
    if (query.tuitionMin !== undefined) {
      addCondition(cycleConditions, cycleValues, `(
        EXISTS (
          SELECT 1 FROM current_fee_items AS tuition
          WHERE tuition.release_id = cycle.release_id
            AND tuition.owner_record_id = cycle.program_cycle_id
            AND tuition.fee_type = 'tuition'
            AND COALESCE(tuition.amount_min_minor, tuition.amount_max_minor) >= ?
        )
        OR EXISTS (
          SELECT 1 FROM current_record_fields AS tuition_fact
          WHERE tuition_fact.release_id = cycle.release_id
            AND tuition_fact.record_id = cycle.program_cycle_id
            AND tuition_fact.field_path IN ('tuitionCny', 'tuition_amount')
            AND CAST(json_extract(tuition_fact.value_json, '$') AS REAL) >= ?
        )
      )`, Math.round(query.tuitionMin * 100), query.tuitionMin)
    }
    if (query.tuitionMax !== undefined) {
      addCondition(cycleConditions, cycleValues, `(
        EXISTS (
          SELECT 1 FROM current_fee_items AS tuition
          WHERE tuition.release_id = cycle.release_id
            AND tuition.owner_record_id = cycle.program_cycle_id
            AND tuition.fee_type = 'tuition'
            AND COALESCE(tuition.amount_max_minor, tuition.amount_min_minor) <= ?
        )
        OR EXISTS (
          SELECT 1 FROM current_record_fields AS tuition_fact
          WHERE tuition_fact.release_id = cycle.release_id
            AND tuition_fact.record_id = cycle.program_cycle_id
            AND tuition_fact.field_path IN ('tuitionCny', 'tuition_amount')
            AND CAST(json_extract(tuition_fact.value_json, '$') AS REAL) <= ?
        )
      )`, Math.round(query.tuitionMax * 100), query.tuitionMax)
    }
    if (cycleConditions.length > 0) {
      const matchingCycle = `EXISTS (
        SELECT 1
        FROM current_program_cycles AS cycle
        WHERE cycle.release_id = program.release_id
          AND cycle.program_id = program.program_id
          AND ${cycleConditions.join('\n          AND ')}
      )`
      const identityOnlyNotAnnounced = query.applicationState === 'not-announced'
        && query.academicYear === undefined
        && query.intake === undefined
        && query.tuitionMin === undefined
        && query.tuitionMax === undefined
      addCondition(
        conditions,
        values,
        identityOnlyNotAnnounced
          ? `(NOT EXISTS (
              SELECT 1
              FROM current_program_cycles AS announced_cycle
              WHERE announced_cycle.release_id = program.release_id
                AND announced_cycle.program_id = program.program_id
            ) OR ${matchingCycle})`
          : matchingCycle,
        ...cycleValues,
      )
    }
    if (query.cursor && exactSlug === undefined) {
      const cursor = decodeCursor(query.cursor, 'programs', this.release.id)
      addCondition(
        conditions,
        values,
        `(COALESCE(record.slug, '') > ?
          OR (COALESCE(record.slug, '') = ? AND record.record_id > ?))`,
        cursor.sortKey,
        cursor.sortKey,
        cursor.id,
      )
    }
    const limit = exactSlug === undefined ? pageLimit(query.limit) + 1 : 1
    values.push(limit)
    return queryAll<ProgramRow>(this.database, `
      SELECT
        record.record_id,
        COALESCE(record.slug, '') AS sort_slug,
        record.verified_at AS record_verified_at,
        record.review_after AS record_review_after,
        program.institution_id,
        institution_record.slug AS institution_slug,
        program.program_type,
        program.degree_level,
        program.credential_type,
        program.attendance_mode,
        program.delivery_mode,
        program.duration_min,
        program.duration_max,
        program.duration_unit,
        program.official_url,
        institution.city_id,
        city_record.slug AS city_slug
      FROM current_programs AS program
      JOIN current_catalog_records AS record
        ON record.release_id = program.release_id
       AND record.record_id = program.program_id
      JOIN current_institutions AS institution
        ON institution.release_id = program.release_id
       AND institution.institution_id = program.institution_id
      JOIN current_catalog_records AS institution_record
        ON institution_record.release_id = institution.release_id
       AND institution_record.record_id = institution.institution_id
      JOIN current_locations AS city
        ON city.release_id = institution.release_id
       AND city.location_id = institution.city_id
      JOIN current_catalog_records AS city_record
        ON city_record.release_id = city.release_id
       AND city_record.record_id = city.location_id
      WHERE ${conditions.join('\n        AND ')}
      ORDER BY COALESCE(record.slug, ''), record.record_id
      LIMIT ?
    `, values)
  }

  private async mapPrograms(rows: ProgramRow[]) {
    const programIds = rows.map((row) => row.record_id)
    const slots = programIds.length > 0 ? placeholders(programIds.length) : ''
    const [decorations, disciplines, languages] = await Promise.all([
      loadRecordDecorations(
        this.database,
        this.release.id,
        rows.flatMap((row) => [row.record_id, row.institution_id]),
      ),
      programIds.length === 0
        ? Promise.resolve([] as ProgramCodeRow[])
        : queryAll<ProgramCodeRow>(this.database, `
            SELECT program_id, discipline_code AS code
            FROM current_program_disciplines
            WHERE release_id = ? AND program_id IN (${slots})
            ORDER BY program_id, is_primary DESC, discipline_code
          `, [this.release.id, ...programIds]),
      programIds.length === 0
        ? Promise.resolve([] as ProgramCodeRow[])
        : queryAll<ProgramCodeRow>(this.database, `
            SELECT program_id, language_code AS code
            FROM current_program_teaching_languages
            WHERE release_id = ? AND program_id IN (${slots})
            ORDER BY program_id, role, language_code
          `, [this.release.id, ...programIds]),
    ])
    return rows.map((row): ProgramDto => {
      const disciplineCodes = disciplines
        .filter((item) => item.program_id === row.record_id)
        .map((item) => item.code)
      const teachingLanguageCodes = languages
        .filter((item) => item.program_id === row.record_id)
        .map((item) => item.code)
      return {
        type: 'program',
        id: row.record_id,
        slug: row.sort_slug || null,
        attributes: {
          name: decorations.localized(row.record_id, 'name') ?? {},
          programType: row.program_type,
          degreeLevel: row.degree_level,
          credentialType: row.credential_type,
          attendanceMode: row.attendance_mode,
          deliveryMode: row.delivery_mode,
          duration: {
            minimum: row.duration_min,
            maximum: row.duration_max,
            unit: row.duration_unit,
          },
          disciplineCodes,
          teachingLanguageCodes,
          officialUrl: row.official_url,
          applyUrl: decorations.value<string>(row.record_id, ['apply_url', 'applyUrl']),
        },
        relationships: {
          institution: {
            id: row.institution_id,
            slug: row.institution_slug,
            name: decorations.localized(row.institution_id, 'name') ?? {},
          },
        },
        sources: decorations.sources(row.record_id),
        fieldMeta: {
          name: identityMeta(decorations, row, 'name'),
          programType: identityMeta(decorations, row, 'program_type'),
          degreeLevel: identityMeta(decorations, row, 'degree_level'),
          credentialType: identityMeta(decorations, row, 'credential_type'),
          attendanceMode: identityMeta(decorations, row, 'attendance_mode'),
          deliveryMode: identityMeta(decorations, row, 'delivery_mode'),
          'duration.minimum': decorations.meta(row, ['duration_min', 'durationMonths']),
          'duration.maximum': decorations.meta(row, ['duration_max', 'durationMonthsMax']),
          'duration.unit': decorations.meta(row, ['duration_unit']),
          disciplineCodes: decorations.meta(row, ['discipline', 'disciplines']),
          teachingLanguageCodes: decorations.meta(row, ['teachingLanguages', 'teaching_languages']),
          officialUrl: identityMeta(decorations, row, 'official_url'),
          applyUrl: decorations.meta(row, ['apply_url', 'applyUrl']),
          institution: identityMeta(decorations, row, 'institution_id'),
        },
      }
    })
  }

  async listPrograms(query: ProgramQuery = {}) {
    const limit = pageLimit(query.limit)
    const page = pagination(
      await this.selectPrograms(query),
      limit,
      'programs',
      this.release.id,
    )
    const data = await this.mapPrograms(page.items)
    return this.envelope(data, { pageSize: data.length, nextCursor: page.nextCursor })
  }

  async getProgram(slug: string) {
    const row = (await this.selectPrograms({}, slug))[0]
    if (!row) return null
    return this.envelope((await this.mapPrograms([row]))[0]!)
  }

  private async selectScholarships(query: ScholarshipQuery, exactSlug?: string) {
    const conditions = ['record.release_id = ?']
    const values: unknown[] = [this.release.id]
    if (exactSlug !== undefined) addCondition(conditions, values, 'record.slug = ?', exactSlug)
    if (query.q) {
      addCondition(conditions, values, `EXISTS (
        SELECT 1
        FROM search_fts
        JOIN current_search_documents AS search_document
          ON search_document.search_rowid = search_fts.rowid
        WHERE search_fts MATCH ?
          AND search_document.release_id = scholarship.release_id
          AND search_document.record_id = scholarship.scholarship_id
          AND search_document.record_kind = 'scholarship'
      )`, fts5Query(query.q))
    }
    if (query.provider) {
      addCondition(
        conditions,
        values,
        `(scholarship.scheme_type = ?
          OR scholarship.provider_organization_id = ?
          OR provider_record.slug = ?)`,
        query.provider === 'csc' ? 'government' : query.provider,
        query.provider,
        query.provider,
      )
    }
    if (query.institution) {
      addCondition(conditions, values, `EXISTS (
        SELECT 1
        FROM current_record_fields AS scope
        JOIN json_each(scope.value_json) AS scoped_institution ON 1 = 1
        JOIN current_institutions AS matched_institution
          ON matched_institution.release_id = scope.release_id
         AND matched_institution.institution_id = CAST(scoped_institution.value AS TEXT)
        JOIN current_catalog_records AS matched_record
          ON matched_record.release_id = matched_institution.release_id
         AND matched_record.record_id = matched_institution.institution_id
        WHERE scope.release_id = scholarship.release_id
          AND scope.record_id = scholarship.scholarship_id
          AND scope.field_path IN ('universityIds', 'institution_ids')
          AND (matched_institution.institution_id = ? OR matched_record.slug = ?)
      )`, query.institution, query.institution)
    }
    if (query.program) {
      addCondition(conditions, values, `EXISTS (
        SELECT 1
        FROM current_record_fields AS scope
        JOIN json_each(scope.value_json) AS scoped_program ON 1 = 1
        JOIN current_programs AS matched_program
          ON matched_program.release_id = scope.release_id
         AND matched_program.program_id = CAST(scoped_program.value AS TEXT)
        JOIN current_catalog_records AS matched_record
          ON matched_record.release_id = matched_program.release_id
         AND matched_record.record_id = matched_program.program_id
        WHERE scope.release_id = scholarship.release_id
          AND scope.record_id = scholarship.scholarship_id
          AND scope.field_path IN ('programIds', 'program_ids')
          AND (matched_program.program_id = ? OR matched_record.slug = ?)
      )`, query.program, query.program)
    }
    if (query.cursor && exactSlug === undefined) {
      const cursor = decodeCursor(query.cursor, 'scholarships', this.release.id)
      addCondition(
        conditions,
        values,
        `(COALESCE(record.slug, '') > ?
          OR (COALESCE(record.slug, '') = ? AND record.record_id > ?))`,
        cursor.sortKey,
        cursor.sortKey,
        cursor.id,
      )
    }
    const limit = exactSlug === undefined ? pageLimit(query.limit) + 1 : 1
    values.push(limit)
    return queryAll<ScholarshipRow>(this.database, `
      SELECT
        record.record_id,
        COALESCE(record.slug, '') AS sort_slug,
        record.verified_at AS record_verified_at,
        record.review_after AS record_review_after,
        scholarship.provider_organization_id,
        provider_record.slug AS provider_slug,
        provider.organization_type AS provider_organization_type,
        provider.official_url AS provider_official_url,
        scholarship.scheme_type,
        scholarship.official_url
      FROM current_scholarships AS scholarship
      JOIN current_catalog_records AS record
        ON record.release_id = scholarship.release_id
       AND record.record_id = scholarship.scholarship_id
      JOIN current_organizations AS provider
        ON provider.release_id = scholarship.release_id
       AND provider.organization_id = scholarship.provider_organization_id
      JOIN current_catalog_records AS provider_record
        ON provider_record.release_id = provider.release_id
       AND provider_record.record_id = provider.organization_id
      WHERE ${conditions.join('\n        AND ')}
      ORDER BY COALESCE(record.slug, ''), record.record_id
      LIMIT ?
    `, values)
  }

  private async mapScholarships(rows: ScholarshipRow[]) {
    const decorations = await loadRecordDecorations(
      this.database,
      this.release.id,
      rows.map((row) => row.record_id),
    )
    return rows.map((row): ScholarshipDto => ({
      type: 'scholarship',
      id: row.record_id,
      slug: row.sort_slug || null,
      attributes: {
        name: decorations.localized(row.record_id, 'name') ?? {},
        summary: decorations.localized(row.record_id, 'summary'),
        schemeType: row.scheme_type,
        officialUrl: row.official_url,
        deadline: decorations.value<string>(row.record_id, ['deadline', 'closes_on']),
        scope: {
          institutionIds: decorations.value<string[]>(row.record_id, ['universityIds', 'institution_ids']),
          programIds: decorations.value<string[]>(row.record_id, ['programIds', 'program_ids']),
          degreeLevels: decorations.value<string[]>(row.record_id, ['degreeLevels', 'degree_levels']),
          disciplineCodes: decorations.value<string[]>(row.record_id, ['disciplineCodes', 'discipline_codes']),
          nationalities: decorations.value<string[]>(row.record_id, ['nationalities']),
        },
        coverage: {
          tuition: decorations.value<string>(row.record_id, ['coverage.tuition']),
          accommodation: decorations.value<string>(row.record_id, ['coverage.accommodation']),
          insurance: decorations.value<boolean | string>(row.record_id, ['coverage.insurance']),
          stipendCnyPerMonth: decorations.value<number>(row.record_id, ['coverage.stipendCnyPerMonth']),
        },
      },
      relationships: {
        provider: {
          id: row.provider_organization_id,
          slug: row.provider_slug,
          organizationType: row.provider_organization_type,
          officialUrl: row.provider_official_url,
        },
      },
      sources: decorations.sources(row.record_id),
      fieldMeta: {
        name: identityMeta(decorations, row, 'name'),
        summary: decorations.meta(row, ['summary', 'localized.summary']),
        schemeType: identityMeta(decorations, row, 'scheme_type'),
        officialUrl: identityMeta(decorations, row, 'official_url'),
        deadline: decorations.meta(row, ['deadline', 'closes_on']),
        'scope.institutionIds': decorations.meta(row, ['universityIds', 'institution_ids']),
        'scope.programIds': decorations.meta(row, ['programIds', 'program_ids']),
        'scope.degreeLevels': decorations.meta(row, ['degreeLevels', 'degree_levels']),
        'scope.disciplineCodes': decorations.meta(row, ['disciplineCodes', 'discipline_codes']),
        'scope.nationalities': decorations.meta(row, ['nationalities']),
        'coverage.tuition': decorations.meta(row, ['coverage.tuition']),
        'coverage.accommodation': decorations.meta(row, ['coverage.accommodation']),
        'coverage.insurance': decorations.meta(row, ['coverage.insurance']),
        'coverage.stipendCnyPerMonth': decorations.meta(row, ['coverage.stipendCnyPerMonth']),
        provider: identityMeta(decorations, row, 'provider_organization_id'),
      },
    }))
  }

  async listScholarships(query: ScholarshipQuery = {}) {
    const limit = pageLimit(query.limit)
    const page = pagination(
      await this.selectScholarships(query),
      limit,
      'scholarships',
      this.release.id,
    )
    const data = await this.mapScholarships(page.items)
    return this.envelope(data, { pageSize: data.length, nextCursor: page.nextCursor })
  }

  private async routeWindows(ownerIds: string[]) {
    if (ownerIds.length === 0) return []
    const slots = placeholders(ownerIds.length)
    return queryAll<RouteWindowRow>(this.database, `
      SELECT
        route.owner_record_id,
        route.route_type,
        route.access_mode,
        route.apply_url,
        window.opens_on,
        window.closes_on,
        window.rolling,
        window.application_state
      FROM current_application_routes AS route
      LEFT JOIN current_application_windows AS window
        ON window.release_id = route.release_id
       AND window.application_route_id = route.application_route_id
      WHERE route.release_id = ? AND route.owner_record_id IN (${slots})
      ORDER BY route.owner_record_id, route.is_primary DESC, route.application_route_id,
               window.closes_on, window.application_window_id
    `, [this.release.id, ...ownerIds])
  }

  private async fees(ownerIds: string[]) {
    if (ownerIds.length === 0) return []
    const slots = placeholders(ownerIds.length)
    return queryAll<FeeRow>(this.database, `
      SELECT
        owner_record_id,
        fee_type,
        amount_min_minor,
        amount_max_minor,
        currency_code,
        currency_exponent,
        billing_period
      FROM current_fee_items
      WHERE release_id = ? AND owner_record_id IN (${slots})
      ORDER BY owner_record_id, fee_type, fee_id
    `, [this.release.id, ...ownerIds])
  }

  async getProgramCycles(slug: string) {
    const program = await queryFirst<{ program_id: string; slug: string | null }>(this.database, `
      SELECT program.program_id, record.slug
      FROM current_programs AS program
      JOIN current_catalog_records AS record
        ON record.release_id = program.release_id AND record.record_id = program.program_id
      WHERE record.release_id = ? AND record.slug = ?
      LIMIT 1
    `, [this.release.id, slug])
    if (!program) return null
    const rows = await queryAll<ProgramCycleRow>(this.database, `
      SELECT
        record.record_id,
        record.slug,
        record.verified_at AS record_verified_at,
        record.review_after AS record_review_after,
        cycle.program_cycle_id,
        cycle.program_id,
        cycle.academic_year,
        cycle.intake_code,
        cycle.sequence,
        cycle.starts_on,
        cycle.ends_on,
        cycle.cycle_status
      FROM current_program_cycles AS cycle
      JOIN current_catalog_records AS record
        ON record.release_id = cycle.release_id AND record.record_id = cycle.program_cycle_id
      WHERE cycle.release_id = ? AND cycle.program_id = ?
      ORDER BY cycle.academic_year DESC, cycle.intake_code, cycle.sequence, cycle.program_cycle_id
    `, [this.release.id, program.program_id])
    const ids = rows.map((row) => row.record_id)
    const [decorations, routes, fees] = await Promise.all([
      loadRecordDecorations(this.database, this.release.id, ids),
      this.routeWindows(ids),
      this.fees(ids),
    ])
    const data = rows.map((row): ProgramCycleDto => {
      const route = routes.find((item) => item.owner_record_id === row.record_id)
      const opensOn = route?.opens_on
        ?? decorations.value<string>(row.record_id, ['opens_on', 'opensOn'])
      const closesOn = route?.closes_on
        ?? decorations.value<string>(row.record_id, ['closes_on', 'closesOn'])
      const tuitionFee = moneyFromFee(
        fees.find((item) => item.owner_record_id === row.record_id && item.fee_type === 'tuition'),
      ) ?? legacyMoney(
        decorations.value<number>(row.record_id, ['tuitionCny', 'tuition_amount']),
        decorations.value<string>(row.record_id, ['tuitionPeriod', 'billing_period']),
      )
      const applicationFee = moneyFromFee(
        fees.find((item) => item.owner_record_id === row.record_id && item.fee_type === 'application'),
      ) ?? legacyMoney(
        decorations.value<number>(row.record_id, ['applicationFeeCny', 'application_fee']),
        'one_time',
      )
      return {
        type: 'program_cycle',
        id: row.record_id,
        slug: row.slug,
        attributes: {
          academicYear: row.academic_year,
          intake: row.intake_code,
          sequence: Number(row.sequence),
          cycleStatus: row.cycle_status,
          startsOn: row.starts_on,
          endsOn: row.ends_on,
          application: routeApplication(route, {
            opensOn,
            closesOn,
            applyUrl: decorations.value<string>(row.record_id, ['apply_url', 'applyUrl']),
          }, this.today),
          tuition: tuitionFee,
          applicationFee,
        },
        relationships: {
          program: { id: program.program_id, slug: program.slug },
        },
        sources: decorations.sources(row.record_id),
        fieldMeta: {
          academicYear: identityMeta(decorations, row, 'academic_year'),
          intake: identityMeta(decorations, row, 'intake_code'),
          sequence: identityMeta(decorations, row, 'sequence'),
          cycleStatus: identityMeta(decorations, row, 'cycle_status'),
          startsOn: decorations.meta(row, ['starts_on', 'startsOn']),
          endsOn: decorations.meta(row, ['ends_on', 'endsOn']),
          'application.opensOn': decorations.meta(row, ['opens_on', 'opensOn']),
          'application.closesOn': decorations.meta(row, ['closes_on', 'closesOn']),
          'application.routeType': decorations.meta(row, ['route_type'], route !== undefined),
          'application.accessMode': decorations.meta(
            row,
            ['access_mode'],
            route?.access_mode !== null && route?.access_mode !== undefined,
          ),
          'application.applyUrl': decorations.meta(row, ['apply_url', 'applyUrl']),
          'application.rolling': decorations.meta(
            row,
            ['rolling'],
            route?.rolling !== null && route?.rolling !== undefined,
          ),
          'application.state': decorations.meta(
            row,
            ['application_state', 'opens_on', 'opensOn', 'closes_on', 'closesOn'],
            route !== undefined,
          ),
          tuition: decorations.meta(row, ['tuitionCny', 'tuition_amount', 'amount_min_minor']),
          applicationFee: decorations.meta(row, ['applicationFeeCny', 'application_fee']),
          program: identityMeta(decorations, row, 'program_id'),
        },
      }
    })
    return this.envelope(data)
  }

  private async coverage(cycleIds: string[]) {
    if (cycleIds.length === 0) return []
    const slots = placeholders(cycleIds.length)
    return queryAll<CoverageRow>(this.database, `
      SELECT
        scholarship_cycle_id,
        coverage_id,
        coverage_type,
        coverage_mode,
        amount_min_minor,
        amount_max_minor,
        currency_code,
        currency_exponent,
        period,
        max_duration,
        max_duration_unit
      FROM current_scholarship_coverage
      WHERE release_id = ? AND scholarship_cycle_id IN (${slots})
      ORDER BY scholarship_cycle_id, coverage_type, coverage_id
    `, [this.release.id, ...cycleIds])
  }

  async getScholarshipCycles(slug: string) {
    const scholarship = await queryFirst<RecordAuditRow & { slug: string | null }>(this.database, `
      SELECT
        scholarship.scholarship_id AS record_id,
        record.slug,
        record.verified_at AS record_verified_at,
        record.review_after AS record_review_after
      FROM current_scholarships AS scholarship
      JOIN current_catalog_records AS record
        ON record.release_id = scholarship.release_id AND record.record_id = scholarship.scholarship_id
      WHERE record.release_id = ? AND record.slug = ?
      LIMIT 1
    `, [this.release.id, slug])
    if (!scholarship) return null
    const rows = await queryAll<ScholarshipCycleRow>(this.database, `
      SELECT
        record.record_id,
        record.slug,
        record.verified_at AS record_verified_at,
        record.review_after AS record_review_after,
        cycle.scholarship_cycle_id,
        cycle.scholarship_id,
        cycle.academic_year,
        cycle.intake_code,
        cycle.sequence,
        cycle.cycle_status,
        cycle.institution_scope,
        cycle.program_scope,
        cycle.degree_scope,
        cycle.nationality_scope
      FROM current_scholarship_cycles AS cycle
      JOIN current_catalog_records AS record
        ON record.release_id = cycle.release_id AND record.record_id = cycle.scholarship_cycle_id
      WHERE cycle.release_id = ? AND cycle.scholarship_id = ?
      ORDER BY cycle.academic_year DESC, cycle.intake_code, cycle.sequence, cycle.scholarship_cycle_id
    `, [this.release.id, scholarship.record_id])

    if (rows.length === 0) {
      const decorations = await loadRecordDecorations(
        this.database,
        this.release.id,
        [scholarship.record_id],
      )
      const deadline = decorations.value<string>(scholarship.record_id, ['deadline', 'closes_on'])
      const data: ScholarshipCycleDto[] = [{
        type: 'scholarship_cycle',
        id: `legacy:${scholarship.record_id}`,
        slug: null,
        attributes: {
          academicYear: null,
          intake: null,
          sequence: 1,
          cycleStatus: 'legacy_projection',
          legacyProjection: true,
          application: routeApplication(undefined, {
            opensOn: null,
            closesOn: deadline,
          }, this.today),
          institutionScope: null,
          programScope: null,
          degreeScope: null,
          nationalityScope: null,
          coverage: [],
        },
        relationships: {
          scholarship: { id: scholarship.record_id, slug: scholarship.slug },
        },
        sources: decorations.sources(scholarship.record_id),
        fieldMeta: {
          academicYear: decorations.meta(scholarship, ['academic_year']),
          intake: decorations.meta(scholarship, ['intake_code']),
          sequence: identityMeta(decorations, scholarship, 'sequence'),
          cycleStatus: identityMeta(decorations, scholarship, 'cycle_status'),
          'application.opensOn': decorations.meta(scholarship, ['opens_on']),
          'application.closesOn': decorations.meta(scholarship, ['deadline', 'closes_on']),
          'application.routeType': decorations.meta(scholarship, ['route_type']),
          'application.accessMode': decorations.meta(scholarship, ['access_mode']),
          'application.applyUrl': decorations.meta(scholarship, ['apply_url', 'applicationUrl']),
          'application.rolling': decorations.meta(scholarship, ['rolling']),
          'application.state': decorations.meta(scholarship, ['deadline', 'closes_on']),
          institutionScope: decorations.meta(scholarship, ['universityIds', 'institution_ids']),
          programScope: decorations.meta(scholarship, ['programIds', 'program_ids']),
          degreeScope: decorations.meta(scholarship, ['degreeLevels', 'degree_levels']),
          nationalityScope: decorations.meta(scholarship, ['nationalities']),
          coverage: decorations.meta(scholarship, ['coverage']),
          scholarship: identityMeta(decorations, scholarship, 'scholarship_id'),
        },
      }]
      return this.envelope(data)
    }

    const ids = rows.map((row) => row.record_id)
    const [decorations, routes, coverageRows] = await Promise.all([
      loadRecordDecorations(this.database, this.release.id, ids),
      this.routeWindows(ids),
      this.coverage(ids),
    ])
    const data = rows.map((row): ScholarshipCycleDto => {
      const route = routes.find((item) => item.owner_record_id === row.record_id)
      const coverage = coverageRows
        .filter((item) => item.scholarship_cycle_id === row.record_id)
        .map((item): ScholarshipCoverageItemDto => ({
          id: item.coverage_id,
          coverageType: item.coverage_type,
          coverageMode: item.coverage_mode,
          amount: item.amount_min_minor === null
            && item.amount_max_minor === null
            && item.currency_code === null
            ? null
            : {
                amountMinimumMinor: item.amount_min_minor,
                amountMaximumMinor: item.amount_max_minor,
                currencyCode: item.currency_code,
                currencyExponent: item.currency_exponent,
                period: item.period,
              },
          maximumDuration: item.max_duration,
          maximumDurationUnit: item.max_duration_unit,
        }))
      return {
        type: 'scholarship_cycle',
        id: row.record_id,
        slug: row.slug,
        attributes: {
          academicYear: row.academic_year,
          intake: row.intake_code,
          sequence: Number(row.sequence),
          cycleStatus: row.cycle_status,
          legacyProjection: false,
          application: routeApplication(route, {
            opensOn: decorations.value<string>(row.record_id, ['opens_on', 'opensOn']),
            closesOn: decorations.value<string>(row.record_id, ['closes_on', 'closesOn', 'deadline']),
          }, this.today),
          institutionScope: row.institution_scope,
          programScope: row.program_scope,
          degreeScope: row.degree_scope,
          nationalityScope: row.nationality_scope,
          coverage,
        },
        relationships: {
          scholarship: { id: scholarship.record_id, slug: scholarship.slug },
        },
        sources: decorations.sources(row.record_id),
        fieldMeta: {
          academicYear: identityMeta(decorations, row, 'academic_year'),
          intake: identityMeta(decorations, row, 'intake_code'),
          sequence: identityMeta(decorations, row, 'sequence'),
          cycleStatus: identityMeta(decorations, row, 'cycle_status'),
          'application.opensOn': decorations.meta(row, ['opens_on', 'opensOn']),
          'application.closesOn': decorations.meta(row, ['closes_on', 'closesOn', 'deadline']),
          'application.routeType': decorations.meta(row, ['route_type'], route !== undefined),
          'application.accessMode': decorations.meta(
            row,
            ['access_mode'],
            route?.access_mode !== null && route?.access_mode !== undefined,
          ),
          'application.applyUrl': decorations.meta(
            row,
            ['apply_url'],
            route?.apply_url !== null && route?.apply_url !== undefined,
          ),
          'application.rolling': decorations.meta(
            row,
            ['rolling'],
            route?.rolling !== null && route?.rolling !== undefined,
          ),
          'application.state': decorations.meta(
            row,
            ['application_state', 'opens_on', 'opensOn', 'closes_on', 'closesOn', 'deadline'],
            route !== undefined,
          ),
          institutionScope: decorations.meta(row, ['institution_scope']),
          programScope: decorations.meta(row, ['program_scope']),
          degreeScope: decorations.meta(row, ['degree_scope']),
          nationalityScope: decorations.meta(row, ['nationality_scope']),
          coverage: decorations.meta(row, ['coverage'], coverage.length > 0),
          scholarship: identityMeta(decorations, row, 'scholarship_id'),
        },
      }
    })
    return this.envelope(data)
  }
}
