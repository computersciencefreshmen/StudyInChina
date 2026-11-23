import { execFileSync } from 'node:child_process'
import { bundleSchema } from '@/lib/data/schema'

export function reviewedDataAt(commit: string, file: string) {
  return JSON.parse(execFileSync('git', ['show', `${commit}:content/data/${file}.json`], {
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  }))
}

export function reviewedCatalogueAt(commit: string) {
  return bundleSchema.parse({
    sources: reviewedDataAt(commit, 'sources'),
    cities: reviewedDataAt(commit, 'cities'),
    universities: reviewedDataAt(commit, 'universities'),
    programs: reviewedDataAt(commit, 'programs'),
    scholarships: reviewedDataAt(commit, 'scholarships'),
    admissionCycles: reviewedDataAt(commit, 'admission-cycles'),
  })
}
