import { z } from 'zod'
import { evidenceSchema, officialUrlSchema } from './contracts'

/** Discovery identity only: annual money, eligibility and deadlines belong to field reviews. */
export const scholarshipIdentityFieldsSchema = z.object({
  name: z.object({ en: z.string().trim().min(1).max(240).optional(), zh: z.string().trim().min(1).max(240).optional() })
    .strict().refine(name => Boolean(name.en || name.zh), 'Official scholarship name is required'),
  providerType: z.enum(['csc', 'university', 'province', 'city', 'other']),
  scholarshipUrl: officialUrlSchema,
  internationalAdmissionsEvidence: evidenceSchema,
  institutionEvidence: evidenceSchema,
}).strict()
export type ScholarshipIdentityFields = z.infer<typeof scholarshipIdentityFieldsSchema>
