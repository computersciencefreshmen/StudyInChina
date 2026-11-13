import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const args = process.argv.slice(2)
const option = name => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : undefined }
const config = option('--config'), output = option('--output'), profile = option('--profile')
const accountId = option('--source-account'), kind = option('--kind')
if (!config || !output || !profile || !/^[a-f0-9]{32}$/u.test(accountId ?? '') || !['pipeline', 'catalog'].includes(kind)) {
  throw new Error('Usage: export-account-migration-d1.mjs --config <source-config> --output <private-dir> --profile <source-profile> --source-account <id> --kind pipeline|catalog')
}
const configPath = resolve(config), directory = resolve(output)
const parsed = ts.parseConfigFileTextToJson(configPath, readFileSync(configPath, 'utf8'))
if (parsed.error || parsed.config.account_id !== accountId) throw new Error('source_account_configuration_mismatch')
const databaseName = `studyinchina-${kind}`
const bindings = parsed.config.d1_databases?.filter(binding => binding.database_name === databaseName)
if (bindings?.length !== 1 || !/^[a-f0-9-]{36}$/u.test(bindings[0].database_id ?? '')) throw new Error('source_database_configuration_invalid')
mkdirSync(directory, { recursive: true })
const reportPath = join(directory, `${kind}.export.json`), sqlPath = join(directory, `${kind}.data.sql`)
// A distinct output directory is required for a new capture. Never overwrite a
// previous checkpoint or treat this read-only preflight as a frozen snapshot.
for (const path of [reportPath, sqlPath]) {
  try { statSync(path); throw new Error('export_output_already_exists') }
  catch (error) { if (error.code !== 'ENOENT') throw error }
}
let sequence = 0
function wrangler(command) {
  sequence++
  const result = spawnSync(process.execPath, [join(root, 'node_modules/wrangler/bin/wrangler.js'), ...command,
    '--config', configPath, '--profile', profile], {
    cwd: root, windowsHide: true, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, WRANGLER_LOG_PATH: join(directory, `${kind}.wrangler-debug.log`) },
  })
  writeFileSync(join(directory, `${kind}.${sequence}.private-cli.log`), `${result.stdout ?? ''}\n${result.stderr ?? ''}`)
  if (result.error || result.status !== 0) throw new Error('source_export_command_failed_see_private_log')
  return result.stdout
}
const metadata = JSON.parse(wrangler(['d1', 'info', databaseName, '--json']))
if (metadata.uuid !== bindings[0].database_id || metadata.name !== databaseName) throw new Error('source_database_identity_mismatch')
// Direct PRAGMA uses D1's metadata path. Selecting from its table-valued
// equivalent can incur normal read allowance even when no user rows are read.
const query = 'PRAGMA table_list'
const discovery = JSON.parse(wrangler(['d1', 'execute', databaseName, '--remote', '--command', query, '--json']))
if (!Array.isArray(discovery) || !discovery.length || discovery.some(result => result.success !== true || !Array.isArray(result.results))) throw new Error('source_table_discovery_failed')
const tables = discovery.flatMap(result => result.results)
  .filter(row => row.schema === 'main' && row.type === 'table' && typeof row.name === 'string'
    && !row.name.startsWith('sqlite_') && !row.name.startsWith('_cf_') && row.name !== 'd1_migrations')
  .map(row => row.name).sort()
if (!tables.length || new Set(tables).size !== tables.length || tables.some(name => !/^[a-z][a-z0-9_]*$/u.test(name))) throw new Error('source_table_manifest_invalid')
wrangler(['d1', 'export', databaseName, '--remote', '--no-schema', '--skip-confirmation', '--output', sqlPath,
  ...tables.flatMap(name => ['--table', name])])
const bytes = statSync(sqlPath).size
if (!bytes) throw new Error('source_export_empty')
const sha256 = createHash('sha256').update(readFileSync(sqlPath)).digest('hex')
const manifest = { format: 'studyinchina.account-migration-d1-export', version: 1, observedAt: new Date().toISOString(),
  kind, accountId, databaseId: metadata.uuid, databaseName, tables, bytes, sha256,
  sourceWritersFrozen: false, cutoverReady: false }
writeFileSync(reportPath, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' })
console.log(JSON.stringify({ kind, tables: tables.length, bytes, sha256, sourceWritersFrozen: false, cutoverReady: false }))
