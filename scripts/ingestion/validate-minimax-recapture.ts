import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

type JsonRecord = Record<string, unknown>

type RecaptureTask = {
  id: string
  kind: 'programs' | 'scholarships'
  schools: Array<{ institutionRef: string }>
  outputJsonPath: string
}

type RecaptureQueue = {
  format: 'studyinchina.minimax-recapture-queue'
  formatVersion: 3
  tasks: RecaptureTask[]
}

const MINIMUM_RATES = {
  duration: 0.6,
  tuition: 0.5,
  futureDeadline: 0.4,
} as const

const THIRD_PARTY_HOSTS = [
  'applychina',
  'bachelorsportal',
  'china-admissions',
  'cucas',
  'mastersportal',
  'studyinchina.com',
]

const GENERATED_EVIDENCE_PATTERNS = [
  /the official program page identifies this program as open to non-chinese citizens/iu,
  /admission is processed through .* international student office/iu,
  /individual submission is required, no partner-university nomination/iu,
  /submit your application directly through .* no partner-university nomination is required/iu,
  /^program length:\s*\d+\s*months\s*\(full-time\)\.?$/iu,
]

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as JsonRecord
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value.trim()
}

function officialHttps(value: unknown, label: string): string {
  const raw = text(value, label)
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`${label} must be a valid URL`)
  }
  const host = url.hostname.toLowerCase()
  if (
    url.protocol !== 'https:'
    || url.username
    || url.password
    || url.port
    || THIRD_PARTY_HOSTS.some((blocked) => host.includes(blocked))
  ) {
    throw new Error(`${label} must be an official HTTPS URL`)
  }
  return url.href
}

function isHomepageUrl(value: string): boolean {
  try {
    const url = new URL(value)
    const path = url.pathname.replace(/\/+$/u, '')
    return path === '' || path === '/' || /^\/(index|default|home)(\.[a-z]+)?$/iu.test(path)
  } catch {
    return true
  }
}

function evidenceStatus(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return typeof (value as JsonRecord).status === 'string'
    ? String((value as JsonRecord).status)
    : null
}

function evidenceValue(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return (value as JsonRecord).value
}

function isKnown(value: unknown): boolean {
  return evidenceStatus(value) === 'known'
    && evidenceValue(value) !== null
    && evidenceValue(value) !== undefined
    && evidenceValue(value) !== ''
}

function isFutureDeadline(value: unknown, publicationEligibility: unknown, checkedAt: string): boolean {
  if (!isKnown(value)) return false
  const date = evidenceValue(value)
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(date)) return false
  if (publicationEligibility !== 'open' && publicationEligibility !== 'future') return false
  const deadline = Date.parse(`${date}T23:59:59Z`)
  const checked = Date.parse(`${checkedAt}T00:00:00Z`)
  return Number.isFinite(deadline) && Number.isFinite(checked) && deadline >= checked
}

function snapshotReference(item: JsonRecord, ancestors: JsonRecord[]): boolean {
  const candidates = [item, ...ancestors]
  return candidates.some((candidate) => (
    (typeof candidate.rawSnapshotPath === 'string' && candidate.rawSnapshotPath.trim().length > 0)
    || (typeof candidate.rawSnapshotHash === 'string' && candidate.rawSnapshotHash.trim().length > 0)
  ))
}

type EvidenceCounts = {
  known: number
  homepage: number
  searchSnippet: number
  generatedTemplate: number
  missingSnapshot: number
}

function validateEvidenceTree(
  value: unknown,
  path: string,
  issues: string[],
  counts: EvidenceCounts,
  ancestors: JsonRecord[] = [],
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      validateEvidenceTree(item, `${path}[${index}]`, issues, counts, ancestors)
    })
    return
  }
  if (!value || typeof value !== 'object') return

  const item = value as JsonRecord
  if (item.status === 'known') {
    counts.known++
    try {
      const url = officialHttps(item.officialUrl, `${path}.officialUrl`)
      if (isHomepageUrl(url)) {
        counts.homepage++
        throw new Error(`${path}.officialUrl must not be a homepage`)
      }
      text(item.sourceTitle, `${path}.sourceTitle`)
      text(item.checkedAt, `${path}.checkedAt`)
      const quote = text(item.quote, `${path}.quote`)
      const locator = text(item.locator, `${path}.locator`)
      if (quote.length > 350) throw new Error(`${path}.quote exceeds 350 characters`)
      if (!Object.hasOwn(item, 'value')) throw new Error(`${path}.value is required`)
      if (/search snippet|websearch snippet/iu.test(`${quote} ${locator}`)) {
        counts.searchSnippet++
        throw new Error(`${path} uses a search snippet as evidence`)
      }
      if (GENERATED_EVIDENCE_PATTERNS.some((pattern) => pattern.test(quote))) {
        counts.generatedTemplate++
        throw new Error(`${path} uses a generated evidence template`)
      }
      if (!snapshotReference(item, ancestors)) {
        counts.missingSnapshot++
        throw new Error(`${path} requires rawSnapshotPath or rawSnapshotHash`)
      }
    } catch (error) {
      issues.push(error instanceof Error ? error.message : String(error))
    }
  }

  for (const [key, child] of Object.entries(item)) {
    if (
      typeof child === 'string'
      && /(?:official|program|apply|application|catalog|source)Url$/iu.test(key)
    ) {
      try {
        const url = officialHttps(child, `${path}.${key}`)
        if ((key === 'programUrl' || key === 'officialUrl') && isHomepageUrl(url)) {
          throw new Error(`${path}.${key} must not be a homepage`)
        }
      } catch (error) {
        issues.push(error instanceof Error ? error.message : String(error))
      }
    }
    validateEvidenceTree(child, `${path}.${key}`, issues, counts, [item, ...ancestors])
  }
}

type ProgramQuality = {
  publishable: boolean
  duration: boolean
  tuition: boolean
  futureDeadline: boolean
}

function programQuality(program: JsonRecord, checkedAt: string, label: string): ProgramQuality {
  const programUrl = officialHttps(program.programUrl, `${label}.programUrl`)
  if (isHomepageUrl(programUrl)) throw new Error(`${label}.programUrl must not be a homepage`)
  if (!isKnown(program.internationalEligibility) || evidenceValue(program.internationalEligibility) !== true) {
    throw new Error(`${label}.internationalEligibility must be known:true`)
  }
  if (!isKnown(program.individualApplication) || evidenceValue(program.individualApplication) !== true) {
    throw new Error(`${label}.individualApplication must be known:true`)
  }

  const cycles = Array.isArray(program.cycles) ? program.cycles : []
  const duration = isKnown(program.durationMonths)
  const tuition = cycles.some((cycle) => {
    if (!cycle || typeof cycle !== 'object') return false
    return isKnown((cycle as JsonRecord).tuitionCny)
  })
  const futureDeadline = cycles.some((cycle) => {
    if (!cycle || typeof cycle !== 'object') return false
    const item = cycle as JsonRecord
    return isFutureDeadline(item.closesOn, item.publicationEligibility, checkedAt)
  })
  const publishable = program.publishable !== false
  if (publishable && !duration && !tuition && !futureDeadline) {
    throw new Error(`${label} requires duration, tuition, or a future deadline`)
  }
  return { publishable, duration, tuition, futureDeadline }
}

function scholarshipInstitutions(scholarship: JsonRecord, label: string): string[] {
  return array(scholarship.institutionIds, `${label}.institutionIds`).map(
    (institution, index) => text(institution, `${label}.institutionIds[${index}]`),
  )
}

function validateScholarship(scholarship: JsonRecord, label: string): string[] {
  text(scholarship.scholarshipKey, `${label}.scholarshipKey`)
  text(scholarship.nameOriginal, `${label}.nameOriginal`)
  const officialUrl = officialHttps(scholarship.officialUrl, `${label}.officialUrl`)
  if (isHomepageUrl(officialUrl)) throw new Error(`${label}.officialUrl must not be a homepage`)
  const coverage = record(scholarship.coverage, `${label}.coverage`)
  if (!Object.values(coverage).some(isKnown)) {
    throw new Error(`${label}.coverage must contain at least one known benefit`)
  }
  if (!isKnown(scholarship.applicationRoute)) {
    throw new Error(`${label}.applicationRoute must be known`)
  }
  return scholarshipInstitutions(scholarship, label)
}

export interface RecaptureValidationResult {
  programs: number
  scholarships: number
  sourceFailures: number
  publishablePrograms: number
  quarantinedPrograms: number
  durationCoverageRate: number
  tuitionCoverageRate: number
  futureDeadlineCoverageRate: number
  knownEvidence: number
  homepageEvidenceCount: number
  searchSnippetEvidenceCount: number
  generatedTemplateEvidenceCount: number
  missingSnapshotEvidenceCount: number
}

export function validateMiniMaxRecapture(
  task: RecaptureTask,
  input: unknown,
): RecaptureValidationResult {
  const data = record(input, 'harvest')
  if (data.format !== 'studyinchina.minimax-official-harvest' || data.formatVersion !== 1) {
    throw new Error('harvest format/version is not supported')
  }
  if (data.batchId !== task.id) throw new Error(`batchId must equal ${task.id}`)
  const checkedAt = text(data.checkedAt, 'harvest.checkedAt')
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(checkedAt)) {
    throw new Error('harvest.checkedAt must use YYYY-MM-DD')
  }

  const collector = record(data.collector, 'harvest.collector')
  const collectorText = `${collector.agent ?? ''} ${collector.evidenceSource ?? ''}`
  if (/v2 expansion repair|documented-gap pass|generated (?:from|by) .*catalog|catalog wrapper/iu.test(collectorText)) {
    throw new Error('generated Catalog wrapper or documented-gap collector is not allowed')
  }

  const scope = record(data.scope, 'harvest.scope')
  const schoolIds = array(scope.schoolIds, 'harvest.scope.schoolIds').map(
    (school, index) => text(school, `harvest.scope.schoolIds[${index}]`),
  )
  const expected = task.schools.map((school) => school.institutionRef)
  if (JSON.stringify(schoolIds) !== JSON.stringify(expected)) {
    throw new Error('scope.schoolIds must exactly match the assigned task order')
  }

  const programs = array(data.programs, 'harvest.programs')
  const scholarships = array(data.scholarships, 'harvest.scholarships')
  const reconciliation = array(data.reconciliation, 'harvest.reconciliation')
  const sourceFailures = array(data.sourceFailures, 'harvest.sourceFailures')
  if (reconciliation.length !== expected.length) {
    throw new Error('reconciliation must contain exactly one entry per assigned school')
  }

  let publishablePrograms = 0
  let quarantinedPrograms = 0
  let durationRate = 0
  let tuitionRate = 0
  let futureDeadlineRate = 0

  if (task.kind === 'programs') {
    if (scholarships.length !== 0) throw new Error('program task scholarships must be empty')
    if (programs.length < expected.length) {
      throw new Error('program task must contain at least one program per assigned school')
    }
    const qualities = programs.map((program, index) => (
      programQuality(record(program, `programs[${index}]`), checkedAt, `programs[${index}]`)
    ))
    const publishable = qualities.filter((quality) => quality.publishable)
    publishablePrograms = publishable.length
    quarantinedPrograms = qualities.length - publishable.length
    if (publishablePrograms === 0) throw new Error('program task must contain a publishable program')
    durationRate = publishable.filter((quality) => quality.duration).length / publishablePrograms
    tuitionRate = publishable.filter((quality) => quality.tuition).length / publishablePrograms
    futureDeadlineRate = publishable.filter((quality) => quality.futureDeadline).length / publishablePrograms
    if (durationRate < MINIMUM_RATES.duration) {
      throw new Error(`durationCoverageRate ${durationRate.toFixed(2)} < 0.60`)
    }
    if (tuitionRate < MINIMUM_RATES.tuition) {
      throw new Error(`tuitionCoverageRate ${tuitionRate.toFixed(2)} < 0.50`)
    }
    if (futureDeadlineRate < MINIMUM_RATES.futureDeadline) {
      throw new Error(`futureDeadlineCoverageRate ${futureDeadlineRate.toFixed(2)} < 0.40`)
    }
  } else {
    if (programs.length !== 0) throw new Error('scholarship task programs must be empty')
    if (scholarships.length === 0) {
      throw new Error('scholarship task must contain at least one verified scholarship')
    }
    const covered = new Set<string>()
    scholarships.forEach((scholarship, index) => {
      validateScholarship(record(scholarship, `scholarships[${index}]`), `scholarships[${index}]`)
        .forEach((institution) => covered.add(institution))
    })
    const missing = expected.filter((institution) => !covered.has(institution))
    if (missing.length > 0) {
      throw new Error(`scholarship task does not cover assigned schools: ${missing.join(', ')}`)
    }
  }

  const issues: string[] = []
  const evidenceCounts: EvidenceCounts = {
    known: 0,
    homepage: 0,
    searchSnippet: 0,
    generatedTemplate: 0,
    missingSnapshot: 0,
  }
  validateEvidenceTree(data, 'harvest', issues, evidenceCounts)
  if (issues.length > 0) {
    throw new Error(`evidence validation failed:\n- ${issues.slice(0, 30).join('\n- ')}`)
  }
  if (evidenceCounts.known === 0) throw new Error('task must contain known official evidence')

  return {
    programs: programs.length,
    scholarships: scholarships.length,
    sourceFailures: sourceFailures.length,
    publishablePrograms,
    quarantinedPrograms,
    durationCoverageRate: durationRate,
    tuitionCoverageRate: tuitionRate,
    futureDeadlineCoverageRate: futureDeadlineRate,
    knownEvidence: evidenceCounts.known,
    homepageEvidenceCount: evidenceCounts.homepage,
    searchSnippetEvidenceCount: evidenceCounts.searchSnippet,
    generatedTemplateEvidenceCount: evidenceCounts.generatedTemplate,
    missingSnapshotEvidenceCount: evidenceCounts.missingSnapshot,
  }
}

function argument(name: string): string | null {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] ?? null : null
}

async function main(): Promise<void> {
  const taskId = argument('--task')
  if (!taskId) throw new Error('--task is required')
  const queuePath = argument('--queue') ?? 'quality/minimax-recapture/queue.v3.json'
  const queue = JSON.parse(await readFile(resolve(queuePath), 'utf8')) as RecaptureQueue
  if (
    queue.format !== 'studyinchina.minimax-recapture-queue'
    || queue.formatVersion !== 3
  ) {
    throw new Error('recapture queue format/version is not supported')
  }
  const task = queue.tasks.find((candidate) => candidate.id === taskId)
  if (!task) throw new Error(`Unknown recapture task: ${taskId}`)
  const outputPath = resolve(task.outputJsonPath)
  const bytes = await readFile(outputPath)
  const data = JSON.parse(bytes.toString('utf8')) as unknown
  const counts = validateMiniMaxRecapture(task, data)
  const marker = resolve(`quality/minimax-recapture/completed/${task.id}.json`)
  await mkdir(dirname(marker), { recursive: true })
  await writeFile(marker, `${JSON.stringify({
    taskId: task.id,
    validatedAt: new Date().toISOString(),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    counts,
  }, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ taskId: task.id, valid: true, ...counts }))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
