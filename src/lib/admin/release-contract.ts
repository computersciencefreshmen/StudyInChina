import { z } from 'zod'
import { deploymentWriterCommandSchema } from './deployment-release-contract'

export const adminReleaseId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/)
const sha = z.string().regex(/^[a-f0-9]{64}$/)
export const rollbackReleaseSchema = z.object({
  commandId: z.string().uuid(), kind: z.literal('catalog'), targetId: adminReleaseId,
  expectedCurrentId: adminReleaseId, expectedRevision: z.number().int().nonnegative().safe(),
  expectedTargetSha256: sha, expectedCompatibilitySha256: sha,
  reason: z.string().trim().min(3).max(300),
}).strict()
export type RollbackReleaseRequest = z.infer<typeof rollbackReleaseSchema>

const catalogVersionSchema = z.object({
  id: adminReleaseId, dataVersion: z.number().int().positive(), generatedAt: z.string(),
  activatedAt: z.string().nullable(), status: z.enum(['active', 'retired', 'purged']),
  contentSha256: sha, compatibilitySha256: sha.nullable(), rollbackAvailable: z.boolean(),
}).strict()
export const rollbackReceiptSchema = z.object({
  commandId: z.string().uuid(), kind: z.literal('catalog'), previousId: adminReleaseId,
  targetId: adminReleaseId, revision: z.number().int().nonnegative().safe(),
  reason: z.string(), actor: z.string(), completedAt: z.string(),
}).strict()
export type RollbackReleaseReceipt = z.infer<typeof rollbackReceiptSchema>
export const releaseHistorySchema = z.object({
  observedAt: z.string(),
  catalog: z.object({
    backend: z.enum(['d1', 'json', 'shadow']), currentId: z.union([adminReleaseId, z.string().regex(/^json:\d{4}-\d{2}-\d{2}$/)]).nullable(),
    revision: z.number().int().nonnegative().safe().nullable(), available: z.boolean(),
    reason: z.string().nullable(), versions: z.array(catalogVersionSchema).max(50),
  }).strict().superRefine((catalog, context) => {
    if (catalog.backend === 'd1' && catalog.currentId !== null && !adminReleaseId.safeParse(catalog.currentId).success) {
      context.addIssue({ code: 'custom', path: ['currentId'], message: 'D1 requires a registered release identity' })
    }
  }),
  interface: z.object({
    currentId: z.string().nullable(), available: z.boolean(), rollbackAvailable: z.boolean(),
    registrySha256: sha.nullable(), revision: z.number().int().nonnegative().safe().nullable(),
    alias: z.string().nullable(), command: deploymentWriterCommandSchema.nullable(),
    history: z.array(deploymentWriterCommandSchema).max(50),
    reason: z.string(), versions: z.array(z.object({
      id: z.string().regex(/^dpl_[a-zA-Z0-9]+$/), createdAt: z.string(),
      deploymentUrl: z.string().url(), commitSha: z.string().nullable(), current: z.boolean(),
    }).strict()).max(20),
  }).strict(),
  audit: z.array(rollbackReceiptSchema).max(50),
}).strict()
export type AdminReleaseHistory = z.infer<typeof releaseHistorySchema>
