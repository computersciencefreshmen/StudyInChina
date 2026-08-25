import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { getTodayDate } from '../../src/lib/data/freshness'
import type { ContentStatus } from '../../src/lib/data/types'

const DATA_FILES = ['cities', 'universities', 'programs', 'admission-cycles', 'scholarships'] as const

export type AuditedRecord = {
  id: string
  status: ContentStatus
  reviewAfter: string
}

export type RolloverResult<T extends AuditedRecord> = {
  records: T[]
  changedIds: string[]
}

export function rolloverOverdueRecords<T extends AuditedRecord>(
  records: readonly T[],
  today: string,
): RolloverResult<T> {
  const changedIds: string[] = []
  const next = records.map((record) => {
    if (record.status !== 'verified' || record.reviewAfter >= today) return record
    changedIds.push(record.id)
    return { ...record, status: 'stale' as const }
  })

  return { records: next, changedIds }
}

export function parseRolloverArgs(argv: string[]): { apply: boolean; today: string } {
  let apply = false
  let today = getTodayDate()

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--apply') {
      apply = true
      continue
    }
    if (argument === '--today') {
      const value = argv[index + 1]
      if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new Error('--today must use YYYY-MM-DD')
      }
      const parsed = new Date(`${value}T00:00:00.000Z`)
      if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
        throw new Error('--today must be a valid calendar date')
      }
      today = value
      index += 1
      continue
    }
    throw new Error(`Unknown argument: ${argument}`)
  }

  return { apply, today }
}

export function runRollover({
  apply,
  today,
  root = process.cwd(),
}: {
  apply: boolean
  today: string
  root?: string
}): { changedIds: string[] } {
  const changedIds: string[] = []

  for (const file of DATA_FILES) {
    const path = join(root, 'content', 'data', `${file}.json`)
    const records = JSON.parse(readFileSync(path, 'utf8')) as AuditedRecord[]
    const result = rolloverOverdueRecords(records, today)
    changedIds.push(...result.changedIds)
    if (apply && result.changedIds.length > 0) {
      writeFileSync(path, `${JSON.stringify(result.records, null, 2)}\n`, 'utf8')
    }
  }

  return { changedIds }
}

function main() {
  const options = parseRolloverArgs(process.argv.slice(2))
  const result = runRollover(options)
  const mode = options.apply ? 'updated' : 'would update'
  console.log(`${mode} ${result.changedIds.length} overdue verified record(s) for ${options.today}.`)
  if (result.changedIds.length > 0) console.log(result.changedIds.join('\n'))
  if (!options.apply && result.changedIds.length > 0) {
    console.log('Re-run with --apply to mark these records stale without extending their evidence horizon.')
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) main()
