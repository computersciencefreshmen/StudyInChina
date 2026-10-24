import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { identityAcceptanceLedgerSchema, type IdentityAcceptance } from './identity-acceptance'

/** Invalid/missing review evidence must never widen public discovery. */
export function readIdentityAcceptances(dataDirectory = join(process.cwd(), 'content', 'data')): IdentityAcceptance[] {
  try {
    return identityAcceptanceLedgerSchema.parse(JSON.parse(readFileSync(join(dataDirectory, 'identity-acceptances.json'), 'utf8'))).entries
  } catch { return [] }
}
