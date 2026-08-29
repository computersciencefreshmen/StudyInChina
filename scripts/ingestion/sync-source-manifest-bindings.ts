import {
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { resolve, sep } from 'node:path'

import { sourceManifestSchema } from '../../workers/ingestion/src/manifest-schema'
import { sourceBindingsForSources } from '../source-manifest-contract'

function jsonFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = resolve(directory, entry.name)
      if (entry.isDirectory()) return jsonFiles(path)
      if (!entry.isFile() || !entry.name.endsWith('.json')) return []
      if (/^targets(?:\.|-).*\.json$/i.test(entry.name)) return []
      return [path]
    })
    .sort((left, right) => left.localeCompare(right, 'en'))
}

function assertInsideRepository(path: string): void {
  const repositoryRoot = realpathSync(process.cwd())
  const resolved = realpathSync(path)
  if (resolved !== repositoryRoot && !resolved.startsWith(`${repositoryRoot}${sep}`)) {
    throw new Error(`Source manifest directory is outside the repository: ${resolved}`)
  }
  if (!lstatSync(resolved).isDirectory()) {
    throw new Error(`Source manifest path is not a directory: ${resolved}`)
  }
}

function synchronizeFile(filePath: string): 'updated' | 'unchanged' | 'skipped' {
  const text = readFileSync(filePath, 'utf8')
  const document = JSON.parse(text) as Record<string, unknown>
  if (document.version !== 2 || !Array.isArray(document.sources)) return 'skipped'

  const sources = document.sources.map((source) => sourceManifestSchema.parse(source))
  const expectedBindings = sourceBindingsForSources(sources)
  if (document.sourceBindings !== undefined) {
    if (JSON.stringify(document.sourceBindings) !== JSON.stringify(expectedBindings)) {
      throw new Error(`Existing sourceBindings differ from the locked derivation: ${filePath}`)
    }
    return 'unchanged'
  }

  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  const marker = /^  "officialHosts": [^\r\n]+,$/m
  const match = text.match(marker)
  if (!match) throw new Error(`Could not locate compact officialHosts field: ${filePath}`)
  const bindingLines = [
    '  "sourceBindings": [',
    ...expectedBindings.map((binding, index) => (
      `    ${JSON.stringify(binding)}${index === expectedBindings.length - 1 ? '' : ','}`
    )),
    '  ],',
  ].join(newline)
  const updated = text.replace(marker, `${match[0]}${newline}${bindingLines}`)
  writeFileSync(filePath, updated, 'utf8')
  return 'updated'
}

const targetDirectory = resolve(
  process.argv[2] ?? 'content/source-manifests/pilot',
)
assertInsideRepository(targetDirectory)

const summary = { updated: 0, unchanged: 0, skipped: 0 }
for (const filePath of jsonFiles(targetDirectory)) {
  summary[synchronizeFile(filePath)] += 1
}

console.log(JSON.stringify({ directory: targetDirectory, ...summary }))
