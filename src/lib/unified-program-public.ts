import type { UnifiedProgramItem } from './unified-programs'
import { unifiedProgramSlug } from './unified-programs'
import { publicThirdPartyProgram } from './third-party-public'

export function publicUnifiedProgram(item: UnifiedProgramItem, detail = false) {
  const sources = (item.sources || []).map(source => ({ publisher: source.provider, url: source.sourceUrl, collectedAt: source.fetchedAt, official: false }))
  if ('collected' in item) {
    const record = publicThirdPartyProgram(item.collected, detail)
    const university = item.university ? { id: item.university.id, slug: item.university.slug, name: item.university.name } : null
    return { ...record, university, slug: unifiedProgramSlug(item), status: 'source-collected', sources }
  }
  return { ...item.program, university: item.university, cycle: item.cycle, sources }
}
