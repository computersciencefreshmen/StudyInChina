import { ReleaseValidationError, sha256, stableJson } from './artifact'
import type { R2Bucket, ReleaseArtifact, SqlRow } from './types'

export type CompatibilityArtifact = {
  key: string
  text: string
  contentSha256: string
  byteLength: number
}

type JsonObject = Record<string, unknown>

function text(row: SqlRow | undefined, key: string): string | null {
  const value = row?.[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function number(row: SqlRow | undefined, key: string): number | null {
  const value = row?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function unique(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => value !== null))].sort()
}

function rowsBy(rows: SqlRow[], key: string): Map<string, SqlRow> {
  return new Map(rows.flatMap((row) => {
    const value = text(row, key)
    return value ? [[value, row] as const] : []
  }))
}

function rowsGroupedBy(rows: SqlRow[], key: string): Map<string, SqlRow[]> {
  const result = new Map<string, SqlRow[]>()
  for (const row of rows) {
    const value = text(row, key)
    if (!value) continue
    result.set(value, [...(result.get(value) ?? []), row])
  }
  return result
}

function parseKnownValue(row: SqlRow): unknown {
  if (row.field_status !== 'known' || typeof row.value_json !== 'string') return undefined
  try {
    return JSON.parse(row.value_json)
  } catch {
    throw new ReleaseValidationError(
      'invalid_compatibility_fact',
      `${String(row.record_id)}.${String(row.field_path)} is not valid JSON`,
    )
  }
}

function sourceKind(value: string | null): string {
  if (value === 'institution') return 'university'
  if (value === 'application_portal') return 'admissions'
  return ['program', 'admissions', 'scholarship', 'government', 'city'].includes(value ?? '')
    ? value as string
    : 'other'
}

function sourceLanguage(value: string | null): string {
  return ['zh', 'en', 'ru'].includes(value ?? '') ? value as string : 'other'
}

function schemeType(value: string | null): string {
  if (value === 'government') return 'csc'
  return ['university', 'province', 'city'].includes(value ?? '') ? value as string : 'other'
}

export async function buildCompatibilityArtifact(
  artifact: ReleaseArtifact,
): Promise<CompatibilityArtifact> {
  const tables = artifact.tables
  const records = rowsBy(tables.catalog_records, 'record_id')
  const locations = rowsBy(tables.locations, 'location_id')
  const organizations = rowsBy(tables.organizations, 'organization_id')
  const institutions = rowsBy(tables.institutions, 'institution_id')
  const programs = rowsBy(tables.programs, 'program_id')
  const scholarships = rowsBy(tables.scholarships, 'scholarship_id')
  const localized = rowsGroupedBy(tables.localized_content, 'record_id')
  const recordSources = rowsGroupedBy(tables.record_sources, 'record_id')
  const fields = rowsGroupedBy(tables.record_field_status, 'record_id')
  const disciplines = rowsGroupedBy(tables.program_disciplines, 'program_id')
  const teachingLanguages = rowsGroupedBy(tables.program_teaching_languages, 'program_id')
  const languageRows = rowsBy(tables.languages, 'code')

  const localizations = (recordId: string, field: string): JsonObject => Object.fromEntries(
    (localized.get(recordId) ?? [])
      .filter((row) => row.field_name === field)
      .flatMap((row) => {
        const locale = text(row, 'locale')
        const value = text(row, 'text_value')
        return locale && value ? [[locale, value] as const] : []
      })
      .sort(([left], [right]) => left.localeCompare(right, 'en')),
  )
  const optionalLocalizations = (recordId: string, field: string): JsonObject | null => {
    const value = localizations(recordId, field)
    return Object.keys(value).length > 0 ? value : null
  }
  const sourceIds = (recordId: string): string[] => unique(
    (recordSources.get(recordId) ?? []).map((row) => text(row, 'source_id')),
  )
  const fact = (recordId: string, paths: string[]): unknown => {
    for (const path of paths) {
      const row = (fields.get(recordId) ?? []).find(
        (candidate) => candidate.field_path === path && candidate.locale === '',
      )
      if (row) {
        const value = parseKnownValue(row)
        if (value !== undefined) return value
      }
    }
    return undefined
  }
  const audit = (recordId: string): JsonObject => {
    const record = records.get(recordId)
    if (!record) {
      throw new ReleaseValidationError(
        'invalid_compatibility_record',
        `compatibility record ${recordId} is missing`,
      )
    }
    return {
      sourceIds: sourceIds(recordId),
      verifiedAt: text(record, 'verified_at'),
      reviewAfter: text(record, 'review_after'),
      status: 'verified',
    }
  }
  const slug = (recordId: string): string => {
    const value = text(records.get(recordId), 'slug')
    if (!value) {
      throw new ReleaseValidationError(
        'invalid_compatibility_record',
        `compatibility record ${recordId} has no slug`,
      )
    }
    return value
  }

  const sources = tables.source_summaries.map((row) => ({
    id: text(row, 'source_id'),
    url: text(row, 'url'),
    title: text(row, 'title'),
    publisher: text(row, 'publisher'),
    kind: sourceKind(text(row, 'source_kind')),
    language: sourceLanguage(text(row, 'language_code')),
    official: ['primary_official', 'secondary_official'].includes(
      text(row, 'authority_level') ?? '',
    ),
    accessedAt: text(row, 'checked_at')?.slice(0, 10) ?? null,
  })).sort((left, right) => String(left.id).localeCompare(String(right.id), 'en'))

  const cities = [...locations.values()]
    .filter((row) => row.location_type === 'city')
    .map((row) => {
      const id = text(row, 'location_id') as string
      const latitude = number(row, 'latitude')
      const longitude = number(row, 'longitude')
      return {
        id,
        slug: slug(id),
        name: localizations(id, 'name'),
        province: optionalLocalizations(id, 'province'),
        region: text(row, 'region_code'),
        coordinates: latitude === null || longitude === null
          ? null
          : { lat: latitude, lng: longitude },
        overview: optionalLocalizations(id, 'overview'),
        climate: optionalLocalizations(id, 'climate'),
        foodHighlights: fact(id, ['foodHighlights']) ?? [],
        sights: fact(id, ['sights']) ?? [],
        ...audit(id),
      }
    })
    .sort((left, right) => left.id.localeCompare(right.id, 'en'))

  const cityRegions = new Map(cities.map((city) => [city.id, city.region]))
  const universities = [...institutions.values()].map((row) => {
    const id = text(row, 'institution_id') as string
    const cityId = text(row, 'city_id') as string
    const organization = organizations.get(id)
    if (locations.get(cityId)?.location_type !== 'city') {
      throw new ReleaseValidationError(
        'invalid_compatibility_city',
        `compatibility institution ${id} references invalid city ${cityId}`,
      )
    }
    return {
      id,
      slug: slug(id),
      name: localizations(id, 'name'),
      cityId,
      region: cityRegions.get(cityId) ?? null,
      officialUrl: text(organization, 'official_url'),
      admissionsUrl: text(row, 'admissions_url'),
      summary: optionalLocalizations(id, 'summary'),
      featured: row.featured === 1,
      ...audit(id),
    }
  }).sort((left, right) => left.id.localeCompare(right.id, 'en'))

  const compatiblePrograms = [...programs.values()].map((row) => {
    const id = text(row, 'program_id') as string
    const type = text(row, 'program_type') ?? 'other'
    const rawDegree = text(row, 'degree_level')
    const knownDuration = fact(id, ['duration_min', 'durationMonths'])
    const knownMaximum = fact(id, ['duration_max', 'durationMonthsMax'])
    const durationUnit = fact(id, ['duration_unit'])
    const primaryDiscipline = [...(disciplines.get(id) ?? [])]
      .sort((left, right) => Number(right.is_primary ?? 0) - Number(left.is_primary ?? 0))
      .map((item) => text(item, 'discipline_code'))
      .find((value): value is string => value !== null)
    const languages = unique((teachingLanguages.get(id) ?? []).map((item) => {
      const code = text(item, 'language_code')
      const language = code ? languageRows.get(code) : undefined
      return text(language, 'name_en') ?? text(language, 'name_zh') ?? code
    }))
    return {
      id,
      slug: slug(id),
      universityId: text(row, 'institution_id'),
      name: localizations(id, 'name'),
      programType: type,
      degreeLevel: type === 'degree'
        ? rawDegree ?? 'other'
        : ['language', 'foundation'].includes(type) ? type : 'other',
      discipline: primaryDiscipline ?? 'other',
      teachingLanguages: languages,
      durationMonths: durationUnit === 'months' && typeof knownDuration === 'number'
        ? knownDuration
        : null,
      durationMonthsMax: durationUnit === 'months' && typeof knownMaximum === 'number'
        ? knownMaximum
        : null,
      durationUnit: typeof durationUnit === 'string' ? durationUnit : null,
      programUrl: text(row, 'official_url'),
      applyUrl: typeof fact(id, ['apply_url', 'applyUrl']) === 'string'
        ? fact(id, ['apply_url', 'applyUrl'])
        : null,
      languageRequirements: [],
      ...audit(id),
    }
  }).sort((left, right) => left.id.localeCompare(right.id, 'en'))

  const routesByOwner = rowsGroupedBy(tables.application_routes, 'owner_record_id')
  const windowsByRoute = rowsGroupedBy(tables.application_windows, 'application_route_id')
  const feesByOwner = rowsGroupedBy(tables.fee_items, 'owner_record_id')
  const knownDate = (recordId: string, paths: string[]): string | null => {
    const value = fact(recordId, paths)
    return typeof value === 'string' ? value : null
  }
  const money = (ownerId: string, kind: string): number | null => {
    const candidates = (feesByOwner.get(ownerId) ?? []).filter((row) => (
      row.fee_type === kind
      && row.currency_code === 'CNY'
      && row.currency_exponent === 2
    ))
    if (candidates.length !== 1) return null
    const fee = candidates[0]
    const id = text(fee, 'fee_id') as string
    const amount = fact(id, ['amount_min_minor'])
    return typeof amount === 'number' ? amount / 100 : null
  }
  const admissionCycles = tables.program_cycles
    .filter((row) => row.cycle_status === 'announced')
    .map((row) => {
      const id = text(row, 'program_cycle_id') as string
      const routes = routesByOwner.get(id) ?? []
      const windows = routes.flatMap((route) => (
        windowsByRoute.get(text(route, 'application_route_id') ?? '') ?? []
      ))
      const opens = unique(windows.map((window) => (
        knownDate(text(window, 'application_window_id') as string, ['opens_on', 'opensOn'])
      )))
      const closes = unique(windows.map((window) => (
        knownDate(text(window, 'application_window_id') as string, ['closes_on', 'closesOn'])
      )))
      const rolling = windows.some((window) => (
        fact(text(window, 'application_window_id') as string, ['rolling']) === true
      ))
      const opensOn = opens.length === 1 ? opens[0] : null
      const closesOn = closes.length === 1 ? closes[0] : null
      return {
        id,
        programId: text(row, 'program_id'),
        academicYear: text(row, 'academic_year'),
        intake: ['spring', 'autumn'].includes(text(row, 'intake_code') ?? '')
          ? text(row, 'intake_code')
          : 'other',
        opensOn,
        closesOn,
        dateStatus: rolling
          ? 'rolling'
          : opensOn || closesOn ? 'published' : 'not-announced',
        tuitionCny: money(id, 'tuition'),
        tuitionPeriod: null,
        tuitionStatus: null,
        applicationFeeCny: money(id, 'application'),
        ...audit(id),
      }
    })
    .sort((left, right) => left.id.localeCompare(right.id, 'en'))

  const compatibleScholarships = [...scholarships.values()].map((row) => {
    const id = text(row, 'scholarship_id') as string
    const arrayFact = (paths: string[]): string[] => {
      const value = fact(id, paths)
      return Array.isArray(value)
        ? unique(value.map((item) => typeof item === 'string' ? item : null))
        : []
    }
    const coverage = (path: string, allowed: string[]): string => {
      const value = fact(id, [path])
      return typeof value === 'string' && allowed.includes(value) ? value : 'unknown'
    }
    const insurance = fact(id, ['coverage.insurance'])
    const stipend = fact(id, ['coverage.stipendCnyPerMonth'])
    const deadline = fact(id, ['deadline', 'closes_on'])
    const applicationUrl = fact(id, ['applicationUrl', 'apply_url'])
    return {
      id,
      slug: slug(id),
      name: localizations(id, 'name'),
      providerType: schemeType(text(row, 'scheme_type')),
      universityIds: arrayFact(['universityIds', 'institution_ids']),
      programIds: arrayFact(['programIds', 'program_ids']),
      coverage: {
        tuition: coverage('coverage.tuition', ['full', 'partial', 'none']),
        accommodation: coverage('coverage.accommodation', ['full', 'partial', 'none']),
        insurance: typeof insurance === 'boolean' ? insurance : 'unknown',
        stipendCnyPerMonth: typeof stipend === 'number' ? stipend : null,
      },
      deadline: typeof deadline === 'string' ? deadline : null,
      applicationUrl: typeof applicationUrl === 'string' ? applicationUrl : null,
      summary: optionalLocalizations(id, 'summary'),
      ...audit(id),
    }
  }).sort((left, right) => left.id.localeCompare(right.id, 'en'))

  const data = {
    sources,
    cities,
    universities,
    programs: compatiblePrograms,
    admissionCycles,
    scholarships: compatibleScholarships,
  }
  const envelope = {
    data,
    meta: {
      release: {
        id: artifact.manifest.releaseId,
        dataDate: artifact.manifest.dataDate,
        generatedAt: artifact.manifest.generatedAt,
        recordCounts: {
          sources: sources.length,
          cities: cities.length,
          universities: universities.length,
          programs: compatiblePrograms.length,
          admissionCycles: admissionCycles.length,
          scholarships: compatibleScholarships.length,
        },
      },
    },
  }
  const textValue = stableJson(envelope)
  const byteLength = new TextEncoder().encode(textValue).byteLength
  if (byteLength > 20 * 1024 * 1024) {
    throw new ReleaseValidationError(
      'compatibility_artifact_too_large',
      'frontend compatibility artifact exceeds 20 MiB',
    )
  }
  return {
    key: `releases/${artifact.manifest.releaseId}/compat-envelope.json`,
    text: textValue,
    contentSha256: await sha256(textValue),
    byteLength,
  }
}

export async function ensureImmutableCompatibilityArtifact(
  bucket: R2Bucket,
  artifact: CompatibilityArtifact,
): Promise<void> {
  const verify = async (): Promise<boolean> => {
    const existing = await bucket.get(artifact.key)
    if (!existing) return false
    const bytes = await existing.arrayBuffer()
    if (
      bytes.byteLength !== artifact.byteLength
      || await sha256(bytes) !== artifact.contentSha256
    ) {
      throw new ReleaseValidationError(
        'compatibility_artifact_collision',
        'compatibility artifact key is already bound to different bytes',
      )
    }
    return true
  }
  if (await verify()) return
  await bucket.put(artifact.key, artifact.text, {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: {
      contentSha256: artifact.contentSha256,
      byteLength: String(artifact.byteLength),
    },
  })
  if (!(await verify())) {
    throw new ReleaseValidationError(
      'compatibility_artifact_missing',
      'compatibility artifact could not be verified after upload',
    )
  }
}
