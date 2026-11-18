import { canonicalJson, sha256 } from '../ingestion/program-catalog-feed.mjs'

const nameKey = name => typeof name === 'string' ? name.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '') : ''

// Use exact, unique bilingual institutional identities. Conflicting captured
// school names keep the provider ID in the unbound discovery queue.
export function schoolCoverageTargets(snapshot, universities, sources, today) {
  if (!snapshot) return new Map()
  const { sha256: hash, ...content } = snapshot
  if (snapshot.format !== 'studyinchina.school-program-coverage' || snapshot.version !== 1
    || snapshot.evaluatedOn !== today || !Array.isArray(snapshot.schools)
    || !/^[a-f0-9]{64}$/.test(snapshot.scopeRegistrySha256) || !/^[a-f0-9]{64}$/.test(snapshot.inputCatalogSha256)
    || sha256(canonicalJson(content)) !== hash) throw new Error('school_coverage_binding_invalid')
  const byName = new Map(), counts = new Map()
  for (const school of snapshot.schools) {
    if (!school.universityId || counts.has(school.universityId) || !Number.isSafeInteger(school.currentProgramCount) || school.currentProgramCount < 0) throw new Error('school_coverage_row_invalid')
    counts.set(school.universityId, school.currentProgramCount)
  }
  for (const school of universities) for (const name of [school.name.en, school.name.zh]) {
    const key = nameKey(name)
    if (!key) continue
    byName.set(key, byName.has(key) && byName.get(key) !== school.id ? null : school.id)
  }
  const names = new Map()
  for (const row of sources) {
    if (row.provider !== 'SICAS') continue
    const keys = names.get(row.schoolId) ?? new Set()
    keys.add(nameKey(row.schoolName))
    names.set(row.schoolId, keys)
  }
  const targets = new Map()
  for (const [providerId, keys] of names) {
    const ids = new Set([...keys].map(key => byName.get(key)))
    if (ids.size !== 1) continue
    const [id] = ids
    if (counts.has(id)) targets.set(providerId, { universityId: id, count: counts.get(id) })
  }
  return targets
}

export function prioritizeSicasQueue(eligible, sources, outcomes, targets, likelyEvidence = () => false) {
  const lastSeen = new Map()
  for (const source of sources) {
    const id = targets.get(source.schoolId)?.universityId ?? source.schoolId
    const observed = Date.parse(outcomes[source.id]?.fetchedAt ?? source.fetchedAt)
    if (Number.isFinite(observed)) lastSeen.set(id, Math.max(observed, lastSeen.get(id) ?? 0))
  }
  const tiers = new Map()
  for (const entry of eligible) {
    const school = entry.source.schoolId, target = targets.get(school), id = target?.universityId ?? school
    const tier = !target ? 4 : target.count <= 1 ? target.count : target.count < 5 ? 2 : 3
    if (!tiers.has(tier)) tiers.set(tier, new Map())
    const groups = tiers.get(tier)
    if (!groups.has(id)) groups.set(id, [])
    groups.get(id).push(entry)
  }
  const result = []
  for (const tier of [0, 1, 2, 3, 4]) {
    const schools = [...(tiers.get(tier) ?? [])].sort(([a], [b]) => (lastSeen.get(a) ?? 0) - (lastSeen.get(b) ?? 0) || a.localeCompare(b))
    for (const [, rows] of schools) rows.sort((a, b) => Number(likelyEvidence(b.source)) - Number(likelyEvidence(a.source)))
    let active = schools.map(([, rows]) => rows)
    for (let round = 0; active.length; round++) {
      for (const rows of active) result.push(rows[round])
      active = active.filter(rows => rows.length > round + 1)
    }
  }
  return result
}
