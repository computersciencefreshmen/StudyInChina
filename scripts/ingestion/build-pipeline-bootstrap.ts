import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { bundleSchema } from '../../src/lib/data/schema'
import type {
  City,
  DataBundle,
  LocalizedText,
  Source,
  University,
} from '../../src/lib/data/types'
import {
  validatePilotSourceManifestDirectory,
  type PilotSourceManifest,
} from '../validate-source-manifests'
import { buildPilotSourceImport } from './build-source-import'

type SqlValue = string | number | boolean | null

type SourceDocument = {
  url: string
  sourceKind: string
  languageCode: string
  active: boolean
  cadenceMinutes: number | null
  robotsPolicy: 'enforce' | 'blocked' | 'unknown'
  publisherOrganizationId: string | null
  title: string
  publisher: string
  reviewedAt: string
}

type FieldDefinition = {
  recordKind: string
  fieldPath: string
  valueType: string
  riskClass: 'low' | 'medium' | 'high' | 'critical'
  requiredForPublish: boolean
  maxAgeDays: number
  validationProfile: string | null
}

export type PipelineBootstrapArtifacts = {
  sql: string
  generatedAt: string
  records: number
  locations: number
  institutions: number
  localizedContent: number
  ingestionSources: number
  enabledSources: number
  sourceDocuments: number
  sourceBindings: number
  fieldDefinitions: number
  fieldMappings: number
  excludedDraftPrograms: number
}

const FIELD_DEFINITIONS: FieldDefinition[] = [
  { recordKind: 'location', fieldPath: 'localized.name', valueType: 'localized_string', riskClass: 'low', requiredForPublish: true, maxAgeDays: 365, validationProfile: 'non-empty-text' },
  { recordKind: 'location', fieldPath: 'localized.province', valueType: 'localized_string', riskClass: 'low', requiredForPublish: false, maxAgeDays: 365, validationProfile: 'non-empty-text' },
  { recordKind: 'location', fieldPath: 'localized.overview', valueType: 'localized_string', riskClass: 'low', requiredForPublish: false, maxAgeDays: 365, validationProfile: 'non-empty-text' },
  { recordKind: 'location', fieldPath: 'localized.climate', valueType: 'localized_string', riskClass: 'low', requiredForPublish: false, maxAgeDays: 365, validationProfile: 'non-empty-text' },
  { recordKind: 'organization', fieldPath: 'localized.name', valueType: 'localized_string', riskClass: 'low', requiredForPublish: true, maxAgeDays: 365, validationProfile: 'non-empty-text' },
  { recordKind: 'organization', fieldPath: 'localized.summary', valueType: 'localized_string', riskClass: 'low', requiredForPublish: false, maxAgeDays: 180, validationProfile: 'non-empty-text' },
  { recordKind: 'organization', fieldPath: 'official_url', valueType: 'url', riskClass: 'medium', requiredForPublish: true, maxAgeDays: 90, validationProfile: 'official-https-url' },
  { recordKind: 'organization', fieldPath: 'admissions_url', valueType: 'url', riskClass: 'high', requiredForPublish: false, maxAgeDays: 30, validationProfile: 'official-https-url' },
  { recordKind: 'program', fieldPath: 'localized.name', valueType: 'localized_string', riskClass: 'medium', requiredForPublish: true, maxAgeDays: 30, validationProfile: 'non-empty-text' },
  { recordKind: 'program', fieldPath: 'official_url', valueType: 'url', riskClass: 'high', requiredForPublish: true, maxAgeDays: 30, validationProfile: 'official-https-url' },
  { recordKind: 'program', fieldPath: 'program_type', valueType: 'string', riskClass: 'high', requiredForPublish: true, maxAgeDays: 30, validationProfile: 'program-type' },
  { recordKind: 'program', fieldPath: 'degree_level', valueType: 'string', riskClass: 'high', requiredForPublish: false, maxAgeDays: 30, validationProfile: 'degree-level' },
  { recordKind: 'program', fieldPath: 'duration_min', valueType: 'integer', riskClass: 'medium', requiredForPublish: false, maxAgeDays: 30, validationProfile: 'positive-integer' },
  { recordKind: 'program', fieldPath: 'duration_max', valueType: 'integer', riskClass: 'medium', requiredForPublish: false, maxAgeDays: 30, validationProfile: 'positive-integer' },
  { recordKind: 'program', fieldPath: 'teaching_languages', valueType: 'json', riskClass: 'high', requiredForPublish: false, maxAgeDays: 30, validationProfile: 'string-array' },
  { recordKind: 'program_cycle', fieldPath: 'academic_year', valueType: 'string', riskClass: 'high', requiredForPublish: true, maxAgeDays: 30, validationProfile: 'academic-year' },
  { recordKind: 'program_cycle', fieldPath: 'intake_code', valueType: 'string', riskClass: 'high', requiredForPublish: true, maxAgeDays: 30, validationProfile: 'intake-code' },
  { recordKind: 'program_cycle', fieldPath: 'official_url', valueType: 'url', riskClass: 'high', requiredForPublish: true, maxAgeDays: 30, validationProfile: 'official-https-url' },
  { recordKind: 'application_route', fieldPath: 'access_mode', valueType: 'string', riskClass: 'critical', requiredForPublish: true, maxAgeDays: 30, validationProfile: 'application-access-mode' },
  { recordKind: 'application_route', fieldPath: 'apply_url', valueType: 'url', riskClass: 'critical', requiredForPublish: false, maxAgeDays: 7, validationProfile: 'official-https-url' },
  { recordKind: 'application_window', fieldPath: 'opens_on', valueType: 'date', riskClass: 'critical', requiredForPublish: false, maxAgeDays: 7, validationProfile: 'iso-date' },
  { recordKind: 'application_window', fieldPath: 'closes_on', valueType: 'date', riskClass: 'critical', requiredForPublish: false, maxAgeDays: 7, validationProfile: 'iso-date' },
  { recordKind: 'application_window', fieldPath: 'rolling', valueType: 'boolean', riskClass: 'critical', requiredForPublish: true, maxAgeDays: 7, validationProfile: 'boolean' },
  { recordKind: 'fee', fieldPath: 'amount_min_minor', valueType: 'decimal_minor', riskClass: 'critical', requiredForPublish: false, maxAgeDays: 7, validationProfile: 'non-negative-integer' },
  { recordKind: 'fee', fieldPath: 'currency_code', valueType: 'string', riskClass: 'critical', requiredForPublish: false, maxAgeDays: 7, validationProfile: 'iso-4217' },
  { recordKind: 'scholarship', fieldPath: 'localized.name', valueType: 'localized_string', riskClass: 'medium', requiredForPublish: true, maxAgeDays: 30, validationProfile: 'non-empty-text' },
  { recordKind: 'scholarship', fieldPath: 'official_url', valueType: 'url', riskClass: 'critical', requiredForPublish: true, maxAgeDays: 30, validationProfile: 'official-https-url' },
  { recordKind: 'scholarship_cycle', fieldPath: 'academic_year', valueType: 'string', riskClass: 'critical', requiredForPublish: true, maxAgeDays: 30, validationProfile: 'academic-year' },
  { recordKind: 'scholarship_cycle', fieldPath: 'deadline', valueType: 'date', riskClass: 'critical', requiredForPublish: false, maxAgeDays: 7, validationProfile: 'iso-date' },
  { recordKind: 'scholarship_coverage', fieldPath: 'coverage_mode', valueType: 'string', riskClass: 'critical', requiredForPublish: true, maxAgeDays: 7, validationProfile: 'coverage-mode' },
]

const CONTENT_SOURCE_KIND: Record<Source['kind'], string> = {
  university: 'institution',
  program: 'program',
  admissions: 'admissions',
  scholarship: 'scholarship',
  government: 'government',
  city: 'city',
}

const SOURCE_KIND_PRIORITY: Record<string, number> = {
  application_portal: 7,
  scholarship: 6,
  program: 5,
  admissions: 4,
  institution: 3,
  government: 2,
  city: 1,
  other: 0,
}

const USTC_PREREQUISITE = {
  cityId: 'city-hefei',
  citySlug: 'hefei',
  cityName: { en: 'Hefei', zh: '\u5408\u80a5' },
  institutionId: 'uni-university-of-science-and-technology-of-china',
  institutionSlug: 'university-of-science-and-technology-of-china',
  institutionName: {
    en: 'University of Science and Technology of China',
    zh: '\u4e2d\u56fd\u79d1\u5b66\u6280\u672f\u5927\u5b66',
  },
  officialUrl: 'https://www.ustc.edu.cn/',
  admissionsUrl: 'https://ic.ustc.edu.cn/en/admission.php',
  domains: ['ustc.edu.cn', 'ic.ustc.edu.cn'] as const,
} as const

function sqlValue(value: SqlValue): string {
  if (value === null) return 'NULL'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Cannot serialize a non-finite SQL number')
    return String(value)
  }
  if (typeof value === 'boolean') return value ? '1' : '0'
  return `'${value.replaceAll("'", "''")}'`
}

function isoTimestamp(value: string): string {
  if (Number.isNaN(Date.parse(value))) throw new Error(`Invalid ISO timestamp: ${value}`)
  return new Date(value).toISOString()
}

function dateTimestamp(value: string): string {
  return `${value}T00:00:00.000Z`
}

function urlHash(url: string): string {
  return createHash('sha256').update(url).digest('hex').slice(0, 24)
}

function sourceKindForCategory(category: PilotSourceManifest['sources'][number]['sourceCategory']): string {
  if (category === 'application_portal') return 'application_portal'
  if (category.includes('scholarship')) return 'scholarship'
  if (['undergraduate_catalog', 'masters_catalog', 'doctoral_catalog', 'non_degree_catalog', 'program_detail'].includes(category)) return 'program'
  if (['international_admissions_home', 'catalog_anchor'].includes(category)) return 'institution'
  return 'admissions'
}

function humanize(value: string): string {
  return value.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
}

function insertStableRecord(
  statements: string[],
  record: { id: string; slug: string; reviewAfter: string },
  kind: 'location' | 'organization',
  generatedAt: string,
) {
  statements.push(`
INSERT INTO records (
  id, public_id, kind, slug, workflow_status, review_after, created_at, updated_at
) VALUES (
  ${sqlValue(record.id)}, ${sqlValue(record.id)}, ${sqlValue(kind)}, ${sqlValue(record.slug)},
  'validated', ${sqlValue(record.reviewAfter)}, ${sqlValue(generatedAt)}, ${sqlValue(generatedAt)}
)
ON CONFLICT(id) DO UPDATE SET
  public_id = excluded.public_id,
  slug = excluded.slug,
  workflow_status = CASE
    WHEN records.workflow_status = 'draft' THEN 'validated'
    ELSE records.workflow_status
  END,
  review_after = CASE
    WHEN records.workflow_status IN ('applied', 'published') THEN records.review_after
    ELSE excluded.review_after
  END,
  updated_at = CASE
    WHEN records.public_id <> excluded.public_id
      OR records.slug IS NOT excluded.slug
      OR records.workflow_status = 'draft'
      OR (
        records.workflow_status NOT IN ('applied', 'published')
        AND records.review_after IS NOT excluded.review_after
      )
    THEN excluded.updated_at
    ELSE records.updated_at
  END;`.trim())
  statements.push(`
UPDATE record_slugs
SET is_current = 0, valid_to = ${sqlValue(generatedAt)}
WHERE record_id = ${sqlValue(record.id)}
  AND is_current = 1
  AND slug <> ${sqlValue(record.slug)};`.trim())
  statements.push(`
INSERT INTO record_slugs (record_id, slug, valid_from, valid_to, is_current)
VALUES (${sqlValue(record.id)}, ${sqlValue(record.slug)}, ${sqlValue(generatedAt)}, NULL, 1)
ON CONFLICT(record_id, slug) DO UPDATE SET
  valid_to = NULL,
  is_current = 1;`.trim())
}

function localizedStatements(
  statements: string[],
  recordId: string,
  fieldName: string,
  value: LocalizedText,
  generatedAt: string,
): number {
  let count = 0
  for (const [locale, text] of Object.entries(value).sort(([left], [right]) => left.localeCompare(right))) {
    if (!text) continue
    count += 1
    statements.push(`
INSERT INTO localized_content (
  record_id, locale, field_name, text_value, translation_status, source_locale, updated_at
) VALUES (
  ${sqlValue(recordId)}, ${sqlValue(locale)}, ${sqlValue(fieldName)}, ${sqlValue(text)},
  'published', NULL, ${sqlValue(generatedAt)}
)
ON CONFLICT(record_id, locale, field_name) DO UPDATE SET
  text_value = excluded.text_value,
  translation_status = excluded.translation_status,
  source_locale = excluded.source_locale,
  updated_at = CASE
    WHEN localized_content.text_value <> excluded.text_value
      OR localized_content.translation_status <> excluded.translation_status
      OR localized_content.source_locale IS NOT excluded.source_locale
    THEN excluded.updated_at
    ELSE localized_content.updated_at
  END;`.trim())
  }
  return count
}

function localizedListStatements(
  statements: string[],
  recordId: string,
  fieldName: string,
  values: LocalizedText[],
  generatedAt: string,
): number {
  const locales = [...new Set(values.flatMap((value) => Object.keys(value)))].sort()
  const localized = Object.fromEntries(locales.map((locale) => [
    locale,
    values.map((value) => value[locale as keyof LocalizedText] ?? value.en).join('\n'),
  ])) as LocalizedText
  return localizedStatements(statements, recordId, fieldName, localized, generatedAt)
}

function cityStatements(statements: string[], city: City, generatedAt: string): number {
  insertStableRecord(statements, city, 'location', generatedAt)
  statements.push(`
INSERT INTO locations (
  record_id, parent_location_id, location_type, country_code,
  region_code, latitude, longitude
) VALUES (
  ${sqlValue(city.id)}, NULL, 'city', 'CN', ${sqlValue(city.region)},
  ${sqlValue(city.coordinates.lat)}, ${sqlValue(city.coordinates.lng)}
)
ON CONFLICT(record_id) DO UPDATE SET
  parent_location_id = excluded.parent_location_id,
  location_type = excluded.location_type,
  country_code = excluded.country_code,
  region_code = excluded.region_code,
  latitude = excluded.latitude,
  longitude = excluded.longitude;`.trim())
  let localizedCount = 0
  localizedCount += localizedStatements(statements, city.id, 'name', city.name, generatedAt)
  localizedCount += localizedStatements(statements, city.id, 'province', city.province, generatedAt)
  localizedCount += localizedStatements(statements, city.id, 'overview', city.overview, generatedAt)
  localizedCount += localizedStatements(statements, city.id, 'climate', city.climate, generatedAt)
  localizedCount += localizedListStatements(statements, city.id, 'foodHighlights', city.foodHighlights, generatedAt)
  localizedCount += localizedListStatements(statements, city.id, 'sights', city.sights, generatedAt)
  return localizedCount
}

function universityStatements(
  statements: string[],
  university: University,
  generatedAt: string,
): number {
  insertStableRecord(statements, university, 'organization', generatedAt)
  statements.push(`
INSERT INTO organizations (record_id, organization_type, official_url)
VALUES (${sqlValue(university.id)}, 'university', ${sqlValue(university.officialUrl)})
ON CONFLICT(record_id) DO UPDATE SET
  organization_type = excluded.organization_type,
  official_url = excluded.official_url;`.trim())
  statements.push(`
INSERT INTO organization_domains (organization_id, domain, is_primary, verified_at)
VALUES (
  ${sqlValue(university.id)}, ${sqlValue(new URL(university.officialUrl).hostname.toLowerCase())},
  1, ${sqlValue(dateTimestamp(university.verifiedAt))}
)
ON CONFLICT(organization_id, domain) DO UPDATE SET
  is_primary = 1,
  verified_at = excluded.verified_at;`.trim())
  statements.push(`
INSERT INTO institutions (
  record_id, city_id, institution_type, ministry_code, admissions_url, featured
) VALUES (
  ${sqlValue(university.id)}, ${sqlValue(university.cityId)}, 'other', NULL,
  ${sqlValue(university.admissionsUrl)}, ${sqlValue(university.featured)}
)
ON CONFLICT(record_id) DO UPDATE SET
  city_id = excluded.city_id,
  institution_type = excluded.institution_type,
  admissions_url = excluded.admissions_url,
  featured = excluded.featured;`.trim())
  let localizedCount = 0
  localizedCount += localizedStatements(statements, university.id, 'name', university.name, generatedAt)
  localizedCount += localizedStatements(statements, university.id, 'summary', university.summary, generatedAt)
  return localizedCount
}

function ustcPrerequisiteStatements(
  statements: string[],
  manifest: PilotSourceManifest,
  generatedAt: string,
): number {
  const checkedAt = dateTimestamp(manifest.checkedAt)
  const reviewAfterDate = new Date(checkedAt)
  reviewAfterDate.setUTCDate(reviewAfterDate.getUTCDate() + 90)
  const reviewAfter = reviewAfterDate.toISOString().slice(0, 10)

  insertStableRecord(statements, {
    id: USTC_PREREQUISITE.cityId,
    slug: USTC_PREREQUISITE.citySlug,
    reviewAfter,
  }, 'location', generatedAt)
  statements.push(`
INSERT INTO locations (
  record_id, parent_location_id, location_type, country_code,
  region_code, latitude, longitude
) VALUES (
  ${sqlValue(USTC_PREREQUISITE.cityId)}, NULL, 'city', 'CN',
  'CN-AH', NULL, NULL
)
ON CONFLICT(record_id) DO UPDATE SET
  parent_location_id = NULL,
  location_type = 'city',
  country_code = 'CN',
  region_code = 'CN-AH';`.trim())

  insertStableRecord(statements, {
    id: USTC_PREREQUISITE.institutionId,
    slug: USTC_PREREQUISITE.institutionSlug,
    reviewAfter,
  }, 'organization', generatedAt)
  statements.push(`
INSERT INTO organizations (record_id, organization_type, official_url)
VALUES (
  ${sqlValue(USTC_PREREQUISITE.institutionId)}, 'university',
  ${sqlValue(USTC_PREREQUISITE.officialUrl)}
)
ON CONFLICT(record_id) DO UPDATE SET
  organization_type = 'university',
  official_url = excluded.official_url;`.trim())
  statements.push(`
UPDATE organization_domains
SET is_primary = 0
WHERE organization_id = ${sqlValue(USTC_PREREQUISITE.institutionId)}
  AND domain <> ${sqlValue(USTC_PREREQUISITE.domains[0])}
  AND is_primary <> 0;`.trim())
  for (const [index, domain] of USTC_PREREQUISITE.domains.entries()) {
    statements.push(`
INSERT INTO organization_domains (
  organization_id, domain, is_primary, verified_at
) VALUES (
  ${sqlValue(USTC_PREREQUISITE.institutionId)}, ${sqlValue(domain)},
  ${sqlValue(index === 0)}, ${sqlValue(checkedAt)}
)
ON CONFLICT(organization_id, domain) DO UPDATE SET
  is_primary = excluded.is_primary,
  verified_at = excluded.verified_at;`.trim())
  }
  statements.push(`
INSERT INTO institutions (
  record_id, city_id, institution_type, ministry_code, admissions_url, featured
) VALUES (
  ${sqlValue(USTC_PREREQUISITE.institutionId)},
  ${sqlValue(USTC_PREREQUISITE.cityId)}, 'other', NULL,
  ${sqlValue(USTC_PREREQUISITE.admissionsUrl)}, 0
)
ON CONFLICT(record_id) DO UPDATE SET
  city_id = excluded.city_id,
  institution_type = excluded.institution_type,
  admissions_url = excluded.admissions_url,
  featured = excluded.featured;`.trim())

  let localizedCount = 0
  localizedCount += localizedStatements(
    statements,
    USTC_PREREQUISITE.cityId,
    'name',
    USTC_PREREQUISITE.cityName,
    generatedAt,
  )
  localizedCount += localizedStatements(
    statements,
    USTC_PREREQUISITE.institutionId,
    'name',
    USTC_PREREQUISITE.institutionName,
    generatedAt,
  )
  return localizedCount
}

function sourceOwners(bundle: DataBundle): Map<string, string> {
  const owners = new Map<string, Set<string>>()
  const add = (sourceId: string, institutionId: string) => {
    const sourceOwners = owners.get(sourceId) ?? new Set<string>()
    sourceOwners.add(institutionId)
    owners.set(sourceId, sourceOwners)
  }
  for (const university of bundle.universities) {
    for (const sourceId of university.sourceIds) add(sourceId, university.id)
  }
  for (const program of bundle.programs) {
    for (const sourceId of program.sourceIds) add(sourceId, program.universityId)
  }
  return new Map(
    [...owners].flatMap(([sourceId, institutionIds]) => (
      institutionIds.size === 1 ? [[sourceId, [...institutionIds][0]] as const] : []
    )),
  )
}

function collectSourceDocuments(
  bundle: DataBundle,
  manifests: PilotSourceManifest[],
  stableInstitutionIds: Set<string>,
): SourceDocument[] {
  type Candidate = SourceDocument & { preference: number }
  const byUrl = new Map<string, Candidate[]>()
  const add = (candidate: Candidate) => {
    const candidates = byUrl.get(candidate.url) ?? []
    candidates.push(candidate)
    byUrl.set(candidate.url, candidates)
  }
  const owners = sourceOwners(bundle)
  for (const source of bundle.sources) {
    const owner = owners.get(source.id)
    add({
      url: source.url,
      sourceKind: CONTENT_SOURCE_KIND[source.kind],
      languageCode: source.language,
      active: source.official,
      cadenceMinutes: null,
      robotsPolicy: 'unknown',
      publisherOrganizationId: owner && stableInstitutionIds.has(owner) ? owner : null,
      title: source.title,
      publisher: source.publisher,
      reviewedAt: dateTimestamp(source.accessedAt),
      preference: 100,
    })
  }
  const universityNames = new Map(bundle.universities.map((item) => [item.id, item.name.en]))
  universityNames.set(
    USTC_PREREQUISITE.institutionId,
    USTC_PREREQUISITE.institutionName.en,
  )
  for (const manifest of manifests) {
    for (const source of manifest.sources) {
      const publisher = universityNames.get(source.institutionId) ?? source.institutionId
      add({
        url: source.officialUrl,
        sourceKind: sourceKindForCategory(source.sourceCategory),
        languageCode: 'other',
        active: source.enabled && source.robots.mode === 'enforce',
        cadenceMinutes: source.enabled ? source.schedule.intervalHours * 60 : null,
        robotsPolicy: source.robots.mode,
        publisherOrganizationId: stableInstitutionIds.has(source.institutionId)
          ? source.institutionId
          : null,
        title: `${humanize(source.sourceCategory)} — ${publisher}`,
        publisher,
        reviewedAt: dateTimestamp(manifest.checkedAt),
        preference: source.enabled ? 20 : 10,
      })
    }
  }
  return [...byUrl.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([url, candidates]) => {
      const preferred = [...candidates].sort((left, right) => (
        right.preference - left.preference || left.title.localeCompare(right.title)
      ))[0]
      const activeCandidates = candidates.filter((candidate) => candidate.active)
      const kinds = [...candidates].sort((left, right) => (
        (SOURCE_KIND_PRIORITY[right.sourceKind] ?? 0) - (SOURCE_KIND_PRIORITY[left.sourceKind] ?? 0)
      ))
      const publisherIds = [...new Set(
        candidates
          .map((candidate) => candidate.publisherOrganizationId)
          .filter((value): value is string => value !== null),
      )]
      const cadences = activeCandidates
        .map((candidate) => candidate.cadenceMinutes)
        .filter((value): value is number => value !== null)
      const reviewedAt = candidates.map((candidate) => candidate.reviewedAt).sort().at(-1)!
      const robotsPolicy = activeCandidates.some((candidate) => candidate.robotsPolicy === 'enforce')
        ? 'enforce'
        : candidates.every((candidate) => candidate.robotsPolicy === 'blocked')
          ? 'blocked'
          : 'unknown'
      return {
        url,
        sourceKind: kinds[0].sourceKind,
        languageCode: preferred.languageCode,
        active: activeCandidates.length > 0,
        cadenceMinutes: cadences.length > 0 ? Math.min(...cadences) : null,
        robotsPolicy,
        publisherOrganizationId: publisherIds.length === 1 ? publisherIds[0] : null,
        title: preferred.title,
        publisher: preferred.publisher,
        reviewedAt,
      }
    })
}

function sourceDocumentStatements(
  statements: string[],
  document: SourceDocument,
  generatedAt: string,
) {
  const deterministicId = `source-document-${urlHash(document.url)}`
  statements.push(`
INSERT INTO source_documents (
  id, public_id, canonical_url, publisher_organization_id, source_kind,
  authority_level, official, language_code, active, fetch_cadence_minutes,
  robots_policy, created_at, updated_at
) VALUES (
  ${sqlValue(deterministicId)}, ${sqlValue(deterministicId)}, ${sqlValue(document.url)},
  ${sqlValue(document.publisherOrganizationId)}, ${sqlValue(document.sourceKind)},
  'primary_official', 1, ${sqlValue(document.languageCode)}, ${sqlValue(document.active)},
  ${sqlValue(document.cadenceMinutes)}, ${sqlValue(document.robotsPolicy)},
  ${sqlValue(generatedAt)}, ${sqlValue(generatedAt)}
)
ON CONFLICT(canonical_url) DO UPDATE SET
  publisher_organization_id = excluded.publisher_organization_id,
  source_kind = excluded.source_kind,
  authority_level = excluded.authority_level,
  official = excluded.official,
  language_code = excluded.language_code,
  active = excluded.active,
  fetch_cadence_minutes = excluded.fetch_cadence_minutes,
  robots_policy = excluded.robots_policy,
  updated_at = CASE
    WHEN source_documents.publisher_organization_id IS NOT excluded.publisher_organization_id
      OR source_documents.source_kind <> excluded.source_kind
      OR source_documents.authority_level <> excluded.authority_level
      OR source_documents.official <> excluded.official
      OR source_documents.language_code <> excluded.language_code
      OR source_documents.active <> excluded.active
      OR source_documents.fetch_cadence_minutes IS NOT excluded.fetch_cadence_minutes
      OR source_documents.robots_policy <> excluded.robots_policy
    THEN excluded.updated_at
    ELSE source_documents.updated_at
  END;`.trim())
  statements.push(`
INSERT INTO publication_source_metadata (
  source_id, title, publisher, reviewed_by, reviewed_at, updated_at
)
SELECT
  id, ${sqlValue(document.title)}, ${sqlValue(document.publisher)},
  'pipeline-bootstrap-v1', ${sqlValue(document.reviewedAt)}, ${sqlValue(generatedAt)}
FROM source_documents
WHERE canonical_url = ${sqlValue(document.url)}
ON CONFLICT(source_id) DO UPDATE SET
  title = excluded.title,
  publisher = excluded.publisher,
  reviewed_by = excluded.reviewed_by,
  reviewed_at = excluded.reviewed_at,
  updated_at = CASE
    WHEN publication_source_metadata.title <> excluded.title
      OR publication_source_metadata.publisher <> excluded.publisher
      OR publication_source_metadata.reviewed_by <> excluded.reviewed_by
      OR publication_source_metadata.reviewed_at <> excluded.reviewed_at
    THEN excluded.updated_at
    ELSE publication_source_metadata.updated_at
  END;`.trim())
}

function fieldDefinitionStatements(statements: string[]) {
  for (const definition of [...FIELD_DEFINITIONS].sort((left, right) => (
    `${left.recordKind}:${left.fieldPath}`.localeCompare(`${right.recordKind}:${right.fieldPath}`)
  ))) {
    statements.push(`
INSERT INTO field_definitions (
  record_kind, field_path, value_type, risk_class,
  required_for_publish, max_age_days, validation_profile
) VALUES (
  ${sqlValue(definition.recordKind)}, ${sqlValue(definition.fieldPath)},
  ${sqlValue(definition.valueType)}, ${sqlValue(definition.riskClass)},
  ${sqlValue(definition.requiredForPublish)}, ${sqlValue(definition.maxAgeDays)},
  ${sqlValue(definition.validationProfile)}
)
ON CONFLICT(record_kind, field_path) DO NOTHING;`.trim())
  }
}

export function buildPipelineBootstrap(
  bundleInput: DataBundle,
  manifests: PilotSourceManifest[],
  generatedAtInput = new Date().toISOString(),
): PipelineBootstrapArtifacts {
  const bundle = bundleSchema.parse(bundleInput)
  const generatedAt = isoTimestamp(generatedAtInput)
  const stableCities = bundle.cities.filter((item) => item.status === 'verified')
  const stableInstitutions = bundle.universities.filter((item) => item.status === 'verified')
  const stableInstitutionIds = new Set(stableInstitutions.map((item) => item.id))
  const ustcManifest = manifests.find(
    (manifest) => manifest.institutionId === USTC_PREREQUISITE.institutionId,
  )
  if (!ustcManifest) {
    throw new Error('USTC pilot manifest is required for its materialization prerequisite')
  }
  stableInstitutionIds.add(USTC_PREREQUISITE.institutionId)
  const pilotSources = manifests
    .flatMap((manifest) => manifest.sources)
    .sort((left, right) => left.id.localeCompare(right.id))
  const enabledPilotSources = pilotSources.filter((source) => source.enabled)
  const sourceDocuments = collectSourceDocuments(bundle, manifests, stableInstitutionIds)
  const sourceImport = buildPilotSourceImport(manifests, generatedAt)
  const statements = [
    '-- Generated by scripts/ingestion/build-pipeline-bootstrap.ts. Do not edit.',
    '-- Stable identity bootstrap only: draft program templates are intentionally excluded.',
    'PRAGMA foreign_keys = ON;',
    sourceImport.sql,
  ]
  let localizedContent = 0
  for (const city of [...stableCities].sort((left, right) => left.id.localeCompare(right.id))) {
    localizedContent += cityStatements(statements, city, generatedAt)
  }
  for (const university of [...stableInstitutions].sort((left, right) => left.id.localeCompare(right.id))) {
    localizedContent += universityStatements(statements, university, generatedAt)
  }
  localizedContent += ustcPrerequisiteStatements(statements, ustcManifest, generatedAt)

  fieldDefinitionStatements(statements)

  const managedInstitutionIds = [...new Set(manifests.map((manifest) => manifest.institutionId))].sort()
  const enabledSourceIds = new Set(enabledPilotSources.map((source) => source.id))
  statements.push(`
UPDATE promotion_source_bindings
SET enabled = 0,
    updated_at = ${sqlValue(generatedAt)}
WHERE source_id IN (
  SELECT source_id
  FROM ingestion_sources
  WHERE json_extract(manifest_json, '$.institutionId') IN (
    ${managedInstitutionIds.map(sqlValue).join(', ')}
  )
)
AND source_id NOT IN (
  ${[...enabledSourceIds].sort().map(sqlValue).join(', ')}
)
AND enabled <> 0;`.trim())

  for (const document of sourceDocuments) {
    sourceDocumentStatements(statements, document, generatedAt)
  }

  const activeDocumentUrls = sourceDocuments
    .filter((document) => document.active)
    .map((document) => document.url)
    .sort()
  statements.push(`
UPDATE source_documents
SET active = 0,
    updated_at = ${sqlValue(generatedAt)}
WHERE id IN (
  SELECT binding.source_document_id
  FROM promotion_source_bindings binding
  JOIN ingestion_sources source ON source.source_id = binding.source_id
  WHERE json_extract(source.manifest_json, '$.institutionId') IN (
    ${managedInstitutionIds.map(sqlValue).join(', ')}
  )
)
AND canonical_url NOT IN (
  ${activeDocumentUrls.map(sqlValue).join(', ')}
)
AND active <> 0;`.trim())

  const documentByUrl = new Map(sourceDocuments.map((document) => [document.url, document]))
  for (const source of enabledPilotSources) {
    const document = documentByUrl.get(source.officialUrl)
    if (!document?.active) {
      throw new Error(`Enabled source ${source.id} has no active official source document`)
    }
    statements.push(`
INSERT INTO promotion_source_bindings (
  source_id, source_document_id, enabled, created_at, updated_at
)
SELECT
  ${sqlValue(source.id)}, id, 1, ${sqlValue(generatedAt)}, ${sqlValue(generatedAt)}
FROM source_documents
WHERE canonical_url = ${sqlValue(source.officialUrl)}
ON CONFLICT(source_id) DO UPDATE SET
  source_document_id = excluded.source_document_id,
  enabled = 1,
  updated_at = CASE
    WHEN promotion_source_bindings.source_document_id <> excluded.source_document_id
      OR promotion_source_bindings.enabled <> 1
    THEN excluded.updated_at
    ELSE promotion_source_bindings.updated_at
  END;`.trim())
  }

  statements.push(
    '-- Aggregate catalog fields intentionally have no promotion_field_mappings.',
    '-- A versioned identity-discovery extractor must create record-level candidates first.',
    'PRAGMA optimize;',
  )
  return {
    sql: `${statements.join('\n')}\n`,
    generatedAt,
    records: stableCities.length + stableInstitutions.length + 2,
    locations: stableCities.length + 1,
    institutions: stableInstitutions.length + 1,
    localizedContent,
    ingestionSources: pilotSources.length,
    enabledSources: enabledPilotSources.length,
    sourceDocuments: sourceDocuments.length,
    sourceBindings: enabledPilotSources.length,
    fieldDefinitions: FIELD_DEFINITIONS.length,
    fieldMappings: 0,
    excludedDraftPrograms: bundle.programs.filter((item) => item.status === 'draft').length,
  }
}

export function readPipelineBootstrapBundle(
  dataDirectory = resolve('content', 'data'),
): DataBundle {
  const read = (name: string) => JSON.parse(
    readFileSync(join(dataDirectory, `${name}.json`), 'utf8'),
  ) as unknown
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
  const outputDirectory = resolve(argument('--output') ?? '.pipeline-build')
  const generatedAt = argument('--generated-at') ?? new Date().toISOString()
  const artifacts = buildPipelineBootstrap(
    readPipelineBootstrapBundle(),
    validatePilotSourceManifestDirectory(),
    generatedAt,
  )
  mkdirSync(outputDirectory, { recursive: true })
  const sqlPath = join(outputDirectory, 'pipeline-bootstrap.sql')
  const manifestPath = join(outputDirectory, 'pipeline-bootstrap.manifest.json')
  writeFileSync(sqlPath, artifacts.sql, 'utf8')
  writeFileSync(manifestPath, JSON.stringify({
    generatedAt: artifacts.generatedAt,
    records: artifacts.records,
    locations: artifacts.locations,
    institutions: artifacts.institutions,
    localizedContent: artifacts.localizedContent,
    ingestionSources: artifacts.ingestionSources,
    enabledSources: artifacts.enabledSources,
    sourceDocuments: artifacts.sourceDocuments,
    sourceBindings: artifacts.sourceBindings,
    fieldDefinitions: artifacts.fieldDefinitions,
    fieldMappings: artifacts.fieldMappings,
    excludedDraftPrograms: artifacts.excludedDraftPrograms,
    sqlPath,
  }, null, 2), 'utf8')
  process.stdout.write(`${manifestPath}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main()
