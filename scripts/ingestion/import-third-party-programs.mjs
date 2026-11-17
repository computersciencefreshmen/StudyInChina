import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'

const clean = value => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
const sha256 = value => createHash('sha256').update(value).digest('hex')
const lines = path => existsSync(path) ? readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)) : []

export function publicSourceUrl(value, provider) {
  try {
    const url = new URL(value)
    const hostAllowed = provider === 'SICAS'
      ? url.hostname === 'www.sicas.com.cn'
      : provider === 'CUCAS' && /^[a-z0-9-]+\.cucas\.cn$/.test(url.hostname)
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !hostAllowed) return null
    url.hash = ''
    return url.href
  } catch { return null }
}

export function buildThirdPartyImport(harvestRoot, { cucasCandidateFile = 'candidates.jsonl' } = {}) {
  if (!/^[a-zA-Z0-9._-]+\.jsonl$/.test(cucasCandidateFile)) throw new Error('Invalid candidate snapshot filename')
  const candidatePath = join(harvestRoot, 'cucas', cucasCandidateFile)
  if (cucasCandidateFile !== 'candidates.jsonl' && !existsSync(candidatePath)) throw new Error('Requested candidate snapshot is missing')
  const schools = new Map(), links = new Map(), details = new Map(), rejected = []
  const addSchool = school => {
    const existing = schools.get(school.id)
    if (existing && existing.name !== school.name) rejected.push({ id: school.id, reason: 'conflicting_school_label', retained: existing.name, discarded: school.name })
    if (!existing) schools.set(school.id, school)
  }
  const sitemapPath = join(harvestRoot, 'sicas', 'discovered-programme-links.jsonl')
  for (const row of lines(sitemapPath)) {
    const url = publicSourceUrl(row.original_loc || row.url, 'SICAS')
    const name = clean(row.programme_name_from_slug), schoolName = clean(row.school_name_from_slug)
    if (!url || !/^\d+$/.test(row.programme_source_id || '') || !/^\d+$/.test(row.school_source_id || '') || !name || !schoolName) {
      rejected.push({ url: row.url, reason: 'invalid_discovery_identity' }); continue
    }
    const id = `sicas-${row.programme_source_id}`, schoolId = `sicas-${row.school_source_id}`
    addSchool({ id: schoolId, provider: 'SICAS', sourceId: row.school_source_id, name: schoolName })
    // This is a source URL index. Neither the slug nor sitemap date proves an admission fact.
    if (!links.has(id)) links.set(id, [id, schoolId, name, url, clean(row.sitemap_lastmod)])
  }
  const fieldNames = {
    degree: 'degree', teaching_language_display: 'language', duration_display: 'duration',
    start_date_display: 'startDate', application_deadline_display: 'deadline', tuition_display: 'tuition',
    application_fee_display: 'applicationFee', provider_service_fee_display: 'providerServiceFee',
    entry_requirements_text: 'requirements', application_materials_text: 'materials',
    program_description_text: 'description', fee_structure_text: 'fees',
  }
  for (const row of lines(candidatePath)) {
    const url = publicSourceUrl(row.sourceUrl, 'CUCAS')
    const name = clean(row.facts?.program_name?.value), schoolName = clean(row.facts?.institution_name?.value)
    const sourceId = url && new URL(url).pathname.match(/-(\d+)\.html$/)?.[1]
    if (!url || !name || !schoolName || !sourceId || !/^[a-f0-9]{64}$/.test(row.rawSha256 || '') || Number.isNaN(Date.parse(row.fetchedAt))) {
      rejected.push({ url: row.sourceUrl, reason: 'invalid_extracted_identity' }); continue
    }
    const rawPath = resolve(harvestRoot, 'cucas', row.rawBodyPath)
    const safeRoot = resolve(harvestRoot, 'cucas')
    if (!rawPath.startsWith(safeRoot + (process.platform === 'win32' ? '\\' : '/')) || !existsSync(rawPath) || sha256(readFileSync(rawPath)) !== row.rawSha256) {
      throw new Error(`Third-party raw evidence is missing or changed: ${row.sourceUrl}`)
    }
    const id = `cucas-${sourceId}`, schoolId = `cucas-${new URL(url).hostname.split('.')[0]}`
    addSchool({ id: schoolId, provider: 'CUCAS', sourceId: new URL(url).hostname, name: schoolName })
    const fields = {}
    for (const [sourceField, targetField] of Object.entries(fieldNames)) {
      const fact = row.facts?.[sourceField], value = clean(fact?.value)
      if (!value) continue
      // Store only visibly extracted source text. Do not generate missing values or infer years.
      if (!clean(fact.evidence?.text).includes(value)) throw new Error(`Unbound extraction: ${id}/${sourceField}`)
      fields[targetField] = value
    }
    const record = { id, provider: 'CUCAS', sourceId, schoolId, schoolName, name, sourceUrl: url,
      fetchedAt: row.fetchedAt, status: 'extracted', official: false, admissionYear: null,
      evidenceHash: row.rawSha256, fields }
    const previous = details.get(id)
    if (previous && previous.schoolId !== schoolId) throw new Error(`Conflicting source programme identity: ${id}`)
    if (!previous || Date.parse(previous.fetchedAt) <= Date.parse(record.fetchedAt)) details.set(id, record)
    links.set(id, [id, schoolId, name, url, ''])
  }
  const rows = [...links.values()].sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0], 'en', { numeric: true }))
  const schoolRows = [...schools.values()].map(school => ({ ...school, programCount: 0, extractedCount: 0 }))
  const schoolMap = new Map(schoolRows.map(school => [school.id, school]))
  for (const [id, schoolId] of rows) {
    schoolMap.get(schoolId).programCount++
    if (details.has(id)) schoolMap.get(schoolId).extractedCount++
  }
  schoolRows.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
  const captured = [...details.values()].sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }))
  const sourceSummaryPath = join(harvestRoot, 'sicas', 'discovery-summary.json')
  const sourceSummary = existsSync(sourceSummaryPath) ? JSON.parse(readFileSync(sourceSummaryPath, 'utf8')) : null
  const latestCapture = captured.map(row => row.fetchedAt).concat(sourceSummary?.sitemap_receipt?.retrieved_at_utc || []).sort().at(-1) || null
  return {
    directory: { schemaVersion: 1, generatedAt: latestCapture, columns: ['id', 'schoolId', 'name', 'sourceUrl', 'sourceUpdatedAt'], schools: schoolRows, programs: rows },
    details: { schemaVersion: 1, programs: captured },
    manifest: { schemaVersion: 1, generatedAt: latestCapture, programCount: rows.length, extractedCount: captured.length,
      linkOnlyCount: rows.length - captured.length, schoolCount: schoolRows.length,
      schoolsWithExtractedDetails: schoolRows.filter(row => row.extractedCount > 0).length,
      officialVerificationPerformed: false, modelCalls: 0,
      candidateSnapshot: existsSync(candidatePath) ? { provider: 'CUCAS', filename: cucasCandidateFile, bytes: readFileSync(candidatePath).length, sha256: sha256(readFileSync(candidatePath)) } : null,
      interpretation: 'School counts are provider directory identities, not independently verified unique institutions. URL-only records contain slug-derived labels and no admission facts. All extracted facts are third-party source claims.',
      sources: sourceSummary ? [{ provider: 'SICAS', url: sourceSummary.sitemap_receipt.url, sha256: sourceSummary.sitemap_receipt.sha256,
        retrievedAt: sourceSummary.sitemap_receipt.retrieved_at_utc, lastModified: sourceSummary.sitemap_receipt.response_headers['Last-Modified'], sitemapEntries: sourceSummary.sitemap_entry_count }] : [],
      rejected },
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const harvestRoot = resolve(process.argv[2] || ''), destination = resolve(process.argv[3] || 'content/third-party')
  if (!process.argv[2]) throw new Error('Usage: node scripts/ingestion/import-third-party-programs.mjs <private-harvest-root> [destination] [CUCAS-snapshot-filename]')
  const result = buildThirdPartyImport(harvestRoot, { cucasCandidateFile: process.argv[4] || 'candidates.jsonl' })
  mkdirSync(destination, { recursive: true })
  for (const [name, value] of Object.entries(result)) writeFileSync(join(destination, `${name}.json`), JSON.stringify(value) + '\n')
  console.log(JSON.stringify({ destination, ...result.manifest, rejected: result.manifest.rejected.length }, null, 2))
}
