import { z } from 'zod'
import { evidenceSchema, sha256Schema } from './contracts'
import { MAINTAINED_CYCLE_FIELDS } from './field-contracts'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === value
})
const localized = z.object({ en: z.string().min(1).optional(), zh: z.string().min(1).optional() })
  .strict().refine(value => Boolean(value.en || value.zh))
const knownCycleValues: Record<string, z.ZodType> = {
  opensOn: date, closesOn: date, dateStatus: z.literal('published'), tuitionCny: z.number().nonnegative(),
  applicationFeeCny: z.number().nonnegative(), tuitionPeriod: z.enum(['program', 'semester', 'academic-year', 'month', 'other']),
  tuitionStatus: z.enum(['confirmed', 'reference']), tuitionSchedule: localized,
}
export const cyclePatchSchema = z.object({ fieldPath: z.enum(MAINTAINED_CYCLE_FIELDS), value: z.unknown(),
  factStatus: z.enum(['known', 'officially_not_announced', 'not_applicable']) }).strict().superRefine((patch, context) => {
  if (patch.factStatus === 'known' ? !knownCycleValues[patch.fieldPath].safeParse(patch.value).success : patch.value !== null) {
    context.addIssue({ code: 'custom', message: `Invalid scoped cycle fact ${patch.fieldPath}` })
  }
})

export const cycleDiscoveryFieldsSchema = z.object({
  programId: z.string().min(1), programScopeSha256: sha256Schema,
  academicYear: z.string().regex(/^20\d{2}-20\d{2}$/u).refine(value => Number(value.slice(5)) === Number(value.slice(0, 4)) + 1),
  intake: z.enum(['spring', 'autumn']), patches: z.array(cyclePatchSchema).min(2).max(MAINTAINED_CYCLE_FIELDS.length),
  programEvidence: evidenceSchema, internationalAdmissionsEvidence: evidenceSchema, cycleScopeEvidence: evidenceSchema,
}).strict().superRefine((fields, context) => {
  const paths = fields.patches.map(patch => patch.fieldPath)
  if (new Set(paths).size !== paths.length) context.addIssue({ code: 'custom', message: 'Duplicate cycle fact' })
  if (!fields.patches.some(patch => ['opensOn', 'closesOn'].includes(patch.fieldPath) && patch.factStatus === 'known')
    || !fields.patches.some(patch => patch.fieldPath === 'dateStatus' && patch.factStatus === 'known' && patch.value === 'published')) {
    context.addIssue({ code: 'custom', message: 'A new cycle requires an explicit application date and published-date state' })
  }
  if (fields.patches.some(patch => patch.fieldPath === 'tuitionCny' && patch.factStatus === 'known')
    && !['tuitionPeriod', 'tuitionStatus'].every(path => fields.patches.some(patch => patch.fieldPath === path && patch.factStatus === 'known'))) {
    context.addIssue({ code: 'custom', message: 'New cycle tuition requires billing period and confidence evidence' })
  }
})

export type CycleDiscoveryFields = z.infer<typeof cycleDiscoveryFieldsSchema>
export const cycleIdentityKey = (programId: string, year: string, intake: string) => `${programId}|${year}|${intake}`
export const normalizeCycleEvidence = (text: string) => text.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim()
export function sameOfficialProgramName(left: unknown, right: unknown): boolean {
  const values = (value: unknown) => value && typeof value === 'object' ? Object.values(value).filter((item): item is string => typeof item === 'string' && Boolean(item.trim())) : []
  return values(left).some(name => values(right).some(other => normalizeCycleEvidence(name) === normalizeCycleEvidence(other)))
}

export function cyclePatchHasQuoteSupport(patch: CycleDiscoveryFields['patches'][number], quote: string): boolean {
  if (patch.factStatus === 'officially_not_announced') return /not\s+(?:yet\s+)?(?:announced|published)|to be announced|尚未公布|另行通知/iu.test(quote)
  if (patch.factStatus === 'not_applicable') return /not applicable|不适用|无需|免收/iu.test(quote)
  if (typeof patch.value === 'number') return (quote.replace(/[,，]/gu, '').match(/\d+(?:\.\d+)?/gu) ?? []).some(value => Number(value) === patch.value)
    || patch.value === 0 && /waived|free of charge|免收|免费/iu.test(quote)
  if (patch.fieldPath === 'opensOn' || patch.fieldPath === 'closesOn') {
    const value = String(patch.value), [year, month, day] = value.split('-').map(Number)
    if (quote.includes(value) || new RegExp(`${year}[年/.-]0?${month}[月/.-]0?${day}(?:日|\\b)`, 'u').test(quote.replace(/\s+/gu, ''))) return true
    const monthName = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][month - 1]
    return new RegExp(`\\b${year}\\b`, 'u').test(quote) && new RegExp(`\\b${day}\\b`, 'u').test(quote) && new RegExp(monthName, 'iu').test(quote)
  }
  if (patch.fieldPath === 'dateStatus') return /20\d{2}/u.test(quote) && /application|deadline|申请|报名|截止/iu.test(quote)
  if (patch.fieldPath === 'tuitionPeriod') {
    const patterns: Record<string, RegExp> = { program: /whole program|entire program|per program|全程|项目总/iu,
      semester: /semester|学期/iu, 'academic-year': /academic year|per year|annually|学年|每年|年\/人/iu,
      month: /month|每月|月\/人/iu, other: /billing|收费标准/iu }
    return Boolean(patterns[String(patch.value)]?.test(quote))
  }
  if (patch.fieldPath === 'tuitionStatus') return patch.value === 'reference' ? /reference|参考/iu.test(quote) : /tuition|学费/iu.test(quote) && /\d/u.test(quote)
  return Boolean(patch.value && typeof patch.value === 'object' && Object.values(patch.value).every(value => typeof value === 'string'
    && normalizeCycleEvidence(quote).includes(normalizeCycleEvidence(value))))
}

/** The same named programme, degree and actual intake year must occur in cited official text. */
export function explicitCycleScope(fields: CycleDiscoveryFields, identity: { name: unknown; degreeLevel?: unknown }): boolean {
  const names = identity.name && typeof identity.name === 'object' ? Object.values(identity.name).filter((value): value is string => typeof value === 'string' && value.trim().length > 1) : []
  const containsName = (quote: string) => names.some(name => normalizeCycleEvidence(quote).includes(normalizeCycleEvidence(name)))
  if (!containsName(fields.programEvidence.quote) || !containsName(fields.cycleScopeEvidence.quote)) return false
  const degrees: Record<string, RegExp> = {
    bachelor: /undergraduate|bachelor|本科|学士/iu, master: /master|硕士/iu, doctorate: /doctoral|doctorate|ph\.?d|博士/iu,
    language: /language|汉语|语言/iu, foundation: /foundation|pre.?university|预科/iu,
  }
  const expectedDegree = typeof identity.degreeLevel === 'string' ? degrees[identity.degreeLevel] : undefined
  if (expectedDegree && !expectedDegree.test(fields.programEvidence.quote)) return false
  const intakeYear = fields.intake === 'spring' ? fields.academicYear.slice(5) : fields.academicYear.slice(0, 4)
  const season = fields.intake === 'spring' ? /spring|春季|March|3月/iu : /autumn|fall|秋季|September|9月/iu
  return new RegExp(`\\b${intakeYear}\\b`, 'u').test(fields.cycleScopeEvidence.quote) && season.test(fields.cycleScopeEvidence.quote)
    && /international|foreign|国际|外国|留学/iu.test(fields.internationalAdmissionsEvidence.quote)
}
