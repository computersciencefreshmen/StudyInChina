import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { bundleSchema } from '../src/lib/data/schema'

const read = (name: string) => JSON.parse(readFileSync(join(process.cwd(), 'content', 'data', `${name}.json`), 'utf8'))
const result = bundleSchema.safeParse({ sources: read('sources'), cities: read('cities'), universities: read('universities'), programs: read('programs'), admissionCycles: read('admission-cycles'), scholarships: read('scholarships') })

if (!result.success) {
  console.error(result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n'))
  process.exit(1)
}

const data = result.data
const today = (process.env.DATA_VALIDATION_DATE || new Date().toISOString()).slice(0, 10)
const audited = [...data.cities, ...data.universities, ...data.programs, ...data.admissionCycles, ...data.scholarships]
const overdueVerified = audited.filter((item) => item.status === 'verified' && item.reviewAfter < today)
if (overdueVerified.length) {
  console.error(`Verified records are past their review date: ${overdueVerified.map((item) => item.id).join(', ')}`)
  process.exit(1)
}
console.log(`Validated ${data.universities.length} universities, ${data.programs.length} programs, ${data.cities.length} cities, ${data.scholarships.length} scholarships, and ${data.sources.length} sources.`)
