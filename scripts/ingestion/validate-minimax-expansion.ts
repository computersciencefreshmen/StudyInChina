import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

type JsonRecord = Record<string, unknown>

type MiniMaxExpansionTask = {
  id: string
  kind: 'programs' | 'scholarships'
  schools: Array<{ institutionRef: string }>
  outputJsonPath: string
}

type MiniMaxExpansionQueue = {
  format: 'studyinchina.minimax-expansion-queue'
  formatVersion: 2
  tasks: MiniMaxExpansionTask[]
}

const THIRD_PARTY_HOSTS = [
  'applychina',
  'bachelorsportal',
  'china-admissions',
  'cucas',
  'mastersportal',
  'studyinchina.com',
]

const HOME_DOMAIN_ALLOWLIST: ReadonlySet<string> = new Set<string>()

const MIN_PUBLISHABLE = {
  durationRate: 0.6,
  tuitionRate: 0.5,
  futureDeadlineRate: 0.4,
}

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

function getEvidenceStatus(value: unknown): string | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const item = value as JsonRecord
    if (typeof item.status === 'string') return item.status
  }
  return null
}

function getEvidenceValue(value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const item = value as JsonRecord
    return item.value
  }
  return undefined
}

function isHomepageUrl(url: string): boolean {
  // A homepage is e.g. https://sie.tju.edu.cn/ or https://iso.ruc.edu.cn/index.htm
  try {
    const u = new URL(url)
    if (HOME_DOMAIN_ALLOWLIST.has(u.hostname.toLowerCase())) return false
    const path = u.pathname.replace(/\/+$/u, '')
    if (path === '' || path === '/' || /^\/(index|default|home)(\.[a-z]+)?$/iu.test(path)) {
      return true
    }
    return false
  } catch {
    return false
  }
}

function locatorContainsForbiddenText(locator: string, quote: string, url: string): string | null {
  const text = `${locator} ${quote} ${url}`.toLowerCase()
  if (text.includes('search snippet') || text.includes('websearch snippet')) {
    return 'search snippet used as evidence'
  }
  if (isHomepageUrl(url) && /home|首页/i.test(locator)) {
    return 'homepage used as evidence'
  }
  return null
}

type ProgramSummary = {
  programUrl: string
  internationalEligibilityKnown: boolean
  individualApplicationKnown: boolean
  durationKnown: boolean
  tuitionKnown: boolean
  deadlineKnown: boolean
  publishable: boolean
  quarantineReasons: string[]
}

function summarizeProgram(p: JsonRecord): ProgramSummary {
  const programUrl = typeof p.programUrl === 'string' ? p.programUrl : ''
  const intl = getEvidenceStatus(p.internationalEligibility)
  const ind = getEvidenceStatus(p.individualApplication)
  const duration = getEvidenceStatus(p.durationMonths)
  let tuitionKnown = false
  let deadlineKnown = false
  const cycles = Array.isArray(p.cycles) ? p.cycles : []
  for (const c of cycles) {
    if (c && typeof c === 'object') {
      const ci = c as JsonRecord
      if (getEvidenceStatus(ci.tuitionCny) === 'known') tuitionKnown = true
      if (getEvidenceStatus(ci.closesOn) === 'known') deadlineKnown = true
      if (getEvidenceStatus(ci.publicationEligibility) === 'future' || getEvidenceStatus(ci.publicationEligibility) === 'open') {
        // future cycles count toward future deadline coverage
      }
    }
  }
  const quarantineReasons: string[] = []
  if (!programUrl || isHomepageUrl(programUrl)) {
    quarantineReasons.push('programUrl is homepage or missing')
  }
  if (intl !== 'known' || getEvidenceValue(p.internationalEligibility) !== true) {
    quarantineReasons.push('internationalEligibility not known:true')
  }
  if (ind !== 'known' || getEvidenceValue(p.individualApplication) !== true) {
    quarantineReasons.push('individualApplication not known:true')
  }
  if (duration !== 'known') {
    quarantineReasons.push('durationMonths not known')
  }
  const publishable = quarantineReasons.length === 0
  return {
    programUrl,
    internationalEligibilityKnown: intl === 'known',
    individualApplicationKnown: ind === 'known',
    durationKnown: duration === 'known',
    tuitionKnown,
    deadlineKnown,
    publishable,
    quarantineReasons,
  }
}

function visitKnownEvidence(value: unknown, path: string, issues: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitKnownEvidence(item, `${path}[${index}]`, issues))
    return
  }
  if (!value || typeof value !== 'object') return
  const item = value as JsonRecord
  if (item.status === 'known') {
    try {
      officialHttps(item.officialUrl, `${path}.officialUrl`)
      text(item.checkedAt, `${path}.checkedAt`)
      const quote = text(item.quote, `${path}.quote`)
      if (quote.length > 350) throw new Error(`${path}.quote exceeds 350 characters`)
      text(item.locator, `${path}.locator`)
      if (!Object.hasOwn(item, 'value')) throw new Error(`${path}.value is required`)
      const reason = locatorContainsForbiddenText(
        String(item.locator ?? ''),
        quote,
        String(item.officialUrl ?? ''),
      )
      if (reason) throw new Error(`${path} uses forbidden evidence: ${reason}`)
    } catch (error) {
      issues.push(error instanceof Error ? error.message : String(error))
    }
  }
  for (const [key, child] of Object.entries(item)) {
    if (
      child !== null
      && typeof child === 'string'
      && /(?:official|program|apply|application|catalog|source)Url$/iu.test(key)
    ) {
      try {
        officialHttps(child, `${path}.${key}`)
        if (key === 'programUrl' && isHomepageUrl(child)) {
          throw new Error(`${path}.programUrl must not be a homepage`)
        }
      } catch (error) {
        issues.push(error instanceof Error ? error.message : String(error))
      }
    }
    visitKnownEvidence(child, `${path}.${key}`, issues)
  }
}

export interface ValidationResult {
  programs: number
  scholarships: number
  sourceFailures: number
  publishablePrograms: number
  quarantinedPrograms: number
  specificOfficialUrlRate: number
  internationalEligibilityEvidenceRate: number
  individualApplicationEvidenceRate: number
  durationCoverageRate: number
  tuitionCoverageRate: number
  futureDeadlineCoverageRate: number
  searchSnippetEvidenceCount: number
  homepageEvidenceCount: number
}

export function validateMiniMaxExpansion(
  task: MiniMaxExpansionTask,
  input: unknown,
): ValidationResult {
  const data = record(input, 'harvest')
  if (data.format !== 'studyinchina.minimax-official-harvest' || data.formatVersion !== 1) {
    throw new Error('harvest format/version is not supported')
  }
  if (data.batchId !== task.id) throw new Error(`batchId must equal ${task.id}`)
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

  if (task.kind === 'programs') {
    if (scholarships.length !== 0) throw new Error('program task scholarships must be empty')
    if (programs.length < expected.length) {
      throw new Error('program task must average at least one verified program per school')
    }
  } else {
    if (programs.length !== 0) throw new Error('scholarship task programs must be empty')
    if (scholarships.length === 0) {
      throw new Error('scholarship task cannot complete with zero scholarship identities')
    }
  }

  // Program-level quality gates
  const summaries: ProgramSummary[] = []
  for (const p of programs) {
    summaries.push(summarizeProgram(record(p, 'programs[]')))
  }
  const publishable = summaries.filter((s) => s.publishable)
  const quarantined = summaries.filter((s) => !s.publishable)

  if (publishable.length === 0 && programs.length > 0) {
    throw new Error('no program meets the minimum publishable criteria')
  }

  const allJson = JSON.stringify(data)
  const searchSnippetEvidenceCount = (allJson.match(/search snippet|websearch snippet/giu) ?? []).length
  const homepageEvidenceCount = (allJson.match(/homepage/i) ?? []).length

  const intlRate = publishable.length === 0 ? 0 : publishable.filter((s) => s.internationalEligibilityKnown).length / publishable.length
  const indAppRate = publishable.length === 0 ? 0 : publishable.filter((s) => s.individualApplicationKnown).length / publishable.length
  const durationRate = publishable.length === 0 ? 0 : publishable.filter((s) => s.durationKnown).length / publishable.length
  const tuitionRate = publishable.length === 0 ? 0 : publishable.filter((s) => s.tuitionKnown).length / publishable.length
  // futureDeadline: known closesOn OR officially_not_announced with non-null future cycle
  const futureDeadlineRate = (() => {
    if (publishable.length === 0) return 0
    let hit = 0
    for (let i = 0; i < programs.length; i++) {
      const p = record(programs[i], 'programs[]')
      const s = summaries[i]
      if (!s.publishable) continue
      if (s.deadlineKnown) {
        hit++
      } else {
        const cycles = Array.isArray(p.cycles) ? p.cycles : []
        const hasOfficiallyNotAnnounced = cycles.some((c) => {
          if (!c || typeof c !== 'object') return false
          const ci = c as JsonRecord
          return getEvidenceStatus(ci.closesOn) === 'officially_not_announced'
            && (getEvidenceValue(ci.publicationEligibility) === 'future' || getEvidenceValue(ci.publicationEligibility) === 'not_announced')
        })
        if (hasOfficiallyNotAnnounced) hit++
      }
    }
    return hit / publishable.length
  })()

  if (intlRate < MIN_PUBLISHABLE.internationalEligibilityEvidenceRate) {
    throw new Error(`internationalEligibilityEvidenceRate ${intlRate.toFixed(2)} < 1.00`)
  }
  if (indAppRate < MIN_PUBLISHABLE.individualApplicationEvidenceRate) {
    throw new Error(`individualApplicationEvidenceRate ${indAppRate.toFixed(2)} < 1.00`)
  }
  if (durationRate < MIN_PUBLISHABLE.durationRate) {
    throw new Error(`durationCoverageRate ${durationRate.toFixed(2)} < 0.60`)
  }
  if (tuitionRate < MIN_PUBLISHABLE.tuitionRate) {
    throw new Error(`tuitionCoverageRate ${tuitionRate.toFixed(2)} < 0.50`)
  }
  if (futureDeadlineRate < MIN_PUBLISHABLE.futureDeadlineRate) {
    throw new Error(`futureDeadlineCoverageRate ${futureDeadlineRate.toFixed(2)} < 0.40`)
  }
  if (searchSnippetEvidenceCount > 0) {
    throw new Error(`search snippet evidence count ${searchSnippetEvidenceCount} > 0`)
  }
  if (homepageEvidenceCount > 0) {
    // Soft signal, not strictly enforced
  }

  const issues: string[] = []
  visitKnownEvidence(data, 'harvest', issues)
  if (issues.length > 0) {
    throw new Error(`evidence validation failed:\n- ${issues.slice(0, 20).join('\n- ')}`)
  }

  const specificOfficialUrlRate = publishable.length === 0 ? 0 : publishable.filter((s) => !!s.programUrl && !isHomepageUrl(s.programUrl)).length / publishable.length
  return {
    programs: programs.length,
    scholarships: scholarships.length,
    sourceFailures: sourceFailures.length,
    publishablePrograms: publishable.length,
    quarantinedPrograms: quarantined.length,
    specificOfficialUrlRate,
    internationalEligibilityEvidenceRate: intlRate,
    individualApplicationEvidenceRate: indAppRate,
    durationCoverageRate: durationRate,
    tuitionCoverageRate: tuitionRate,
    futureDeadlineCoverageRate: futureDeadlineRate,
    searchSnippetEvidenceCount,
    homepageEvidenceCount,
  }
}

function argument(name: string): string | null {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] ?? null : null
}

async function main(): Promise<void> {
  const taskId = argument('--task')
  if (!taskId) throw new Error('--task is required')
  const queue = JSON.parse(
    await readFile(resolve('quality/minimax-expansion/queue.v2.json'), 'utf8'),
  ) as MiniMaxExpansionQueue
  const task = queue.tasks.find((candidate) => candidate.id === taskId)
  if (!task) throw new Error(`Unknown expansion queue task: ${taskId}`)
  const output = resolve(task.outputJsonPath)
  const bytes = await readFile(output)
  const data = JSON.parse(bytes.toString('utf8')) as unknown
  const counts = validateMiniMaxExpansion(task, data)
  const marker = resolve(`quality/minimax-expansion/completed/${task.id}.json`)
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