import { createHash, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { lstat, mkdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { getTodayDate } from '../../src/lib/data/freshness'
import { selectPublishedData } from '../../src/lib/data/publication'
import { bundleSchema } from '../../src/lib/data/schema'
import type { DataBundle } from '../../src/lib/data/types'

type Cell = string | number | null
export type MoeSheet = { name: string; rows: Cell[][] }
export type Capture = { url: string; finalUrl: string; httpStatus: number; capturedAt: string; sha256: string; bytes: number; contentType: string; fileName: string }
export type ProvenAlias = { localNameZh: string; officialNameZh: string; institutionCode: string; evidenceCaptureId: string; evidenceText: string }
export type RegistrySourceReceipt = {
  format: 'studyinchina.national-university-registry-source-receipt'; version: 1
  listYear: number; asOf: string; publishedAt: string
  scope: { excludesHongKongMacaoTaiwan: true; officialScopeNoteZh: string }
  expectedCounts: { total: number; general: number; bachelor: number; higherVocational: number; adult: number }
  captures: Record<string, Capture>
  aliases: ProvenAlias[]
}
export type Institution = {
  id: string; institutionCode: string; officialNameZh: string; listCategory: 'general' | 'adult'
  educationCategory: 'bachelor-level' | 'higher-vocational-junior-college' | 'adult-higher-education'
  educationLevelRaw: string | null; provinceNameZh: string; locationRaw: string | null; supervisingAuthorityRaw: string; remarksRaw: string | null
  sourceRow: number; sourceSheet: string; sourceCaptureId: 'general' | 'adult'; ordinal: number
}
type CatalogueUniversity = { id: string; name: { zh?: string }; officialUrl?: string; admissionsUrl?: string | null }
export function buildCatalogueCoverage(bundle: DataBundle, today: string) {
  assertDate(today)
  const published = selectPublishedData(bundle, today), publicIds = new Set(published.universities.map(row => row.id))
  const universities = Object.fromEntries(bundle.universities.map(row => [row.id, { publicIdentity: publicIds.has(row.id),
    rawProgrammes: bundle.programs.filter(program => program.universityId === row.id).length,
    currentPublicProgrammes: published.programs.filter(program => program.universityId === row.id).length }]))
  const withProgrammes = Object.values(universities).filter(row => row.publicIdentity && row.currentPublicProgrammes > 0).length
  return { evaluatedOn: today, timeZone: 'Asia/Shanghai', basis: 'selectPublishedData', universities,
    summary: { rawCatalogueUniversities: bundle.universities.length, publicCatalogueUniversities: published.universities.length,
      hiddenCatalogueUniversities: bundle.universities.length - published.universities.length, publicUniversitiesWithCurrentProgrammes: withProgrammes,
      publicUniversitiesWithoutCurrentProgrammes: published.universities.length - withProgrammes, currentPublicProgrammes: published.programs.length,
      currentPublicAdmissionCycles: published.admissionCycles.length } }
}
const text = (value: Cell | undefined) => value == null ? '' : String(value).trim()
const sha256 = (value: Buffer | string) => createHash('sha256').update(value).digest('hex')
const required = (value: Cell | undefined, label: string) => { const result = text(value); if (!result) throw new Error(`Missing ${label}`); return result }
function integer(value: Cell | undefined, label: string) {
  const raw = text(value)
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new Error(`Invalid ${label}: ${raw}`)
  return Number(raw)
}
function assertDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new Error('Invalid source date')
}

/** Preserve MOE's row grain. A provincial heading is context, never an institution. */
export function parseMoeSheet(sheet: MoeSheet, category: 'general' | 'adult', asOf: string): Institution[] {
  assertDate(asOf)
  const width = category === 'general' ? 7 : 5
  const header = category === 'general' ? ['序号', '学校名称', '学校标识码', '主管部门', '所在地', '办学层次', '备注'] : ['序号', '学校名称', '学校标识码', '主管部门', '备注']
  const expectedName = category === 'general' ? '全国普通高等学校名单' : '全国成人高等学校名单'
  if (sheet.name !== expectedName) throw new Error('Unexpected worksheet scope')
  const title = text(sheet.rows[1]?.[0]), [year, month, day] = asOf.split('-').map(Number)
  if (!title.includes(expectedName) || !title.includes(`截至${year}年${month}月${day}日`)) throw new Error('Worksheet date or title does not match the source receipt')
  if (JSON.stringify(sheet.rows[2]?.map(text)) !== JSON.stringify(header)) throw new Error('Unsupported MOE worksheet columns')
  const institutions: Institution[] = [], provinceCounts = new Map<string, number>()
  let province: string | null = null, expectedProvinceCount = 0, actualProvinceCount = 0
  const finishProvince = () => { if (province && actualProvinceCount !== expectedProvinceCount) throw new Error(`Province row count mismatch: ${province}`) }
  for (let index = 3; index < sheet.rows.length; index++) {
    const row = sheet.rows[index]
    if (row.length !== width) throw new Error(`Unexpected row width at ${index + 1}`)
    if (row.every(cell => text(cell) === '')) continue
    const heading = text(row[0]).match(/^(.+)（(\d+)所）$/)
    if (heading && row.slice(1).every(cell => text(cell) === '')) {
      finishProvince(); province = heading[1]; expectedProvinceCount = Number(heading[2]); actualProvinceCount = 0
      if (provinceCounts.has(province)) throw new Error('Duplicate province section')
      provinceCounts.set(province, expectedProvinceCount); continue
    }
    if (!province) throw new Error('Institution occurs before a province heading')
    const ordinal = integer(row[0], 'institution ordinal'), institutionCode = required(row[2], 'institution code')
    if (ordinal !== institutions.length + 1) throw new Error('Nonconsecutive institution ordinals')
    if (!/^\d{10}$/.test(institutionCode)) throw new Error('Institution code must contain exactly ten digits')
    const educationLevelRaw = category === 'general' ? required(row[5], 'education level') : null
    if (category === 'general' && educationLevelRaw !== '本科' && educationLevelRaw !== '专科') throw new Error('Unrecognized education level; update the adapter before importing')
    institutions.push({
      id: `moe-${institutionCode}`, institutionCode, officialNameZh: required(row[1], 'official Chinese name'), listCategory: category,
      educationCategory: category === 'adult' ? 'adult-higher-education' : educationLevelRaw === '本科' ? 'bachelor-level' : 'higher-vocational-junior-college',
      educationLevelRaw, provinceNameZh: province, locationRaw: category === 'general' ? required(row[4], 'official location') : null,
      supervisingAuthorityRaw: required(row[3], 'supervising authority'), remarksRaw: text(row[width - 1]) || null,
      sourceRow: index + 1, sourceSheet: sheet.name, sourceCaptureId: category, ordinal,
    }); actualProvinceCount++
  }
  finishProvince()
  if (!institutions.length) throw new Error('Empty institution list')
  return institutions
}

export function validateInstitutionSet(institutions: Institution[]) {
  const codes = new Set<string>(), names = new Set<string>()
  for (const institution of institutions) {
    if (codes.has(institution.institutionCode)) throw new Error(`Duplicate national institution code: ${institution.institutionCode}`)
    if (names.has(institution.officialNameZh)) throw new Error(`Duplicate national institution name: ${institution.officialNameZh}`)
    codes.add(institution.institutionCode); names.add(institution.officialNameZh)
  }
}

/** No transliteration, punctuation replacement, substring matching or fuzzy joins. */
export function matchCatalogue(institutions: Institution[], catalogue: CatalogueUniversity[], aliases: ProvenAlias[]) {
  validateInstitutionSet(institutions)
  const byName = new Map(institutions.map(row => [row.officialNameZh, row])), byCode = new Map(institutions.map(row => [row.institutionCode, row]))
  const aliasNames = new Map<string, ProvenAlias>(), catalogueIds = new Set<string>(), linkedTargets = new Set<string>()
  for (const alias of aliases) {
    if (!alias.evidenceCaptureId || !alias.evidenceText || byName.has(alias.localNameZh) || aliasNames.has(alias.localNameZh)
      || byCode.get(alias.institutionCode)?.officialNameZh !== alias.officialNameZh) throw new Error('Ambiguous or unsupported alias')
    aliasNames.set(alias.localNameZh, alias)
  }
  const matches = new Map<string, { universityId: string; catalogueNameZh: string; method: 'exact-official-Chinese-name' | 'documented-official-rename'; aliasEvidenceCaptureId: string | null }>()
  const unmatched: { universityId: string; catalogueNameZh: string | null; reason: 'no-exact-or-proven-alias-match' }[] = []
  for (const university of catalogue) {
    if (!university.id || catalogueIds.has(university.id)) throw new Error('Duplicate or empty catalogue university ID')
    catalogueIds.add(university.id)
    const name = university.name.zh ?? '', alias = aliasNames.get(name), institution = byName.get(name) ?? (alias ? byCode.get(alias.institutionCode) : undefined)
    if (!institution) { unmatched.push({ universityId: university.id, catalogueNameZh: name || null, reason: 'no-exact-or-proven-alias-match' }); continue }
    if (linkedTargets.has(institution.id)) throw new Error(`Multiple catalogue identities map to ${institution.id}`)
    linkedTargets.add(institution.id)
    matches.set(institution.id, { universityId: university.id, catalogueNameZh: name, method: alias ? 'documented-official-rename' : 'exact-official-Chinese-name', aliasEvidenceCaptureId: alias?.evidenceCaptureId ?? null })
  }
  return { matches, unmatched }
}

function knownSources(university: CatalogueUniversity | undefined) {
  const urls = [university?.admissionsUrl, university?.officialUrl].filter((url): url is string => Boolean(url))
  return [...new Set(urls)].filter(value => {
    try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password } catch { return false }
  }).map(url => ({ url, basis: 'existing-catalogue-unchecked' as const, verificationStatus: 'unknown' as const }))
}

export function buildNationalUniversityRegistry(institutions: Institution[], catalogue: CatalogueUniversity[], source: RegistrySourceReceipt, catalogueSha256: string, coverage?: ReturnType<typeof buildCatalogueCoverage>) {
  const { matches, unmatched } = matchCatalogue(institutions, catalogue, source.aliases)
  const actual = { total: institutions.length, general: institutions.filter(row => row.listCategory === 'general').length,
    bachelor: institutions.filter(row => row.educationCategory === 'bachelor-level').length,
    higherVocational: institutions.filter(row => row.educationCategory === 'higher-vocational-junior-college').length,
    adult: institutions.filter(row => row.listCategory === 'adult').length }
  if (Object.entries(actual).some(([key, value]) => value !== source.expectedCounts[key as keyof typeof actual])) throw new Error('National category totals do not reconcile to the official announcement')
  const byCatalogueId = new Map(catalogue.map(row => [row.id, row]))
  const records = institutions.map(institution => {
    const match = matches.get(institution.id)
    return { ...institution, catalogueMatch: match ? { ...match, publicCoverage: coverage?.universities[match.universityId] ?? null } : null,
      discoveryStatus: 'pending-international-admissions-discovery' as const, internationalAdmissionsStatus: 'unknown' as const, currentProgramsStatus: 'unknown' as const }
  })
  const nationalCoverage = {
    ...actual, catalogueUniversities: catalogue.length, matchedCatalogueUniversities: matches.size,
    exactNameMatches: [...matches.values()].filter(row => row.method === 'exact-official-Chinese-name').length,
    documentedAliasMatches: [...matches.values()].filter(row => row.method === 'documented-official-rename').length,
    unmatchedCatalogueUniversities: unmatched.length, missingFromCatalogue: institutions.length - matches.size,
    generalMissingFromCatalogue: records.filter(row => row.listCategory === 'general' && !row.catalogueMatch).length,
    adultMissingFromCatalogue: records.filter(row => row.listCategory === 'adult' && !row.catalogueMatch).length,
    pendingDiscovery: records.length, registryCertifiedInternationalAdmissions: 0, registryCertifiedCurrentProgrammes: 0,
    cataloguePublicCoverage: coverage ? { evaluatedOn: coverage.evaluatedOn, timeZone: coverage.timeZone, basis: coverage.basis, ...coverage.summary } : null,
  }
  const discoveryQueue = records.map(row => ({ targetId: row.id, institutionCode: row.institutionCode, officialNameZh: row.officialNameZh,
    listCategory: row.listCategory, educationCategory: row.educationCategory, catalogueUniversityId: row.catalogueMatch?.universityId ?? null,
    status: 'pending' as const, nextAction: 'discover-official-international-admissions-source' as const,
    knownSourceCandidates: knownSources(row.catalogueMatch ? byCatalogueId.get(row.catalogueMatch.universityId) : undefined),
  }))
  return { format: 'studyinchina.national-university-target-registry', version: 1, purpose: 'pending-international-admissions-discovery',
    sourceYear: source.listYear, asOf: source.asOf, publishedAt: source.publishedAt,
    policy: { operationalTargetsOnly: true, publicationEligible: false, catalogueWritten: false,
      moeIdentityDoesNotEstablishInternationalAdmissions: true, moeIdentityDoesNotEstablishCurrentProgrammes: true,
      noInferredAdmissionsHosts: true, sourceScope: source.scope },
    source, catalogueSnapshotSha256: catalogueSha256, nationalCoverage, unmatchedCatalogue: unmatched, institutions: records, discoveryQueue }
}

const XLS_EXTRACTOR = `import sys,json\nif len(sys.argv)>2 and sys.argv[2]:sys.path.insert(0,sys.argv[2])\nimport xlrd\nif xlrd.__version__!='2.0.2':raise RuntimeError('Use pinned xlrd==2.0.2')\nw=xlrd.open_workbook(sys.argv[1],on_demand=True)\nprint(json.dumps([{'name':s.name,'rows':[s.row_values(i) for i in range(s.nrows)]} for s in w.sheets()],ensure_ascii=True))\nw.release_resources()\n`
export function readMoeXls(path: string, python = 'python', moduleDirectory = ''): MoeSheet[] {
  const result = spawnSync(python, ['-c', XLS_EXTRACTOR, path, moduleDirectory], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, windowsHide: true, timeout: 30_000 })
  if (result.error || result.status !== 0) throw new Error(`Official XLS extraction failed. Install xlrd==2.0.2 in an isolated Python directory: ${result.error?.message ?? result.stderr.trim()}`)
  return JSON.parse(result.stdout)
}
type Arguments = { root: string; captureDirectory: string; receipt: string; dataDirectory: string; output: string; python: string; pythonModuleDirectory: string; today: string }
const inside = (root: string, path: string) => { const part = relative(root, path); return part === '' || part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part) }
export function parseNationalRegistryArguments(args: string[], root = process.cwd()): Arguments {
  root = resolve(root)
  const allowed = new Set(['--capture-dir', '--receipt', '--data-dir', '--output', '--python', '--python-module-dir', '--today']), values = new Map<string, string>()
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1]
    if (!allowed.has(key) || values.has(key) || !value || value.startsWith('--')) throw new Error('Unknown, duplicate or missing registry argument')
    values.set(key, value)
  }
  const output = resolve(root, values.get('--output') ?? 'content/targets/national-university-registry.json')
  if (!inside(root, output) || !['content/targets', '.tmp', 'quality'].some(prefix => inside(resolve(root, prefix), output)) || !output.endsWith('.json')) throw new Error('Registry output must be JSON under content/targets, .tmp or quality; canonical catalogue writes are forbidden')
  const local = (key: string, fallback: string) => { const path = resolve(root, values.get(key) ?? fallback); if (!inside(root, path)) throw new Error('Input must remain within the workspace'); return path }
  const today = values.get('--today') ?? getTodayDate(); assertDate(today)
  return { root, output, captureDirectory: local('--capture-dir', 'content/targets/sources/moe-2026'),
    receipt: local('--receipt', 'content/targets/national-university-registry.sources.json'), dataDirectory: local('--data-dir', 'content/data'), today,
    python: values.get('--python') ?? 'python', pythonModuleDirectory: values.has('--python-module-dir') ? local('--python-module-dir', '') : '' }
}

export async function verifyRegistryCapture(capture: Capture, directory: string): Promise<Buffer> {
  if (basename(capture.fileName) !== capture.fileName || !capture.fileName || !/^[a-f0-9]{64}$/.test(capture.sha256)) throw new Error('Invalid capture file identity')
  for (const value of [capture.url, capture.finalUrl]) {
    const url = new URL(value)
    if (url.hostname !== 'www.moe.gov.cn' || !['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Capture is not on the official MOE origin')
  }
  if (capture.httpStatus !== 200 || !Number.isFinite(Date.parse(capture.capturedAt))) throw new Error('Capture was not a dated successful response')
  await assertRegistryPath(directory, resolve(directory, capture.fileName))
  const bytes = await readFile(resolve(directory, capture.fileName))
  if (sha256(bytes) !== capture.sha256 || bytes.length !== capture.bytes) throw new Error('Source capture hash or byte count mismatch')
  return bytes
}

/** Reject symlink/junction escapes as well as lexical ../ traversal. */
export async function assertRegistryPath(root: string, path: string) {
  root = resolve(root); path = resolve(path)
  if (!inside(root, path)) throw new Error('Registry path escapes its allowed root')
  const realRoot = await realpath(root)
  let cursor = path
  for (;;) {
    try {
      const stat = await lstat(cursor)
      if (stat.isSymbolicLink() || !inside(realRoot, await realpath(cursor))) throw new Error('Registry symlink or junction path is forbidden')
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    if (cursor === root) break
    const parent = dirname(cursor)
    if (parent === cursor) throw new Error('Registry path has no workspace ancestor')
    cursor = parent
  }
}

export function validateRegistrySourceEvidence(source: RegistrySourceReceipt, captures: Map<string, Buffer>) {
  if (source.format !== 'studyinchina.national-university-registry-source-receipt' || source.version !== 1 || source.scope.excludesHongKongMacaoTaiwan !== true
    || source.scope.officialScopeNoteZh !== '本名单未包含港澳台地区高等学校。') throw new Error('Unsupported or ambiguous source scope')
  assertDate(source.asOf); assertDate(source.publishedAt)
  if (source.listYear !== Number(source.asOf.slice(0, 4)) || source.publishedAt < source.asOf) throw new Error('Source year or publication date mismatch')
  const announcement = captures.get('announcement')?.toString('utf8') ?? ''
  const publishedDates = [...announcement.matchAll(/<meta\s+name=["'](?:publishdate|PubDate)["']\s+content=["'](\d{4}-\d{2}-\d{2})(?:[^"']*)["']/gi)].map(match => match[1])
  if (!publishedDates.length || publishedDates.some(date => date !== source.publishedAt)) throw new Error('Publication date is not supported by announcement metadata')
  const [year, month, day] = source.asOf.split('-').map(Number)
  if (!announcement.includes(`截至${year}年${month}月${day}日`)) throw new Error('List as-of date is not supported by the announcement')
  const counts = source.expectedCounts
  for (const expected of [`共计${counts.total}所`, `普通高等学校${counts.general}所`, `本科学校${counts.bachelor}所`, `专科）学校${counts.higherVocational}所`, `成人高等学校${counts.adult}所`, source.scope.officialScopeNoteZh]) {
    if (!announcement.includes(expected)) throw new Error('Source announcement does not substantiate the expected totals or scope')
  }
  for (const key of ['general', 'adult']) {
    const capture = source.captures[key]
    if (!capture || !source.captures.announcement) throw new Error('Required source capture is missing')
    const linkedUrls = [...announcement.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)].map(match => new URL(match[1], source.captures.announcement.finalUrl))
    const expected = new URL(capture.finalUrl)
    if (!linkedUrls.some(link => link.href === expected.href)) throw new Error('Spreadsheet is not exactly linked from the captured announcement')
  }
  for (const alias of source.aliases) {
    const expected = `同意${alias.localNameZh}更名为${alias.officialNameZh}，学校标识码为${alias.institutionCode}`
    if (alias.evidenceText !== expected || !captures.get(alias.evidenceCaptureId)?.toString('utf8').includes(expected)) throw new Error('Alias name/code binding is not supported by its captured official evidence')
  }
}

export async function runNationalRegistryBuild(options: Arguments) {
  const optionsFromParser = parseNationalRegistryArguments(['--capture-dir', options.captureDirectory, '--receipt', options.receipt, '--data-dir', options.dataDirectory,
    '--output', options.output, '--python', options.python, '--today', options.today, ...(options.pythonModuleDirectory ? ['--python-module-dir', options.pythonModuleDirectory] : [])], options.root)
  if (optionsFromParser.output === options.receipt) throw new Error('Output cannot overwrite the source receipt')
  for (const path of [options.captureDirectory, options.receipt, options.dataDirectory, options.output, ...(options.pythonModuleDirectory ? [options.pythonModuleDirectory] : [])]) await assertRegistryPath(options.root, path)
  const source = JSON.parse(await readFile(options.receipt, 'utf8')) as RegistrySourceReceipt
  const captures = new Map<string, Buffer>()
  for (const [key, capture] of Object.entries(source.captures)) captures.set(key, await verifyRegistryCapture(capture, options.captureDirectory))
  validateRegistrySourceEvidence(source, captures)
  const institutions = (['general', 'adult'] as const).flatMap(category => {
    const sheets = readMoeXls(resolve(options.captureDirectory, source.captures[category].fileName), options.python, options.pythonModuleDirectory)
    if (sheets.length !== 1) throw new Error('Unexpected additional worksheets; review before importing')
    return parseMoeSheet(sheets[0], category, source.asOf)
  })
  const files = { sources: 'sources', cities: 'cities', universities: 'universities', programs: 'programs', admissionCycles: 'admission-cycles', scholarships: 'scholarships' }
  const entries = await Promise.all(Object.entries(files).map(async ([key, name]) => {
    const path = resolve(options.dataDirectory, `${name}.json`)
    if (path === options.output) throw new Error('Output cannot overwrite a catalogue input')
    await assertRegistryPath(options.root, path)
    const bytes = await readFile(path)
    return { key, value: JSON.parse(bytes.toString('utf8')), sha256: sha256(bytes) }
  }))
  const bundle = bundleSchema.parse(Object.fromEntries(entries.map(row => [row.key, row.value])))
  const coverage = buildCatalogueCoverage(bundle, options.today), snapshotSha256 = sha256(JSON.stringify(Object.fromEntries(entries.map(row => [row.key, row.sha256]))))
  const registry = buildNationalUniversityRegistry(institutions, bundle.universities, source, snapshotSha256, coverage)
  await mkdir(dirname(options.output), { recursive: true })
  await assertRegistryPath(options.root, options.output)
  const temporary = `${options.output}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(registry, null, 2)}\n`, { flag: 'wx' })
  try { await rename(temporary, options.output) } catch (error) { await unlink(temporary).catch(() => undefined); throw error }
  return registry
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runNationalRegistryBuild(parseNationalRegistryArguments(process.argv.slice(2))).then(registry => console.log(JSON.stringify({ output: 'national-university-target-registry', sourceYear: registry.sourceYear, asOf: registry.asOf, nationalCoverage: registry.nationalCoverage, publicationEligible: false })))
    .catch(error => { console.error(error instanceof Error ? error.message : 'National registry build failed'); process.exitCode = 1 })
}
