import type { AdmissionCycle, City, Program, University } from '@/lib/data/types'
import { getApplicationState } from './data/admission'

export type UniversityFilters = { query: string; cityId: string; region: string; discipline: string }
export type ProgramFilters = { query: string; degree: string; discipline: string; language: string; dateStatus: string; tuition: string }

function searchable(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(searchable).join(' ')
  if (value && typeof value === 'object') return Object.values(value).map(searchable).join(' ')
  return ''
}

function includesQuery(values: unknown[], query: string) {
  const normalized = query.trim().toLocaleLowerCase()
  return !normalized || searchable(values).toLocaleLowerCase().includes(normalized)
}

export function filterUniversities(universities: University[], programs: Program[], cities: City[], filters: UniversityFilters) {
  return universities.filter((university) => {
    const relatedPrograms = programs.filter((program) => program.universityId === university.id)
    const city = cities.find((item) => item.id === university.cityId)
    return includesQuery([university.name, university.summary, city?.name, relatedPrograms.map((item) => [item.name, item.discipline])], filters.query)
      && (!filters.cityId || university.cityId === filters.cityId)
      && (!filters.region || university.region === filters.region)
      && (!filters.discipline || relatedPrograms.some((program) => program.discipline === filters.discipline))
  })
}

export function filterPrograms(programs: Program[], universities: University[], cycles: AdmissionCycle[], filters: ProgramFilters, today = new Date().toISOString().slice(0, 10)) {
  return programs.filter((program) => {
    const university = universities.find((item) => item.id === program.universityId)
    const cycle = cycles.find((item) => item.programId === program.id)
    const applicationState = getApplicationState(cycle, today)
    const matchesApplicationState = !filters.dateStatus
      || (filters.dateStatus === 'open' ? applicationState === 'open' || applicationState === 'rolling' : applicationState === filters.dateStatus)
    return includesQuery([program.name, program.discipline, program.teachingLanguages, university?.name], filters.query)
      && (!filters.degree || program.degreeLevel === filters.degree)
      && (!filters.discipline || program.discipline === filters.discipline)
      && (!filters.language || program.teachingLanguages.includes(filters.language))
      && matchesApplicationState
      && (!filters.tuition || (filters.tuition === 'known' ? cycle?.tuitionCny !== null && cycle?.tuitionCny !== undefined : cycle?.tuitionCny === null || cycle?.tuitionCny === undefined))
  })
}
