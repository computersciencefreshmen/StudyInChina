import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { bundleSchema } from '../../src/lib/data/schema'
import { readIdentityAcceptances } from '../../src/lib/data/identity-acceptance-store'
import { readFieldVerifications } from '../../src/lib/data/field-verification-store'
import { getTodayDate } from '../../src/lib/data/freshness'
import { selectDiscoveryData } from '../../src/lib/data/discovery'
import { selectPublishedData } from '../../src/lib/data/publication'

export const TODAY = getTodayDate()
const read = (name: string): unknown => JSON.parse(readFileSync(join(process.cwd(), 'content/data', `${name}.json`), 'utf8'))
export const rawData = bundleSchema.parse({ sources: read('sources'), cities: read('cities'), universities: read('universities'),
  programs: read('programs'), admissionCycles: read('admission-cycles'), scholarships: read('scholarships') })
export const currentData = selectPublishedData(rawData, TODAY)
export const directoryData = selectDiscoveryData(rawData, TODAY, readIdentityAcceptances(), readFieldVerifications())
