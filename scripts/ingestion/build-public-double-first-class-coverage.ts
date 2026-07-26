import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  buildPublicDoubleFirstClassCoverageV2,
} from './public-double-first-class-coverage'

type JsonRecord = Record<string, unknown>

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const targetPath = join(
  rootDirectory,
  'content',
  'source-manifests',
  'double-first-class',
  'targets.v1.json',
)
const cohortDirectory = join(
  rootDirectory,
  'content',
  'source-registry',
  'cohorts',
)
const reconciliationDirectory = join(
  rootDirectory,
  'content',
  'source-registry',
  'reconciliation',
)
const outputPath = join(
  rootDirectory,
  'src',
  'data',
  'generated',
  'double-first-class-coverage.json',
)

export function buildPublicDoubleFirstClassCoverage(): JsonRecord {
  return buildPublicDoubleFirstClassCoverageV2({
    targetPath,
    cohortDirectory,
    reconciliationDirectory,
  })
}

export function writePublicDoubleFirstClassCoverage(): JsonRecord {
  const output = buildPublicDoubleFirstClassCoverage()
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
  return output
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) {
  const output = writePublicDoubleFirstClassCoverage()
  process.stdout.write(`${JSON.stringify({
    outputPath,
    totals: output.totals,
  })}\n`)
}
