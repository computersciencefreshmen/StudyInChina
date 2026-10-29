import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { identityAcceptanceLedgerSchema, scopedNameReceiptMatches, type IdentityAcceptance } from './identity-acceptance'

/** Invalid/missing review evidence must never widen public discovery. */
export function readIdentityAcceptances(dataDirectory = join(process.cwd(), 'content', 'data'), options: { strictProjection?: boolean } = {}): IdentityAcceptance[] {
  try {
    const file = join(dataDirectory, 'identity-acceptances.json')
    if (!existsSync(file)) return [] // Legacy catalogues without a ledger remain compatible.
    const entries = identityAcceptanceLedgerSchema.parse(JSON.parse(readFileSync(file, 'utf8'))).entries
    if (options.strictProjection) for (const entry of entries) if (entry.verifiedName) {
      const root = realpathSync(resolve(dataDirectory, '../..')), path = realpathSync(resolve(root, entry.receiptPath)), inside = relative(root, path)
      if (!inside || inside.startsWith('..') || isAbsolute(inside)
        || !scopedNameReceiptMatches(entry, JSON.parse(readFileSync(path, 'utf8')))) throw Error('identity_scoped_name_receipt_invalid')
    }
    return entries
  } catch (error) {
    if (options.strictProjection) throw error // Never turn a corrupt scoped review into unrestricted current names.
    return []
  }
}
