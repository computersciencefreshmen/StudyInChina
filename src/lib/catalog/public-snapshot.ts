import type { DataBundle } from '@/lib/data/types'
import { readIdentityAcceptances } from '@/lib/data/identity-acceptance-store'
import { readFieldVerifications } from '@/lib/data/field-verification-store'
import { selectPublishedData } from '@/lib/data/publication'
import { selectDiscoveryData } from '@/lib/data/discovery'
import { freezeSnapshot } from '@/lib/data/file-snapshot'
import { directoryRevision } from './directory-revision'
import { deriveCatalogRelease } from './release'

type Snapshot = ReturnType<typeof buildSnapshot>
const snapshots = new WeakMap<DataBundle, { today: string; identities: unknown; fields: unknown; value: Snapshot }>()

function buildSnapshot(bundle: DataBundle, today: string, identities: ReturnType<typeof readIdentityAcceptances>, fields: ReturnType<typeof readFieldVerifications>, immutable = true) {
  const value = {
    current: selectPublishedData(bundle, today, identities),
    directory: selectDiscoveryData(bundle, today, identities, fields),
    revision: directoryRevision(bundle, today, identities, fields),
    release: deriveCatalogRelease(bundle),
  }
  return immutable ? freezeSnapshot(value) : value
}

/** One latest day/evidence generation per immutable bundle, local to this isolate.
 * The strict stores check all receipt dependencies BEFORE any cached projection is used.
 * Mutable injected bundles/evidence deliberately bypass caching (tests and external loaders).
 */
export function getPublicCatalogSnapshot(bundle: DataBundle, today: string) {
  const identities = readIdentityAcceptances(undefined, { strictProjection: true }), fields = readFieldVerifications()
  const cacheable = Object.isFrozen(bundle) && Object.isFrozen(identities) && Object.isFrozen(fields)
  const cached = cacheable ? snapshots.get(bundle) : undefined
  if (cached && cached.today === today && cached.identities === identities && cached.fields === fields) return cached.value
  const value = buildSnapshot(bundle, today, identities, fields, cacheable)
  if (cacheable) snapshots.set(bundle, { today, identities, fields, value })
  return value
}
