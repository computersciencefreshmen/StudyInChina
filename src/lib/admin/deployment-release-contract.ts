import { z } from 'zod'

const deploymentId = z.string().regex(/^dpl_[a-zA-Z0-9]{8,100}$/)
const sha = z.string().regex(/^[a-f0-9]{64}$/)
const timestamp = z.iso.datetime()
export const deploymentVersionSchema = z.object({
  id: deploymentId, projectId: z.string().regex(/^prj_[a-zA-Z0-9]+$/), ready: z.literal(true),
  deploymentUrl: z.string().url().refine(value => { const url = new URL(value); return url.protocol === 'https:' && url.hostname.endsWith('.vercel.app') && url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password }),
  createdAt: timestamp, registeredAt: timestamp, commitSha: z.string().regex(/^[a-f0-9]{40}$/).nullable(),
  proofSha256: sha,
}).strict()
export const deploymentRegistrySchema = z.object({
  version: z.literal(1), revision: z.number().int().nonnegative().safe(), observedAt: timestamp,
  projectId: z.string().regex(/^prj_[a-zA-Z0-9]+$/),
  alias: z.string().regex(/^[a-z0-9][a-z0-9.-]{0,252}[a-z0-9]$/),
  currentId: deploymentId, versions: z.array(deploymentVersionSchema).min(1).max(20),
}).strict().superRefine((value, context) => {
  if (new Set(value.versions.map(item => item.id)).size !== value.versions.length || !value.versions.some(item => item.id === value.currentId) || value.versions.some(item => item.projectId !== value.projectId)) context.addIssue({ code: 'custom', message: 'Registry identity mismatch' })
})
export const deploymentRollbackSchema = z.object({
  commandId: z.string().uuid(), kind: z.literal('deployment'), targetId: deploymentId,
  expectedCurrentId: deploymentId, expectedRevision: z.number().int().nonnegative().safe(),
  expectedRegistrySha256: sha, reason: z.string().trim().min(3).max(300),
}).strict().refine(value => value.targetId !== value.expectedCurrentId)
export type DeploymentRollbackRequest = z.infer<typeof deploymentRollbackSchema>
export const deploymentOutcomeSchema = z.object({
  outcome: z.enum(['completed', 'failed', 'uncertain']), actualPreviousId: deploymentId.nullable(),
  actualCurrentId: deploymentId.nullable(), readbackAt: timestamp,
  proofSha256: sha, error: z.enum(['current_changed', 'ownership_invalid', 'not_ready', 'assignment_failed', 'readback_failed', 'outcome_unknown']).nullable(),
}).strict()
export const deploymentWriterCommandSchema = z.object({
  commandId: z.string().uuid(), action: z.enum(['deployment-rollback', 'deployment-promotion']),
  targetId: deploymentId, expectedCurrentId: deploymentId,
  expectedRevision: z.number().int().nonnegative().safe(), expectedRegistrySha256: sha,
  reason: z.string().trim().min(3).max(300), requestedAt: timestamp, updatedAt: timestamp,
  status: z.enum(['pending', 'claimed', 'completed', 'failed', 'uncertain']),
  result: deploymentOutcomeSchema.nullable(),
}).strict()
export const deploymentWriterStateSchema = z.object({
  version: z.literal(1), registry: deploymentRegistrySchema,
  command: deploymentWriterCommandSchema.nullable(), recentCommands: z.array(deploymentWriterCommandSchema).max(50),
}).strict()
export type DeploymentRegistry = z.infer<typeof deploymentRegistrySchema>
export type DeploymentWriterState = z.infer<typeof deploymentWriterStateSchema>
export type DeploymentWriterCommand = NonNullable<DeploymentWriterState['command']>

export const deploymentMachineRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('sync-registry'), registry: deploymentRegistrySchema }).strict(),
  z.object({ action: z.literal('claim'), commandId: z.string().uuid() }).strict(),
  z.object({ action: z.literal('result'), commandId: z.string().uuid(), result: deploymentOutcomeSchema }).strict(),
  z.object({ action: z.literal('reserve-promotion'), request: deploymentRollbackSchema }).strict(),
])
export type DeploymentMachineRequest = z.infer<typeof deploymentMachineRequestSchema>
