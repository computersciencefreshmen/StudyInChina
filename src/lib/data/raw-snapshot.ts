import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { bundleSchema } from './schema'
import type { DataBundle } from './types'
import { createFileSnapshotCache } from './file-snapshot'

const cachedBundle = createFileSnapshotCache<DataBundle>()
const files = { sources: 'sources', cities: 'cities', universities: 'universities', programs: 'programs',
  admissionCycles: 'admission-cycles', scholarships: 'scholarships' }

/** Shared by synchronous pages and async repositories; failures remain retryable. */
export function readValidatedCatalogBundle(directory = join(process.cwd(), 'content', 'data')): DataBundle {
  return cachedBundle(resolve(directory), depend => bundleSchema.parse(Object.fromEntries(
    Object.entries(files).map(([collection, name]) => {
      const file = join(directory, `${name}.json`)
      depend(file)
      return [collection, JSON.parse(readFileSync(file, 'utf8'))]
    }),
  )))
}
