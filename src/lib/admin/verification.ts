import 'server-only'
import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { promisify } from 'node:util'
import { z } from 'zod'
import { ADMIN_COLLECTIONS, type AdminSnapshot, type VerificationRequest } from './types'

const requestSchema = z.object({
  collection: z.enum(ADMIN_COLLECTIONS), mode: z.enum(['sample', 'full']),
  limit: z.number().int().min(1).max(200).optional(),
  model: z.enum(['configured', 'MiniMax-M3', 'MiniMax-M3.1-Flash-Preview']).optional(),
  effort: z.enum(['default', 'high', 'xhigh', 'max']).optional(),
}).strict().superRefine((request, context) => {
  if (request.effort && request.effort !== 'default' && request.model !== 'MiniMax-M3.1-Flash-Preview') {
    context.addIssue({ code: 'custom', message: 'Adjustable effort requires MiniMax-M3.1-Flash-Preview', path: ['effort'] })
  }
})

export function parseVerificationRequest(value: unknown): VerificationRequest { return requestSchema.parse(value) }

export function buildVerificationArguments(request: VerificationRequest, useCcSwitch: boolean): string[] {
  const args = useCcSwitch ? ['--use-ccswitch'] : []
  if (request.collection !== 'all') args.push('--collection', request.collection)
  if (request.mode === 'full') args.push('--all')
  else args.push('--limit', String(request.limit ?? 20))
  args.push('--concurrency', '2', '--batch-size', '2')
  if (request.model && request.model !== 'configured') {
    args.push('--model', request.model, '--thinking', 'adaptive')
    if (request.model === 'MiniMax-M3.1-Flash-Preview' && request.effort && request.effort !== 'default') args.push('--effort', request.effort)
  }
  return args
}

type Environment = Record<string, string | undefined>
export function getVerificationCapabilities(environment: Environment = process.env): AdminSnapshot['capabilities'] {
  const localMonitoring = environment.ADMIN_LOCAL_VERIFICATION_ENABLED === 'true' && !environment.VERCEL && !environment.CF_PAGES && !environment.AWS_LAMBDA_FUNCTION_NAME
  const useCcSwitch = environment.ADMIN_VERIFICATION_USE_CCSWITCH === 'true'
  const environmentKey = Boolean(environment.MINIMAX_API_KEY || environment.ANTHROPIC_AUTH_TOKEN || environment.ANTHROPIC_API_KEY)
  const credentialSource = useCcSwitch ? 'ccswitch' : environmentKey ? 'environment' : 'unconfigured'
  const ready = localMonitoring && (useCcSwitch ? existsSync(/* turbopackIgnore: true */ join(homedir(), '.cc-switch', 'cc-switch.db')) : environmentKey)
  return {
    localMonitoring, startVerification: ready, credentialSource,
    reason: !localMonitoring ? '本地核验执行器尚未启用。线上部署需要独立执行器；网站无法读取你电脑的任务。'
      : !ready ? '尚未配置 MiniMax 服务端凭据，或明确启用本机 CC Switch。' : null,
  }
}

export function processAlive(pid: unknown): boolean {
  if (!Number.isSafeInteger(pid) || Number(pid) <= 0) return false
  try { process.kill(Number(pid), 0); return true } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM' }
}

const globalRunner = globalThis as typeof globalThis & { studyInChinaAdminRunner?: { starting: boolean; pid: number | null } }
const runner = globalRunner.studyInChinaAdminRunner ??= { starting: false, pid: null }
const auditCommand = promisify(execFile)

/** The administrator chooses typed scope/model options, never an executable, filename or shell fragment. */
export async function launchVerification(request: VerificationRequest, hasActiveRun: () => Promise<boolean>): Promise<number> {
  const capabilities = getVerificationCapabilities()
  if (!capabilities.startVerification) throw new Error('executor_unavailable')
  if (runner.starting || processAlive(runner.pid)) throw new Error('verification_already_running')
  runner.starting = true
  try {
    if (await hasActiveRun()) throw new Error('verification_already_running')
    const root = process.cwd()
    const cli = join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs')
    const script = join(root, 'scripts', 'ingestion', 'verify-catalog-minimax.ts')
    // Executables belong to the explicitly enabled local executor, never serverless deployment assets.
    if (!existsSync(/* turbopackIgnore: true */ cli) || !existsSync(/* turbopackIgnore: true */ script)) throw new Error('executor_unavailable')
    const args = buildVerificationArguments(request, capabilities.credentialSource === 'ccswitch')
    // This CLI branch only validates configuration; it makes no model calls or run writes.
    try {
      const { stdout } = await auditCommand(process.execPath, [cli, script, '--audit-config', ...args], { cwd: root, windowsHide: true, timeout: 15_000, maxBuffer: 16_384 })
      if (JSON.parse(stdout.trim()).configured !== true) throw new Error('executor_unavailable')
    } catch { throw new Error('executor_unavailable') }
    const child = spawn(process.execPath, [cli, script, ...args], {
      cwd: root, detached: true, windowsHide: true, stdio: 'ignore', shell: false,
    })
    await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', () => reject(new Error('executor_unavailable'))) })
    if (!child.pid) throw new Error('executor_unavailable')
    runner.pid = child.pid
    child.unref()
    return child.pid
  } finally { runner.starting = false }
}
