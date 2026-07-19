import { z } from 'zod'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}, 'Invalid calendar date')
const httpsUrl = z.url().refine((value) => new URL(value).protocol === 'https:', 'URL must use HTTPS')
const localizedText = z.object({
  en: z.string().min(1), zh: z.string().min(1), ru: z.string().min(1),
  es: z.string().min(1).optional(), fr: z.string().min(1).optional(), ar: z.string().min(1).optional(), pt: z.string().min(1).optional(),
})
const status = z.enum(['draft', 'verified', 'stale', 'archived'])
const audit = z.object({ sourceIds: z.array(z.string().min(1)).min(1), verifiedAt: date, reviewAfter: date, status })
const region = z.enum(['north', 'northeast', 'east', 'south', 'central', 'southwest', 'northwest'])

export const sourceSchema = z.object({ id: z.string().min(1), url: httpsUrl, title: z.string().min(1), publisher: z.string().min(1), kind: z.enum(['university', 'program', 'admissions', 'scholarship', 'government', 'city']), language: z.enum(['zh', 'en', 'ru', 'other']), official: z.boolean(), accessedAt: date })
export const citySchema = audit.extend({ id: z.string().min(1), slug: z.string().regex(/^[a-z0-9-]+$/), name: localizedText, province: localizedText, region, coordinates: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }), overview: localizedText, climate: localizedText, foodHighlights: z.array(localizedText).min(1), sights: z.array(localizedText).min(1) })
export const universitySchema = audit.extend({ id: z.string().min(1), slug: z.string().regex(/^[a-z0-9-]+$/), name: localizedText, cityId: z.string().min(1), region, officialUrl: httpsUrl, admissionsUrl: httpsUrl, summary: localizedText, featured: z.boolean() })
export const programSchema = audit.extend({ id: z.string().min(1), slug: z.string().regex(/^[a-z0-9-]+$/), universityId: z.string().min(1), name: localizedText, degreeLevel: z.enum(['bachelor', 'master', 'language', 'foundation']), discipline: z.enum(['engineering', 'business', 'medicine', 'chinese-education', 'humanities', 'law-ir', 'science', 'art-design']), teachingLanguages: z.array(z.string().min(1)).min(1), durationMonths: z.number().int().positive().max(120).nullable(), programUrl: httpsUrl, applyUrl: httpsUrl, languageRequirements: z.array(z.object({ test: z.enum(['HSK', 'IELTS', 'TOEFL', 'other']), minimum: z.string().nullable() })) }).superRefine((value, context) => {
  if (value.status !== 'verified') return
  if (value.programUrl === value.applyUrl) context.addIssue({ code: 'custom', message: 'Verified programs require a distinct official application URL' })
  if (value.teachingLanguages.some((language) => language.toLowerCase().includes('confirm'))) context.addIssue({ code: 'custom', message: 'Verified programs require confirmed teaching languages' })
})
export const admissionCycleSchema = audit.extend({ id: z.string().min(1), programId: z.string().min(1), academicYear: z.string().regex(/^\d{4}-\d{4}$/).refine((value) => Number(value.slice(5)) === Number(value.slice(0, 4)) + 1, 'Academic year must contain consecutive years'), intake: z.enum(['spring', 'autumn', 'other']), opensOn: date.nullable(), closesOn: date.nullable(), dateStatus: z.enum(['published', 'rolling', 'not-announced', 'previous-cycle-reference']), tuitionCny: z.number().nonnegative().nullable(), applicationFeeCny: z.number().nonnegative().nullable() }).superRefine((value, context) => {
  if (value.opensOn && value.closesOn && value.opensOn > value.closesOn) context.addIssue({ code: 'custom', message: 'opensOn must be before closesOn' })
  if (value.dateStatus === 'published' && (!value.opensOn || !value.closesOn)) context.addIssue({ code: 'custom', message: 'Published cycles require opening and closing dates' })
  if (value.dateStatus === 'not-announced' && (value.opensOn || value.closesOn)) context.addIssue({ code: 'custom', message: 'Not-announced cycles must keep dates null' })
})
export const scholarshipSchema = audit.extend({ id: z.string().min(1), slug: z.string().regex(/^[a-z0-9-]+$/), name: localizedText, providerType: z.enum(['csc', 'university', 'province', 'city', 'other']), universityIds: z.array(z.string()), programIds: z.array(z.string()), coverage: z.object({ tuition: z.enum(['full', 'partial', 'none', 'unknown']), accommodation: z.enum(['full', 'partial', 'none', 'unknown']), insurance: z.union([z.boolean(), z.literal('unknown')]), stipendCnyPerMonth: z.number().nonnegative().nullable() }), deadline: date.nullable(), applicationUrl: httpsUrl, summary: localizedText })

export const bundleSchema = z.object({
  sources: z.array(sourceSchema), cities: z.array(citySchema), universities: z.array(universitySchema), programs: z.array(programSchema), admissionCycles: z.array(admissionCycleSchema), scholarships: z.array(scholarshipSchema),
}).superRefine((bundle, context) => {
  const duplicateCheck = (items: { id: string }[], label: string) => {
    const seen = new Set<string>()
    for (const item of items) {
      if (seen.has(item.id)) context.addIssue({ code: 'custom', message: `Duplicate ${label} id: ${item.id}` })
      seen.add(item.id)
    }
  }
  duplicateCheck(bundle.sources, 'source'); duplicateCheck(bundle.cities, 'city'); duplicateCheck(bundle.universities, 'university'); duplicateCheck(bundle.programs, 'program'); duplicateCheck(bundle.admissionCycles, 'cycle'); duplicateCheck(bundle.scholarships, 'scholarship')
  const duplicateSlugCheck = (items: { slug: string }[], label: string) => {
    const seen = new Set<string>()
    for (const item of items) { if (seen.has(item.slug)) context.addIssue({ code: 'custom', message: `Duplicate ${label} slug: ${item.slug}` }); seen.add(item.slug) }
  }
  duplicateSlugCheck(bundle.cities, 'city'); duplicateSlugCheck(bundle.universities, 'university'); duplicateSlugCheck(bundle.programs, 'program'); duplicateSlugCheck(bundle.scholarships, 'scholarship')
  const sourceIds = new Set(bundle.sources.map((item) => item.id)); const officialSourceIds = new Set(bundle.sources.filter((item) => item.official).map((item) => item.id)); const officialProgramSourceIds = new Set(bundle.sources.filter((item) => item.official && item.kind === 'program').map((item) => item.id)); const cityIds = new Set(bundle.cities.map((item) => item.id)); const universityIds = new Set(bundle.universities.map((item) => item.id)); const programIds = new Set(bundle.programs.map((item) => item.id))
  const auditItems = [...bundle.cities, ...bundle.universities, ...bundle.programs, ...bundle.admissionCycles, ...bundle.scholarships]
  for (const item of auditItems) {
    if (item.reviewAfter < item.verifiedAt) context.addIssue({ code: 'custom', message: `reviewAfter precedes verifiedAt on ${item.id}` })
    for (const id of item.sourceIds) if (!sourceIds.has(id)) context.addIssue({ code: 'custom', message: `Unknown source id ${id} on ${item.id}` })
  }
  for (const item of bundle.universities) if (!cityIds.has(item.cityId)) context.addIssue({ code: 'custom', message: `Unknown city ${item.cityId} on ${item.id}` })
  for (const item of bundle.programs) if (!universityIds.has(item.universityId)) context.addIssue({ code: 'custom', message: `Unknown university ${item.universityId} on ${item.id}` })
  for (const item of bundle.programs) if (item.status === 'verified' && !item.sourceIds.some((id) => officialProgramSourceIds.has(id))) context.addIssue({ code: 'custom', message: `Verified program lacks a program-level official source on ${item.id}` })
  for (const item of bundle.admissionCycles) if (!programIds.has(item.programId)) context.addIssue({ code: 'custom', message: `Unknown program ${item.programId} on ${item.id}` })
  for (const item of bundle.scholarships) {
    for (const id of item.universityIds) if (!universityIds.has(id)) context.addIssue({ code: 'custom', message: `Unknown university ${id} on ${item.id}` })
    for (const id of item.programIds) if (!programIds.has(id)) context.addIssue({ code: 'custom', message: `Unknown program ${id} on ${item.id}` })
  }
  const dynamicFacts = [...bundle.admissionCycles.filter((item) => item.opensOn || item.closesOn || item.tuitionCny !== null || item.applicationFeeCny !== null), ...bundle.scholarships.filter((item) => item.deadline || item.coverage.tuition !== 'unknown' || item.coverage.accommodation !== 'unknown' || item.coverage.insurance !== 'unknown' || item.coverage.stipendCnyPerMonth !== null)]
  for (const item of dynamicFacts) if (!item.sourceIds.some((id) => officialSourceIds.has(id))) context.addIssue({ code: 'custom', message: `Dynamic fact lacks an official source on ${item.id}` })
})
