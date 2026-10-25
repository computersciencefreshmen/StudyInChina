import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fieldVerificationLedgerSchema, type FieldVerification } from './field-verification'

export function readFieldVerifications(directory = join(process.cwd(), 'content', 'data')): FieldVerification[] {
  try { return fieldVerificationLedgerSchema.parse(JSON.parse(readFileSync(join(directory, 'field-verifications.json'), 'utf8'))).entries }
  catch { return [] }
}
