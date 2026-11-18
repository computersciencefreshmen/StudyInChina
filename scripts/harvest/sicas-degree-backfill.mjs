import { programWithdrawalReason } from '../../src/lib/program-publication-policy.mjs'

const DAY = 86_400_000
const hasLevel = row => Boolean(row.fields?.degree?.trim())
export const degreeHint = text => /\b(?:degree|diploma)\s+(?:awarded|conferred)\b/iu.test(text ?? '')

// This is a durable per-field queue. The program ID already identifies its
// provider and school; grouping by reason keeps a 25,000-row state compact.
export function degreeBackfill(sources, previous, now) {
  const pending = {}, waiting = {}
  for (const row of sources) {
    if (row.provider !== 'SICAS' || row.status !== 'extracted' || hasLevel(row) || programWithdrawalReason(row)) continue
    const retry = previous?.explicit_degree_missing?.[row.id]
    if (Number.isSafeInteger(retry) && retry > 0) waiting[row.id] = retry
    else pending[row.id] = Number.isSafeInteger(previous?.awaiting_source_check?.[row.id]) ? previous.awaiting_source_check[row.id] : now
  }
  return { awaiting_source_check: pending, explicit_degree_missing: waiting }
}

export function degreeDue(queue, id, now) {
  return (queue.awaiting_source_check[id] ?? queue.explicit_degree_missing[id] ?? Infinity) <= now
}

export function finishDegreeCheck(queue, row, now) {
  delete queue.awaiting_source_check[row.id]
  delete queue.explicit_degree_missing[row.id]
  if (!hasLevel(row) && !programWithdrawalReason(row)) queue.explicit_degree_missing[row.id] = now + 14 * DAY
}

export function selectDegreeAndDiscovery(rows, repairs, capacity, requestedId) {
  if (capacity < 1) return []
  if (!repairs.length) return rows.slice(0, capacity)
  const repairIds = new Set(repairs.map(item => item.source.id))
  const discovery = rows.filter(item => !repairIds.has(item.source.id))
  const slots = Math.min(repairs.length, Math.max(1, Math.ceil(capacity / 4), capacity - discovery.length))
  const requested = requestedId && repairs.find(item => item.source.id === requestedId)
  const selected = requested ? [requested, ...repairs.filter(item => item !== requested).slice(0, slots - 1)] : repairs.slice(0, slots)
  return [...selected, ...discovery.slice(0, capacity - slots)]
}
