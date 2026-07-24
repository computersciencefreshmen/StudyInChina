import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const [, , sqlPath, configPath, targetFlag = '--remote'] = process.argv

if (!sqlPath || !configPath) {
  throw new Error('Usage: node execute-d1-command-file.mjs <sql-file> <wrangler-config> [--remote|--local]')
}
if (!['--remote', '--local'].includes(targetFlag)) {
  throw new Error(`Unsupported D1 target flag: ${targetFlag}`)
}

const absoluteSqlPath = resolve(sqlPath)
const absoluteConfigPath = resolve(configPath)
if (!existsSync(absoluteSqlPath)) throw new Error(`SQL file not found: ${absoluteSqlPath}`)
if (!existsSync(absoluteConfigPath)) throw new Error(`Wrangler config not found: ${absoluteConfigPath}`)

const sql = readFileSync(absoluteSqlPath, 'utf8')
  .split(/\r?\n/u)
  .filter((line) => !/^\s*--/u.test(line))
  .join(' ')
  .trim()

if (!sql) throw new Error(`SQL file is empty: ${absoluteSqlPath}`)
if (sql.length > 24_000) {
  throw new Error(`SQL command exceeds the safe Windows argument limit: ${sql.length}`)
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const wranglerEntrypoint = resolve(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js')
if (!existsSync(wranglerEntrypoint)) {
  throw new Error(`Wrangler entrypoint not found: ${wranglerEntrypoint}`)
}

const result = spawnSync(process.execPath, [
  wranglerEntrypoint,
  'd1',
  'execute',
  'INGESTION_DB',
  '--command',
  sql,
  '--config',
  absoluteConfigPath,
  targetFlag,
], {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true,
})

if (result.error) throw result.error
process.exitCode = result.status ?? 1
