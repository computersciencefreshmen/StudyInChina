import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { canonicalIdentityJson, hasRequiredProgramNameScope, identityAcceptanceLedgerSchema, scopedNameReceiptMatches, type IdentityAcceptance } from './identity-acceptance'

/** Invalid/missing review evidence must never widen public discovery. */
export function readIdentityAcceptances(dataDirectory = join(process.cwd(), 'content', 'data'), options: { strictProjection?: boolean } = {}): IdentityAcceptance[] {
  try {
    const file = join(dataDirectory, 'identity-acceptances.json')
    if (!existsSync(file)) return [] // Legacy catalogues without a ledger remain compatible.
    const entries = identityAcceptanceLedgerSchema.parse(JSON.parse(readFileSync(file, 'utf8'))).entries
    if (options.strictProjection) {
      const root = realpathSync(resolve(dataDirectory, '../..')), receipts = new Map<string, { value: unknown; sha256: string } | null>()
      for (const entry of entries) {
        if (!hasRequiredProgramNameScope(entry)) throw Error('identity_scoped_name_receipt_invalid')
        const candidate = resolve(root, entry.receiptPath), relativeCandidate = relative(root, candidate)
        if (!relativeCandidate || relativeCandidate.startsWith('..') || isAbsolute(relativeCandidate)) throw Error('identity_scoped_name_receipt_invalid')
        if (!receipts.has(candidate)) {
          // Old installations need not ship unscoped receipts. Available
          // receipts retain their scope even if both ledger fields are erased.
          if (!existsSync(candidate)) receipts.set(candidate, null)
          else {
            const path = realpathSync(candidate), inside = relative(root, path)
            if (!inside || inside.startsWith('..') || isAbsolute(inside)) throw Error('identity_scoped_name_receipt_invalid')
            const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
            if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('identity_scoped_name_receipt_invalid')
            const { sha256, ...content } = value as Record<string, unknown>
            if (typeof sha256 !== 'string' || createHash('sha256').update(canonicalIdentityJson(content)).digest('hex') !== sha256) throw Error('identity_scoped_name_receipt_invalid')
            receipts.set(candidate, { value, sha256 })
          }
        }
        const receipt = receipts.get(candidate)
        if (!receipt) {
          if (entry.verifiedName || entry.verifiedSourceUrl) throw Error('identity_scoped_name_receipt_invalid')
          continue
        }
        if (receipt.sha256 !== entry.receiptSha256 || !scopedNameReceiptMatches(entry, receipt.value)) throw Error('identity_scoped_name_receipt_invalid')
      }
    }
    return entries
  } catch (error) {
    if (options.strictProjection) throw error // Never turn a corrupt scoped review into unrestricted current names.
    return []
  }
}
