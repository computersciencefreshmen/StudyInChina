import { htmlToText, normalizeEvidenceText } from './rules'
import { assertSafeSourceUrl } from './security'
import type { Evidence, SourceCategory } from './types'

export type CatalogEntityKind = 'program' | 'scholarship'

export type CatalogDegreeLevel =
  | 'bachelor'
  | 'master'
  | 'doctorate'
  | 'language'
  | 'foundation'

export type OfficialCatalogCandidate = {
  kind: CatalogEntityKind
  name: string
  degreeLevel: CatalogDegreeLevel | null
  anchorText: string | null
  officialUrl: string
  evidence: Evidence
}

export type OfficialCatalogParserOptions = {
  sourceUrl: string | URL
  allowedHosts: readonly string[]
  sourceCategory?: SourceCategory
  expectedKind?: CatalogEntityKind | 'auto'
  maxCandidates?: number
}

const DEFAULT_MAX_CANDIDATES = 500
const HARD_MAX_CANDIDATES = 2_000
const MAX_HTML_CHARACTERS = 5_000_000
const MAX_NAME_CHARACTERS = 240
const MAX_EVIDENCE_CHARACTERS = 600

const SCHOLARSHIP_CATEGORIES = new Set<SourceCategory>([
  'university_scholarship',
  'faculty_scholarship',
  'government_scholarship',
])

const PROGRAM_CATEGORIES = new Set<SourceCategory>([
  'undergraduate_catalog',
  'masters_catalog',
  'doctoral_catalog',
  'non_degree_catalog',
  'program_detail',
])

const GENERIC_LABELS = new Set([
  'admission',
  'admissions',
  'admission guide',
  'apply',
  'apply now',
  'catalog',
  'catalogue',
  'click here',
  'contact',
  'contacts',
  'details',
  'download',
  'home',
  'international admissions',
  'learn more',
  'more',
  'news',
  'program',
  'programs',
  'programme',
  'programmes',
  'read more',
  'scholarship',
  'scholarships',
  'view',
  'view details',
  '下载',
  '了解更多',
  '国际招生',
  '奖学金',
  '招生',
  '招生信息',
  '招生简章',
  '查看更多',
  '查看',
  '查看详情',
  '申请',
  '立即申请',
  '项目',
  '项目列表',
  '首页',
  'about',
  'about us',
  'contact us',
  'departments',
  'faq',
  'faculty',
  'how to apply',
  'login',
  'notices',
  'register',
  'schools',
  'schools and departments',
  '\u7f51\u7ad9\u5730\u56fe',
  '\u9662\u7cfb',
  '\u9662\u7cfb\u8bbe\u7f6e',
  '\u767b\u5f55',
  '\u6ce8\u518c',
])

const NON_NAME_VALUES = [
  /^(?:no\.?|number|序号|编号)$/iu,
  /^\d+(?:[.)、-]\d+)*$/u,
  /^(?:english|chinese|中文|英文|汉语)$/iu,
  /^(?:full[- ]?time|part[- ]?time|全日制|非全日制)$/iu,
  /^\d+(?:\.\d+)?\s*(?:years?|months?|semesters?|年|个月|学期)$/iu,
  /^(?:cny|rmb|usd|人民币|￥|¥)?\s*[\d,.]+(?:\s*(?:元|\/.*))?$/iu,
]

const SCHOLARSHIP_SIGNAL =
  /(?:\b(?:scholarship|fellowship|studentship)\b|奖学金|助学金|奖助学金|资助计划)/iu
const PROGRAM_SIGNAL =
  /(?:\b(?:degree|major|program|programme|summer school|exchange program|visiting program)\b|专业|项目|课程|交换生|访问学生|访学)/iu
const DIRECTORY_OR_GUIDE_SIGNAL =
  /(?:\b(?:all programs?|application (?:guide|procedure|schedule)|catalog(?:ue)?|degree programs?|program(?:me)?s? (?:catalog(?:ue)?|directory|list|overview)|admission schedule|eligibility|fees?|funding overview|scholarship (?:categories|directory|list|overview|programs?)|schools? (?:&|and) departments?)\b|(?:bachelor'?s?|master'?s?|ph\.?\s*d\.?|doctoral|undergraduate|graduate)\s+(?:program(?:me)?s|scholarships?)\b|\u62db\u751f\u7b80\u7ae0|\u9879\u76ee\u76ee\u5f55|\u4e13\u4e1a\u76ee\u5f55|\u9879\u76ee\u5217\u8868|\u4e13\u4e1a\u5217\u8868|\u7533\u8bf7\u6307\u5357|\u7533\u8bf7\u65e5\u7a0b|\u7533\u8bf7\u8d44\u683c|\u5b66\u8d39|\u5956\u5b66\u91d1\u76ee\u5f55|\u5956\u5b66\u91d1\u5217\u8868|\u9662\u7cfb\u8bbe\u7f6e)/iu
const SECTION_HEADING_SIGNAL =
  /^(?:(?:bachelor'?s?|master'?s?|ph\.?\s*d\.?|doctoral|undergraduate|graduate)\s+scholarships?|(?:degree|undergraduate|graduate|master'?s?|doctoral|ph\.?\s*d\.?)\s+program(?:me)?s)$/iu
const PROGRAM_TABLE_HEADER =
  /^(?:program(?:me)?s?(?:\s+(?:name|title))?|majors?(?:\s+(?:name|title))?|degree(?:s?|\s+program(?:me)?s?)(?:\s+(?:name|title))?|name\s+of\s+(?:program(?:me)?|major|degree)|\u4e13\u4e1a(?:\u540d\u79f0)?|\u9879\u76ee(?:\u540d\u79f0)?|\u5b66\u4f4d(?:\u540d\u79f0)?|\u4e13\u4e1a\/\u9879\u76ee)$/iu
const SCHOLARSHIP_TABLE_HEADER =
  /^(?:scholarships?(?:\s+(?:name|title|program(?:me)?s?))?|funding(?:\s+(?:name|title|opportunities))?|awards?(?:\s+(?:name|title))?|name\s+of\s+(?:scholarship|funding|award)|\u5956\u5b66\u91d1(?:\u540d\u79f0)?|\u8d44\u52a9(?:\u540d\u79f0)?|\u5956\u9879(?:\u540d\u79f0)?)$/iu
const GENERIC_NAME_TABLE_HEADER = /^(?:name|title|\u540d\u79f0)$/iu
const NAVIGATION_CONTAINER_TAGS = new Set(['nav', 'header', 'footer', 'aside'])
const VOID_HTML_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
])

type ParsedAnchor = {
  href: string
  text: string
  position: number
}

type PendingCandidate = {
  candidate: OfficialCatalogCandidate
  position: number
  linked: boolean
}

type TableCell = {
  text: string
  html: string
}

type EntityColumn = {
  index: number
  kind: CatalogEntityKind
}

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/giu, (entity, token: string) => {
    const normalized = token.toLowerCase()
    const named: Record<string, string> = {
      amp: '&',
      apos: "'",
      gt: '>',
      lt: '<',
      nbsp: ' ',
      quot: '"',
    }
    if (named[normalized]) return named[normalized]
    const radix = normalized.startsWith('#x') ? 16 : 10
    const digits = normalized.startsWith('#x')
      ? normalized.slice(2)
      : normalized.startsWith('#')
        ? normalized.slice(1)
        : ''
    if (!digits) return entity
    const codePoint = Number.parseInt(digits, radix)
    if (
      !Number.isInteger(codePoint) ||
      codePoint < 0 ||
      codePoint > 0x10ffff ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff)
    ) return entity
    return String.fromCodePoint(codePoint)
  })
}

function navigationAttributeValue(attributes: string): boolean {
  const pattern = /\b(class|id|role)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/giu
  for (const match of attributes.matchAll(pattern)) {
    const name = match[1]?.toLowerCase()
    const value = decodeHtmlEntities(match[2] ?? match[3] ?? match[4] ?? '')
      .normalize('NFKC')
      .toLowerCase()
      .trim()
    if (name === 'role' && /^(?:navigation|menu|menubar)$/u.test(value)) return true
    if (
      (name === 'class' || name === 'id') &&
      /(?:^|[\s_-])(?:nav(?:bar|igation)?|menu|submenu|breadcrumb|pagination|pager|sidebar|site-header|site-footer|topbar|mobile-nav)(?:$|[\s_-])/u.test(` ${value} `)
    ) return true
  }
  return false
}

function maskRanges(value: string, ranges: Array<[number, number]>): string {
  if (ranges.length === 0) return value
  const merged: Array<[number, number]> = []
  for (const [start, end] of ranges.sort((left, right) => left[0] - right[0])) {
    const previous = merged.at(-1)
    if (previous && start <= previous[1]) {
      previous[1] = Math.max(previous[1], end)
    } else {
      merged.push([start, end])
    }
  }
  const parts: string[] = []
  let cursor = 0
  for (const [start, end] of merged) {
    parts.push(value.slice(cursor, start), ' '.repeat(Math.max(0, end - start)))
    cursor = end
  }
  parts.push(value.slice(cursor))
  return parts.join('')
}

function maskNavigationContainers(value: string): string {
  const stack: Array<{
    tag: string
    start: number
    excluded: boolean
    rootExcluded: boolean
  }> = []
  const ranges: Array<[number, number]> = []
  const pattern = /<(\/)?([a-z][a-z0-9:-]*)\b([^>]*)>/giu
  for (const match of value.matchAll(pattern)) {
    const closing = match[1] === '/'
    const tag = (match[2] ?? '').toLowerCase()
    if (closing) {
      let stackIndex = stack.length - 1
      while (stackIndex >= 0 && stack[stackIndex]?.tag !== tag) stackIndex -= 1
      if (stackIndex < 0) continue
      const entry = stack[stackIndex]!
      stack.splice(stackIndex)
      if (entry.rootExcluded) {
        ranges.push([entry.start, (match.index ?? 0) + match[0].length])
      }
      continue
    }
    const attributes = match[3] ?? ''
    const selfClosing = /\/\s*>$/u.test(match[0]) || VOID_HTML_TAGS.has(tag)
    if (selfClosing) continue
    const parentExcluded = stack.at(-1)?.excluded === true
    const selfExcluded =
      NAVIGATION_CONTAINER_TAGS.has(tag) || navigationAttributeValue(attributes)
    stack.push({
      tag,
      start: match.index ?? 0,
      excluded: parentExcluded || selfExcluded,
      rootExcluded: selfExcluded && !parentExcluded,
    })
  }
  for (const entry of stack) {
    if (entry.rootExcluded) ranges.push([entry.start, value.length])
  }
  return maskRanges(value, ranges)
}

function boundedHtml(value: string): string {
  const bounded = value.slice(0, MAX_HTML_CHARACTERS)
  const inert = bounded
    .replace(/<!--[\s\S]*?-->/g, (match) => ' '.repeat(match.length))
    .replace(
      /<(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/giu,
      (match) => ' '.repeat(match.length),
    )
  return maskNavigationContainers(inert)
}

function cleanText(value: string): string {
  return normalizeEvidenceText(htmlToText(value))
}

function cleanName(value: string): string {
  return cleanText(value)
    .replace(/^(?:[\s•·▪●◆◇]+|\d{1,4}\s*[.)、．-]\s*)/u, '')
    .replace(/\s+(?:details?|more|apply|查看详情|申请)$/iu, '')
    .trim()
    .slice(0, MAX_NAME_CHARACTERS)
}

function normalizedNameKey(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

function isGenericLabel(value: string): boolean {
  return GENERIC_LABELS.has(normalizedNameKey(value))
}

function isPlausibleName(value: string): boolean {
  const normalized = cleanName(value)
  if (normalized.length < 2 || normalized.length > MAX_NAME_CHARACTERS) return false
  if (isGenericLabel(normalized)) return false
  if (NON_NAME_VALUES.some((pattern) => pattern.test(normalized))) return false
  return /[\p{L}]/u.test(normalized)
}

function hrefAttribute(attributes: string): string | null {
  const match = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/iu.exec(attributes)
  const raw = match?.[1] ?? match?.[2] ?? match?.[3]
  return raw === undefined ? null : decodeHtmlEntities(raw.trim())
}

function anchorsIn(fragment: string, fragmentPosition: number): ParsedAnchor[] {
  const anchors: ParsedAnchor[] = []
  const pattern = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/giu
  for (const match of fragment.matchAll(pattern)) {
    const href = hrefAttribute(match[1] ?? '')
    if (!href) continue
    anchors.push({
      href,
      text: cleanName(match[2] ?? ''),
      position: fragmentPosition + (match.index ?? 0),
    })
  }
  return anchors
}

function normalizedOfficialUrl(
  href: string,
  sourceUrl: URL,
  allowedHosts: readonly string[],
): string | null {
  if (!href || href.startsWith('#')) return null
  try {
    const resolved = new URL(href, sourceUrl)
    const safe = assertSafeSourceUrl(resolved, [...allowedHosts])
    safe.hash = ''
    return safe.href
  } catch {
    return null
  }
}

function categoryKind(category: SourceCategory | undefined): CatalogEntityKind | null {
  if (category && SCHOLARSHIP_CATEGORIES.has(category)) return 'scholarship'
  if (category && PROGRAM_CATEGORIES.has(category)) return 'program'
  return null
}

function hintedKind(options: OfficialCatalogParserOptions): CatalogEntityKind | null {
  const sourceKind = categoryKind(options.sourceCategory)
  if (sourceKind) return sourceKind
  if (options.expectedKind && options.expectedKind !== 'auto') {
    return options.expectedKind
  }
  return null
}

function classifyKind(
  name: string,
  hint: CatalogEntityKind | null,
): CatalogEntityKind | null {
  const scholarship = SCHOLARSHIP_SIGNAL.test(name)
  const program = PROGRAM_SIGNAL.test(name) || inferDegreeLevel(name) !== null
  if (hint === 'program') {
    return scholarship ? null : 'program'
  }
  if (hint === 'scholarship') {
    return program && !scholarship ? null : 'scholarship'
  }
  if (scholarship && !program) return 'scholarship'
  if (program && !scholarship) return 'program'
  if (scholarship && program) return 'scholarship'
  return null
}

export function inferDegreeLevel(value: string): CatalogDegreeLevel | null {
  const text = normalizeEvidenceText(value)
  const degreeMatches: CatalogDegreeLevel[] = []
  if (
    /(?:\b(?:bachelor(?:'s)?|undergraduate)\b|本科|学士)/iu.test(text) ||
    /\b(?:BSc|BEng|BA|MBBS)\b/u.test(text)
  ) degreeMatches.push('bachelor')
  if (
    /(?:\bmaster(?:'s)?\b|硕士)/iu.test(text) ||
    /\b(?:MSc|MEng|MBA|LLM|MA)\b/u.test(text)
  ) degreeMatches.push('master')
  if (
    /(?:\b(?:doctoral|doctorate|doctor of philosophy)\b|博士)/iu.test(text) ||
    /\bPh\.?\s*D\.?\b/iu.test(text)
  ) degreeMatches.push('doctorate')
  if (degreeMatches.length === 1) return degreeMatches[0] ?? null
  if (degreeMatches.length > 1) return null

  const foundation =
    /(?:\b(?:foundation|preparatory|pre-university)\s+(?:program|programme|course)\b|预科)/iu.test(text)
  const language =
    /(?:\b(?:chinese|mandarin)\s+language\s+(?:program|programme|course|training)\b|(?:汉语|中文)(?:进修|项目|课程|培训|班))/iu.test(text)
  if (foundation === language) return null
  return foundation ? 'foundation' : 'language'
}

function categoryDegreeLevel(category: SourceCategory | undefined): CatalogDegreeLevel | null {
  if (category === 'undergraduate_catalog') return 'bachelor'
  if (category === 'masters_catalog') return 'master'
  if (category === 'doctoral_catalog') return 'doctorate'
  return null
}

function evidenceQuote(fragment: string): string {
  return cleanText(fragment).slice(0, MAX_EVIDENCE_CHARACTERS)
}

function rowCells(row: string): TableCell[] {
  const cells: TableCell[] = []
  const pattern = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]\s*>/giu
  for (const match of row.matchAll(pattern)) {
    const html = match[1] ?? ''
    cells.push({ html, text: cleanName(html) })
  }
  return cells
}

function headerColumnKind(
  value: string,
  hint: CatalogEntityKind | null,
): CatalogEntityKind | null {
  const header = cleanName(value)
  const program = PROGRAM_TABLE_HEADER.test(header)
  const scholarship = SCHOLARSHIP_TABLE_HEADER.test(header)
  if (hint === 'program') return program || GENERIC_NAME_TABLE_HEADER.test(header) ? hint : null
  if (hint === 'scholarship') {
    return scholarship || GENERIC_NAME_TABLE_HEADER.test(header) ? hint : null
  }
  if (program !== scholarship) return program ? 'program' : 'scholarship'
  return null
}

function entityColumnsForTable(
  table: string,
  hint: CatalogEntityKind | null,
): EntityColumn[] {
  for (const match of table.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr\s*>/giu)) {
    const row = match[0]
    if (!/<th\b/iu.test(row)) continue
    const columns = rowCells(row)
      .map((cell, index) => ({ index, kind: headerColumnKind(cell.text, hint) }))
      .filter((column): column is EntityColumn => column.kind !== null)
    if (columns.length > 0) return columns
  }
  return []
}

function bestContextName(anchorText: string, cells: string[], fallback: string): string | null {
  if (isPlausibleName(anchorText) && !isGenericLabel(anchorText)) return cleanName(anchorText)
  const contextual = cells.find((cell) => isPlausibleName(cell) && !isGenericLabel(cell))
  if (contextual) return cleanName(contextual)
  const cleanedFallback = cleanName(fallback)
  return isPlausibleName(cleanedFallback) ? cleanedFallback : null
}

function addPending(
  pending: PendingCandidate[],
  input: {
    name: string | null
    anchorText: string | null
    officialUrl: string
    context: string
    locator: string
    position: number
    linked: boolean
    allowHintOnly: boolean
  },
  hint: CatalogEntityKind | null,
  category: SourceCategory | undefined,
): void {
  if (!input.name || !isPlausibleName(input.name)) return
  if (DIRECTORY_OR_GUIDE_SIGNAL.test(input.name)) return
  if (SECTION_HEADING_SIGNAL.test(input.name)) return
  const kind = classifyKind(input.name, hint)
  if (!kind) return
  const hasProgramSignal =
    PROGRAM_SIGNAL.test(input.name) || inferDegreeLevel(input.name) !== null
  const hasScholarshipSignal = SCHOLARSHIP_SIGNAL.test(input.name)
  if (kind === 'program' && !hasProgramSignal && !input.allowHintOnly) return
  if (kind === 'scholarship' && !hasScholarshipSignal && !input.allowHintOnly) {
    return
  }
  const categoryLevel = categoryDegreeLevel(category)
  const inferredLevel = kind === 'program'
    ? inferDegreeLevel(input.name) ?? categoryLevel
    : null
  pending.push({
    position: input.position,
    linked: input.linked,
    candidate: {
      kind,
      name: input.name,
      degreeLevel: inferredLevel,
      anchorText: input.anchorText && cleanName(input.anchorText)
        ? cleanName(input.anchorText)
        : null,
      officialUrl: input.officialUrl,
      evidence: {
        quote: evidenceQuote(input.context),
        locator: input.locator,
      },
    },
  })
}

function validateLimit(value: number | undefined): number {
  const limit = value ?? DEFAULT_MAX_CANDIDATES
  if (!Number.isInteger(limit) || limit < 1 || limit > HARD_MAX_CANDIDATES) {
    throw new Error(`maxCandidates must be an integer from 1 to ${HARD_MAX_CANDIDATES}`)
  }
  return limit
}

export function parseOfficialCatalogHtml(
  html: string,
  options: OfficialCatalogParserOptions,
): OfficialCatalogCandidate[] {
  const maxCandidates = validateLimit(options.maxCandidates)
  const sourceUrl = assertSafeSourceUrl(options.sourceUrl, [...options.allowedHosts])
  sourceUrl.hash = ''
  const safeSourceUrl = sourceUrl.href
  const document = boundedHtml(html)
  const hint = hintedKind(options)
  const pending: PendingCandidate[] = []

  let rowNumber = 0
  for (const tableMatch of document.matchAll(/<table\b[^>]*>[\s\S]*?<\/table\s*>/giu)) {
    const table = tableMatch[0]
    const tablePosition = tableMatch.index ?? 0
    const entityColumns = entityColumnsForTable(table, hint)
    for (const rowMatch of table.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr\s*>/giu)) {
      rowNumber += 1
      const fragment = rowMatch[0]
      if (!/<td\b/iu.test(fragment)) continue
      const position = tablePosition + (rowMatch.index ?? 0)
      const context = cleanText(fragment)
      const cells = rowCells(fragment)
      const rowAnchors = anchorsIn(fragment, position)
        .map((anchor, index) => ({
          ...anchor,
          anchorNumber: index + 1,
          officialUrl: normalizedOfficialUrl(anchor.href, sourceUrl, options.allowedHosts),
        }))
        .filter((anchor): anchor is ParsedAnchor & {
          anchorNumber: number
          officialUrl: string
        } => anchor.officialUrl !== null)
      const columns = entityColumns.length > 0
        ? entityColumns
        : cells.flatMap((cell, index) => {
            const kind = classifyKind(cell.text, hint)
            const hasSignal = SCHOLARSHIP_SIGNAL.test(cell.text) ||
              PROGRAM_SIGNAL.test(cell.text) || inferDegreeLevel(cell.text) !== null
            return kind && hasSignal ? [{ index, kind }] : []
          })

      for (const column of columns) {
        const cell = cells[column.index]
        if (!cell) continue
        const cellUrls = new Set(
          anchorsIn(cell.html, 0)
            .map((anchor) => normalizedOfficialUrl(
              anchor.href,
              sourceUrl,
              options.allowedHosts,
            ))
            .filter((url): url is string => url !== null),
        )
        const linkedAnchor = rowAnchors.find((anchor) => cellUrls.has(anchor.officialUrl))
          ?? rowAnchors.find((anchor) => isGenericLabel(anchor.text))
          ?? rowAnchors[0]
          ?? null
        const name = bestContextName(
          linkedAnchor && !isGenericLabel(linkedAnchor.text) ? linkedAnchor.text : '',
          [cell.text],
          cell.text,
        )
        addPending(pending, {
          name,
          anchorText: linkedAnchor?.text || null,
          officialUrl: linkedAnchor?.officialUrl ?? safeSourceUrl,
          context,
          locator: linkedAnchor
            ? `html:table-row[${rowNumber}]/a[${linkedAnchor.anchorNumber}]`
            : `html:table-row[${rowNumber}]`,
          position: linkedAnchor?.position ?? position,
          linked: linkedAnchor !== null,
          allowHintOnly: entityColumns.length > 0,
        }, column.kind, options.sourceCategory)
      }
    }
  }

  let listItemNumber = 0
  for (const match of document.matchAll(/<li\b[^>]*>[\s\S]*?<\/li\s*>/giu)) {
    listItemNumber += 1
    const fragment = match[0]
    const position = match.index ?? 0
    const context = cleanText(fragment)
    let anchorNumber = 0
    for (const anchor of anchorsIn(fragment, position)) {
      anchorNumber += 1
      const officialUrl = normalizedOfficialUrl(anchor.href, sourceUrl, options.allowedHosts)
      if (!officialUrl) continue
      addPending(pending, {
        name: bestContextName(anchor.text, [], context),
        anchorText: anchor.text || null,
        officialUrl,
        context,
        locator: `html:list-item[${listItemNumber}]/a[${anchorNumber}]`,
        position: anchor.position,
        linked: true,
        allowHintOnly: false,
      }, hint, options.sourceCategory)
    }
  }

  let headingNumber = 0
  for (const match of document.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/giu)) {
    headingNumber += 1
    const fragment = match[0]
    const inner = match[2] ?? ''
    const position = match.index ?? 0
    const context = cleanText(fragment)
    const anchors = anchorsIn(fragment, position)
    if (anchors.length === 0) {
      const name = cleanName(inner)
      const hasEntitySignal =
        SCHOLARSHIP_SIGNAL.test(name) ||
        PROGRAM_SIGNAL.test(name) ||
        inferDegreeLevel(name) !== null
      if (!hasEntitySignal) continue
      addPending(pending, {
        name,
        anchorText: null,
        officialUrl: safeSourceUrl,
        context,
        locator: `html:heading[${headingNumber}]`,
        position,
        linked: false,
        allowHintOnly: false,
      }, hint, options.sourceCategory)
      continue
    }
    let anchorNumber = 0
    for (const anchor of anchors) {
      anchorNumber += 1
      const officialUrl = normalizedOfficialUrl(anchor.href, sourceUrl, options.allowedHosts)
      if (!officialUrl) continue
      addPending(pending, {
        name: bestContextName(anchor.text, [], context),
        anchorText: anchor.text || null,
        officialUrl,
        context,
        locator: `html:heading[${headingNumber}]/a[${anchorNumber}]`,
        position: anchor.position,
        linked: true,
        allowHintOnly: false,
      }, hint, options.sourceCategory)
    }
  }

  const deduplicated = new Map<string, PendingCandidate>()
  for (const item of pending.sort((left, right) => left.position - right.position)) {
    const key = [
      item.candidate.kind,
      item.candidate.degreeLevel ?? '',
      normalizedNameKey(item.candidate.name),
    ].join(':')
    const existing = deduplicated.get(key)
    if (!existing || (!existing.linked && item.linked)) {
      deduplicated.set(key, item)
    }
  }
  return [...deduplicated.values()]
    .sort((left, right) => left.position - right.position)
    .slice(0, maxCandidates)
    .map((item) => item.candidate)
}
