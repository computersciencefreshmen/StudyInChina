import { control, queueExtraction, refreshTargets, seed, setControls } from '../src/repository'
import { seedTargetFollowupJobs } from '../src/target-followup'
import { canonical, digest } from '../src/util'
import type { RecordTarget } from '../src/types'
import { makeEnv, seedInput, TEST_CATALOG, TEST_GUARDS } from './fixture'

export const now = Date.parse('2026-11-14T10:00:00.000Z'), iso = new Date(now).toISOString()
export async function followupFixture(count = 2, sources = 1) {
  const f = makeEnv(), input = seedInput()
  for (let i = 0; i < sources; i++) input.schools[i].sourceSeeds = [{ id: `source-${i}`, url: `https://test.edu.cn/source-${i}`, allowedHosts: ['test.edu.cn'], sourceCategory: 'current_guide', enabled: true, registration: 'catalogue_official' }]
  const ids = await Promise.all(Array.from({ length: sources }, (_, i) => digest(`https://test.edu.cn/source-${i}`)))
  const target = (index: number, source = 0): RecordTarget => ({ recordId: `programme-${index}`, entityType: 'program', universityId: input.schools[source].universityId,
    sourceIds: [ids[source]], recordScopeSha256: index.toString(16).padStart(64, '0'), identity: { name: { en: `Programme ${index}` }, degreeLevel: 'bachelor', teachingLanguages: [] },
    year: null, intake: null, fields: { teachingLanguages: null, durationMonths: null, applyUrl: null, languageRequirements: null }, reviewAfter: '2026-11-30' })
  const old = target(0); Object.assign(input, { recordTargets: [old] })
  await seed(f.env, input, now); await setControls(f.env, { expectedRevision: 0, legacyGuardSha256: TEST_GUARDS, enabled: true, modelsEnabled: true, canaryUniversityIds: input.schools.slice(0, Math.max(5, sources)).map(s => s.universityId) }, now)
  for (let i = 0; i < sources; i++) {
    const raw = `Official international Programme ${i}; current observed original body`, rawSha = await digest(raw), full = raw + ' normalized text', textSha = await digest(full), rawKey = `maintenance/snapshots/${ids[i]}/${rawSha}.bin`, key = `maintenance/snapshots/${ids[i]}/${rawSha}.json`, textKey = `maintenance/text/${ids[i]}/${textSha}.txt`
    await f.bucket.put(rawKey, raw); await f.bucket.put(textKey, full); await f.bucket.put(key, canonical({ version: 1, sourceId: ids[i], sourceUrl: `https://test.edu.cn/source-${i}`, finalUrl: `https://test.edu.cn/source-${i}`, checkedAt: iso, rawSha256: rawSha, rawKey, textKey, textSha256: textSha, canonicalSha256: textSha, contentType: 'text/plain', parserCandidates: [] }))
    f.db.sqlite.prepare('UPDATE maintenance_sources SET raw_sha256=?,canonical_sha256=?,snapshot_key=?,last_attempt_at=?,last_success_at=?,due_at=? WHERE source_id=?').run(rawSha, textSha, key, iso, iso, new Date(now + 168 * 3600000).toISOString(), ids[i])
    f.db.sqlite.prepare('INSERT INTO maintenance_observations VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(`observed-${i}`, `captured-${i}`, ids[i], iso, `https://test.edu.cn/source-${i}`, 200, rawSha, textSha, key, 'text/plain', 'captured', 0)
  }
  const targets = [old, ...Array.from({ length: count }, (_, i) => target(i + 1, i % sources))]
  const refresh = () => refreshTargets(f.env, { inputCatalogSha256: TEST_CATALOG, recordTargets: targets })
  const drain = async () => seedTargetFollowupJobs(f.env, (await control(f.env))!, (row, sha, key, scope) => queueExtraction(f.env, row, sha, key, now, scope), now)
  return { ...f, ids, targets, target, refresh, drain }
}

