import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { bundleSchema } from '../../src/lib/data/schema'
import type { DataBundle } from '../../src/lib/data/types'
import { validateManifest } from '../../workers/ingestion/src/security'
import type { SourceCategory, SourceManifestV1 } from '../../workers/ingestion/src/types'

export function buildCatalogSeeds(bundle: DataBundle, generatedAt = new Date().toISOString()) {
  if (!Number.isFinite(Date.parse(generatedAt))) throw new Error('Invalid generatedAt')
  const sources = new Map(bundle.sources.filter(source => source.official).map(source => [source.id, source]))
  const seeds = new Map<string, SourceManifestV1>()
  const captureOnly = new Set<string>()
  const excluded: { institutionId: string; url: string; reason: string }[] = []
  for (const university of bundle.universities.filter(row => row.status !== 'draft')) {
    const schoolHosts = [university.officialUrl, university.admissionsUrl].filter(Boolean).map(value => new URL(value!).hostname)
    const schoolDomains = schoolHosts.map(host => host.match(/(?:^|\.)([^.]+\.edu\.cn)$/)?.[1] ?? host)
    const candidates: { url: string; category: SourceCategory }[] = [
      { url: university.officialUrl, category: 'catalog_anchor' },
      ...(university.admissionsUrl ? [{ url: university.admissionsUrl, category: 'catalog_anchor' as const }] : []),
    ]
    const addReferences = (ids: string[], category: SourceCategory) => {
      for (const id of ids) {
        const source = sources.get(id)
        if (source) candidates.push({ url: source.url, category })
      }
    }
    addReferences(university.sourceIds, 'catalog_anchor')
    const programs = bundle.programs.filter(row => row.universityId === university.id && row.status !== 'draft')
    for (const row of programs) addReferences(row.sourceIds, 'program_detail')
    const programIds = new Set(programs.map(row => row.id))
    for (const row of bundle.admissionCycles.filter(row => programIds.has(row.programId) && row.status !== 'draft')) {
      addReferences(row.sourceIds, 'program_detail')
    }
    for (const row of bundle.scholarships.filter(row => row.universityIds.includes(university.id) && row.status !== 'draft')) {
      addReferences(row.sourceIds, 'university_scholarship')
    }
    for (const candidate of candidates) {
      try {
        const url = new URL(candidate.url)
        if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new Error('credential-free HTTPS required')
        url.hash = ''
        const key = `${university.id}\n${url.href}`
        if (seeds.has(key)) continue
        const id = `auto-seed-${createHash('sha256').update(key).digest('hex').slice(0, 24)}`
        const schoolOwned = schoolHosts.includes(url.hostname) || schoolDomains.some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`))
        const category = schoolOwned ? candidate.category : 'contacts'
        if (!schoolOwned) captureOnly.add(key)
        const manifest: SourceManifestV1 = {
          version: 1, id, institutionId: university.id,
          entityType: category === 'university_scholarship' ? 'scholarship' : 'program',
          sourceCategory: category, officialUrl: url.href, allowedHosts: [url.hostname],
          enabled: true, schedule: { intervalHours: 168, jitterMinutes: 60 },
          fetch: { renderMode: 'http', timeoutMs: 15000, maxBytes: 5 * 1024 * 1024 },
          robots: { mode: 'enforce' },
          extraction: {
            mode: 'rules-only', schemaVersion: 'auto-seed-v2',
            fields: [{ path: 'title', type: 'string', required: false }],
            rules: [{ kind: 'regex', fieldPath: 'title', pattern: '<title[^>]*>([^<]{1,300})</title>', flags: 'i', captureGroup: 1 }],
          },
        }
        seeds.set(key, validateManifest(manifest))
      } catch (error) {
        excluded.push({ institutionId: university.id, url: candidate.url, reason: error instanceof Error ? error.message : 'invalid source' })
      }
    }
  }
  const manifests = [...seeds.values()].sort((a, b) => a.institutionId.localeCompare(b.institutionId) || a.id.localeCompare(b.id))
  const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
  const sql = manifests.map(manifest => `UPDATE ingestion_sources
SET manifest_json = json_set(manifest_json, '$.extraction.schemaVersion', 'auto-seed-v2', '$.extraction.fields[0].required', json('false')), next_fetch_at = ${quote(generatedAt)}, updated_at = ${quote(generatedAt)}
WHERE source_id = ${quote(manifest.id)} AND enabled = 1 AND manifest_json = ${quote(JSON.stringify({ ...manifest, extraction: { ...manifest.extraction, schemaVersion: 'auto-seed-v1', fields: [{ path: 'title', type: 'string', required: true }] } }))};
INSERT INTO ingestion_sources (source_id, manifest_json, enabled, next_fetch_at, created_at, updated_at)
SELECT ${quote(manifest.id)}, ${quote(JSON.stringify(manifest))}, 1, ${quote(generatedAt)}, ${quote(generatedAt)}, ${quote(generatedAt)}
WHERE NOT EXISTS (SELECT 1 FROM ingestion_sources WHERE source_id = ${quote(manifest.id)} OR (json_extract(manifest_json, '$.institutionId') = ${quote(manifest.institutionId)} AND json_extract(manifest_json, '$.officialUrl') = ${quote(manifest.officialUrl)}));`).join('\n')
  return {
    format: 'studyinchina.automation.catalog-seeds', formatVersion: 1, generatedAt,
    policy: { sourceRegistrationOnly: true, refreshesVerifiedAt: false, exactOfficialHosts: true, overwritesExistingManifests: false, upgradesExactKnownSeedTemplate: true },
    summary: { institutions: new Set(manifests.map(row => row.institutionId)).size, sources: manifests.length, captureOnly: captureOnly.size, excluded: excluded.length },
    manifests, excluded, sql: `PRAGMA foreign_keys = ON;\n${sql}\n`,
  }
}

export function readCatalogBundle(directory: string): DataBundle {
  const names = { universities: 'universities', programs: 'programs', admissionCycles: 'admission-cycles', scholarships: 'scholarships', cities: 'cities', sources: 'sources' }
  return bundleSchema.parse(Object.fromEntries(Object.entries(names).map(([key, file]) => [key, JSON.parse(readFileSync(join(directory, `${file}.json`), 'utf8'))])))
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const value = (flag: string, fallback: string) => { const index = process.argv.indexOf(flag); return index < 0 ? fallback : process.argv[index + 1] }
  const output = resolve(value('--output', '.pipeline-build/automation-seeds'))
  const result = buildCatalogSeeds(readCatalogBundle(resolve(value('--data-dir', 'content/data'))))
  mkdirSync(output, { recursive: true })
  writeFileSync(join(output, 'catalog-seeds.sql'), result.sql)
  const report = { ...result, sql: undefined }
  writeFileSync(join(output, 'catalog-seeds.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ ...result.summary, output, sourceRegistrationOnly: true }))
}
