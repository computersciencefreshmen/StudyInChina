import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  canonicalJson,
  createInitialGoldRegistry,
  goldRegistrySchema,
  type GoldRegistry,
} from './gold-gate'

const projectRoot = process.cwd()
const registryPath = join(projectRoot, 'quality', 'gold', 'registry.json')

function buildSyncedRegistry(): GoldRegistry {
  const generated = createInitialGoldRegistry(projectRoot)
  if (!existsSync(registryPath)) return generated

  const existing = goldRegistrySchema.parse(
    JSON.parse(readFileSync(registryPath, 'utf8')),
  )
  const previousById = new Map(
    existing.entries.map((entry) => [entry.sourceId, entry]),
  )

  generated.entries = generated.entries.map((entry) => {
    const previous = previousById.get(entry.sourceId)
    if (!previous) return entry
    if (previous.manifestFingerprint === entry.manifestFingerprint) {
      return {
        ...entry,
        snapshot: previous.snapshot,
        annotation: previous.annotation,
      }
    }
    if (
      previous.snapshot.status === 'captured' ||
      previous.annotation.status === 'annotated'
    ) {
      throw new Error(
        `${entry.sourceId}: manifest identity changed while curated evidence exists; review and migrate this entry explicitly`,
      )
    }
    return entry
  })
  return goldRegistrySchema.parse(generated)
}

const next = buildSyncedRegistry()
const formatted = `${JSON.stringify(next, null, 2)}\n`
const argument = process.argv[2] ?? '--check'

if (argument === '--print') {
  process.stdout.write(formatted)
} else if (argument === '--write') {
  writeFileSync(registryPath, formatted, 'utf8')
  console.log(`Wrote deterministic official gold registry to ${registryPath}`)
} else if (argument === '--check') {
  if (!existsSync(registryPath)) {
    throw new Error('Official gold registry is missing; run quality:gold:sync -- --write')
  }
  const current = goldRegistrySchema.parse(
    JSON.parse(readFileSync(registryPath, 'utf8')),
  )
  if (canonicalJson(current) !== canonicalJson(next)) {
    throw new Error('Official gold registry is stale; run quality:gold:sync -- --write')
  }
  console.log(
    `Official gold registry is stable: ${next.entries.length} manifest-derived sources.`,
  )
} else {
  throw new Error(`Unknown argument ${argument}; use --check, --print, or --write`)
}
