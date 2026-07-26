import {
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  loadSourceReconciliations,
  type ReconciliationStatus,
} from './source-reconciliation'

type JsonRecord = Record<string, unknown>
type Target = {
  targetId: string
  officialNameZh: string
}

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const targetPath = join(
  rootDirectory,
  'content',
  'source-manifests',
  'double-first-class',
  'targets.v1.json',
)
const reconciliationDirectory = join(
  rootDirectory,
  'content',
  'source-registry',
  'reconciliation',
)
const outputPath = join(
  rootDirectory,
  '.pipeline-build',
  'source-reconciliation.sql',
)

function sqlValue(value: string | null): string {
  return value === null ? 'NULL' : `'${value.replaceAll("'", "''")}'`
}

function pipelineStatus(status: ReconciliationStatus): string {
  return status === 'verified_official' ? 'discovered' : status
}

function nextCheckAt(checkedAt: string): string {
  const date = new Date(`${checkedAt}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + 30)
  return date.toISOString().slice(0, 10)
}

export function buildSourceReconciliationImport(): {
  sql: string
  counts: {
    institutions: number
    categories: number
    discovered: number
    sourceUnavailable: number
    officiallyNotProvided: number
  }
} {
  const registry = JSON.parse(readFileSync(targetPath, 'utf8')) as JsonRecord
  if (!Array.isArray(registry.targets)) throw new Error('target registry is invalid')
  const targets = registry.targets as Target[]
  const targetByName = new Map(targets.map((target) => [
    target.officialNameZh,
    target.targetId,
  ]))
  const reconciliations = loadSourceReconciliations(reconciliationDirectory)
  if (reconciliations.length !== 17) {
    throw new Error(`final source reconciliation must contain 17 institutions, got ${reconciliations.length}`)
  }
  // Wrangler's remote D1 bulk import rejects explicit BEGIN/COMMIT
  // statements. Each UPDATE remains idempotent, so the generated file can
  // be retried safely after transport or quota failures.
  const statements = ['PRAGMA foreign_keys = ON;']
  const statuses: ReconciliationStatus[] = []
  for (const institution of reconciliations) {
    const targetId = targetByName.get(institution.institutionNameZh)
    if (!targetId) {
      throw new Error(`${institution.institutionNameZh} is not in the target registry`)
    }
    statements.push(`UPDATE institution_targets
SET onboarding_status = CASE
      WHEN onboarding_status = 'registered' THEN 'source_discovery'
      ELSE onboarding_status
    END,
    updated_at = ${sqlValue(`${institution.checkedAt}T00:00:00.000Z`)}
WHERE target_id = ${sqlValue(targetId)};`)
    for (const category of institution.categories) {
      statuses.push(category.status)
      const note = `${category.note}\nEvidence: ${category.evidenceUrl}`
      statements.push(`UPDATE institution_target_source_coverage
SET coverage_status = ${sqlValue(pipelineStatus(category.status))},
    official_url = ${sqlValue(category.officialUrl)},
    registered_source_id = NULL,
    note = ${sqlValue(note)},
    checked_at = ${sqlValue(category.checkedAt)},
    next_check_at = ${sqlValue(nextCheckAt(category.checkedAt))},
    updated_at = ${sqlValue(`${category.checkedAt}T00:00:00.000Z`)}
WHERE target_id = ${sqlValue(targetId)}
  AND source_category = ${sqlValue(category.sourceCategory)}
  AND coverage_status NOT IN ('registered', 'parser_pending');`)
    }
  }
  return {
    sql: `${statements.join('\n\n')}\n`,
    counts: {
      institutions: reconciliations.length,
      categories: statuses.length,
      discovered: statuses.filter((status) => status === 'verified_official').length,
      sourceUnavailable: statuses.filter((status) => status === 'source_unavailable').length,
      officiallyNotProvided: statuses.filter(
        (status) => status === 'officially_not_provided',
      ).length,
    },
  }
}

export function writeSourceReconciliationImport(): ReturnType<
  typeof buildSourceReconciliationImport
> {
  const output = buildSourceReconciliationImport()
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, output.sql, 'utf8')
  return output
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) {
  const output = writeSourceReconciliationImport()
  process.stdout.write(`${JSON.stringify({ outputPath, counts: output.counts })}\n`)
}
