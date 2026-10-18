import { randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, realpath, rename, unlink } from 'node:fs/promises'
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { bundleSchema } from '../../src/lib/data/schema'
import { getTodayDate } from '../../src/lib/data/freshness'
import { assertMaintenanceDate, buildUniversityMaintenancePlan, emptyUniversityMaintenanceState, maintenanceDigest,
  recordUniversityMaintenanceAttempts, universityMaintenanceStateSchema } from '../../src/lib/maintenance/university-coverage'

export type MaintenancePlanArguments = { root: string; today: string; dataDirectory: string; output: string; stateFile: string; limit: number; recordAttempts?: string }
const inside = (root: string, path: string) => { const part = relative(root, path); return part === '' || part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part) }

export function parseUniversityMaintenanceArguments(args: string[], root = process.cwd()): MaintenancePlanArguments {
  const values = new Map<string, string>(), allowed = new Set(['--today', '--data-dir', '--output', '--state-file', '--limit', '--record-attempts'])
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i], value = args[i + 1]
    if (!allowed.has(flag) || values.has(flag) || !value || value.startsWith('--')) throw new Error('Unknown, duplicate or missing maintenance argument')
    values.set(flag, value)
  }
  root = resolve(root)
  const today = values.get('--today') ?? getTodayDate()
  assertMaintenanceDate(today)
  const limitText = values.get('--limit') ?? '10', limit = Number(limitText)
  if (!/^\d+$/.test(limitText) || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error('--limit must be an integer from 1 through 1000')
  const dataDirectory = resolve(root, values.get('--data-dir') ?? 'content/data')
  if (!inside(root, dataDirectory)) throw new Error('Data directory must remain inside the workspace')
  const artifact = (value: string, readOnly = false) => {
    const path = resolve(root, value), part = relative(root, path)
    const allowed = ['.tmp', '.pipeline-build', 'quality'].includes(part.split(sep)[0])
      || readOnly && part.startsWith(`.official-harvest${sep}university-maintenance${sep}`)
    if (!inside(root, path) || !allowed || extname(path) !== '.json' || inside(dataDirectory, path)) throw new Error('Artifacts must be JSON under .tmp, .pipeline-build or quality, outside catalogue data; capture receipts may be read from .official-harvest/university-maintenance')
    return path
  }
  const output = artifact(values.get('--output') ?? '.tmp/university-maintenance/plan.json')
  const stateFile = artifact(values.get('--state-file') ?? '.tmp/university-maintenance/state.json')
  const recordAttempts = values.has('--record-attempts') ? artifact(values.get('--record-attempts')!, true) : undefined
  if (new Set([output, stateFile, ...(recordAttempts ? [recordAttempts] : [])]).size !== (recordAttempts ? 3 : 2)) throw new Error('Plan, state and receipt paths must be distinct')
  return { root, today, dataDirectory, output, stateFile, limit, recordAttempts }
}

async function containedRealPath(root: string, path: string): Promise<void> {
  let cursor = path
  for (;;) {
    try {
      const stat = await lstat(cursor)
      if (cursor === path && stat.isSymbolicLink() || !inside(await realpath(root), await realpath(cursor))) throw new Error('Symlink or path escapes the workspace')
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const parent = dirname(cursor)
      if (parent === cursor) throw new Error('Workspace ancestor is missing')
      cursor = parent
    }
  }
}
async function optionalState(path: string) {
  try { const bytes = await readFile(path, 'utf8'); return { state: universityMaintenanceStateSchema.parse(JSON.parse(bytes)), digest: maintenanceDigest(bytes) } }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { state: emptyUniversityMaintenanceState(), digest: null }; throw error }
}
async function atomicJson(path: string, value: unknown) {
  const temporary = `${path}.${randomUUID()}.tmp`, handle = await open(temporary, 'wx')
  try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`); await handle.sync() } finally { await handle.close() }
  try { await rename(temporary, path) } catch (error) { await unlink(temporary).catch(() => undefined); throw error }
}

export async function runUniversityMaintenancePlan(options: MaintenancePlanArguments) {
  for (const path of [options.dataDirectory, options.output, options.stateFile, ...(options.recordAttempts ? [options.recordAttempts] : [])]) await containedRealPath(options.root, path)
  const names = { sources: 'sources', cities: 'cities', universities: 'universities', programs: 'programs', admissionCycles: 'admission-cycles', scholarships: 'scholarships' }
  const entries = await Promise.all(Object.entries(names).map(async ([key, name]) => {
    const path = resolve(options.dataDirectory, `${name}.json`)
    await containedRealPath(options.root, path)
    return [key, JSON.parse(await readFile(path, 'utf8'))] as const
  }))
  const bundle = bundleSchema.parse(Object.fromEntries(entries)), initial = await optionalState(options.stateFile)
  let state = initial.state, plan = buildUniversityMaintenancePlan(bundle, { today: options.today, limit: options.limit, state })
  if (options.recordAttempts) {
    const receipt = JSON.parse(await readFile(options.recordAttempts, 'utf8'))
    const next = recordUniversityMaintenanceAttempts(plan, state, receipt)
    if (next.revision !== state.revision) {
      await mkdir(dirname(options.stateFile), { recursive: true })
      await containedRealPath(options.root, options.stateFile)
      const lockPath = `${options.stateFile}.lock`, lock = await open(lockPath, 'wx')
      try {
        await lock.writeFile(JSON.stringify({ token: randomUUID(), revision: state.revision }))
        const current = await optionalState(options.stateFile)
        if (current.digest !== initial.digest) throw new Error('Maintenance state changed; regenerate the plan before recording outcomes')
        await atomicJson(options.stateFile, next)
        state = next
      } finally { await lock.close(); await unlink(lockPath) }
    }
    plan = buildUniversityMaintenancePlan(bundle, { today: options.today, limit: options.limit, state })
  }
  await mkdir(dirname(options.output), { recursive: true })
  await containedRealPath(options.root, options.output)
  await atomicJson(options.output, plan)
  return plan
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runUniversityMaintenancePlan(parseUniversityMaintenanceArguments(process.argv.slice(2))).then(plan => {
    console.log(JSON.stringify({ format: plan.format, today: plan.today, summary: plan.summary, planSha256: plan.planSha256 }))
  }).catch(error => { console.error(error instanceof Error ? error.message : 'Maintenance planning failed'); process.exitCode = 1 })
}
