import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const fixture = vi.hoisted(() => {
  const captured = Array.from({ length: 87 }, (_, offset) => {
    const school = offset < 45 ? 'alpha' : 'beta'
    const sourceId = String(1000 + offset)
    return {
      id: `cucas-${sourceId}`, sourceId, provider: 'CUCAS', schoolId: `cucas-${school}`,
      schoolName: `${school === 'alpha' ? 'Alpha' : 'Beta'} University`,
      name: `Computer Research ${offset}`, sourceUrl: `https://${school}.cucas.cn/program/Computer-Research-${sourceId}.html`,
      status: 'extracted', official: false, admissionYear: null,
      fields: { degree: 'Bachelor', language: 'English', startDate: 'Sep 1, 2027' },
    }
  })
  const link = ['sicas-9000', 'sicas-gamma', 'Medicine 2035', 'https://www.sicas.com.cn/School/1/Program/9000', '2035-01-01']
  return {
    captured, link,
    directory: {
      generatedAt: '2026-11-17T00:00:00Z',
      schools: [
        { id: 'cucas-alpha', name: 'Alpha University', provider: 'CUCAS', programCount: 45, extractedCount: 45 },
        { id: 'cucas-beta', name: 'Beta University', provider: 'CUCAS', programCount: 42, extractedCount: 42 },
        { id: 'sicas-gamma', name: 'Gamma University', provider: 'SICAS', programCount: 1, extractedCount: 0 },
      ],
      programs: [...captured.map(p => [p.id, p.schoolId, p.name, p.sourceUrl, '']), link],
    },
  }
})

vi.mock('../../content/third-party/directory.json', () => ({ default: fixture.directory }))
vi.mock('../../content/third-party/details.json', () => ({ default: { programs: fixture.captured } }))

import { getThirdPartyProgram, getThirdPartySummary, queryThirdPartyPrograms } from '@/lib/third-party-programs'

type ImportResult = {
  directory: { programs: string[][] }
  details: { programs: { id: string; schoolId: string; official: boolean; admissionYear: null; fields: Record<string, string> }[] }
  manifest: { programCount: number; extractedCount: number; rejected: { reason: string }[] }
}
type Importer = {
  publicSourceUrl(value: string, provider: string): string | null
  buildThirdPartyImport(root: string): ImportResult
}
// The CLI is plain ESM; a URL import exercises its exported pure functions without running its CLI entry point.
const importerUrl = pathToFileURL(resolve('scripts/ingestion/import-third-party-programs.mjs')).href
const { publicSourceUrl, buildThirdPartyImport } = await import(/* @vite-ignore */ importerUrl) as Importer

describe('third-party programme queries', () => {
  it('defaults to extracted records and exposes URL-only records only in the links view', () => {
    const extracted = queryThirdPartyPrograms()
    expect(extracted.total).toBe(fixture.captured.length)
    expect(extracted.items.every(item => item.status === 'extracted')).toBe(true)
    expect(extracted.schools.every(school => school.extractedCount > 0)).toBe(true)
    expect(queryThirdPartyPrograms({ view: 'links', provider: 'sicas' }).items.map(item => item.id)).toEqual([fixture.link[0]])
  })

  it('combines exact school IDs, case-insensitive providers, and normalized AND search tokens', () => {
    const filtered = queryThirdPartyPrograms({ school: 'cucas-alpha', provider: 'cUcAs', query: ' ＣＯＭＰＵＴＥＲ  ALPHA ' })
    expect(filtered.total).toBe(fixture.captured.filter(item => item.schoolId === 'cucas-alpha').length)
    expect(filtered.items.every(item => item.schoolId === 'cucas-alpha' && item.provider === 'CUCAS')).toBe(true)
    expect(queryThirdPartyPrograms({ school: 'cucas-alpha', provider: 'SICAS' }).total).toBe(0)
    expect(queryThirdPartyPrograms({ query: 'computer medicine' }).items).toEqual([])
    expect(queryThirdPartyPrograms({ provider: 'ALL' }).total).toBe(queryThirdPartyPrograms().total)
  })

  it('interleaves schools and visits each matching record exactly once across bounded pages', () => {
    const first = queryThirdPartyPrograms()
    expect(first.items[0].schoolId).not.toBe(first.items[1].schoolId)
    const pages = Array.from({ length: first.totalPages }, (_, offset) => queryThirdPartyPrograms({ page: offset + 1 }))
    const ids = pages.flatMap(page => page.items.map(item => item.id))
    expect(ids).toHaveLength(first.total)
    expect(new Set(ids).size).toBe(ids.length)
    expect([...ids].sort()).toEqual(fixture.captured.map(item => item.id).sort())
    expect(pages.every(page => page.items.length <= page.pageSize)).toBe(true)
    expect(pages.at(-1)!.items.length).toBeGreaterThan(0)
  })

  it.each([undefined, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -7, 0])(
    'normalizes invalid or nonpositive page %s to the first page', page => {
      expect(queryThirdPartyPrograms({ page }).page).toBe(1)
    },
  )

  it('floors fractional pages, clamps oversized pages, and preserves an empty page for unmatched filters', () => {
    expect(queryThirdPartyPrograms({ page: 2.9 }).page).toBe(2)
    const last = queryThirdPartyPrograms({ page: Number.MAX_SAFE_INTEGER })
    expect(last.page).toBe(last.totalPages)
    const empty = queryThirdPartyPrograms({ school: 'unknown-school', page: 99 })
    expect(empty).toMatchObject({ items: [], total: 0, page: 1, totalPages: 1 })
  })

  it('returns undefined for unknown detail IDs so the route can render a 404', () => {
    expect(getThirdPartyProgram('missing-programme')).toBeUndefined()
    expect(getThirdPartyProgram('../cucas-1000')).toBeUndefined()
    expect(getThirdPartyProgram(fixture.captured[0].id)?.sourceUrl).toBe(fixture.captured[0].sourceUrl)
  })

  it('keeps URL-only admission fields blank and never infers a year or official status', () => {
    const link = getThirdPartyProgram(fixture.link[0])!
    expect(link).toMatchObject({ status: 'link_only', fields: {}, official: false, admissionYear: null })
    expect(link.sourceUpdatedAt).toBe('2035-01-01')
    const extracted = getThirdPartyProgram(fixture.captured[0].id)!
    expect(extracted.fields.startDate).toContain('2027')
    expect(extracted).toMatchObject({ status: 'extracted', official: false, admissionYear: null })
    expect(getThirdPartySummary()).toMatchObject({ extractedCount: fixture.captured.length, official: false })
  })
})

const temporaryRoots: string[] = []
afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    const checked = realpathSync(root)
    if (dirname(checked) !== realpathSync(tmpdir()) || !basename(checked).startsWith('sic-third-party-test-')) throw new Error('Unexpected fixture cleanup path')
    rmSync(checked, { recursive: true, force: true })
  }
})

function harvestFixture() {
  const root = mkdtempSync(join(tmpdir(), 'sic-third-party-test-'))
  temporaryRoots.push(root)
  mkdirSync(join(root, 'cucas', 'raw'), { recursive: true })
  mkdirSync(join(root, 'sicas'))
  const raw = '<html><h3>Computer Science</h3><p>Example University</p><p>Sep 1, 2035</p><p>RMB 20,000</p><p>Tuition RMB 21,000</p></html>'
  const hash = createHash('sha256').update(raw).digest('hex')
  const rawBodyPath = `raw/${hash}.body`
  writeFileSync(join(root, 'cucas', rawBodyPath), raw)
  const fact = (value: string) => ({ value, evidence: { selector: 'p', text: value } })
  const candidate = {
    sourceUrl: 'https://example.cucas.cn/program/Computer-Science-123.html',
    fetchedAt: '2026-11-16T00:00:00Z', rawBodyPath, rawSha256: hash,
    admissionYear: 2035, verifiedOfficial: true,
    facts: {
      program_name: fact('Computer Science'), institution_name: fact('Example University'),
      start_date_display: fact('Sep 1, 2035'), tuition_display: fact('RMB 20,000'),
    },
  }
  const writeCandidates = (rows: unknown[]) => writeFileSync(join(root, 'cucas', 'candidates.jsonl'), rows.map(row => JSON.stringify(row)).join('\n') + '\n')
  return { root, candidate, writeCandidates }
}

describe('third-party source import boundaries', () => {
  it.each([
    'javascript:alert(1)', 'http://example.cucas.cn/program/Test-1.html',
    'https://example.cucas.cn.evil.test/program/Test-1.html',
    'https://user:pass@example.cucas.cn/program/Test-1.html',
    'https://example.cucas.cn:444/program/Test-1.html',
  ])('rejects unsafe or non-provider source URL %s', url => {
    expect(publicSourceUrl(url, 'CUCAS')).toBeNull()
  })

  it('canonicalizes source URLs without exposing an unescaped path or carrying fragments', () => {
    const url = publicSourceUrl('https://example.cucas.cn/program/Computer Science-1.html?q=a%26b#top', 'CUCAS')!
    expect(url).toBe('https://example.cucas.cn/program/Computer%20Science-1.html?q=a%26b')
    expect(publicSourceUrl('https://www.sicas.com.cn/School/1', 'SICAS')).toBeTruthy()
    expect(publicSourceUrl('https://www.sicas.com.cn.evil.test/School/1', 'SICAS')).toBeNull()
  })

  it('deduplicates source programme IDs and retains the newest captured facts regardless of input order', () => {
    const { root, candidate, writeCandidates } = harvestFixture()
    const newest = { ...candidate, fetchedAt: '2026-11-17T00:00:00Z', facts: { ...candidate.facts, tuition_display: { value: 'RMB 21,000', evidence: { selector: 'p', text: 'Tuition RMB 21,000' } } } }
    writeCandidates([newest, candidate, candidate])
    const imported = buildThirdPartyImport(root)
    expect(imported.directory.programs.map(row => row[0])).toEqual(['cucas-123'])
    expect(imported.details.programs).toHaveLength(1)
    expect(imported.details.programs[0].fields.tuition).toBe('RMB 21,000')
    expect(imported.details.programs[0]).toMatchObject({ official: false, admissionYear: null })
    expect(imported.details.programs[0].fields.startDate).toBe('Sep 1, 2035')
  })

  it('imports sitemap duplicates once without inventing facts from a name, URL, or sitemap year', () => {
    const { root } = harvestFixture()
    const row = { url: 'https://www.sicas.com.cn/School/7/Program/9', programme_source_id: '9', school_source_id: '7', programme_name_from_slug: 'Medicine 2035', school_name_from_slug: 'Example University', sitemap_lastmod: '2035-01-01' }
    writeFileSync(join(root, 'sicas', 'discovered-programme-links.jsonl'), [row, row].map(r => JSON.stringify(r)).join('\n'))
    const imported = buildThirdPartyImport(root)
    expect(imported.directory.programs.map(r => r[0])).toEqual(['sicas-9'])
    expect(imported.details.programs).toEqual([])
    expect(imported.manifest.extractedCount).toBe(0)
  })

  it('rejects changed raw evidence and field values that are absent from their source quote', () => {
    const { root, candidate, writeCandidates } = harvestFixture()
    writeCandidates([{ ...candidate, facts: { ...candidate.facts, tuition_display: { value: 'Free', evidence: { selector: 'p', text: 'RMB 20,000' } } } }])
    expect(() => buildThirdPartyImport(root)).toThrow(/Unbound extraction/)
    writeCandidates([candidate])
    writeFileSync(join(root, 'cucas', candidate.rawBodyPath), readFileSync(join(root, 'cucas', candidate.rawBodyPath), 'utf8') + 'changed')
    expect(() => buildThirdPartyImport(root)).toThrow(/raw evidence is missing or changed/)
  })
})
