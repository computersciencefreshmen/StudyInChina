import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { bundleSchema } from '../src/lib/data/schema'
import { resolveDataValidationDate } from '../src/lib/data/freshness'

/** Strict raw-status validation remains the default for manual data authors.
 * Directory releases also prove the complete safe projection, so expiry alone
 * requires neither a fabricated renewal nor a daily canonical commit. */
export async function validateContentData(root: string, today: string, options: { directorySafeExpiry?: boolean } = {}) {
  const read = (name: string): unknown => JSON.parse(readFileSync(join(root, 'content', 'data', `${name}.json`), 'utf8'))
  const result = bundleSchema.safeParse({ sources: read('sources'), cities: read('cities'), universities: read('universities'),
    programs: read('programs'), admissionCycles: read('admission-cycles'), scholarships: read('scholarships') })
  if (!result.success) throw new Error(result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('\n'))
  const data = result.data
  const audited = [...data.cities, ...data.universities, ...data.programs, ...data.admissionCycles, ...data.scholarships]
  const overdueVerified = audited.filter(item => item.status === 'verified' && item.reviewAfter < today).map(item => item.id)
  if (overdueVerified.length && !options.directorySafeExpiry) throw new Error(`Verified records are past their review date: ${overdueVerified.join(', ')}`)
  // Always mandatory in this mode, including when no record has expired.
  const directory = options.directorySafeExpiry
    ? await (await import('./quality/validate-directory')).validateDirectory(root, today) : undefined
  return { evaluatedForDate: today, overdueRawVerifiedIds: overdueVerified, directory,
    counts: { universities: data.universities.length, programs: data.programs.length, cities: data.cities.length,
      scholarships: data.scholarships.length, sources: data.sources.length } }
}
async function main() {
  const args = process.argv.slice(2)
  if (args.length > 1 || args.some(argument => argument !== '--directory-safe-expiry')) throw new Error('Usage: validate-data.ts [--directory-safe-expiry]')
  const report = await validateContentData(process.cwd(), resolveDataValidationDate(process.env.DATA_VALIDATION_DATE),
    { directorySafeExpiry: args.includes('--directory-safe-expiry') })
  console.log(JSON.stringify(report))
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { console.error(error instanceof Error ? error.message : 'Data validation failed'); process.exitCode = 1 })
