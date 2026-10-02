import 'server-only'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { AdminSnapshot, VerificationRequest } from './types'
export { parseVerificationRequest, buildVerificationArguments } from './verification-options'

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

/** The administrator chooses typed scope/model options, never an executable, filename or shell fragment. */
export async function launchVerification(request: VerificationRequest, hasActiveRun: () => Promise<boolean>): Promise<number> {
  const capabilities = getVerificationCapabilities()
  if (!capabilities.startVerification) throw new Error('executor_unavailable')
  if (runner.starting || processAlive(runner.pid)) throw new Error('verification_already_running')
  runner.starting = true
  try {
    if (await hasActiveRun()) throw new Error('verification_already_running')
    const { executeExecutorCommand } = await import('../../../scripts/ingestion/minimax-admin-control')
    const result = await executeExecutorCommand({ commandId: randomUUID(), action: 'start', options: request })
    if (result.status !== 'completed' || !result.pid) throw new Error(result.error || 'executor_unavailable')
    runner.pid = result.pid
    return result.pid
  } finally { runner.starting = false }
}
