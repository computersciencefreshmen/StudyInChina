import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { bundleSchema } from '../../src/lib/data/schema'
import { readIdentityAcceptances } from '../../src/lib/data/identity-acceptance-store'
import { readFieldVerifications } from '../../src/lib/data/field-verification-store'
import { getTodayDate } from '../../src/lib/data/freshness'
import { selectDiscoveryData } from '../../src/lib/data/discovery'
import { selectPublishedData } from '../../src/lib/data/publication'
import { expect, type APIRequestContext } from '@playwright/test'

export const TODAY = getTodayDate()
const read = (name: string): unknown => JSON.parse(readFileSync(join(process.cwd(), 'content/data', `${name}.json`), 'utf8'))
export const rawData = bundleSchema.parse({ sources: read('sources'), cities: read('cities'), universities: read('universities'),
  programs: read('programs'), admissionCycles: read('admission-cycles'), scholarships: read('scholarships') })
export const currentData = selectPublishedData(rawData, TODAY)
export const directoryData = selectDiscoveryData(rawData, TODAY, readIdentityAcceptances(), readFieldVerifications())

export async function readPublicProgramIds(request: APIRequestContext): Promise<string[]> {
  const ids: string[] = [], cursors = new Set<string>()
  let cursor: string | null = null
  do {
    const query = new URLSearchParams({ limit: '10' })
    if (cursor) query.set('cursor', cursor)
    const response = await request.get(`/api/v1/directory/programs?${query}`)
    expect(response.ok()).toBe(true)
    const body = await response.json()
    expect(body.meta.release.evaluatedForDate).toBe(TODAY)
    ids.push(...body.data.map((item: { id: string }) => item.id))
    cursor = body.meta.nextCursor ?? null
    if (cursor) {
      expect(cursors.has(cursor), 'public pagination must advance').toBe(false)
      cursors.add(cursor)
      expect(cursors.size).toBeLessThanOrEqual(rawData.programs.length)
    }
  } while (cursor)
  expect(new Set(ids).size, 'public pages must not repeat programs').toBe(ids.length)
  return ids
}
