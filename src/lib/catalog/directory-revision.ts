import { createHash } from 'node:crypto'
import type { DataBundle } from '@/lib/data/types'
import { canonicalIdentityJson, type IdentityAcceptance } from '@/lib/data/identity-acceptance'
import type { FieldVerification } from '@/lib/data/field-verification'

/** Bind pagination to the exact facts and review ledgers used by this projection. */
export function directoryRevision(bundle: DataBundle, today: string, identities: IdentityAcceptance[], fields: FieldVerification[]): string {
  return createHash('sha256').update('studyinchina.directory-projection.v1\n').update(today).update('\n')
    .update(JSON.stringify(bundle)).update('\n').update(canonicalIdentityJson(identities)).update('\n')
    .update(canonicalIdentityJson(fields)).digest('hex')
}
