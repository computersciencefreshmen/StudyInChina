import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export type ZjuDegreeLevel = 'bachelor' | 'master' | 'doctorate'
export type ZjuInstructionLanguage = 'Chinese' | 'English'

export type ZjuPdfBoundingBox = {
  left: number
  top: number
  width: number
  height: number
}

export type ZjuProgramTuition = {
  amount: number
  currency: 'CNY'
  period: 'year' | 'whole_program'
  raw: string
}

export type ZjuProgramEvidence = {
  page: number
  lineStart: number
  lineEnd: number
  bbox: ZjuPdfBoundingBox
  departmentBbox: ZjuPdfBoundingBox
  locator: string
  quote: string
  officialUrl: string
  checkedAt: string
}

export type ZjuPdfProgramEntity = {
  entityKey: string
  entityType: 'program'
  institutionId: string
  programType: 'degree'
  degreeLevel: ZjuDegreeLevel
  instructionLanguage: ZjuInstructionLanguage
  name: string
  department: string
  durationYears: number | null
  tuition: ZjuProgramTuition | null
  officialUrl: string
  sourceCheckedAt: string
  verificationStatus: 'verified'
  confidence: number
  warnings: string[]
  evidence: ZjuProgramEvidence
}

export type ZjuQuarantinedPdfRow = {
  status: 'quarantined'
  page: number
  candidateName: string | null
  reasons: string[]
  locator: string
  bbox: ZjuPdfBoundingBox
}

export type ZjuPdfCatalogReconciliation = {
  tsvRows: number
  malformedTsvRows: number
  wordRows: number
  pages: number
  tableHeaderPages: number
  programCandidateRows: number
  durationObservations: number
  tuitionObservations: number
  verifiedRows: number
  quarantinedRows: number
  quarantinedFieldFacts: number
  duplicateRows: number
  orphanDurationRows: number
  verificationRate: number
}

export type ZjuPdfCatalogHarvest = {
  parserVersion: 'zju-pdf-tsv-v1'
  sourceType: 'official_pdf'
  sourcePdfName: string | null
  officialUrl: string
  institutionId: string
  checkedAt: string
  degreeLevel: ZjuDegreeLevel
  instructionLanguage: ZjuInstructionLanguage
  entities: ZjuPdfProgramEntity[]
  quarantined: ZjuQuarantinedPdfRow[]
  reconciliation: ZjuPdfCatalogReconciliation
}

export type ParseZjuPdfCatalogOptions = {
  officialUrl: string
  institutionId: string
  checkedAt: string
  degreeLevel: ZjuDegreeLevel
  instructionLanguage: ZjuInstructionLanguage
  sourcePdfName?: string
}

export type HarvestZjuPdfCatalogOptions = ParseZjuPdfCatalogOptions & {
  pdfPath: string
  pdftotextPath?: string
}

type TsvWord = {
  page: number
  block: number
  paragraph: number
  sourceLine: number
  word: number
  left: number
  top: number
  width: number
  height: number
  text: string
}

type SourceLine = {
  key: string
  page: number
  top: number
  left: number
  words: TsvWord[]
  text: string
  bbox: ZjuPdfBoundingBox
}

type PhysicalLine = SourceLine & {
  lineNumber: number
}

type Layout = {
  durationStart: number
  tuitionStart: number
  requirementsStart: number
  programStart: number
  headerBottomByPage: Map<number, number>
  headerPages: Set<number>
}

type DurationObservation = {
  page: number
  top: number
  durationYears: number
  words: TsvWord[]
  bbox: ZjuPdfBoundingBox
  lineNumber: number
}

type TuitionObservation = {
  page: number
  top: number
  tuition: ZjuProgramTuition
  words: TsvWord[]
  bbox: ZjuPdfBoundingBox
  lineStart: number
  lineEnd: number
}

type ProgramCluster = {
  page: number
  top: number
  name: string
  lines: PhysicalLine[]
  words: TsvWord[]
  bbox: ZjuPdfBoundingBox
}

type DepartmentCandidate = {
  page: number
  name: string
  centerTop: number
  lines: PhysicalLine[]
  words: TsvWord[]
  bbox: ZjuPdfBoundingBox
}

type DepartmentAssignment = {
  department: DepartmentCandidate | null
  ambiguous: boolean
}

const MAX_PROCESS_BUFFER_BYTES = 128 * 1024 * 1024
const PHYSICAL_LINE_TOP_TOLERANCE = 2.5
const WRAPPED_LINE_GAP = 16
const MAX_FACT_DISTANCE = 48

function round(value: number, precision = 2): number {
  const scale = 10 ** precision
  return Math.round(value * scale) / scale
}

function unionBox(words: readonly TsvWord[]): ZjuPdfBoundingBox {
  if (words.length === 0) return { left: 0, top: 0, width: 0, height: 0 }
  const left = Math.min(...words.map((word) => word.left))
  const top = Math.min(...words.map((word) => word.top))
  const right = Math.max(...words.map((word) => word.left + word.width))
  const bottom = Math.max(...words.map((word) => word.top + word.height))
  return {
    left: round(left),
    top: round(top),
    width: round(right - left),
    height: round(bottom - top),
  }
}

function centerTop(box: ZjuPdfBoundingBox): number {
  return box.top + box.height / 2
}

function normalizeText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\s+([,.;:)\]])/gu, '$1')
    .replace(/([(\[])\s+/gu, '$1')
    .replace(/\s+/gu, ' ')
    .trim()
}

function wordsText(words: readonly TsvWord[]): string {
  return normalizeText(
    [...words]
      .sort((left, right) => left.left - right.left || left.word - right.word)
      .map((word) => word.text)
      .join(' '),
  )
}

function validateOfficialUrl(value: string): string {
  const url = new URL(value)
  const host = url.hostname.toLowerCase()
  if (
    url.protocol !== 'https:' ||
    (host !== 'zju.edu.cn' && !host.endsWith('.zju.edu.cn'))
  ) {
    throw new Error('officialUrl must be an HTTPS Zhejiang University URL')
  }
  url.hash = ''
  return url.href
}

function validateInstitutionId(value: string): string {
  if (!/^[a-z0-9][a-z0-9-]{2,127}$/u.test(value)) {
    throw new Error('institutionId must be a stable lowercase identifier')
  }
  return value
}

function validateCheckedAt(value: string): string {
  if (Number.isNaN(Date.parse(value))) throw new Error('checkedAt must be an ISO timestamp')
  return value
}

function validateDegreeLevel(value: string): ZjuDegreeLevel {
  if (value === 'bachelor' || value === 'master' || value === 'doctorate') return value
  throw new Error('degreeLevel must be bachelor, master, or doctorate')
}

function validateInstructionLanguage(value: string): ZjuInstructionLanguage {
  if (value === 'Chinese' || value === 'English') return value
  throw new Error('instructionLanguage must be Chinese or English')
}

function numericCell(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function parseTsvWords(tsv: string): {
  words: TsvWord[]
  tsvRows: number
  malformedTsvRows: number
} {
  const rows = tsv.replace(/^\uFEFF/u, '').split(/\r?\n/u)
  const headerIndex = rows.findIndex((row) => row.trim() !== '')
  if (headerIndex < 0) throw new Error('pdftotext TSV is empty')
  const header = rows[headerIndex]!.split('\t')
  const column = (name: string): number => {
    const index = header.indexOf(name)
    if (index < 0) throw new Error(`pdftotext TSV is missing the ${name} column`)
    return index
  }
  const indices = {
    level: column('level'),
    page: column('page_num'),
    block: column('block_num'),
    paragraph: column('par_num'),
    line: column('line_num'),
    word: column('word_num'),
    left: column('left'),
    top: column('top'),
    width: column('width'),
    height: column('height'),
    text: column('text'),
  }
  const words: TsvWord[] = []
  let malformedTsvRows = 0
  let tsvRows = 0
  for (const row of rows.slice(headerIndex + 1)) {
    if (!row.trim()) continue
    tsvRows += 1
    const cells = row.split('\t')
    if (cells[indices.level] !== '5') continue
    const page = numericCell(cells[indices.page])
    const block = numericCell(cells[indices.block])
    const paragraph = numericCell(cells[indices.paragraph])
    const sourceLine = numericCell(cells[indices.line])
    const word = numericCell(cells[indices.word])
    const left = numericCell(cells[indices.left])
    const top = numericCell(cells[indices.top])
    const width = numericCell(cells[indices.width])
    const height = numericCell(cells[indices.height])
    const text = cells.slice(indices.text).join('\t').trim()
    if (
      page === null ||
      block === null ||
      paragraph === null ||
      sourceLine === null ||
      word === null ||
      left === null ||
      top === null ||
      width === null ||
      height === null ||
      !text ||
      text.startsWith('###')
    ) {
      malformedTsvRows += 1
      continue
    }
    words.push({
      page,
      block,
      paragraph,
      sourceLine,
      word,
      left,
      top,
      width,
      height,
      text,
    })
  }
  if (words.length === 0) throw new Error('pdftotext TSV contains no word rows')
  return { words, tsvRows, malformedTsvRows }
}

function buildSourceLines(words: readonly TsvWord[]): SourceLine[] {
  const groups = new Map<string, TsvWord[]>()
  for (const word of words) {
    const key = `${word.page}:${word.block}:${word.paragraph}:${word.sourceLine}`
    const group = groups.get(key) ?? []
    group.push(word)
    groups.set(key, group)
  }
  return [...groups.entries()]
    .map(([key, group]) => {
      const sorted = [...group].sort((left, right) => left.left - right.left || left.word - right.word)
      const bbox = unionBox(sorted)
      return {
        key,
        page: sorted[0]!.page,
        top: bbox.top,
        left: bbox.left,
        words: sorted,
        text: wordsText(sorted),
        bbox,
      }
    })
    .sort((left, right) => (
      left.page - right.page ||
      left.top - right.top ||
      left.left - right.left
    ))
}

function buildPhysicalLines(words: readonly TsvWord[]): PhysicalLine[] {
  const byPage = Map.groupBy(words, (word) => word.page)
  const lines: PhysicalLine[] = []
  for (const [page, pageWords] of [...byPage.entries()].sort(([left], [right]) => left - right)) {
    const sorted = [...pageWords].sort((left, right) => (
      left.top - right.top ||
      left.left - right.left ||
      left.word - right.word
    ))
    const groups: TsvWord[][] = []
    for (const word of sorted) {
      const current = groups.at(-1)
      if (
        current &&
        Math.abs(word.top - current.reduce((sum, item) => sum + item.top, 0) / current.length) <=
          PHYSICAL_LINE_TOP_TOLERANCE
      ) {
        current.push(word)
      } else {
        groups.push([word])
      }
    }
    groups.forEach((group, index) => {
      const sortedGroup = [...group].sort((left, right) => left.left - right.left || left.word - right.word)
      const bbox = unionBox(sortedGroup)
      lines.push({
        key: `physical:${page}:${index + 1}`,
        page,
        top: bbox.top,
        left: bbox.left,
        words: sortedGroup,
        text: wordsText(sortedGroup),
        bbox,
        lineNumber: index + 1,
      })
    })
  }
  return lines
}

function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error('Cannot calculate a median from no values')
  const sorted = [...values].sort((left, right) => left - right)
  const midpoint = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[midpoint - 1]! + sorted[midpoint]!) / 2
    : sorted[midpoint]!
}

function numericMode(values: readonly number[], tolerance: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const clusters: number[][] = []
  for (const value of sorted) {
    const cluster = clusters.at(-1)
    if (cluster && Math.abs(value - median(cluster)) <= tolerance) {
      cluster.push(value)
    } else {
      clusters.push([value])
    }
  }
  clusters.sort((left, right) => (
    right.length - left.length ||
    median(right) - median(left)
  ))
  return median(clusters[0]!)
}

function durationValue(text: string): number | null {
  const normalized = normalizeText(text)
  const withUnit = /(?:^|\s)(\d(?:\.\d+)?)\s*(?:academic\s+)?years?(?:\s|$)/iu.exec(normalized)
  const raw = withUnit?.[1] ?? (/^\d(?:\.\d+)?$/u.test(normalized) ? normalized : null)
  if (!raw) return null
  const years = Number(raw)
  return years >= 0.5 && years <= 8 ? years : null
}

function tuitionValue(text: string): ZjuProgramTuition | null {
  const normalized = normalizeText(text)
  const match =
    /(?:RMB|CNY|[¥￥])\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?:yuan)?\s*\/\s*(academic\s+year|year|whole\s+program)/iu
      .exec(normalized)
  if (!match?.[1] || !match[2]) return null
  const amount = Number(match[1].replace(/,/gu, ''))
  if (!Number.isFinite(amount) || amount <= 0) return null
  return {
    amount,
    currency: 'CNY',
    period: /whole/iu.test(match[2]) ? 'whole_program' : 'year',
    raw: match[0],
  }
}

function splitHorizontalGroups(words: readonly TsvWord[], gap = 12): TsvWord[][] {
  const sorted = [...words].sort((left, right) => left.left - right.left)
  const groups: TsvWord[][] = []
  for (const word of sorted) {
    const group = groups.at(-1)
    const previous = group?.at(-1)
    if (group && previous && word.left - (previous.left + previous.width) <= gap) {
      group.push(word)
    } else {
      groups.push([word])
    }
  }
  return groups
}

function isHeaderText(text: string): boolean {
  return /schools?\s*\/?\s*colleges?\s*\/?\s*departments?|disciplines?\s*\/?\s*programs?|undergraduate\s+programs?|program\s+duration|duration\s+of\s+studies|^duration$|^tuition$|other\s+requirements|^requirements$|required\s+subjects|^remarks$/iu
    .test(text)
}

function inferLayout(
  words: readonly TsvWord[],
  sourceLines: readonly SourceLine[],
  physicalLines: readonly PhysicalLine[],
): Layout {
  const durationHeaderLines = sourceLines.filter((line) => (
    /\bduration\b/iu.test(line.text) &&
    !/application|program length/iu.test(line.text)
  ))
  const tuitionHeaderLines = sourceLines.filter((line) => /^tuition$/iu.test(line.text))
  const headerPairs = durationHeaderLines.flatMap((durationLine) => (
    tuitionHeaderLines
      .filter((tuitionLine) => (
        tuitionLine.page === durationLine.page &&
        tuitionLine.left > durationLine.left &&
        Math.abs(tuitionLine.top - durationLine.top) <= 24
      ))
      .map((tuitionLine) => ({ durationLine, tuitionLine }))
  ))
  if (headerPairs.length === 0) {
    throw new Error('ZJU PDF table headers did not expose Duration and Tuition columns')
  }
  const durationStart = median(headerPairs.map(({ durationLine }) => durationLine.left))
  const currencyLines = sourceLines.filter((line) => /(?:RMB|CNY|[¥￥])\s*[0-9]/iu.test(line.text))
  const tuitionStart = currencyLines.length > 0
    ? median(currencyLines.map((line) => line.left))
    : median(headerPairs.map(({ tuitionLine }) => tuitionLine.left)) - 25

  const requirementCandidates = sourceLines.filter((line) => (
    line.left > tuitionStart + 30 &&
    !isHeaderText(line.text) &&
    !/(?:RMB|CNY|[¥￥])\s*[0-9]/iu.test(line.text) &&
    !/^https?:/iu.test(line.text) &&
    line.text.length > 2
  ))
  const requirementModes = new Map<number, number[]>()
  for (const line of requirementCandidates) {
    const bucket = Math.round(line.left / 5) * 5
    const values = requirementModes.get(bucket) ?? []
    values.push(line.left)
    requirementModes.set(bucket, values)
  }
  const repeatedRequirementStarts = [...requirementModes.values()]
    .filter((values) => values.length >= 2)
    .map((values) => median(values))
    .sort((left, right) => left - right)
  const explicitRequirementHeaders = sourceLines
    .filter((line) => /requirements|remarks/iu.test(line.text) && isHeaderText(line.text))
    .map((line) => line.left)
  const requirementsStart = repeatedRequirementStarts[0] ??
    (explicitRequirementHeaders.length > 0
      ? Math.max(tuitionStart + 45, Math.min(...explicitRequirementHeaders) - 40)
      : tuitionStart + 100)

  const durationObservations = physicalLines.filter((line) => {
    const region = line.words.filter((word) => (
      word.left >= durationStart - 10 &&
      word.left < tuitionStart - 3
    ))
    return region.length > 0 && durationValue(wordsText(region)) !== null
  })
  const programStarts: number[] = []
  for (const durationLine of durationObservations) {
    const sameBandWords = words.filter((word) => (
      word.page === durationLine.page &&
      Math.abs(word.top - durationLine.top) <= 2 &&
      word.left < durationStart - 5
    ))
    const groups = splitHorizontalGroups(sameBandWords)
      .filter((group) => {
        const text = wordsText(group)
        return (
          unionBox(group).left > durationStart * 0.35 &&
          !/^https?:/iu.test(text) &&
          !isHeaderText(text)
        )
      })
    const rightmost = groups.sort((left, right) => unionBox(right).left - unionBox(left).left)[0]
    if (rightmost) programStarts.push(unionBox(rightmost).left)
  }
  const programStart = numericMode(programStarts, 6) ?? durationStart * 0.45

  const headerBottomByPage = new Map<number, number>()
  const headerPages = new Set<number>()
  for (const { durationLine, tuitionLine } of headerPairs) {
    const bottom = Math.max(
      durationLine.bbox.top + durationLine.bbox.height,
      tuitionLine.bbox.top + tuitionLine.bbox.height,
    )
    const existing = headerBottomByPage.get(durationLine.page)
    headerBottomByPage.set(
      durationLine.page,
      existing === undefined ? bottom : Math.min(existing, bottom),
    )
    headerPages.add(durationLine.page)
  }
  return {
    durationStart,
    tuitionStart,
    requirementsStart,
    programStart,
    headerBottomByPage,
    headerPages,
  }
}

function extractDurations(
  physicalLines: readonly PhysicalLine[],
  layout: Layout,
): DurationObservation[] {
  const observations: DurationObservation[] = []
  for (const line of physicalLines) {
    const words = line.words.filter((word) => (
      word.left >= layout.durationStart - 10 &&
      word.left < layout.tuitionStart - 3
    ))
    if (words.length === 0) continue
    const durationYears = durationValue(wordsText(words))
    if (durationYears === null) continue
    const headerBottom = layout.headerBottomByPage.get(line.page) ?? 0
    if (centerTop(unionBox(words)) <= headerBottom) continue
    observations.push({
      page: line.page,
      top: centerTop(unionBox(words)),
      durationYears,
      words,
      bbox: unionBox(words),
      lineNumber: line.lineNumber,
    })
  }
  return observations
}

function extractTuitions(
  physicalLines: readonly PhysicalLine[],
  layout: Layout,
): TuitionObservation[] {
  const observations: TuitionObservation[] = []
  const byPage = Map.groupBy(physicalLines, (line) => line.page)
  for (const [page, pageLines] of byPage) {
    const sorted = [...pageLines].sort((left, right) => left.top - right.top)
    for (let index = 0; index < sorted.length; index += 1) {
      const line = sorted[index]!
      const regionWords = line.words.filter((word) => (
        word.left >= layout.tuitionStart - 12 &&
        word.left < layout.requirementsStart - 1
      ))
      const initialText = wordsText(regionWords)
      if (!/(?:RMB|CNY|[¥￥])\s*[0-9]/iu.test(initialText)) continue
      const words = [...regionWords]
      let lineEnd = line.lineNumber
      for (const next of sorted.slice(index + 1, index + 3)) {
        if (next.top - line.top > 22) break
        const continuation = next.words.filter((word) => (
          word.left >= layout.tuitionStart - 12 &&
          word.left < layout.requirementsStart - 1
        ))
        const continuationText = wordsText(continuation)
        if (!/whole\s+program|academic\s+year|^year$/iu.test(continuationText)) continue
        words.push(...continuation)
        lineEnd = next.lineNumber
      }
      const tuition = tuitionValue(
        [...words]
          .sort((left, right) => left.top - right.top || left.left - right.left)
          .map((word) => word.text)
          .join(' '),
      )
      if (!tuition) continue
      const bbox = unionBox(words)
      observations.push({
        page,
        top: centerTop(bbox),
        tuition,
        words,
        bbox,
        lineStart: line.lineNumber,
        lineEnd,
      })
    }
  }
  return observations
}

function isPotentialProgramText(text: string): boolean {
  const normalized = normalizeText(text)
  if (normalized.length < 2 || isHeaderText(normalized)) return false
  if (
    /^https?:|^www\./iu.test(normalized) ||
    /faculty of|application (?:deadline|requirements?)|scholarship|supervisor|contact\s*:|language proficiency|other requirements|research directions? include|specializations? include|^notes?\s*:|^must have|^suggested to|^offered (?:at|on)|^email\s*:|^tel\s*:/iu
      .test(normalized)
  ) {
    return false
  }
  if (/^[\d\s.,;/()-]+$/u.test(normalized)) return false
  return true
}

function programNameQualityReasons(text: string): string[] {
  const normalized = normalizeText(text)
  const reasons: string[] = []
  if (/^(?:facult(?:y|ies)|program(?:me)?s?|disciplines?)$/iu.test(normalized)) {
    reasons.push('generic_program_label')
  }
  const openingParentheses = [...normalized].filter((character) => character === '(').length
  const closingParentheses = [...normalized].filter((character) => character === ')').length
  if (openingParentheses !== closingParentheses) {
    reasons.push('unbalanced_program_parentheses')
  }
  if (normalized.includes('*')) reasons.push('merged_program_separator')
  return reasons
}

function extractProgramClusters(
  physicalLines: readonly PhysicalLine[],
  durations: readonly DurationObservation[],
  layout: Layout,
): ProgramCluster[] {
  const candidates = physicalLines
    .map((line) => {
      const words = line.words.filter((word) => (
        word.left >= layout.programStart - 5 &&
        word.left < layout.durationStart - 5
      ))
      return { line, words, text: wordsText(words) }
    })
    .filter(({ line, words, text }) => {
      const headerBottom = layout.headerBottomByPage.get(line.page) ?? 0
      return (
        words.length > 0 &&
        centerTop(unionBox(words)) > headerBottom &&
        isPotentialProgramText(text)
      )
    })
    .sort((left, right) => left.line.page - right.line.page || left.line.top - right.line.top)

  const orderedDurations = [...durations].sort((left, right) => (
    left.page - right.page ||
    left.top - right.top
  ))
  const claimed = new Set<PhysicalLine>()
  const processedDurations = new Set<DurationObservation>()
  const clusters: Array<typeof candidates> = []

  const nearestDuration = (
    candidate: (typeof candidates)[number],
  ): DurationObservation | null => {
    const top = centerTop(unionBox(candidate.words))
    return [...durations]
      .filter((duration) => duration.page === candidate.line.page)
      .sort((left, right) => Math.abs(left.top - top) - Math.abs(right.top - top))[0] ?? null
  }

  for (const duration of orderedDurations) {
    const available = candidates
      .filter((candidate) => (
        !claimed.has(candidate.line) &&
        candidate.line.page === duration.page &&
        Math.abs(centerTop(unionBox(candidate.words)) - duration.top) <= MAX_FACT_DISTANCE
      ))
      .map((candidate) => {
        const top = centerTop(unionBox(candidate.words))
        const closest = nearestDuration(candidate)
        const futureAnchorPenalty =
          closest && closest !== duration && !processedDurations.has(closest) ? 20 : 0
        return {
          candidate,
          score: Math.abs(top - duration.top) + futureAnchorPenalty,
        }
      })
      .sort((left, right) => left.score - right.score || left.candidate.line.top - right.candidate.line.top)
    const seed = available[0]?.candidate
    if (!seed) {
      processedDurations.add(duration)
      continue
    }

    const pageCandidates = candidates.filter((candidate) => candidate.line.page === duration.page)
    const seedIndex = pageCandidates.indexOf(seed)
    let firstIndex = seedIndex
    let lastIndex = seedIndex
    for (let index = seedIndex - 1; index >= 0; index -= 1) {
      const candidate = pageCandidates[index]!
      const next = pageCandidates[firstIndex]!
      const gap = next.line.top - (candidate.line.bbox.top + candidate.line.bbox.height)
      const closest = nearestDuration(candidate)
      if (
        claimed.has(candidate.line) ||
        gap > WRAPPED_LINE_GAP ||
        (closest !== duration && closest !== null && !processedDurations.has(closest))
      ) {
        break
      }
      firstIndex = index
    }
    for (let index = seedIndex + 1; index < pageCandidates.length; index += 1) {
      const candidate = pageCandidates[index]!
      const previous = pageCandidates[lastIndex]!
      const gap = candidate.line.top - (previous.line.bbox.top + previous.line.bbox.height)
      const closest = nearestDuration(candidate)
      if (
        claimed.has(candidate.line) ||
        gap > WRAPPED_LINE_GAP ||
        (closest !== duration && closest !== null && !processedDurations.has(closest))
      ) {
        break
      }
      lastIndex = index
    }
    const cluster = pageCandidates.slice(firstIndex, lastIndex + 1)
      .filter((candidate) => !claimed.has(candidate.line))
    cluster.forEach((candidate) => claimed.add(candidate.line))
    if (cluster.length > 0) clusters.push(cluster)
    processedDurations.add(duration)
  }

  const unclaimed = candidates.filter((candidate) => !claimed.has(candidate.line))
  const unclaimedClusters: Array<typeof candidates> = []
  for (const candidate of unclaimed) {
    const cluster = unclaimedClusters.at(-1)
    const previous = cluster?.at(-1)
    const gap = previous
      ? candidate.line.top - (previous.line.bbox.top + previous.line.bbox.height)
      : Number.POSITIVE_INFINITY
    if (
      cluster &&
      previous?.line.page === candidate.line.page &&
      gap <= WRAPPED_LINE_GAP
    ) {
      cluster.push(candidate)
    } else {
      unclaimedClusters.push([candidate])
    }
  }
  clusters.push(...unclaimedClusters)
  return clusters.map((cluster) => {
    const words = cluster.flatMap((candidate) => candidate.words)
    const bbox = unionBox(words)
    return {
      page: cluster[0]!.line.page,
      top: centerTop(bbox),
      name: normalizeText(cluster.map((candidate) => candidate.text).join(' ')),
      lines: cluster.map((candidate) => candidate.line),
      words,
      bbox,
    }
  })
}

function organizationStart(text: string): boolean {
  return /\b(?:school|college|department|institute|academy|center|hospital|university)\b|(?:学院|学校|学系|系|研究所|研究院|中心|医院)/iu
    .test(text)
}

function extractDepartments(
  physicalLines: readonly PhysicalLine[],
  layout: Layout,
): DepartmentCandidate[] {
  const fragments = physicalLines
    .map((line) => {
      const words = line.words.filter((word) => word.left < layout.programStart - 5)
      const text = wordsText(words).replace(/\s*https?:\/\/.*$/iu, '').trim()
      return { line, words, text }
    })
    .filter(({ line, words, text }) => {
      const headerBottom = layout.headerBottomByPage.get(line.page) ?? 0
      return (
        words.length > 0 &&
        centerTop(unionBox(words)) > headerBottom &&
        text.length > 1 &&
        !isHeaderText(text) &&
        !/^https?:|^www\./iu.test(text) &&
        !/^faculty of\b/iu.test(text)
      )
    })
    .sort((left, right) => left.line.page - right.line.page || left.line.top - right.line.top)

  const groups: Array<typeof fragments> = []
  for (const fragment of fragments) {
    const current = groups.at(-1)
    const previous = current?.at(-1)
    if (organizationStart(fragment.text)) {
      groups.push([fragment])
      continue
    }
    if (
      current &&
      previous?.line.page === fragment.line.page &&
      fragment.line.top - (previous.line.bbox.top + previous.line.bbox.height) <= WRAPPED_LINE_GAP &&
      !/^(?:notes?|application|programs?)\b/iu.test(fragment.text)
    ) {
      current.push(fragment)
    }
  }
  return groups
    .map((group) => {
      const words = group.flatMap((fragment) => fragment.words)
      const name = normalizeText(group.map((fragment) => fragment.text).join(' '))
      const bbox = unionBox(words)
      return {
        page: group[0]!.line.page,
        name,
        centerTop: centerTop(bbox),
        lines: group.map((fragment) => fragment.line),
        words,
        bbox,
      }
    })
    .filter((department) => organizationStart(department.name))
}

function segmentMean(rows: readonly ProgramCluster[], start: number, end: number): number {
  const selected = rows.slice(start, end)
  return selected.reduce((sum, row) => sum + row.top, 0) / selected.length
}

function assignDepartmentsForPage(
  rows: readonly ProgramCluster[],
  departments: readonly DepartmentCandidate[],
): DepartmentAssignment[] {
  if (rows.length === 0) return []
  if (departments.length === 0) {
    return rows.map(() => ({ department: null, ambiguous: true }))
  }
  if (rows.length < departments.length) {
    return rows.map((row) => {
      const ordered = [...departments].sort((left, right) => (
        Math.abs(left.centerTop - row.top) - Math.abs(right.centerTop - row.top)
      ))
      return { department: ordered[0] ?? null, ambiguous: true }
    })
  }

  const departmentCount = departments.length
  const rowCount = rows.length
  const cost = Array.from(
    { length: departmentCount + 1 },
    () => Array<number>(rowCount + 1).fill(Number.POSITIVE_INFINITY),
  )
  const previous = Array.from(
    { length: departmentCount + 1 },
    () => Array<number>(rowCount + 1).fill(-1),
  )
  cost[0]![0] = 0
  for (let departmentIndex = 1; departmentIndex <= departmentCount; departmentIndex += 1) {
    const minimumRows = departmentIndex
    const maximumRows = rowCount - (departmentCount - departmentIndex)
    for (let usedRows = minimumRows; usedRows <= maximumRows; usedRows += 1) {
      for (
        let segmentStart = departmentIndex - 1;
        segmentStart < usedRows;
        segmentStart += 1
      ) {
        const previousCost = cost[departmentIndex - 1]![segmentStart]!
        if (!Number.isFinite(previousCost)) continue
        const mean = segmentMean(rows, segmentStart, usedRows)
        const difference = mean - departments[departmentIndex - 1]!.centerTop
        const candidateCost = previousCost + difference ** 2
        if (candidateCost < cost[departmentIndex]![usedRows]!) {
          cost[departmentIndex]![usedRows] = candidateCost
          previous[departmentIndex]![usedRows] = segmentStart
        }
      }
    }
  }

  const assignments: DepartmentAssignment[] = rows.map(() => ({
    department: null,
    ambiguous: true,
  }))
  let usedRows = rowCount
  for (let departmentIndex = departmentCount; departmentIndex >= 1; departmentIndex -= 1) {
    const segmentStart = previous[departmentIndex]![usedRows]!
    if (segmentStart < 0) break
    const department = departments[departmentIndex - 1]!
    const difference = Math.abs(segmentMean(rows, segmentStart, usedRows) - department.centerTop)
    for (let rowIndex = segmentStart; rowIndex < usedRows; rowIndex += 1) {
      assignments[rowIndex] = {
        department,
        ambiguous: difference > 55,
      }
    }
    usedRows = segmentStart
  }
  return assignments
}

function assignDepartments(
  rows: readonly ProgramCluster[],
  departments: readonly DepartmentCandidate[],
): Map<ProgramCluster, DepartmentAssignment> {
  const result = new Map<ProgramCluster, DepartmentAssignment>()
  const rowsByPage = Map.groupBy(rows, (row) => row.page)
  const departmentsByPage = Map.groupBy(departments, (department) => department.page)
  for (const [page, pageRows] of rowsByPage) {
    const sortedRows = [...pageRows].sort((left, right) => left.top - right.top)
    const sortedDepartments = [...(departmentsByPage.get(page) ?? [])]
      .sort((left, right) => left.centerTop - right.centerTop)
    const assignments = assignDepartmentsForPage(sortedRows, sortedDepartments)
    sortedRows.forEach((row, index) => {
      result.set(row, assignments[index]!)
    })
  }
  return result
}

function closestDuration(
  row: ProgramCluster,
  observations: readonly DurationObservation[],
): { observation: DurationObservation | null; ambiguous: boolean } {
  const ordered = observations
    .filter((observation) => observation.page === row.page)
    .map((observation) => ({
      observation,
      distance: Math.abs(observation.top - row.top),
    }))
    .filter(({ distance }) => distance <= MAX_FACT_DISTANCE)
    .sort((left, right) => left.distance - right.distance)
  if (ordered.length === 0) return { observation: null, ambiguous: false }
  const first = ordered[0]!
  const second = ordered[1]
  const ambiguous = Boolean(
    second &&
    Math.abs(second.distance - first.distance) < 1 &&
    second.observation.durationYears !== first.observation.durationYears,
  )
  return { observation: first.observation, ambiguous }
}

function closestTuition(
  row: ProgramCluster,
  duration: DurationObservation,
  observations: readonly TuitionObservation[],
): { observation: TuitionObservation | null; ambiguous: boolean } {
  const referenceTop = (row.top + duration.top) / 2
  const ordered = observations
    .filter((observation) => observation.page === row.page)
    .map((observation) => ({
      observation,
      distance: Math.abs(observation.top - referenceTop),
    }))
    .filter(({ distance }) => distance <= MAX_FACT_DISTANCE + 10)
    .sort((left, right) => left.distance - right.distance)
  if (ordered.length === 0) return { observation: null, ambiguous: false }
  const first = ordered[0]!
  const second = ordered[1]
  const ambiguous = Boolean(
    second &&
    Math.abs(second.distance - first.distance) < 1 &&
    (
      second.observation.tuition.amount !== first.observation.tuition.amount ||
      second.observation.tuition.period !== first.observation.tuition.period
    ),
  )
  return { observation: ambiguous ? null : first.observation, ambiguous }
}

function normalizedKeyPart(value: string): string {
  const slug = value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
  if (!slug) throw new Error(`Cannot build a stable entity key from ${JSON.stringify(value)}`)
  return slug
}

function entityKey(
  degreeLevel: ZjuDegreeLevel,
  instructionLanguage: ZjuInstructionLanguage,
  department: string,
  program: string,
): string {
  return [
    'zju',
    degreeLevel,
    instructionLanguage.toLowerCase(),
    normalizedKeyPart(department),
    normalizedKeyPart(program),
  ].join(':')
}

function locator(page: number, lineStart: number, lineEnd: number, bbox: ZjuPdfBoundingBox): string {
  return [
    `pdf:page=${page}`,
    `lines=${lineStart}-${lineEnd}`,
    `bbox=${bbox.left},${bbox.top},${bbox.width},${bbox.height}`,
  ].join(';')
}

function quarantine(
  page: number,
  candidateName: string | null,
  reasons: string[],
  bbox: ZjuPdfBoundingBox,
  lineStart: number,
  lineEnd: number,
): ZjuQuarantinedPdfRow {
  return {
    status: 'quarantined',
    page,
    candidateName,
    reasons,
    locator: locator(page, lineStart, lineEnd, bbox),
    bbox,
  }
}

export function parseZjuPdfCatalogTsv(
  tsv: string,
  rawOptions: ParseZjuPdfCatalogOptions,
): ZjuPdfCatalogHarvest {
  const options = {
    ...rawOptions,
    officialUrl: validateOfficialUrl(rawOptions.officialUrl),
    institutionId: validateInstitutionId(rawOptions.institutionId),
    checkedAt: validateCheckedAt(rawOptions.checkedAt),
    degreeLevel: validateDegreeLevel(rawOptions.degreeLevel),
    instructionLanguage: validateInstructionLanguage(rawOptions.instructionLanguage),
  }
  const parsed = parseTsvWords(tsv)
  const sourceLines = buildSourceLines(parsed.words)
  const physicalLines = buildPhysicalLines(parsed.words)
  const layout = inferLayout(parsed.words, sourceLines, physicalLines)
  const durations = extractDurations(physicalLines, layout)
  const tuitions = extractTuitions(physicalLines, layout)
  const programRows = extractProgramClusters(physicalLines, durations, layout)
  const departments = extractDepartments(physicalLines, layout)
  const departmentAssignments = assignDepartments(programRows, departments)
  const entitiesByKey = new Map<string, ZjuPdfProgramEntity>()
  const quarantined: ZjuQuarantinedPdfRow[] = []
  const usedDurationObservations = new Set<DurationObservation>()
  let duplicateRows = 0
  let quarantinedFieldFacts = 0

  for (const row of programRows) {
    const reasons = programNameQualityReasons(row.name)
    if (!isPotentialProgramText(row.name) || row.name.length > 300 || row.lines.length > 8) {
      reasons.push('ambiguous_program_name')
    }
    const assignment = departmentAssignments.get(row)
    if (!assignment?.department) reasons.push('missing_department')
    if (assignment?.ambiguous) reasons.push('ambiguous_department_assignment')
    const durationMatch = closestDuration(row, durations)
    const safeDuration = durationMatch.observation && !durationMatch.ambiguous
      ? durationMatch.observation
      : null
    if (safeDuration) usedDurationObservations.add(safeDuration)

    const rowLineStart = Math.min(...row.lines.map((line) => line.lineNumber))
    const rowLineEnd = Math.max(...row.lines.map((line) => line.lineNumber))
    if (reasons.length > 0 || !assignment?.department) {
      quarantined.push(quarantine(
        row.page,
        row.name || null,
        reasons,
        row.bbox,
        rowLineStart,
        rowLineEnd,
      ))
      continue
    }
    if (durationMatch.ambiguous) {
      quarantinedFieldFacts += 1
    }


    const tuitionMatch = safeDuration
      ? closestTuition(row, safeDuration, tuitions)
      : { observation: null, ambiguous: false }
    const warnings: string[] = []
    if (!safeDuration) {
      warnings.push(
        durationMatch.ambiguous ? 'ambiguous_duration' : 'duration_not_located',
        'tuition_not_bound_without_duration',
      )
    } else if (!tuitionMatch.observation) {
      warnings.push(tuitionMatch.ambiguous ? 'ambiguous_tuition' : 'tuition_not_located')
    }
    const evidenceWords = [
      ...row.words,
      ...(safeDuration?.words ?? []),
      ...(tuitionMatch.observation?.words ?? []),
    ]
    const evidenceBox = unionBox(evidenceWords)
    const evidenceLineStart = Math.min(
      rowLineStart,
      safeDuration?.lineNumber ?? Number.POSITIVE_INFINITY,
      tuitionMatch.observation?.lineStart ?? Number.POSITIVE_INFINITY,
    )
    const evidenceLineEnd = Math.max(
      rowLineEnd,
      safeDuration?.lineNumber ?? Number.NEGATIVE_INFINITY,
      tuitionMatch.observation?.lineEnd ?? Number.NEGATIVE_INFINITY,
    )
    const key = entityKey(
      options.degreeLevel,
      options.instructionLanguage,
      assignment.department.name,
      row.name,
    )
    const confidence = round(
      !safeDuration ? 0.9 : tuitionMatch.observation ? 0.99 : 0.94,
      2,
    )
    const entity: ZjuPdfProgramEntity = {
      entityKey: key,
      entityType: 'program',
      institutionId: options.institutionId,
      programType: 'degree',
      degreeLevel: options.degreeLevel,
      instructionLanguage: options.instructionLanguage,
      name: row.name,
      department: assignment.department.name,
      durationYears: safeDuration?.durationYears ?? null,
      tuition: tuitionMatch.observation?.tuition ?? null,
      officialUrl: options.officialUrl,
      sourceCheckedAt: options.checkedAt,
      verificationStatus: 'verified',
      confidence,
      warnings,
      evidence: {
        page: row.page,
        lineStart: evidenceLineStart,
        lineEnd: evidenceLineEnd,
        bbox: evidenceBox,
        departmentBbox: assignment.department.bbox,
        locator: locator(row.page, evidenceLineStart, evidenceLineEnd, evidenceBox),
        quote: normalizeText([
          assignment.department.name,
          row.name,
          safeDuration ? `${safeDuration.durationYears} years` : '',
          tuitionMatch.observation?.tuition.raw ?? '',
        ].filter(Boolean).join(' — ')),
        officialUrl: options.officialUrl,
        checkedAt: options.checkedAt,
      },
    }
    const existing = entitiesByKey.get(key)
    if (existing) {
      duplicateRows += 1
      const durationConflict = (
        existing.durationYears !== null &&
        entity.durationYears !== null &&
        existing.durationYears !== entity.durationYears
      )
      const tuitionConflict = (
        existing.tuition !== null &&
        entity.tuition !== null &&
        (
          existing.tuition.amount !== entity.tuition.amount ||
          existing.tuition.period !== entity.tuition.period
        )
      )
      if (durationConflict || tuitionConflict) {
        entitiesByKey.delete(key)
        quarantined.push(quarantine(
          row.page,
          row.name,
          ['conflicting_duplicate_row'],
          row.bbox,
          rowLineStart,
          rowLineEnd,
        ))
      } else {
        const existingCompleteness =
          Number(existing.durationYears !== null) + Number(existing.tuition !== null)
        const entityCompleteness =
          Number(entity.durationYears !== null) + Number(entity.tuition !== null)
        if (entityCompleteness > existingCompleteness) entitiesByKey.set(key, entity)
      }
      continue
    }
    entitiesByKey.set(key, entity)
  }

  const orphanDurations = durations.filter((duration) => !usedDurationObservations.has(duration))
  for (const duration of orphanDurations) {
    quarantined.push(quarantine(
      duration.page,
      null,
      ['missing_program_name'],
      duration.bbox,
      duration.lineNumber,
      duration.lineNumber,
    ))
  }
  const entities = [...entitiesByKey.values()]
    .sort((left, right) => left.entityKey.localeCompare(right.entityKey))
  const programCandidateRows = programRows.length + orphanDurations.length
  const verificationRate = programCandidateRows === 0
    ? 0
    : round((entities.length / programCandidateRows) * 100, 2)
  return {
    parserVersion: 'zju-pdf-tsv-v1',
    sourceType: 'official_pdf',
    sourcePdfName: rawOptions.sourcePdfName ?? null,
    officialUrl: options.officialUrl,
    institutionId: options.institutionId,
    checkedAt: options.checkedAt,
    degreeLevel: options.degreeLevel,
    instructionLanguage: options.instructionLanguage,
    entities,
    quarantined,
    reconciliation: {
      tsvRows: parsed.tsvRows,
      malformedTsvRows: parsed.malformedTsvRows,
      wordRows: parsed.words.length,
      pages: new Set(parsed.words.map((word) => word.page)).size,
      tableHeaderPages: layout.headerPages.size,
      programCandidateRows,
      durationObservations: durations.length,
      tuitionObservations: tuitions.length,
      verifiedRows: entities.length,
      quarantinedRows: quarantined.length,
      duplicateRows,
      quarantinedFieldFacts,
      orphanDurationRows: orphanDurations.length,
      verificationRate,
    },
  }
}

export function harvestZjuPdfCatalog(
  rawOptions: HarvestZjuPdfCatalogOptions,
): ZjuPdfCatalogHarvest {
  const pdfPath = resolve(rawOptions.pdfPath)
  if (!existsSync(pdfPath) || extname(pdfPath).toLowerCase() !== '.pdf') {
    throw new Error('pdfPath must point to an existing PDF file')
  }
  const pdftotextPath = rawOptions.pdftotextPath?.trim() || 'pdftotext'
  const tsv = execFileSync(pdftotextPath, ['-tsv', pdfPath, '-'], {
    encoding: 'utf8',
    maxBuffer: MAX_PROCESS_BUFFER_BYTES,
    windowsHide: true,
  })
  return parseZjuPdfCatalogTsv(tsv, {
    officialUrl: rawOptions.officialUrl,
    institutionId: rawOptions.institutionId,
    checkedAt: rawOptions.checkedAt,
    degreeLevel: rawOptions.degreeLevel,
    instructionLanguage: rawOptions.instructionLanguage,
    sourcePdfName: basename(pdfPath),
  })
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
  const result = harvestZjuPdfCatalog({
    pdfPath: requiredArgument('--pdf'),
    officialUrl: requiredArgument('--official-url'),
    institutionId: requiredArgument('--institution-id'),
    degreeLevel: validateDegreeLevel(requiredArgument('--degree-level')),
    instructionLanguage: validateInstructionLanguage(requiredArgument('--instruction-language')),
    checkedAt: validateCheckedAt(requiredArgument('--checked-at')),
    pdftotextPath: argument('--pdftotext'),
  })
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify({
    output: outputPath,
    verified: result.reconciliation.verifiedRows,
    quarantined: result.reconciliation.quarantinedRows,
    verificationRate: result.reconciliation.verificationRate,
  })}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
