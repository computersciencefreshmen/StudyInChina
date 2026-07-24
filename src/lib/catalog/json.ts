import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { bundleSchema } from '@/lib/data/schema'
import type { DataBundle } from '@/lib/data/types'
import { deriveCatalogRelease } from './release'
import type { CatalogBundleLoader, CatalogRelease, CatalogRepository } from './types'

const JSON_FILES = {
  sources: 'sources',
  cities: 'cities',
  universities: 'universities',
  programs: 'programs',
  admissionCycles: 'admission-cycles',
  scholarships: 'scholarships',
} as const

export function readJsonCatalogBundle(dataDirectory = join(process.cwd(), 'content', 'data')): unknown {
  return Object.fromEntries(
    Object.entries(JSON_FILES).map(([collection, fileName]) => [
      collection,
      JSON.parse(readFileSync(join(dataDirectory, `${fileName}.json`), 'utf8')),
    ]),
  )
}

export class JsonCatalogRepository implements CatalogRepository {
  readonly mode = 'json' as const
  private bundlePromise: Promise<DataBundle> | undefined

  constructor(private readonly loader: CatalogBundleLoader = readJsonCatalogBundle) {}

  getBundle(): Promise<DataBundle> {
    if (!this.bundlePromise) {
      this.bundlePromise = Promise.resolve()
        .then(() => this.loader())
        .then((value) => bundleSchema.parse(value))
        .catch((error: unknown) => {
          this.bundlePromise = undefined
          throw error
        })
    }

    return this.bundlePromise
  }

  async getRelease(): Promise<CatalogRelease> {
    return deriveCatalogRelease(await this.getBundle())
  }
}

export function createJsonCatalogRepository(loader?: CatalogBundleLoader): CatalogRepository {
  return new JsonCatalogRepository(loader)
}
