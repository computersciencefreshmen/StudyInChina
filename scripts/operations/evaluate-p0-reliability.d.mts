export type P0ReliabilityStatus = 'pass' | 'fail' | 'unobserved'

export type P0ReliabilityCheck = {
  id: string
  status: P0ReliabilityStatus
  source: string | null
  observedAt: string | null
  value: unknown
  threshold: {
    operator: string
    value: number
    unit: string
  }
  detail: string
}

export type P0ReliabilityAudit = {
  format: string
  formatVersion: 1
  status: 'pass' | 'fail'
  evaluatedAt: string
  observation: {
    formatValid: boolean
    formatVersionValid: boolean
    observedAt: string | null
  }
  thresholds: typeof P0_RELIABILITY_THRESHOLDS
  summary: Record<P0ReliabilityStatus, number>
  checks: P0ReliabilityCheck[]
}

export const P0_OBSERVATION_FORMAT: string
export const P0_AUDIT_FORMAT: string
export const P0_RELIABILITY_THRESHOLDS: Readonly<{
  observationMaxAgeMinutes: 15
  backupMaxAgeHours: 26
  releaseMaxAgeHours: 48
  schedulerMaxAgeMinutes: 90
  dlqMaxBacklogCount: 0
  outboxMaxAgeHours: 168
}>

export function evaluateP0Reliability(
  observation: unknown,
  now?: string | number | Date,
): P0ReliabilityAudit

export function parseArguments(args: string[]): {
  inputPath: string
  outputPath: string | null
}
