import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fieldVerificationLedgerSchema, type FieldVerification } from './field-verification'
import { createFileSnapshotCache } from './file-snapshot'

const cachedLedger = createFileSnapshotCache<FieldVerification[]>()

export function readFieldVerifications(directory = join(process.cwd(), 'content', 'data')): FieldVerification[] {
  try { return cachedLedger(resolve(directory), depend => {
    const file = join(directory, 'field-verifications.json')
    depend(file)
    if (!existsSync(file)) return []
    return fieldVerificationLedgerSchema.parse(JSON.parse(readFileSync(file, 'utf8'))).entries
  }) }
  catch { return [] }
}
