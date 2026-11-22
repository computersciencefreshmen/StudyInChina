import { z } from 'zod'
import { getTodayDate } from '../../../src/lib/data/freshness'
import { coverageSnapshotSchema, readCoverageSnapshot, validateCoverageSnapshot, type CoverageSnapshot } from './coverage'
import { EXISTING_SCHOOLS_V2_SHA256 } from './scope-config'
import { MaintenanceError, type MaintenanceEnv } from './types'
import { canonical, digest } from './util'

const hash = z.string().regex(/^[a-f0-9]{64}$/u)
const releaseSchema = z.object({ deploymentSha: z.string().regex(/^[a-f0-9]{40}$/u), directoryRevision: hash,
  evaluatedForDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u), catalogBackend: z.literal('json'),
  coverage: z.object({sha256:hash, inputCatalogSha256:hash, scopeRegistrySha256:hash}).optional() })
export type PublicCoverageRelease = z.infer<typeof releaseSchema>
const registration = z.object({ release: releaseSchema, coverage: coverageSnapshotSchema }).strict()
const publicURL = 'https://studyinchina.vercel.app/api/v1/releases/current?view=school-coverage'

export async function observeCoverageRelease(fetcher: typeof fetch = fetch): Promise<PublicCoverageRelease> {
  let response: Response
  try {
    // Workers supports manual redirects. Reject the redirect response before using its body.
    response = await fetcher(publicURL, { cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(8000) })
  } catch {
    throw new MaintenanceError('public_coverage_release_unavailable')
  }
  if (!response.ok || response.redirected || (response.url && response.url !== publicURL))
    throw new MaintenanceError('public_coverage_release_unavailable')
  try {
    const body = await response.json() as {data?: unknown}
    return releaseSchema.parse(body.data)
  } catch {
    throw new MaintenanceError('public_coverage_release_invalid')
  }
}

const marker = (scope: string) => `maintenance/coverage/public/v1/${scope}/registered`
const location = (scope: string, release: PublicCoverageRelease) =>
  `maintenance/coverage/public/v1/${scope}/${release.evaluatedForDate}/${release.deploymentSha}/${release.directoryRevision}.json`

// There is one immutable receipt per exact deployed commit, projection and day.
// A stale writer therefore cannot replace the version used by a newer deployment.
export async function registerPublicCoverage(env: MaintenanceEnv, value: unknown, now = Date.now(), fetcher: typeof fetch = fetch) {
  const parsed = registration.safeParse(value)
  if (!parsed.success) throw new MaintenanceError('public_coverage_payload_invalid')
  const { release, coverage } = parsed.data, today = getTodayDate(new Date(now))
  const cfg = await env.PIPELINE_DB.prepare('SELECT scope_sha256,seed_complete,targets_complete,enabled FROM maintenance_control WHERE singleton=1')
    .first<{ scope_sha256: string; seed_complete: number; targets_complete: number; enabled: number }>()
  if (!cfg?.enabled || !cfg.seed_complete || !cfg.targets_complete || env.MAINTENANCE_ENABLED !== 'true'
    || cfg.scope_sha256 !== EXISTING_SCHOOLS_V2_SHA256 || cfg.scope_sha256 !== env.SCOPE_REGISTRY_SHA256)
    throw new MaintenanceError('public_coverage_control_not_ready')
  const live = await observeCoverageRelease(fetcher)
  if (!live.coverage || release.evaluatedForDate !== today || canonical(live) !== canonical(release)
    || live.coverage.sha256 !== coverage.sha256 || live.coverage.scopeRegistrySha256 !== cfg.scope_sha256
    || live.coverage.inputCatalogSha256 !== coverage.inputCatalogSha256) throw new MaintenanceError('public_coverage_release_changed')
  const schools = (await env.PIPELINE_DB.prepare('SELECT university_id FROM maintenance_schools WHERE scope_sha256=?')
    .bind(cfg.scope_sha256).all<{university_id:string}>()).results ?? []
  if (schools.length !== 295) throw new MaintenanceError('public_coverage_scope_incomplete')
  await validateCoverageSnapshot(coverage, { scopeRegistrySha256: cfg.scope_sha256, today, inputCatalogSha256: coverage.inputCatalogSha256,
    schoolIds: new Set(schools.map(row => row.university_id)) })
  const key = location(cfg.scope_sha256, live), bytes = canonical({ release, coverage })
  let reused: boolean
  try {
    const prior = await env.SNAPSHOTS_BUCKET.get(key)
    if (!prior) await env.SNAPSHOTS_BUCKET.put(key, bytes, { onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: {contentType:'application/json'} })
    const stored = prior ?? await env.SNAPSHOTS_BUCKET.get(key)
    if (!stored || await stored.text() !== bytes) throw new MaintenanceError('public_coverage_immutable_conflict')
    if (!await env.SNAPSHOTS_BUCKET.get(marker(cfg.scope_sha256)))
      await env.SNAPSHOTS_BUCKET.put(marker(cfg.scope_sha256), '1', { onlyIf: { etagDoesNotMatch: '*' } })
    reused = Boolean(prior)
  } catch (error) {
    if (error instanceof MaintenanceError) throw error
    throw new MaintenanceError('public_coverage_storage_unavailable')
  }
  return { ok: true, reused, deploymentSha: live.deploymentSha, directoryRevision: live.directoryRevision,
    evaluatedOn: today, coverageSha256: coverage.sha256, inputCatalogSha256: coverage.inputCatalogSha256, schoolCount: schools.length }
}

export async function readSchedulingCoverage(env: MaintenanceEnv, catalog: string, scope: string, now = Date.now(),
  fetcher: typeof fetch = fetch, expectedDeployment?: string | null): Promise<CoverageSnapshot | null> {
  if (scope !== EXISTING_SCHOOLS_V2_SHA256 || !await env.SNAPSHOTS_BUCKET.get(marker(scope)))
    return expectedDeployment ? null : readCoverageSnapshot(env,catalog,scope,now)
  try {
    const release = await observeCoverageRelease(fetcher), today = getTodayDate(new Date(now))
    if (!release.coverage || release.coverage.scopeRegistrySha256 !== scope || release.evaluatedForDate !== today
      || (expectedDeployment && release.deploymentSha !== expectedDeployment)) return null
    const object = await env.SNAPSHOTS_BUCKET.get(location(scope,release))
    if (!object || (object.size ?? 0) > 2 * 1024 * 1024) return null
    const saved = registration.parse(JSON.parse(await object.text())), { sha256, ...content } = saved.coverage
    if (canonical(saved.release) !== canonical(release) || content.scopeRegistrySha256 !== scope || content.evaluatedOn !== today
      || content.schools.length !== 295 || content.inputCatalogSha256 !== release.coverage.inputCatalogSha256
      || sha256 !== release.coverage.sha256 || sha256 !== await digest(canonical(content))) return null
    return saved.coverage
  } catch { return null }
}
