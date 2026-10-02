import { verificationOptionsSchema } from './executor-contract'
import type { VerificationRequest } from './types'

export function parseVerificationRequest(value: unknown): VerificationRequest { return verificationOptionsSchema.parse(value) }

/** The command surface chooses typed scope, never an executable or shell fragment. */
export function buildVerificationArguments(request: VerificationRequest, useCcSwitch: boolean): string[] {
  const args = useCcSwitch ? ['--use-ccswitch', '--quota-guard'] : []
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
