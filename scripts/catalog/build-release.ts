import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { bundleSchema } from '../../src/lib/data/schema'
import { getDataReleaseDate } from '../../src/lib/data/release'
import type { AuditMeta, DataBundle, LocalizedText, Program, Source } from '../../src/lib/data/types'

type SqlValue = string | number | boolean | null

export type ReleaseArtifacts = {
  release: {
    id: string
    dataDate: string
    generatedAt: string
    recordCounts: {
      sources: number
      cities: number
      universities: number
      programs: number
      admissionCycles: number
      scholarships: number
    }
  }
  contentSha256: string
  r2Key: string
  sql: string
  envelope: string
}

const sourceKind: Record<Source['kind'], string> = {
  university: 'institution',
  program: 'program',
  admissions: 'admissions',
  scholarship: 'scholarship',
  government: 'government',
  city: 'city',
}

const disciplineNames: Record<string, { en: string; zh: string }> = {
  engineering: { en: 'Engineering', zh: '工学' },
  business: { en: 'Business', zh: '商科' },
  medicine: { en: 'Medicine', zh: '医学' },
  'chinese-education': { en: 'Chinese Education', zh: '汉语教育' },
  humanities: { en: 'Humanities', zh: '人文' },
  'law-ir': { en: 'Law and International Relations', zh: '法律与国际关系' },
  science: { en: 'Science', zh: '理学' },
  'art-design': { en: 'Art and Design', zh: '艺术与设计' },
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function sqlValue(value: SqlValue): string {
  if (value === null) return 'NULL'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Cannot serialize a non-finite SQL number.')
    return String(value)
  }
  if (typeof value === 'boolean') return value ? '1' : '0'
  return `'${value.replaceAll("'", "''")}'`
}

function insert(table: string, row: Record<string, SqlValue>) {
  const columns = Object.keys(row)
  return `INSERT OR IGNORE INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((key) => sqlValue(row[key])).join(', ')});`
}

function publicGate(status: AuditMeta['status']) {
  return status === 'verified' || status === 'stale' ? 'publishable' : 'withheld'
}

function localizedLines(values: LocalizedText[], locale: string) {
  return values.map((value) => value[locale as keyof LocalizedText] ?? value.en).join('\n')
}

function programProjection(program: Program) {
  if (program.degreeLevel === 'language') return { programType: 'language', degreeLevel: null }
  if (program.degreeLevel === 'foundation') return { programType: 'foundation', degreeLevel: null }
  return { programType: 'degree', degreeLevel: program.degreeLevel }
}

function languageCode(value: string) {
  const normalized = value.trim().toLocaleLowerCase()
  if (normalized === 'english') return 'en'
  if (normalized === 'chinese' || normalized === 'mandarin chinese') return 'zh'
  const slug = normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return slug.length >= 2 && slug.length <= 15 ? slug : `lang-${sha256(normalized).slice(0, 8)}`
}

function factStatus(
  record: AuditMeta,
  value: unknown,
  dataDate: string,
  hasOfficialSource: boolean,
) {
  if (!hasOfficialSource) return 'source_unavailable'
  if (record.status === 'stale' || record.reviewAfter < dataDate) return 'stale'
  return value === null || value === undefined || value === '' ? 'officially_not_announced' : 'known'
}

function recordRow(
  releaseId: string,
  record: { id: string; slug?: string; status: AuditMeta['status']; verifiedAt: string; reviewAfter: string },
  kind: string,
  content: unknown,
) {
  return insert('catalog_records', {
    release_id: releaseId,
    record_id: record.id,
    record_kind: kind,
    slug: record.slug ?? null,
    gate_status: publicGate(record.status),
    verified_at: record.verifiedAt,
    review_after: record.reviewAfter,
    content_sha256: sha256(JSON.stringify(content)),
  })
}

function addLocalized(
  statements: string[],
  releaseId: string,
  recordId: string,
  field: string,
  value: LocalizedText,
) {
  for (const [locale, text] of Object.entries(value)) {
    if (!text) continue
    statements.push(insert('localized_content', {
      release_id: releaseId,
      record_id: recordId,
      locale,
      field_name: field,
      text_value: text,
      translation_status: 'published',
      source_locale: null,
    }))
  }
}

function addLocalizedArray(
  statements: string[],
  releaseId: string,
  recordId: string,
  field: string,
  values: LocalizedText[],
) {
  const locales = new Set(values.flatMap((value) => Object.keys(value)))
  for (const locale of locales) {
    const text = localizedLines(values, locale)
    if (!text) continue
    statements.push(insert('localized_content', {
      release_id: releaseId,
      record_id: recordId,
      locale,
      field_name: field,
      text_value: text,
      translation_status: 'published',
      source_locale: null,
    }))
  }
}

function addSources(
  statements: string[],
  releaseId: string,
  recordId: string,
  sourceIds: string[],
) {
  for (const sourceId of sourceIds) {
    statements.push(insert('record_sources', {
      release_id: releaseId,
      record_id: recordId,
      field_path: '*',
      locale: '',
      source_id: sourceId,
      evidence_role: 'primary',
    }))
  }
}

function addField(
  statements: string[],
  releaseId: string,
  recordId: string,
  record: AuditMeta,
  fieldPath: string,
  value: unknown,
  dataDate: string,
  hasOfficialSource: boolean,
) {
  const status = factStatus(record, value, dataDate, hasOfficialSource)
  statements.push(insert('record_field_status', {
    release_id: releaseId,
    record_id: recordId,
    field_path: fieldPath,
    locale: '',
    field_status: status,
    value_json: status === 'known' ? JSON.stringify(value) : null,
    verified_at: record.verifiedAt,
    review_after: record.reviewAfter,
  }))
}

function addSearch(
  statements: string[],
  releaseId: string,
  recordId: string,
  recordKind: 'organization' | 'location' | 'program' | 'scholarship',
  title: LocalizedText,
  body: LocalizedText,
  filterText: string,
) {
  for (const locale of new Set([...Object.keys(title), ...Object.keys(body)])) {
    statements.push(insert('search_documents', {
      release_id: releaseId,
      record_id: recordId,
      locale,
      record_kind: recordKind,
      title: title[locale as keyof LocalizedText] ?? title.en,
      body: body[locale as keyof LocalizedText] ?? body.en,
      filter_text: filterText,
    }))
  }
}

function hasOfficialSource(bundle: DataBundle, sourceIds: string[]) {
  const wanted = new Set(sourceIds)
  return bundle.sources.some((source) => source.official && wanted.has(source.id))
}

export function buildLegacyRelease(bundleInput: DataBundle): ReleaseArtifacts {
  const bundle = bundleSchema.parse(bundleInput)
  const bundleJson = JSON.stringify(bundle)
  const bundleSha256 = sha256(bundleJson)
  const dataDate = getDataReleaseDate(bundle)
  const generatedAt = `${dataDate}T00:00:00.000Z`
  const releaseId = `legacy-${dataDate}-${bundleSha256.slice(0, 12)}`
  const dataVersion = Number(dataDate.replaceAll('-', '')) * 100_000 + Number.parseInt(bundleSha256.slice(0, 4), 16)
  const recordCounts = {
    sources: bundle.sources.length,
    cities: bundle.cities.length,
    universities: bundle.universities.length,
    programs: bundle.programs.length,
    admissionCycles: bundle.admissionCycles.length,
    scholarships: bundle.scholarships.length,
  }
  const release = { id: releaseId, dataDate, generatedAt, recordCounts }
  const envelope = JSON.stringify({ data: bundle, meta: { release } })
  // This digest covers the exact UTF-8 bytes written to and uploaded from the
  // compatibility-envelope file, not the source bundle used to derive the ID.
  const contentSha256 = sha256(envelope)
  const statements: string[] = [
    '-- Generated by scripts/catalog/build-release.ts. Do not edit.',
    '-- Upload the R2 compatibility envelope before executing this file.',
    'PRAGMA foreign_keys = ON;',
    insert('catalog_releases', {
      release_id: releaseId,
      data_version: dataVersion,
      schema_version: 1,
      release_status: 'building',
      source_pipeline_run_id: 'legacy-json-import',
      data_date: dataDate,
      generated_at: generatedAt,
      content_sha256: contentSha256,
      counts_json: JSON.stringify(recordCounts),
      created_at: generatedAt,
      validated_at: null,
      activated_at: null,
      expires_at: null,
    }),
  ]

  for (const source of bundle.sources) {
    if (!source.official) continue
    statements.push(insert('source_summaries', {
      release_id: releaseId,
      source_id: source.id,
      url: source.url,
      title: source.title,
      publisher: source.publisher,
      source_kind: sourceKind[source.kind],
      language_code: source.language === 'other' ? 'und' : source.language,
      authority_level: 'primary_official',
      checked_at: source.accessedAt,
    }))
  }

  for (const city of bundle.cities) {
    statements.push(recordRow(releaseId, city, 'location', city))
    statements.push(insert('locations', {
      release_id: releaseId,
      location_id: city.id,
      parent_location_id: null,
      location_type: 'city',
      country_code: 'CN',
      region_code: city.region,
      latitude: city.coordinates.lat,
      longitude: city.coordinates.lng,
    }))
    addLocalized(statements, releaseId, city.id, 'name', city.name)
    addLocalized(statements, releaseId, city.id, 'province', city.province)
    addLocalized(statements, releaseId, city.id, 'overview', city.overview)
    addLocalized(statements, releaseId, city.id, 'climate', city.climate)
    addLocalizedArray(statements, releaseId, city.id, 'foodHighlights', city.foodHighlights)
    addLocalizedArray(statements, releaseId, city.id, 'sights', city.sights)
    addSources(statements, releaseId, city.id, city.sourceIds)
    addSearch(statements, releaseId, city.id, 'location', city.name, city.overview, `${city.region} ${city.slug}`)
  }

  for (const university of bundle.universities) {
    statements.push(recordRow(releaseId, university, 'organization', university))
    statements.push(insert('organizations', {
      release_id: releaseId,
      organization_id: university.id,
      organization_type: 'university',
      official_url: university.officialUrl,
    }))
    statements.push(insert('institutions', {
      release_id: releaseId,
      institution_id: university.id,
      city_id: university.cityId,
      institution_type: 'other',
      admissions_url: university.admissionsUrl,
      featured: university.featured,
    }))
    addLocalized(statements, releaseId, university.id, 'name', university.name)
    addLocalized(statements, releaseId, university.id, 'summary', university.summary)
    addSources(statements, releaseId, university.id, university.sourceIds)
    for (const [field, value] of Object.entries({ officialUrl: university.officialUrl, admissionsUrl: university.admissionsUrl })) {
      addField(statements, releaseId, university.id, university, field, value, dataDate, hasOfficialSource(bundle, university.sourceIds))
    }
    addSearch(statements, releaseId, university.id, 'organization', university.name, university.summary, `${university.region} ${university.cityId}`)
  }

  for (const [code, names] of Object.entries(disciplineNames)) {
    statements.push(insert('disciplines', {
      release_id: releaseId,
      code,
      parent_code: null,
      name_en: names.en,
      name_zh: names.zh,
    }))
  }

  const languages = new Map<string, string>()
  for (const program of bundle.programs) {
    for (const language of program.teachingLanguages) languages.set(languageCode(language), language)
  }
  for (const [code, name] of languages) {
    statements.push(insert('languages', {
      release_id: releaseId,
      code,
      name_en: name,
      name_zh: code === 'zh' ? '中文' : null,
    }))
  }

  for (const program of bundle.programs) {
    const projection = programProjection(program)
    statements.push(recordRow(releaseId, program, 'program', program))
    statements.push(insert('programs', {
      release_id: releaseId,
      program_id: program.id,
      institution_id: program.universityId,
      academic_unit_id: null,
      parent_program_id: null,
      program_type: projection.programType,
      degree_level: projection.degreeLevel,
      credential_type: null,
      attendance_mode: program.details?.studyMode.replace('-', '_') ?? 'full_time',
      delivery_mode: 'on_campus',
      duration_min: program.durationMonths,
      duration_max: program.durationMonthsMax ?? null,
      duration_unit: program.durationMonths === null ? null : 'months',
      official_url: program.programUrl,
    }))
    statements.push(insert('program_disciplines', {
      release_id: releaseId,
      program_id: program.id,
      discipline_code: program.discipline,
      is_primary: true,
    }))
    for (const language of program.teachingLanguages) {
      statements.push(insert('program_teaching_languages', {
        release_id: releaseId,
        program_id: program.id,
        language_code: languageCode(language),
        role: 'primary',
      }))
    }
    addLocalized(statements, releaseId, program.id, 'name', program.name)
    if (program.details) {
      addLocalized(statements, releaseId, program.id, 'overview', program.details.overview)
      addLocalized(statements, releaseId, program.id, 'faculty', program.details.faculty)
      addLocalized(statements, releaseId, program.id, 'qualification', program.details.qualification)
      addLocalized(statements, releaseId, program.id, 'languagePolicy', program.details.languagePolicy)
      addLocalizedArray(statements, releaseId, program.id, 'curriculumHighlights', program.details.curriculumHighlights)
      addLocalizedArray(statements, releaseId, program.id, 'eligibility', program.details.eligibility)
      addLocalizedArray(statements, releaseId, program.id, 'applicationMaterials', program.details.applicationMaterials)
    }
    addSources(statements, releaseId, program.id, program.sourceIds)
    const official = hasOfficialSource(bundle, program.sourceIds)
    for (const [field, value] of Object.entries({
      teachingLanguages: program.teachingLanguages,
      durationMonths: program.durationMonths,
      durationMonthsMax: program.durationMonthsMax ?? null,
      programUrl: program.programUrl,
      applyUrl: program.applyUrl,
      languageRequirements: program.languageRequirements,
    })) addField(statements, releaseId, program.id, program, field, value, dataDate, official)
    addSearch(statements, releaseId, program.id, 'program', program.name, program.details?.overview ?? program.name, `${program.degreeLevel} ${program.discipline} ${program.teachingLanguages.join(' ')}`)
  }

  for (const cycle of bundle.admissionCycles) {
    const program = bundle.programs.find((item) => item.id === cycle.programId)
    if (!program) throw new Error(`Program not found for cycle ${cycle.id}`)
    const cycleRecord = cycle.dateStatus === 'previous-cycle-reference'
      ? { ...cycle, status: 'archived' as const }
      : cycle
    statements.push(recordRow(releaseId, cycleRecord, 'program_cycle', cycle))
    statements.push(insert('program_cycles', {
      release_id: releaseId,
      program_cycle_id: cycle.id,
      program_id: cycle.programId,
      academic_year: cycle.academicYear,
      intake_code: cycle.intake,
      sequence: 1,
      starts_on: null,
      ends_on: null,
      cycle_status: cycle.dateStatus === 'previous-cycle-reference' ? 'archived' : 'announced',
      official_url: program.programUrl,
    }))
    addSources(statements, releaseId, cycle.id, cycle.sourceIds)
    const official = hasOfficialSource(bundle, cycle.sourceIds)
    for (const [field, value] of Object.entries({
      opensOn: cycle.opensOn,
      closesOn: cycle.closesOn,
      tuitionCny: cycle.tuitionCny,
      applicationFeeCny: cycle.applicationFeeCny,
    })) addField(statements, releaseId, cycle.id, cycle, field, value, dataDate, official)

    const routeId = `route-${cycle.id}`
    const windowId = `window-${cycle.id}`
    statements.push(recordRow(releaseId, { ...cycleRecord, id: routeId }, 'application_route', { cycle, routeId }))
    statements.push(insert('application_routes', {
      release_id: releaseId,
      application_route_id: routeId,
      owner_record_id: cycle.id,
      route_type: 'university_portal',
      access_mode: 'public_individual',
      apply_url: program.applyUrl,
      is_primary: true,
    }))
    addSources(statements, releaseId, routeId, cycle.sourceIds)
    statements.push(recordRow(releaseId, { ...cycleRecord, id: windowId }, 'application_window', { cycle, windowId }))
    statements.push(insert('application_windows', {
      release_id: releaseId,
      application_window_id: windowId,
      application_route_id: routeId,
      round_label: null,
      opens_on: cycle.dateStatus === 'rolling' ? null : cycle.opensOn,
      closes_on: cycle.dateStatus === 'rolling' ? null : cycle.closesOn,
      rolling: cycle.dateStatus === 'rolling',
    }))
    addSources(statements, releaseId, windowId, cycle.sourceIds)

    const fees: Array<{ type: 'tuition' | 'application'; value: number | null; period: string; status: string }> = [
      { type: 'tuition', value: cycle.tuitionCny, period: cycle.tuitionPeriod?.replace('-', '_') ?? 'academic_year', status: cycle.tuitionStatus ?? 'reference' },
      { type: 'application', value: cycle.applicationFeeCny, period: 'one_time', status: 'confirmed' },
    ]
    for (const fee of fees) {
      if (fee.value === null) continue
      const feeId = `fee-${fee.type}-${cycle.id}`
      statements.push(recordRow(releaseId, { ...cycleRecord, id: feeId }, 'fee', { cycleId: cycle.id, ...fee }))
      statements.push(insert('fee_items', {
        release_id: releaseId,
        fee_id: feeId,
        owner_record_id: cycle.id,
        fee_type: fee.type,
        amount_min_minor: Math.round(fee.value * 100),
        amount_max_minor: null,
        currency_code: 'CNY',
        currency_exponent: 2,
        billing_period: fee.period,
        mandatory: true,
        value_status: fee.status === 'confirmed' ? 'confirmed' : 'reference',
      }))
      addSources(statements, releaseId, feeId, cycle.sourceIds)
    }
  }

  for (const scholarship of bundle.scholarships) {
    const providerId = `provider-${scholarship.id}`
    statements.push(recordRow(releaseId, { ...scholarship, id: providerId, slug: `provider-${scholarship.slug}` }, 'organization', { providerId, scholarship }))
    statements.push(insert('organizations', {
      release_id: releaseId,
      organization_id: providerId,
      organization_type: scholarship.providerType === 'university' ? 'university' : 'scholarship_provider',
      official_url: scholarship.applicationUrl,
    }))
    addSources(statements, releaseId, providerId, scholarship.sourceIds)
    statements.push(recordRow(releaseId, scholarship, 'scholarship', scholarship))
    statements.push(insert('scholarships', {
      release_id: releaseId,
      scholarship_id: scholarship.id,
      provider_organization_id: providerId,
      scheme_type: scholarship.providerType === 'csc' ? 'government' : scholarship.providerType,
      official_url: scholarship.applicationUrl,
    }))
    addLocalized(statements, releaseId, scholarship.id, 'name', scholarship.name)
    addLocalized(statements, releaseId, scholarship.id, 'summary', scholarship.summary)
    addSources(statements, releaseId, scholarship.id, scholarship.sourceIds)
    const official = hasOfficialSource(bundle, scholarship.sourceIds)
    for (const [field, value] of Object.entries({
      deadline: scholarship.deadline,
      universityIds: scholarship.universityIds,
      programIds: scholarship.programIds,
      'coverage.tuition': scholarship.coverage.tuition === 'unknown' ? null : scholarship.coverage.tuition,
      'coverage.accommodation': scholarship.coverage.accommodation === 'unknown' ? null : scholarship.coverage.accommodation,
      'coverage.insurance': scholarship.coverage.insurance === 'unknown' ? null : scholarship.coverage.insurance,
      'coverage.stipendCnyPerMonth': scholarship.coverage.stipendCnyPerMonth,
      applicationUrl: scholarship.applicationUrl,
    })) addField(statements, releaseId, scholarship.id, scholarship, field, value, dataDate, official)
    addSearch(statements, releaseId, scholarship.id, 'scholarship', scholarship.name, scholarship.summary, `${scholarship.providerType} ${scholarship.universityIds.join(' ')}`)
  }

  statements.push(
    `UPDATE catalog_releases SET release_status = 'ready', validated_at = ${sqlValue(generatedAt)} WHERE release_id = ${sqlValue(releaseId)} AND release_status = 'building';`,
    insert('release_activation_requests', {
      request_id: `activate-${releaseId}`,
      release_id: releaseId,
      actor: 'legacy-json-import',
      expected_content_sha256: contentSha256,
      expected_counts_json: JSON.stringify(recordCounts),
      requested_at: generatedAt,
      previous_release_id: null,
      completed_at: null,
    }),
    'PRAGMA optimize;',
  )

  return {
    release,
    contentSha256,
    r2Key: `releases/${releaseId}/compat-envelope.json`,
    sql: `${statements.join('\n')}\n`,
    envelope,
  }
}

export function readLegacyBundle(dataDirectory = resolve('content', 'data')): DataBundle {
  const read = (name: string) => JSON.parse(readFileSync(join(dataDirectory, `${name}.json`), 'utf8')) as unknown
  return bundleSchema.parse({
    sources: read('sources'),
    cities: read('cities'),
    universities: read('universities'),
    programs: read('programs'),
    admissionCycles: read('admission-cycles'),
    scholarships: read('scholarships'),
  })
}

function argument(name: string) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function main() {
  const outputDirectory = resolve(argument('--output') ?? '.catalog-build')
  const artifacts = buildLegacyRelease(readLegacyBundle())
  mkdirSync(outputDirectory, { recursive: true })
  const sqlPath = join(outputDirectory, `${artifacts.release.id}.sql`)
  const envelopePath = join(outputDirectory, `${artifacts.release.id}.compat-envelope.json`)
  const manifestPath = join(outputDirectory, `${artifacts.release.id}.manifest.json`)
  writeFileSync(sqlPath, artifacts.sql, 'utf8')
  writeFileSync(envelopePath, artifacts.envelope, 'utf8')
  writeFileSync(manifestPath, JSON.stringify({
    ...artifacts.release,
    contentSha256: artifacts.contentSha256,
    r2Key: artifacts.r2Key,
    sqlPath,
    envelopePath,
  }, null, 2), 'utf8')
  process.stdout.write(`${manifestPath}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main()
