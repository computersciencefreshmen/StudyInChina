import { z } from 'zod'
import type { SourceCategory } from './types'

export const SOURCE_CATEGORIES = [
  'international_admissions_home',
  'undergraduate_catalog',
  'masters_catalog',
  'doctoral_catalog',
  'non_degree_catalog',
  'current_guide',
  'dates_deadlines',
  'fees',
  'eligibility_language',
  'application_portal',
  'university_scholarship',
  'faculty_scholarship',
  'government_scholarship',
  'program_detail',
  'contacts',
  'catalog_anchor',
] as const satisfies readonly SourceCategory[]

const fieldSchema = z.object({
  path: z.string().min(1),
  type: z.enum(['string', 'number', 'money', 'boolean', 'date', 'string-array', 'object']),
  required: z.boolean().optional(),
  nullable: z.boolean().optional(),
  critical: z.boolean().optional(),
}).strict()

const ruleSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('regex'),
    fieldPath: z.string().min(1),
    pattern: z.string().min(1),
    flags: z.string().optional(),
    captureGroup: z.number().int().nonnegative().optional(),
  }).strict(),
  z.object({
    kind: z.literal('json-pointer'),
    fieldPath: z.string().min(1),
    pointer: z.string().min(1),
  }).strict(),
])

export const sourceManifestSchema = z.object({
  version: z.literal(1),
  id: z.string().min(1),
  institutionId: z.string().min(1),
  entityType: z.enum(['university', 'program', 'program-cycle', 'scholarship', 'scholarship-cycle']),
  sourceCategory: z.enum(SOURCE_CATEGORIES),
  officialUrl: z.url(),
  allowedHosts: z.array(z.string().min(1)).min(1),
  allowedRedirectHosts: z.array(z.string().min(1)).optional(),
  enabled: z.boolean(),
  schedule: z.object({
    intervalHours: z.number().int(),
    jitterMinutes: z.number().int().optional(),
  }).strict(),
  fetch: z.object({
    timeoutMs: z.number().int().min(1_000).max(60_000).optional(),
    maxBytes: z.number().int().min(1_024).max(10 * 1024 * 1024).optional(),
    accept: z.string().min(1).optional(),
    renderMode: z.enum(['http', 'browser']).optional(),
    browserWaitUntil: z.enum(['load', 'domcontentloaded', 'networkidle0', 'networkidle2']).optional(),
    browserWaitForSelector: z.string().min(1).max(200).optional(),
    documentConversion: z.enum(['auto', 'disabled']).optional(),
  }).strict().superRefine((fetch, context) => {
    if (
      (fetch.browserWaitUntil !== undefined || fetch.browserWaitForSelector !== undefined)
      && fetch.renderMode !== 'browser'
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Browser wait options require fetch.renderMode=browser',
      })
    }
  }),
  robots: z.object({ mode: z.enum(['enforce', 'blocked']) }).strict(),
  canonicalization: z.object({
    ignorePatterns: z.array(z.string().min(1)).optional(),
    collapseWhitespace: z.boolean().optional(),
  }).strict().optional(),
  extraction: z.object({
    mode: z.enum(['rules-only', 'rules-then-minimax', 'minimax']),
    schemaVersion: z.string().min(1),
    fields: z.array(fieldSchema).min(1),
    rules: z.array(ruleSchema).optional(),
    minimaxModel: z.string().min(1).optional(),
  }).strict(),
}).strict()
