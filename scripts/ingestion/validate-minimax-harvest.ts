import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import type {
  MiniMaxHarvestQueue,
  MiniMaxHarvestTask,
} from './build-minimax-harvest-queue'

type JsonRecord = Record<string, unknown>

const THIRD_PARTY_HOSTS = [
  'applychina',
  'bachelorsportal',
  'china-admissions',
  'cucas',
  'mastersportal',
  'studyinchina.com',
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
      } catch (error) {
        issues.push(error instanceof Error ? error.message : String(error))
      }
    }
    visitKnownEvidence(child, `${path}.${key}`, issues)
  }
}

function institutionReference(value: unknown, label: string): string {
  const item = record(value, label)
  return text(item.institutionId ?? item.institutionRef, `${label}.institutionId`)
}

function scholarshipInstitutions(value: unknown, label: string): string[] {
  const item = record(value, label)
  return array(item.institutionIds, `${label}.institutionIds`).map(
    (institution, index) => text(institution, `${label}.institutionIds[${index}]`),
  )
}

export function validateMiniMaxHarvest(
  task: MiniMaxHarvestTask,
  input: unknown,
): { programs: number; scholarships: number; sourceFailures: number } {
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
    programs.forEach((program, index) => {
      const institution = institutionReference(program, `programs[${index}]`)
      if (!expected.includes(institution)) {
        throw new Error(`programs[${index}] belongs to an unassigned institution`)
      }
    })
  } else {
    if (programs.length !== 0) throw new Error('scholarship task programs must be empty')
    if (scholarships.length === 0) {
      throw new Error('scholarship task cannot complete with zero scholarship identities')
    }
    const covered = new Set<string>()
    scholarships.forEach((scholarship, index) => {
      for (const institution of scholarshipInstitutions(
        scholarship,
        `scholarships[${index}]`,
      )) {
        if (!expected.includes(institution)) {
          throw new Error(`scholarships[${index}] belongs to an unassigned institution`)
        }
        covered.add(institution)
      }
    })
    for (const institution of expected) {
      if (covered.has(institution)) continue
      const failure = sourceFailures
        .map((value) => record(value, 'sourceFailure'))
        .find((value) => (
          value.institutionId === institution
          && value.category === 'scholarships'
          && Array.isArray(value.discoveryAttempts)
          && value.discoveryAttempts.length >= 3
        ))
      if (!failure) {
        throw new Error(
          `${institution} needs a scholarship or at least three documented official discovery attempts`,
        )
      }
    }
  }

  const issues: string[] = []
  visitKnownEvidence(data, 'harvest', issues)
  if (issues.length > 0) {
    throw new Error(`evidence validation failed:\n- ${issues.slice(0, 20).join('\n- ')}`)
  }
  return {
    programs: programs.length,
    scholarships: scholarships.length,
    sourceFailures: sourceFailures.length,
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
    await readFile(resolve('quality/minimax-harvest/queue.v1.json'), 'utf8'),
  ) as MiniMaxHarvestQueue
  const task = queue.tasks.find((candidate) => candidate.id === taskId)
  if (!task) throw new Error(`Unknown queue task: ${taskId}`)
  const output = resolve(task.outputJsonPath)
  const bytes = await readFile(output)
  const data = JSON.parse(bytes.toString('utf8')) as unknown
  const counts = validateMiniMaxHarvest(task, data)
  const marker = resolve(`quality/minimax-harvest/completed/${task.id}.json`)
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
