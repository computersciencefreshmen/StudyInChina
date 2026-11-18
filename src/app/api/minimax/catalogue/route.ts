import { getCatalogData } from '@/lib/data/load'
import { getTodayDate } from '@/lib/data/freshness'
import { getApplicationState } from '@/lib/data/admission'
import { completeScholarship } from '@/lib/data/decision-evidence'
import { distinctPrograms } from '@/lib/data/concrete-majors'
import { getProgramFeedIndex } from '@/lib/program-feed'
import { combineProgramRecords, unifiedCatalogRevision } from '@/lib/unified-programs'
import { readProgrammeReceipts } from '@/lib/minimax/programme-receipts'

export const dynamic = 'force-dynamic'

export async function GET() {
  const today = getTodayDate()
  const [data, feed, receipts] = await Promise.all([getCatalogData(), getProgramFeedIndex(), readProgrammeReceipts()])
  const combined = combineProgramRecords(data, feed.programs, today)
  const bands = [0, 0, 0, 0]
  let decisionReadyMajors = 0
  for (const school of data.universities) {
    // getCatalogData applies the official public admissions gate to every core row.
    const count = distinctPrograms(data.programs.filter(p => p.universityId === school.id)).length
    bands[count === 0 ? 0 : count === 1 ? 1 : count < 5 ? 2 : 3]++
    decisionReadyMajors += count
  }
  const awards = data.scholarships.filter(award => completeScholarship(award, today))
  const schoolIds = new Set(data.universities.map(s => s.id))
  const fundedSchools = new Set(awards.flatMap(award => award.universityIds.filter(id => schoolIds.has(id)))).size
  const openCycles = data.admissionCycles.filter(c => ['open', 'rolling'].includes(getApplicationState(c, today))).length
  return Response.json({
    observedAt: new Date().toISOString(), revision: unifiedCatalogRevision(data, feed.revision, today), feedRevision: feed.revision, fedAt: feed.generatedAt,
    captured: feed.summary.capturedCount, publicPrograms: combined.items.length, universities: data.universities.length,
    decisionReadyMajors, bands, openCycles, fundedSchools, currentScholarshipOpportunities: awards.length, missingDegree: feed.summary.quality?.missing.degree ?? null,
    archived: feed.summary.quality?.archived ?? null, withdrawals: feed.summary.quality?.withdrawn ?? null,
    stall: feed.monitor ?? null, ...receipts,
  }, { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=30', 'X-Robots-Tag': 'noindex, nofollow' } })
}
