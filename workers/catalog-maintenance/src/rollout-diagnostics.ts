import { MaintenanceError } from './types'
import { isDailyD1QuotaError } from './backend-errors'

export type RolloutCommitStage = 'read_runtime_disposition' | 'read_terminal_quarantine' | 'read_legacy_disposition' | 'build_fences' | 'commit'
type ParameterType = 'undefined' | 'non_finite_number' | 'boolean' | 'bigint' | 'object' | 'function' | 'symbol'
export type RolloutBindingDiagnostic = {
  parameterCount: number
  statementParameterCounts: number[]
  unexpectedParameterTypes: Array<{ statement: number; position: number; type: ParameterType }>
}
export type RolloutCommitDiagnostic = {
  format: 'studyinchina.rollout-commit-diagnostic'
  version: 1
  stage: RolloutCommitStage
  category: 'd1_parameter_type' | 'd1_parameter_count' | 'check_constraint' | 'sql' | 'quota' | 'backend' | 'maintenance' | 'invalid_evidence_json' | 'unclassified'
  maintenanceCode?: string
  bindings?: RolloutBindingDiagnostic
}

// Exact fixed codes only. Unknown codes can include caller-controlled text and
// must never be copied to a receipt, even when wrapped in MaintenanceError.
const MAINTENANCE_CODES = new Set([
  'rollout_control_unavailable',
  'runtime_model_guard_index_missing', 'runtime_model_guard_index_invalid',
  'runtime_model_guard_index_marker_unconfirmed',
  'terminal_quarantine_policy_invalid',
  'legacy_model_guard_policy_corrupt',
])

/** Rollout SQL deliberately binds only text, finite numbers and null. Inspect
 * shape without coercing/rejecting values or changing the D1 submission. All
 * statement and position numbers are one-based; no parameter value is retained. */
export function rolloutBindingDiagnostic(statements: readonly (readonly unknown[])[]): RolloutBindingDiagnostic {
  const unexpectedParameterTypes: RolloutBindingDiagnostic['unexpectedParameterTypes'] = []
  statements.forEach((values, index) => values.forEach((value, offset) => {
    if (value === null || typeof value === 'string' || typeof value === 'number' && Number.isFinite(value)) return
    const type = typeof value === 'number' ? 'non_finite_number' : typeof value as ParameterType
    unexpectedParameterTypes.push({ statement: index + 1, position: offset + 1, type })
  }))
  return { parameterCount: statements.reduce((sum, values) => sum + values.length, 0), statementParameterCounts: statements.map(values => values.length), unexpectedParameterTypes }
}

// D1 wraps the actionable SQLite/type error in Error.cause. Inspect only a
// bounded Error/string chain and emit fixed categories, never its contents.
function errorMessages(error: unknown): string[] {
  const messages: string[] = [], seen = new Set<unknown>()
  for (let depth = 0; depth < 4 && !seen.has(error); depth++) {
    seen.add(error)
    if (typeof error === 'string') { messages.push(error.slice(0, 8192)); break }
    if (!(error instanceof Error)) break
    try {
      if (typeof error.message === 'string') messages.push(error.message.slice(0, 8192))
      error = error.cause
    } catch { break }
  }
  return messages
}

export function rolloutCommitDiagnostic(stage: RolloutCommitStage, error: unknown, bindings?: RolloutBindingDiagnostic): RolloutCommitDiagnostic {
  const result: RolloutCommitDiagnostic = { format: 'studyinchina.rollout-commit-diagnostic', version: 1, stage, category: 'unclassified', ...(bindings ? { bindings } : {}) }
  if (error instanceof MaintenanceError) {
    result.category = 'maintenance'
    if (MAINTENANCE_CODES.has(error.code)) result.maintenanceCode = error.code
    return result
  }
  if (error instanceof SyntaxError) { result.category = 'invalid_evidence_json'; return result }
  const messages = errorMessages(error), message = messages.join('\n')
  if (messages.some(isDailyD1QuotaError)) result.category = 'quota'
  else if (/\bD1_TYPE_ERROR\b|(?:unsupported|not supported|invalid) (?:D1 )?(?:parameter|binding|bind value|value type)|type ['"](?:undefined|object|bigint|boolean)['"] is not supported/iu.test(message)) result.category = 'd1_parameter_type'
  else if (/too many (?:SQL variables|parameters)|(?:wrong|incorrect|invalid) number of (?:parameter )?bindings|(?:bind|binding|parameter).{0,60}(?:count mismatch|out of range)|SQLITE_RANGE/iu.test(message)) result.category = 'd1_parameter_count'
  else if (/CHECK constraint failed|SQLITE_CONSTRAINT_CHECK/iu.test(message)) result.category = 'check_constraint'
  else if (/\b(?:D1_ERROR|SQLITE_[A-Z_]+)\b|no such (?:table|column)|syntax error/iu.test(message)) result.category = 'sql'
  else if (/\b(?:network|fetch failed|timeout|timed out|unavailable|R2_ERROR|D1_EXEC_ERROR)\b/iu.test(message)) result.category = 'backend'
  return result
}
