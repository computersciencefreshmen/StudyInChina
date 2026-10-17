import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { DataBundle } from '@/lib/data/types'
import { assertRegistryPath, buildCatalogueCoverage, buildNationalUniversityRegistry, matchCatalogue, parseMoeSheet, parseNationalRegistryArguments,
  validateInstitutionSet, validateRegistrySourceEvidence, verifyRegistryCapture, type Capture, type MoeSheet, type RegistrySourceReceipt } from '../../scripts/automation/build-national-university-registry'

const general = (): MoeSheet => ({ name: '全国普通高等学校名单', rows: [
  ['附件1：', '', '', '', '', '', ''], ['全国普通高等学校名单\n（截至2026年6月17日）', '', '', '', '', '', ''],
  ['序号', '学校名称', '学校标识码', '主管部门', '所在地', '办学层次', '备注'], ['北京市（2所）', '', '', '', '', '', ''],
  [1, '甲大学', 4111010001, '教育部', '北京市', '本科', ''], [2, '乙职业学院', 4111010002, '北京市教委', '北京市', '专科', '民办'],
] })
const adult = (): MoeSheet => ({ name: '全国成人高等学校名单', rows: [
  ['附件2：', '', '', '', ''], ['全国成人高等学校名单\n（截至2026年6月17日）', '', '', '', ''],
  ['序号', '学校名称', '学校标识码', '主管部门', '备注'], ['北京市（1所）', '', '', '', ''],
  [1, '丙职工大学', '4211010001', '北京市', ''],
] })
const institutions = () => [...parseMoeSheet(general(), 'general', '2026-06-17'), ...parseMoeSheet(adult(), 'adult', '2026-06-17')]
const source = (): RegistrySourceReceipt => ({ format: 'studyinchina.national-university-registry-source-receipt', version: 1,
  listYear: 2026, asOf: '2026-06-17', publishedAt: '2026-06-18', scope: { excludesHongKongMacaoTaiwan: true, officialScopeNoteZh: '本名单未包含港澳台地区高等学校。' },
  expectedCounts: { total: 3, general: 2, bachelor: 1, higherVocational: 1, adult: 1 }, captures: {}, aliases: [],
})
const alias = { localNameZh: '甲学院', officialNameZh: '甲大学', institutionCode: '4111010001', evidenceCaptureId: 'rename', evidenceText: '明确的更名及标识码证据' }
function sourceEvidence() {
  const receipt = source(), capture = (fileName: string): Capture => ({ fileName, url: `https://www.moe.gov.cn/list/${fileName}`, finalUrl: `http://www.moe.gov.cn/list/${fileName}`,
    httpStatus: 200, capturedAt: '2026-10-17T05:39:05Z', sha256: 'a'.repeat(64), bytes: 1, contentType: 'text/html' })
  receipt.captures = { announcement: capture('page.html'), general: capture('general.xls'), adult: capture('adult.xls'), rename: capture('rename.html') }
  const html = '<meta name="publishdate" content="2026-06-18"><meta name="PubDate" content="2026-06-18 08:30">截至2026年6月17日，共计3所，普通高等学校2所，含本科学校1所、高职（专科）学校1所；成人高等学校1所。本名单未包含港澳台地区高等学校。<a href="./general.xls">普通</a><a href="./adult.xls">成人</a>'
  return { receipt, html, captures: new Map([['announcement', Buffer.from(html)], ['rename', Buffer.from('同意甲学院更名为甲大学，学校标识码为4111010001')]]) }
}

describe('authoritative national institution target registry', () => {
  it('imports all rows, preserves official institution levels and separates province headings', () => {
    const rows = parseMoeSheet(general(), 'general', '2026-06-17')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ id: 'moe-4111010001', institutionCode: '4111010001', officialNameZh: '甲大学', sourceRow: 5,
      educationCategory: 'bachelor-level', educationLevelRaw: '本科', provinceNameZh: '北京市', locationRaw: '北京市' })
    expect(rows[1]).toMatchObject({ educationCategory: 'higher-vocational-junior-college', remarksRaw: '民办' })
  })
  it('keeps adult institutions distinct without inventing a city or general education level', () => {
    expect(parseMoeSheet(adult(), 'adult', '2026-06-17')[0]).toMatchObject({ listCategory: 'adult', educationCategory: 'adult-higher-education',
      educationLevelRaw: null, locationRaw: null, provinceNameZh: '北京市', supervisingAuthorityRaw: '北京市' })
  })
  it('fails closed for date/title/schema drift and malformed rows', () => {
    expect(() => parseMoeSheet(general(), 'general', '2025-06-17')).toThrow('date or title')
    expect(() => parseMoeSheet(general(), 'general', '2026-02-30')).toThrow('date')
    const sheet = general(); sheet.rows[2][2] = '学校代码'
    expect(() => parseMoeSheet(sheet, 'general', '2026-06-17')).toThrow('columns')
    const badCode = general(); badCode.rows[4][2] = '10001'
    expect(() => parseMoeSheet(badCode, 'general', '2026-06-17')).toThrow('ten digits')
    const badLevel = general(); badLevel.rows[4][5] = '研究生'
    expect(() => parseMoeSheet(badLevel, 'general', '2026-06-17')).toThrow('education level')
  })
  it('reconciles section counts and consecutive ordinals instead of silently dropping unparsed rows', () => {
    const missing = general(); missing.rows.pop()
    expect(() => parseMoeSheet(missing, 'general', '2026-06-17')).toThrow('Province row count')
    const skipped = general(); skipped.rows[5][0] = 3
    expect(() => parseMoeSheet(skipped, 'general', '2026-06-17')).toThrow('Nonconsecutive')
    const unknown = general(); unknown.rows.push(['说明：未审核', '', '', '', '', '', ''])
    expect(() => parseMoeSheet(unknown, 'general', '2026-06-17')).toThrow('ordinal')
  })
  it('rejects duplicate national codes and names across both list categories', () => {
    const rows = institutions()
    expect(() => validateInstitutionSet([...rows, { ...rows[2], institutionCode: rows[0].institutionCode }])).toThrow('code')
    expect(() => validateInstitutionSet([...rows, { ...rows[2], institutionCode: '4211010002', officialNameZh: rows[0].officialNameZh }])).toThrow('name')
  })
  it('uses only an exact official Chinese name or an explicit code-bound alias', () => {
    const rows = institutions(), catalogue = [
      { id: 'current', name: { zh: '甲大学' } }, { id: 'similar', name: { zh: '乙职业学校' } }, { id: 'english', name: {} },
    ]
    const exact = matchCatalogue(rows, catalogue, [])
    expect([...exact.matches.values()].map(row => row.universityId)).toEqual(['current'])
    expect(exact.unmatched).toHaveLength(2)
    expect(matchCatalogue(rows, [{ id: 'old', name: { zh: '甲学院' } }], []).matches.size).toBe(0)
    expect(matchCatalogue(rows, [{ id: 'old', name: { zh: '甲学院' } }], [alias]).matches.get(rows[0].id)).toMatchObject({
      method: 'documented-official-rename', aliasEvidenceCaptureId: 'rename' })
    expect(() => matchCatalogue(rows, [], [{ ...alias, institutionCode: rows[1].institutionCode }])).toThrow('alias')
    expect(() => matchCatalogue(rows, [], [{ ...alias, evidenceText: '' }])).toThrow('alias')
  })
  it('rejects ambiguous catalogue duplicates rather than merging their identities', () => {
    const row = { id: 'one', name: { zh: '甲大学' } }
    expect(() => matchCatalogue(institutions(), [row, row], [])).toThrow('ID')
    expect(() => matchCatalogue(institutions(), [row, { ...row, id: 'two' }], [])).toThrow('Multiple catalogue identities')
  })
  it('creates a deterministic actionable task for every target without inferring eligibility or hosts', () => {
    const catalogue = [{ id: 'one', name: { zh: '甲大学' }, officialUrl: 'https://known.example/', admissionsUrl: 'https://known.example/international' }]
    const first = buildNationalUniversityRegistry(institutions(), catalogue, source(), 'a'.repeat(64))
    expect(first).toEqual(buildNationalUniversityRegistry(institutions(), catalogue, source(), 'a'.repeat(64)))
    expect(first.nationalCoverage).toMatchObject({ total: 3, missingFromCatalogue: 2, pendingDiscovery: 3, adultMissingFromCatalogue: 1 })
    expect(first.discoveryQueue.map(row => row.targetId)).toEqual(first.institutions.map(row => row.id))
    expect(first.discoveryQueue.every(row => row.status === 'pending' && row.nextAction === 'discover-official-international-admissions-source')).toBe(true)
    expect(first.discoveryQueue[1].knownSourceCandidates).toEqual([])
    expect(first.discoveryQueue[0].knownSourceCandidates.every(row => row.verificationStatus === 'unknown')).toBe(true)
    expect(first.institutions.every(row => row.internationalAdmissionsStatus === 'unknown' && row.currentProgramsStatus === 'unknown')).toBe(true)
    expect(first.policy).toMatchObject({ publicationEligible: false, catalogueWritten: false })
    expect(() => buildNationalUniversityRegistry(institutions(), catalogue, { ...source(), expectedCounts: { ...source().expectedCounts, total: 4 } }, '')).toThrow('totals')
  })
  it('reports current public programme coverage separately from registry identity and raw catalogue rows', () => {
    const meta = { status: 'verified', verifiedAt: '2026-10-01', reviewAfter: '2026-11-01', sourceIds: ['official'] }
    const university = { ...meta, id: 'u', cityId: 'city' }, program = { ...meta, id: 'p', universityId: 'u', verificationScope: 'facts' }
    const bundle = { sources: [{ id: 'official', official: true }], cities: [{ ...meta, id: 'city' }], universities: [university, { ...university, id: 'hidden', reviewAfter: '2026-10-16' }],
      programs: [program, { ...program, id: 'old', reviewAfter: '2026-10-16' }, { ...program, id: 'identity', verificationScope: 'identity' }], admissionCycles: [], scholarships: [] } as unknown as DataBundle
    const coverage = buildCatalogueCoverage(bundle, '2026-10-17')
    expect(coverage.summary).toMatchObject({ rawCatalogueUniversities: 2, publicCatalogueUniversities: 1, hiddenCatalogueUniversities: 1,
      publicUniversitiesWithCurrentProgrammes: 1, publicUniversitiesWithoutCurrentProgrammes: 0, currentPublicProgrammes: 1 })
    expect(coverage.universities.u).toMatchObject({ rawProgrammes: 3, currentPublicProgrammes: 1, publicIdentity: true })
  })
  it('allows a deterministic --output and China-date override while forbidding canonical writes', () => {
    const options = parseNationalRegistryArguments(['--today', '2026-10-17', '--output', '.tmp/national-check.json'])
    expect(options.today).toBe('2026-10-17')
    expect(options.output).toMatch(/national-check\.json$/)
    for (const output of ['content/data/universities.json', '.tmp/../../outside.json', 'content/targets/result.html']) {
      expect(() => parseNationalRegistryArguments(['--output', output])).toThrow('output')
    }
    expect(() => parseNationalRegistryArguments(['--today', '2026-02-30'])).toThrow('date')
    expect(() => parseNationalRegistryArguments(['--output', '.tmp/one.json', '--output', '.tmp/two.json'])).toThrow('duplicate')
  })
  it('requires successfully captured official-origin bytes with their exact SHA256 and byte count', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'national-registry-'))
    try {
      const bytes = Buffer.from('original official bytes'), capture: Capture = { url: 'https://www.moe.gov.cn/list.xls', finalUrl: 'http://www.moe.gov.cn/list.xls',
        httpStatus: 200, capturedAt: '2026-10-17T05:39:05Z', sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, contentType: 'application/vnd.ms-excel', fileName: 'list.xls' }
      await writeFile(join(directory, capture.fileName), bytes)
      expect(await verifyRegistryCapture(capture, directory)).toEqual(bytes)
      await expect(verifyRegistryCapture({ ...capture, bytes: 1 }, directory)).rejects.toThrow('hash or byte')
      await expect(verifyRegistryCapture({ ...capture, finalUrl: 'https://third-party.example/list.xls' }, directory)).rejects.toThrow('official MOE')
      await expect(verifyRegistryCapture({ ...capture, httpStatus: 403 }, directory)).rejects.toThrow('successful')
      await expect(verifyRegistryCapture({ ...capture, fileName: '../list.xls' }, directory)).rejects.toThrow('file identity')
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
  it('binds publication and as-of dates to the captured original announcement', () => {
    const evidence = sourceEvidence()
    expect(() => validateRegistrySourceEvidence(evidence.receipt, evidence.captures)).not.toThrow()
    expect(() => validateRegistrySourceEvidence({ ...evidence.receipt, publishedAt: '2026-07-01' }, evidence.captures)).toThrow('Publication date')
    expect(() => validateRegistrySourceEvidence({ ...evidence.receipt, asOf: '2026-06-16' }, evidence.captures)).toThrow('as-of')
    expect(() => validateRegistrySourceEvidence({ ...evidence.receipt, listYear: 2027 }, evidence.captures)).toThrow('year')
    expect(() => validateRegistrySourceEvidence({ ...evidence.receipt, scope: { ...evidence.receipt.scope, excludesHongKongMacaoTaiwan: false } } as unknown as RegistrySourceReceipt, evidence.captures)).toThrow('scope')
  })
  it('requires the exact official attachment href rather than an occurrence of its file name', () => {
    const evidence = sourceEvidence()
    evidence.captures.set('announcement', Buffer.from(evidence.html.replace('href="./general.xls"', 'href="https://untrusted.example/general.xls"')))
    expect(() => validateRegistrySourceEvidence(evidence.receipt, evidence.captures)).toThrow('exactly linked')
  })
  it('binds rename evidence to both exact names and the institution code', () => {
    const evidence = sourceEvidence()
    evidence.receipt.aliases = [{ ...alias, evidenceText: '同意甲学院更名为甲大学，学校标识码为4111010001' }]
    expect(() => validateRegistrySourceEvidence(evidence.receipt, evidence.captures)).not.toThrow()
    evidence.receipt.aliases[0].evidenceText = '更名'
    expect(() => validateRegistrySourceEvidence(evidence.receipt, evidence.captures)).toThrow('name/code binding')
    evidence.receipt.aliases[0] = { ...alias, institutionCode: '4111010002', evidenceText: '同意甲学院更名为甲大学，学校标识码为4111010002' }
    expect(() => validateRegistrySourceEvidence(evidence.receipt, evidence.captures)).toThrow('name/code binding')
  })
  it('rejects a symlink or junction in an otherwise lexically contained output path', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'national-registry-path-')), root = join(directory, 'root'), outside = join(directory, 'outside')
    try {
      await mkdir(root); await mkdir(outside)
      await symlink(outside, join(root, 'targets'), process.platform === 'win32' ? 'junction' : 'dir')
      await expect(assertRegistryPath(root, join(root, 'targets', 'registry.json'))).rejects.toThrow('symlink or junction')
      await expect(assertRegistryPath(root, join(root, 'safe', 'registry.json'))).resolves.toBeUndefined()
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
  it('the committed national artifact reconciles all official rows and all pending tasks', async () => {
    const registry = JSON.parse(await readFile(join(process.cwd(), 'content/targets/national-university-registry.json'), 'utf8'))
    const receipt = JSON.parse(await readFile(join(process.cwd(), 'content/targets/national-university-registry.sources.json'), 'utf8'))
    const captureDirectory = join(process.cwd(), 'content/targets/sources/moe-2026'), captures = new Map<string, Buffer>()
    for (const [key, capture] of Object.entries(receipt.captures)) captures.set(key, await verifyRegistryCapture(capture as Capture, captureDirectory))
    expect(() => validateRegistrySourceEvidence(receipt, captures)).not.toThrow()
    expect(registry.source).toEqual(receipt)
    expect(registry.sourceYear).toBe(2026)
    expect(registry.asOf).toBe('2026-06-17')
    expect(registry.nationalCoverage).toMatchObject(receipt.expectedCounts)
    expect(registry.institutions).toHaveLength(3196)
    expect(registry.discoveryQueue).toHaveLength(3196)
    expect(new Set(registry.institutions.map((row: { institutionCode: string }) => row.institutionCode)).size).toBe(3196)
    expect(registry.institutions.every((row: { institutionCode: string }) => /^\d{10}$/.test(row.institutionCode))).toBe(true)
    expect(registry.institutions.filter((row: { listCategory: string }) => row.listCategory === 'adult')).toHaveLength(244)
    expect(registry.discoveryQueue.every((row: { status: string }) => row.status === 'pending')).toBe(true)
    const aliasRow = registry.institutions.find((row: { institutionCode: string }) => row.institutionCode === '4131010277')
    expect(aliasRow.officialNameZh).toBe('上海体育大学')
    expect(aliasRow.catalogueMatch).toMatchObject({ catalogueNameZh: '上海体育学院', method: 'documented-official-rename' })
  })
})
