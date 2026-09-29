import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { assessCatalogSnapshot } from './assess-catalog-snapshot'
import { applyCatalogSnapshotFiles, readCatalogSnapshotBaseline } from './apply-catalog-snapshot'

const run = promisify(execFile)
const config = resolve('workers/catalog-api/wrangler.jsonc')
const cli = resolve('node_modules/wrangler/bin/wrangler.js')
const releaseQuery = `SELECT release.release_id, release.generated_at, compatibility.artifact_key, compatibility.content_sha256, compatibility.byte_length FROM current_release release JOIN release_compatibility_artifacts compatibility ON compatibility.release_id = release.release_id;`

export async function pullCatalogSnapshot(output: string, apply = false) {
  mkdirSync(output, { recursive: true })
  const wrangler = (args: string[]) => run(process.execPath, [cli, ...args, '--config', config, '--remote'], { encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024, shell: false })
  const query = await wrangler(['d1', 'execute', 'CATALOG_DB', '--command', releaseQuery, '--json'])
  const pages = JSON.parse(query.stdout) as { success?: boolean; results?: Record<string, unknown>[] }[]
  const row = pages.length === 1 && pages[0].success === true && pages[0].results?.length === 1 ? pages[0].results[0] : undefined
  if (!row || typeof row.release_id !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(row.release_id)
    || row.artifact_key !== `releases/${row.release_id}/compat-envelope.json`
    || typeof row.content_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.content_sha256)
    || typeof row.byte_length !== 'number' || row.byte_length < 2 || row.byte_length > 50 * 1024 * 1024) throw new Error('invalid_catalog_snapshot_metadata')
  const file = join(output, 'compat-envelope.json')
  await wrangler(['r2', 'object', 'get', `studyinchina-releases/${row.artifact_key}`, '--file', file])
  const bytes = readFileSync(file)
  if (bytes.byteLength !== row.byte_length) throw new Error('snapshot_size_mismatch')
  const before = readCatalogSnapshotBaseline(resolve('content/data'))
  const assessed = assessCatalogSnapshot(before.bundle, bytes, row.content_sha256)
  if (assessed.release.id !== row.release_id) throw new Error('snapshot_release_mismatch')
  const report = { eligible: assessed.eligible, issues: assessed.issues, release: assessed.release, applied: false, application: null as ReturnType<typeof applyCatalogSnapshotFiles> | null }
  // This reads an immutable pinned release. A later active release cannot alter these bytes.
  if (assessed.eligible && apply) {
    report.application = applyCatalogSnapshotFiles(before, assessed.bundle)
    report.applied = true
  }
  writeFileSync(join(output, 'assessment.json'), `${JSON.stringify(report, null, 2)}\n`)
  return report
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const outputIndex = process.argv.indexOf('--output')
  const output = resolve(outputIndex < 0 ? '.pipeline-build/automation-snapshot' : process.argv[outputIndex + 1])
  if (!process.argv.includes('--remote')) throw new Error('--remote must be explicit')
  pullCatalogSnapshot(output, process.argv.includes('--apply')).then(report => {
    console.log(JSON.stringify({ eligible: report.eligible, issues: report.issues.length, applied: report.applied, release: report.release.id, output }))
    if (!report.eligible) process.exitCode = 2
  }).catch(error => { console.error(error instanceof Error ? error.message : 'snapshot_sync_failed'); process.exitCode = 1 })
}
