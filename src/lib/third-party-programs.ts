import 'server-only'
import directoryData from '../../content/third-party/directory.json'
import detailData from '../../content/third-party/details.json'
import { programWithdrawalReason } from './program-publication-policy.mjs'

export type ThirdPartyProgram = {
  id: string
  provider: string
  sourceId: string
  schoolId: string
  schoolName: string
  name: string
  sourceUrl: string
  sourceUpdatedAt?: string
  fetchedAt?: string
  status: 'extracted' | 'link_only'
  official: false
  admissionYear: null
  evidenceHash?: string
  fieldSources?: Partial<Record<keyof ThirdPartyProgram['fields'], { url: string; collectedAt: string; locator: string; archived: boolean }>>
  fields: Partial<Record<'degree' | 'language' | 'duration' | 'startDate' | 'deadline' | 'tuition' | 'applicationFee' | 'providerServiceFee' | 'requirements' | 'materials' | 'description' | 'fees', string>>
}

export type ThirdPartySchool = { id: string; name: string; provider: string; programCount: number; extractedCount: number }
export type ThirdPartyQuery = { query?: string; school?: string; provider?: string; view?: 'extracted' | 'links'; page?: number }

const schools: ThirdPartySchool[] = directoryData.schools
const schoolIndex = new Map(schools.map(school => [school.id, school]))
const details = new Map((detailData.programs as unknown as ThirdPartyProgram[]).map(program => [program.id, program]))
const programs: ThirdPartyProgram[] = directoryData.programs.map(([id, schoolId, name, sourceUrl, sourceUpdatedAt]) => {
  const captured = details.get(id)
  if (captured) return captured
  const school = schoolIndex.get(schoolId)
  if (!school) throw new Error(`Unknown imported school: ${schoolId}`)
  return { id, schoolId, name, sourceUrl, sourceUpdatedAt: sourceUpdatedAt || undefined,
    provider: school.provider, sourceId: id.replace(/^[^-]+-/, ''), schoolName: school.name,
    status: 'link_only', official: false, admissionYear: null, fields: {} }
}).filter(program => !programWithdrawalReason(program)) as ThirdPartyProgram[]
const index = new Map(programs.map(program => [program.id, program]))
const searchText = new Map(programs.map(program => [program.id, `${program.name} ${program.schoolName} ${program.provider}`.normalize('NFKC').toLowerCase()]))

export function getThirdPartySummary() {
  return { programCount: programs.length, extractedCount: programs.filter(p => p.status === 'extracted').length, schoolCount: schools.length,
    schoolsWithExtractedDetails: schools.filter(school => school.extractedCount > 0).length,
    generatedAt: directoryData.generatedAt, official: false as const }
}

export function getThirdPartyProgram(id: string): ThirdPartyProgram | undefined {
  return index.get(id)
}

export function queryThirdPartyPrograms(filters: ThirdPartyQuery = {}) {
  const query = (filters.query || '').slice(0, 200).trim().normalize('NFKC').toLowerCase()
  const tokens = query.split(/\s+/).filter(Boolean)
  const provider = (filters.provider || '').toLowerCase()
  const view = filters.view === 'links' ? 'links' : 'extracted'
  const filtered = programs.filter(program => (view === 'links' || program.status === 'extracted')
    && (!filters.school || program.schoolId === filters.school)
    && (!provider || provider === 'all' || program.provider.toLowerCase() === provider)
    && tokens.every(token => searchText.get(program.id)!.includes(token)))
  // Put actual extracted records first, then interleave provider schools to avoid a single-school first page.
  const grouped = new Map<string, ThirdPartyProgram[]>()
  for (const program of filtered) {
    const group = grouped.get(program.schoolId) || []
    group.push(program)
    grouped.set(program.schoolId, group)
  }
  const groups = [...grouped.values()].sort((a, b) => Number(b[0].status === 'extracted') - Number(a[0].status === 'extracted'))
  const ordered: ThirdPartyProgram[] = []
  for (let offset = 0; ordered.length < filtered.length; offset++) {
    for (const group of groups) if (group[offset]) ordered.push(group[offset])
  }
  const pageSize = 40, total = filtered.length, totalPages = Math.max(1, Math.ceil(total / pageSize))
  const page = Number.isFinite(filters.page) ? Math.min(totalPages, Math.max(1, Math.floor(filters.page!))) : 1
  return { items: ordered.slice((page - 1) * pageSize, page * pageSize), total, page, pageSize, totalPages,
    schools: schools.filter(school => (view === 'links' || school.extractedCount > 0)
      && (!provider || provider === 'all' || school.provider.toLowerCase() === provider)) }
}
