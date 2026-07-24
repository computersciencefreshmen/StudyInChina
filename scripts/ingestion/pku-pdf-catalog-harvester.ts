import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export type PkuDegreeLevel = 'master' | 'doctorate'
export type PkuInstructionLanguage = 'Chinese' | 'English'

export type PkuCatalogDocument = {
  department: string
  officialUrl: string
  fileName: string
  indexLocator: string
}

export type PkuProgramEvidence = {
  page: number
  lineStart: number
  lineEnd: number
  locator: string
  quote: string
  officialUrl: string
  checkedAt: string
}

export type PkuProgramEntity = {
  entityKey: string
  entityType: 'program'
  institutionId: string
  programType: 'degree'
  degreeLevel: PkuDegreeLevel
  instructionLanguage: PkuInstructionLanguage
  programCode: string
  name: string
  department: string
  officialUrl: string
  sourceCheckedAt: string
  verificationStatus: 'verified'
  confidence: number
  evidence: PkuProgramEvidence
}

export type PkuQuarantineRecord = {
  status: 'quarantined'
  scope: 'index' | 'document' | 'row'
  department: string | null
  officialUrl: string
  candidateName: string | null
  candidateCode: string | null
  page: number | null
  lineStart: number | null
  lineEnd: number | null
  locator: string
  reasons: string[]
}

export type PkuCatalogIndexResult = {
  parserVersion: 'pku-catalog-index-v1'
  indexUrl: string
  degreeLevel: PkuDegreeLevel
  instructionLanguage: PkuInstructionLanguage
  anchorsFound: number
  documents: PkuCatalogDocument[]
  quarantined: PkuQuarantineRecord[]
}

export type PkuDocumentReconciliation = {
  pages: number
  tableHeaderPages: number
  programCandidates: number
  verifiedRows: number
  quarantinedRows: number
  duplicateRows: number
}

export type PkuDocumentHarvest = {
  parserVersion: 'pku-pdf-layout-v1'
  sourceType: 'official_pdf'
  sourcePdfName: string | null
  officialUrl: string
  institutionId: string
  checkedAt: string
  degreeLevel: PkuDegreeLevel
  instructionLanguage: PkuInstructionLanguage
  department: string
  entities: PkuProgramEntity[]
  quarantined: PkuQuarantineRecord[]
  reconciliation: PkuDocumentReconciliation
}

export type PkuCatalogReconciliation = {
  indexAnchors: number
  acceptedDocuments: number
  loadedDocuments: number
  missingDocuments: number
  quarantinedIndexAnchors: number
  quarantinedDocuments: number
  programCandidates: number
  verifiedRows: number
  quarantinedRows: number
  duplicateRows: number
  uniqueVerifiedPrograms: number
  verificationRate: number
  documentCoverageRate: number
}

export type PkuCatalogHarvest = {
  parserVersion: 'pku-pdf-directory-v1'
  sourceType: 'official_pdf_directory'
  indexUrl: string
  institutionId: string
  checkedAt: string
  degreeLevel: PkuDegreeLevel
  instructionLanguage: PkuInstructionLanguage
  entities: PkuProgramEntity[]
  quarantined: PkuQuarantineRecord[]
  reconciliation: PkuCatalogReconciliation
}

export type ParsePkuCatalogIndexOptions = {
  indexUrl: string
  degreeLevel: PkuDegreeLevel
  instructionLanguage: PkuInstructionLanguage
}

export type ParsePkuPdfCatalogOptions = {
  document: PkuCatalogDocument
  institutionId: string
  checkedAt: string
  degreeLevel: PkuDegreeLevel
  instructionLanguage: PkuInstructionLanguage
  sourcePdfName?: string
}

export type HarvestPkuCatalogDirectoryOptions = ParsePkuCatalogIndexOptions & {
  indexHtml: string
  pdfDirectory: string
  institutionId: string
  checkedAt: string
  pdftotextPath?: string
}

type PendingNameFragment = {
  page: number
  line: number
  text: string
}

const MAX_PROCESS_BUFFER_BYTES = 128 * 1024 * 1024
const PKU_CATALOG_HOST = 'admission.pku.edu.cn'
const PROGRAM_CODE_PATTERN = '[A-Z0-9]{6,8}'
const DIRECTION_MARKER_PATTERN =
  /(^|\s+)(\d{2})(?:\.|\uFF0E|\u3001)\s*/u

function round(value: number, precision = 2): number {
  const scale = 10 ** precision
  return Math.round(value * scale) / scale
}

function normalizeText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\u00a0/gu, ' ')
    .replace(/\s+/gu, ' ')
    .replace(/\s+([,.;:)\]])/gu, '$1')
    .replace(/([(\[])\s+/gu, '$1')
    .replace(/\s*([，。；：、])\s*/gu, '$1')
    .replace(/([\p{Script=Han}])\s+(?=[\p{Script=Han}])/gu, '$1')
    .trim()
}

function normalizeIdentity(value: string): string {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[\s()[\]{}（）【】《》·•,，.。:：;；'’"“”/_-]+/gu, '')
}

function htmlDecode(value: string): string {
  return value
    .replace(/&#(\d+);/gu, (_match, digits: string) => (
      String.fromCodePoint(Number(digits))
    ))
    .replace(/&#x([0-9a-f]+);/giu, (_match, digits: string) => (
      String.fromCodePoint(Number.parseInt(digits, 16))
    ))
    .replace(/&nbsp;/giu, ' ')
    .replace(/&amp;/giu, '&')
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
}

function stripHtml(value: string): string {
  return normalizeText(htmlDecode(value.replace(/<[^>]*>/gu, ' ')))
}

function validateDegreeLevel(value: string): PkuDegreeLevel {
  if (value === 'master' || value === 'doctorate') return value
  throw new Error('degreeLevel must be master or doctorate')
}

function validateInstructionLanguage(value: string): PkuInstructionLanguage {
  if (value === 'Chinese' || value === 'English') return value
  throw new Error('instructionLanguage must be Chinese or English')
}

function validateInstitutionId(value: string): string {
  if (!/^[a-z0-9][a-z0-9-]{2,127}$/u.test(value)) {
    throw new Error('institutionId must be a stable lowercase identifier')
  }
  return value
}

function validateCheckedAt(value: string): string {
  if (Number.isNaN(Date.parse(value))) {
    throw new Error('checkedAt must be an ISO timestamp')
  }
  return value
}

function validatePkuUrl(value: string): URL {
  const url = new URL(value)
  if (
    url.protocol !== 'https:' ||
    url.hostname.toLowerCase() !== PKU_CATALOG_HOST ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== ''
  ) {
    throw new Error('officialUrl must be an HTTPS admission.pku.edu.cn URL')
  }
  url.hash = ''
  return url
}

function expectedCatalogStem(
  degreeLevel: PkuDegreeLevel,
  instructionLanguage: PkuInstructionLanguage,
): string {
  const level = degreeLevel === 'master' ? 'ss' : 'bs'
  const language = instructionLanguage === 'Chinese' ? 'cn' : 'en'
  return `zsml_${level}_lxs_${language}`
}

function validateIndexUrl(
  value: string,
  degreeLevel: PkuDegreeLevel,
  instructionLanguage: PkuInstructionLanguage,
): URL {
  const url = validatePkuUrl(value)
  const stem = expectedCatalogStem(degreeLevel, instructionLanguage)
  const level = degreeLevel === 'master' ? 'ss' : 'bs'
  const pathPattern = new RegExp(
    `^/zsxx/lxszs/lxszyml/\\d{4}/${level}/${stem}\\.html$`,
    'u',
  )
  if (!pathPattern.test(url.pathname)) {
    throw new Error(
      `indexUrl path does not match the ${degreeLevel} ${instructionLanguage} PKU catalog`,
    )
  }
  return url
}

function lineNumberAt(value: string, index: number): number {
  return value.slice(0, index).split(/\r?\n/u).length
}

function indexQuarantine(
  indexUrl: string,
  department: string | null,
  officialUrl: string,
  locator: string,
  reasons: string[],
): PkuQuarantineRecord {
  return {
    status: 'quarantined',
    scope: 'index',
    department,
    officialUrl: officialUrl || indexUrl,
    candidateName: null,
    candidateCode: null,
    page: null,
    lineStart: null,
    lineEnd: null,
    locator,
    reasons,
  }
}

export function parsePkuCatalogIndexHtml(
  html: string,
  rawOptions: ParsePkuCatalogIndexOptions,
): PkuCatalogIndexResult {
  const degreeLevel = validateDegreeLevel(rawOptions.degreeLevel)
  const instructionLanguage = validateInstructionLanguage(rawOptions.instructionLanguage)
  const indexUrl = validateIndexUrl(
    rawOptions.indexUrl,
    degreeLevel,
    instructionLanguage,
  )
  const expectedStem = expectedCatalogStem(degreeLevel, instructionLanguage)
  const expectedDirectory = indexUrl.pathname.slice(
    0,
    indexUrl.pathname.lastIndexOf('/') + 1,
  )
  const documents: PkuCatalogDocument[] = []
  const quarantined: PkuQuarantineRecord[] = []
  const seenUrls = new Set<string>()
  const seenDepartments = new Set<string>()
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/giu
  let anchorsFound = 0

  for (const match of html.matchAll(anchorPattern)) {
    const attributes = match[1] ?? ''
    const hrefMatch = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/iu.exec(attributes)
    const rawHref = htmlDecode(hrefMatch?.[1] ?? hrefMatch?.[2] ?? hrefMatch?.[3] ?? '')
    if (!/\.pdf(?:[?#]|$)/iu.test(rawHref)) continue
    anchorsFound += 1
    const department = stripHtml(match[2] ?? '')
    const anchorLine = lineNumberAt(html, match.index ?? 0)
    const locator = `html:line=${anchorLine};a[href=${JSON.stringify(rawHref)}]`
    let resolved: URL
    try {
      resolved = validatePkuUrl(new URL(rawHref, indexUrl).href)
    } catch {
      quarantined.push(indexQuarantine(
        indexUrl.href,
        department || null,
        rawHref,
        locator,
        ['non_official_pdf_url'],
      ))
      continue
    }
    const fileName = basename(resolved.pathname)
    const reasons: string[] = []
    if (!department || department.length > 120) reasons.push('invalid_department_label')
    if (resolved.pathname.slice(0, resolved.pathname.lastIndexOf('/') + 1) !== expectedDirectory) {
      reasons.push('pdf_outside_catalog_directory')
    }
    if (!new RegExp(`^${expectedStem}_[0-9]{5}\\.pdf$`, 'u').test(fileName)) {
      reasons.push('catalog_prefix_mismatch')
    }
    if (seenUrls.has(resolved.href)) reasons.push('duplicate_pdf_url')
    if (department && seenDepartments.has(normalizeIdentity(department))) {
      reasons.push('duplicate_department_anchor')
    }
    if (reasons.length > 0) {
      quarantined.push(indexQuarantine(
        indexUrl.href,
        department || null,
        resolved.href,
        locator,
        reasons,
      ))
      continue
    }
    seenUrls.add(resolved.href)
    seenDepartments.add(normalizeIdentity(department))
    documents.push({
      department,
      officialUrl: resolved.href,
      fileName,
      indexLocator: locator,
    })
  }

  documents.sort((left, right) => left.indexLocator.localeCompare(right.indexLocator))
  return {
    parserVersion: 'pku-catalog-index-v1',
    indexUrl: indexUrl.href,
    degreeLevel,
    instructionLanguage,
    anchorsFound,
    documents,
    quarantined,
  }
}

function rowLocator(
  page: number,
  lineStart: number,
  lineEnd: number,
  code?: string,
): string {
  return [
    `pdf:page=${page}`,
    `lines=${lineStart}-${lineEnd}`,
    code ? `code=${code}` : '',
  ].filter(Boolean).join(';')
}

function rowQuarantine(
  document: PkuCatalogDocument,
  candidateName: string | null,
  candidateCode: string | null,
  page: number,
  lineStart: number,
  lineEnd: number,
  reasons: string[],
): PkuQuarantineRecord {
  return {
    status: 'quarantined',
    scope: 'row',
    department: document.department,
    officialUrl: document.officialUrl,
    candidateName,
    candidateCode,
    page,
    lineStart,
    lineEnd,
    locator: rowLocator(page, lineStart, lineEnd, candidateCode ?? undefined),
    reasons,
  }
}

function documentQuarantine(
  document: PkuCatalogDocument,
  reasons: string[],
): PkuQuarantineRecord {
  return {
    status: 'quarantined',
    scope: 'document',
    department: document.department,
    officialUrl: document.officialUrl,
    candidateName: null,
    candidateCode: null,
    page: null,
    lineStart: null,
    lineEnd: null,
    locator: document.indexLocator,
    reasons,
  }
}

function departmentFingerprint(value: string): string {
  let hash = 2_166_136_261
  for (const character of normalizeIdentity(value)) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16_777_619)
  }
  return (hash >>> 0).toString(36).padStart(7, '0')
}

function entityKey(
  degreeLevel: PkuDegreeLevel,
  instructionLanguage: PkuInstructionLanguage,
  department: string,
  programCode: string,
): string {
  return [
    'pku',
    degreeLevel,
    instructionLanguage.toLowerCase(),
    departmentFingerprint(department),
    programCode.toLowerCase(),
  ].join(':')
}

function isPlausibleProgramName(value: string): boolean {
  if (
    value.length < 2 ||
    value.length > 300 ||
    !/[\p{L}\p{Script=Han}]/u.test(value) ||
    /专业名称|研究方向|学习方式|授课语言|招生专业及研究方向/iu.test(value) ||
    /^\d{1,2}[.、]\s*/u.test(value)
  ) {
    return false
  }
  let balance = 0
  for (const character of value) {
    if (character === '(') balance += 1
    if (character === ')') balance -= 1
    if (balance < 0) return false
  }
  return balance === 0
}

function titleDepartment(pages: readonly string[]): string | null {
  const firstPageLines = (pages[0] ?? '').split('\n').slice(0, 12)
  for (const line of firstPageLines) {
    const normalized = normalizeText(line)
    const match = /^(.*?)招生专业及研究方向(?:目录)?$/u.exec(normalized)
    if (match?.[1]) return normalizeText(match[1])
  }
  return null
}

function departmentTitleMatches(title: string, department: string): boolean {
  if (normalizeIdentity(title) === normalizeIdentity(department)) return true
  const normalizedDepartment = normalizeText(department)
  const baseDepartment = normalizedDepartment.replace(/\([^()]+\)$/u, '')
  return (
    baseDepartment !== normalizedDepartment &&
    normalizeIdentity(title) === normalizeIdentity(baseDepartment)
  )
}

function headerBoundary(lines: readonly string[]): {
  lineIndex: number
  boundary: number
} | null {
  for (let index = 0; index < Math.min(lines.length, 30); index += 1) {
    const line = lines[index] ?? ''
    const majorIndex = line.search(/专业名称|Major|Program(?:\s+Name)?/iu)
    const directionIndex = line.search(/研究方向|Research\s+Directions?/iu)
    if (majorIndex >= 0 && directionIndex > majorIndex) {
      return { lineIndex: index, boundary: directionIndex }
    }
  }
  return null
}

function joinNameFragments(fragments: readonly PendingNameFragment[]): string {
  return normalizeText(fragments.map((fragment) => fragment.text).join(' '))
}

export function parsePkuPdfCatalogText(
  layoutText: string,
  rawOptions: ParsePkuPdfCatalogOptions,
): PkuDocumentHarvest {
  const degreeLevel = validateDegreeLevel(rawOptions.degreeLevel)
  const instructionLanguage = validateInstructionLanguage(rawOptions.instructionLanguage)
  const institutionId = validateInstitutionId(rawOptions.institutionId)
  const checkedAt = validateCheckedAt(rawOptions.checkedAt)
  const officialUrl = validatePkuUrl(rawOptions.document.officialUrl)
  if (extname(officialUrl.pathname).toLowerCase() !== '.pdf') {
    throw new Error('PKU catalog document officialUrl must be a PDF')
  }
  const document: PkuCatalogDocument = {
    ...rawOptions.document,
    officialUrl: officialUrl.href,
    fileName: basename(officialUrl.pathname),
  }
  const pages = layoutText
    .replace(/^\uFEFF/u, '')
    .replace(/\r\n?/gu, '\n')
    .split('\f')
  if (pages.at(-1)?.trim() === '') pages.pop()
  const quarantined: PkuQuarantineRecord[] = []
  const entitiesByCode = new Map<string, PkuProgramEntity>()
  const conflictedCodes = new Set<string>()
  const title = titleDepartment(pages)
  if (!title) {
    quarantined.push(documentQuarantine(document, ['missing_document_title']))
    return {
      parserVersion: 'pku-pdf-layout-v1',
      sourceType: 'official_pdf',
      sourcePdfName: rawOptions.sourcePdfName ?? null,
      officialUrl: document.officialUrl,
      institutionId,
      checkedAt,
      degreeLevel,
      instructionLanguage,
      department: document.department,
      entities: [],
      quarantined,
      reconciliation: {
        pages: pages.length,
        tableHeaderPages: 0,
        programCandidates: 0,
        verifiedRows: 0,
        quarantinedRows: 0,
        duplicateRows: 0,
      },
    }
  }
  if (!departmentTitleMatches(title, document.department)) {
    quarantined.push(documentQuarantine(document, ['department_title_mismatch']))
    return {
      parserVersion: 'pku-pdf-layout-v1',
      sourceType: 'official_pdf',
      sourcePdfName: rawOptions.sourcePdfName ?? null,
      officialUrl: document.officialUrl,
      institutionId,
      checkedAt,
      degreeLevel,
      instructionLanguage,
      department: document.department,
      entities: [],
      quarantined,
      reconciliation: {
        pages: pages.length,
        tableHeaderPages: 0,
        programCandidates: 0,
        verifiedRows: 0,
        quarantinedRows: 0,
        duplicateRows: 0,
      },
    }
  }

  let carriedBoundary: number | null = null
  let carriedDirectionStart: number | null = null
  let tableHeaderPages = 0
  let programCandidates = 0
  let duplicateRows = 0
  let pending: PendingNameFragment[] = []
  const codePattern = new RegExp(`\\((${PROGRAM_CODE_PATTERN})\\)\\s*$`, 'iu')

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const page = pageIndex + 1
    const lines = (pages[pageIndex] ?? '').split('\n')
    const header = headerBoundary(lines)
    if (header) {
      carriedBoundary = header.boundary
      tableHeaderPages += 1
    }
    const directionStarts = lines
      .map((line) => {
        const match = DIRECTION_MARKER_PATTERN.exec(line)
        return match ? match.index + (match[1]?.length ?? 0) : null
      })
      .filter((value): value is number => value !== null && value > 0)
    if (directionStarts.length > 0) {
      carriedDirectionStart = Math.min(...directionStarts)
    }
    if (carriedBoundary === null) {
      quarantined.push(documentQuarantine(document, ['missing_table_header']))
      break
    }

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const lineNumber = lineIndex + 1
      if (header?.lineIndex === lineIndex) continue
      const rawLine = lines[lineIndex] ?? ''
      const directionMarker = DIRECTION_MARKER_PATTERN.exec(rawLine)
      const studyModeMarker = /\s{2,}(?:\u5168\u65E5\u5236|\u975E\u5168\u65E5\u5236|Full[- ]?time|Part[- ]?time)(?:\s|$)/iu
        .exec(rawLine)
      const firstNonProgramColumn = directionMarker?.index ?? studyModeMarker?.index
      const firstNonWhitespace = rawLine.search(/\S/u)
      const directionContinuation = (
        directionMarker === null &&
        carriedDirectionStart !== null &&
        firstNonWhitespace >= Math.max(0, carriedDirectionStart - 2)
      )
      const rawLeftCell = directionContinuation
        ? ''
        : firstNonProgramColumn === undefined
          ? rawLine
          : rawLine.slice(0, firstNonProgramColumn)
      const leftCell = normalizeText(rawLeftCell)
      if (
        !leftCell ||
        /招生专业及研究方向(?:目录)?$/u.test(leftCell) ||
        /^(?:专业名称|Major|Program(?:\s+Name)?)$/iu.test(leftCell) ||
        /^(?:北京大学|Peking University)$/iu.test(leftCell) ||
        /^第?\s*\d+\s*页$/u.test(leftCell)
      ) {
        continue
      }

      const possibleCodeMatch = codePattern.exec(leftCell)
      const codeMatch = possibleCodeMatch?.[1] && /\d/u.test(possibleCodeMatch[1])
        ? possibleCodeMatch
        : null
      if (!codeMatch?.[1]) {
        pending.push({ page, line: lineNumber, text: leftCell })
        continue
      }
      programCandidates += 1
      const programCode = codeMatch[1].toUpperCase()
      const beforeCode = normalizeText(leftCell.slice(0, codeMatch.index))
      if (beforeCode) pending.push({ page, line: lineNumber, text: beforeCode })
      const name = joinNameFragments(pending)
      const evidencePage = pending[0]?.page ?? page
      const lineStart = pending[0]?.line ?? lineNumber
      const lineEnd = lineNumber
      const reasons: string[] = []
      if (pending.length === 0 || !name) reasons.push('missing_program_name')
      if (new Set(pending.map((fragment) => fragment.page)).size > 1) {
        reasons.push('cross_page_program_identity')
      }
      if (!isPlausibleProgramName(name)) reasons.push('ambiguous_program_name')
      if (reasons.length > 0) {
        quarantined.push(rowQuarantine(
          document,
          name || null,
          programCode,
          evidencePage,
          lineStart,
          lineEnd,
          reasons,
        ))
        pending = []
        continue
      }

      const key = entityKey(
        degreeLevel,
        instructionLanguage,
        document.department,
        programCode,
      )
      const entity: PkuProgramEntity = {
        entityKey: key,
        entityType: 'program',
        institutionId,
        programType: 'degree',
        degreeLevel,
        instructionLanguage,
        programCode,
        name,
        department: document.department,
        officialUrl: document.officialUrl,
        sourceCheckedAt: checkedAt,
        verificationStatus: 'verified',
        confidence: 0.99,
        evidence: {
          page: evidencePage,
          lineStart,
          lineEnd,
          locator: rowLocator(evidencePage, lineStart, lineEnd, programCode),
          quote: `${document.department} — ${name} (${programCode})`,
          officialUrl: document.officialUrl,
          checkedAt,
        },
      }
      if (conflictedCodes.has(programCode)) {
        duplicateRows += 1
        quarantined.push(rowQuarantine(
          document,
          name,
          programCode,
          evidencePage,
          lineStart,
          lineEnd,
          ['conflicting_duplicate_program_code'],
        ))
        pending = []
        continue
      }
      const existing = entitiesByCode.get(programCode)
      if (existing) {
        duplicateRows += 1
        if (normalizeIdentity(existing.name) !== normalizeIdentity(entity.name)) {
          entitiesByCode.delete(programCode)
          conflictedCodes.add(programCode)
          quarantined.push(rowQuarantine(
            document,
            existing.name,
            programCode,
            existing.evidence.page,
            existing.evidence.lineStart,
            existing.evidence.lineEnd,
            ['conflicting_duplicate_program_code'],
          ))
          quarantined.push(rowQuarantine(
            document,
            name,
            programCode,
            evidencePage,
            lineStart,
            lineEnd,
            ['conflicting_duplicate_program_code'],
          ))
        }
      } else {
        entitiesByCode.set(programCode, entity)
      }
      pending = []
    }
  }

  if (pending.length > 0) {
    programCandidates += 1
    quarantined.push(rowQuarantine(
      document,
      joinNameFragments(pending) || null,
      null,
      pending[0]!.page,
      pending[0]!.line,
      pending.at(-1)!.line,
      ['missing_program_code'],
    ))
  }
  const entities = [...entitiesByCode.values()]
    .sort((left, right) => left.entityKey.localeCompare(right.entityKey))
  const quarantinedRows = quarantined.filter((item) => item.scope === 'row').length
  return {
    parserVersion: 'pku-pdf-layout-v1',
    sourceType: 'official_pdf',
    sourcePdfName: rawOptions.sourcePdfName ?? null,
    officialUrl: document.officialUrl,
    institutionId,
    checkedAt,
    degreeLevel,
    instructionLanguage,
    department: document.department,
    entities,
    quarantined,
    reconciliation: {
      pages: pages.length,
      tableHeaderPages,
      programCandidates,
      verifiedRows: entities.length,
      quarantinedRows,
      duplicateRows,
    },
  }
}

function aggregateRate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : round((numerator / denominator) * 100, 2)
}

export function harvestPkuCatalogDirectory(
  rawOptions: HarvestPkuCatalogDirectoryOptions,
): PkuCatalogHarvest {
  const institutionId = validateInstitutionId(rawOptions.institutionId)
  const checkedAt = validateCheckedAt(rawOptions.checkedAt)
  const degreeLevel = validateDegreeLevel(rawOptions.degreeLevel)
  const instructionLanguage = validateInstructionLanguage(rawOptions.instructionLanguage)
  const index = parsePkuCatalogIndexHtml(rawOptions.indexHtml, {
    indexUrl: rawOptions.indexUrl,
    degreeLevel,
    instructionLanguage,
  })
  const pdfDirectory = resolve(rawOptions.pdfDirectory)
  const pdftotextPath = rawOptions.pdftotextPath?.trim() || 'pdftotext'
  const quarantined = [...index.quarantined]
  const entitiesByKey = new Map<string, PkuProgramEntity>()
  const conflictedEntityKeys = new Set<string>()
  let loadedDocuments = 0
  let missingDocuments = 0
  let quarantinedDocuments = 0
  let programCandidates = 0
  let quarantinedRows = 0
  let duplicateRows = 0

  for (const document of index.documents) {
    const pdfPath = join(pdfDirectory, document.fileName)
    if (!existsSync(pdfPath) || extname(pdfPath).toLowerCase() !== '.pdf') {
      missingDocuments += 1
      quarantinedDocuments += 1
      quarantined.push(documentQuarantine(document, ['missing_local_pdf_snapshot']))
      continue
    }
    let layoutText: string
    try {
      layoutText = execFileSync(pdftotextPath, ['-layout', pdfPath, '-'], {
        encoding: 'utf8',
        maxBuffer: MAX_PROCESS_BUFFER_BYTES,
        windowsHide: true,
      })
    } catch {
      quarantinedDocuments += 1
      quarantined.push(documentQuarantine(document, ['pdf_text_extraction_failed']))
      continue
    }
    loadedDocuments += 1
    const harvest = parsePkuPdfCatalogText(layoutText, {
      document,
      institutionId,
      checkedAt,
      degreeLevel,
      instructionLanguage,
      sourcePdfName: document.fileName,
    })
    if (harvest.quarantined.some((item) => item.scope === 'document')) {
      quarantinedDocuments += 1
    }
    programCandidates += harvest.reconciliation.programCandidates
    quarantinedRows += harvest.reconciliation.quarantinedRows
    duplicateRows += harvest.reconciliation.duplicateRows
    quarantined.push(...harvest.quarantined)
    for (const entity of harvest.entities) {
      if (conflictedEntityKeys.has(entity.entityKey)) {
        duplicateRows += 1
        quarantinedRows += 1
        quarantined.push(rowQuarantine(
          document,
          entity.name,
          entity.programCode,
          entity.evidence.page,
          entity.evidence.lineStart,
          entity.evidence.lineEnd,
          ['conflicting_duplicate_entity_key'],
        ))
        continue
      }
      const existing = entitiesByKey.get(entity.entityKey)
      if (!existing) {
        entitiesByKey.set(entity.entityKey, entity)
        continue
      }
      duplicateRows += 1
      if (
        normalizeIdentity(existing.name) !== normalizeIdentity(entity.name) ||
        existing.officialUrl !== entity.officialUrl
      ) {
        entitiesByKey.delete(entity.entityKey)
        conflictedEntityKeys.add(entity.entityKey)
        quarantined.push(rowQuarantine(
          document,
          existing.name,
          existing.programCode,
          existing.evidence.page,
          existing.evidence.lineStart,
          existing.evidence.lineEnd,
          ['conflicting_duplicate_entity_key'],
        ))
        quarantinedRows += 2
        quarantined.push(rowQuarantine(
          document,
          entity.name,
          entity.programCode,
          entity.evidence.page,
          entity.evidence.lineStart,
          entity.evidence.lineEnd,
          ['conflicting_duplicate_entity_key'],
        ))
      }
    }
  }

  const entities = [...entitiesByKey.values()]
    .sort((left, right) => left.entityKey.localeCompare(right.entityKey))
  return {
    parserVersion: 'pku-pdf-directory-v1',
    sourceType: 'official_pdf_directory',
    indexUrl: index.indexUrl,
    institutionId,
    checkedAt,
    degreeLevel,
    instructionLanguage,
    entities,
    quarantined,
    reconciliation: {
      indexAnchors: index.anchorsFound,
      acceptedDocuments: index.documents.length,
      loadedDocuments,
      missingDocuments,
      quarantinedIndexAnchors: index.quarantined.length,
      quarantinedDocuments,
      programCandidates,
      verifiedRows: entities.length,
      quarantinedRows,
      duplicateRows,
      uniqueVerifiedPrograms: entities.length,
      verificationRate: aggregateRate(entities.length, programCandidates),
      documentCoverageRate: aggregateRate(
        loadedDocuments - quarantinedDocuments,
        index.documents.length,
      ),
    },
  }
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function requiredArgument(name: string): string {
  const value = argument(name)
  if (!value) throw new Error(`Missing required argument ${name}`)
  return value
}

async function main(): Promise<void> {
  const outputPath = resolve(requiredArgument('--output'))
  const result = harvestPkuCatalogDirectory({
    indexHtml: readFileSync(resolve(requiredArgument('--index-html')), 'utf8'),
    pdfDirectory: requiredArgument('--pdf-dir'),
    indexUrl: requiredArgument('--index-url'),
    institutionId: argument('--institution-id') ?? 'uni-peking-university',
    degreeLevel: validateDegreeLevel(requiredArgument('--degree-level')),
    instructionLanguage: validateInstructionLanguage(
      requiredArgument('--instruction-language'),
    ),
    checkedAt: validateCheckedAt(requiredArgument('--checked-at')),
    pdftotextPath: argument('--pdftotext'),
  })
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify({
    output: outputPath,
    verified: result.reconciliation.uniqueVerifiedPrograms,
    acceptedDocuments: result.reconciliation.acceptedDocuments,
    loadedDocuments: result.reconciliation.loadedDocuments,
    quarantinedDocuments: result.reconciliation.quarantinedDocuments,
    quarantinedRows: result.reconciliation.quarantinedRows,
    verificationRate: result.reconciliation.verificationRate,
    documentCoverageRate: result.reconciliation.documentCoverageRate,
  })}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
