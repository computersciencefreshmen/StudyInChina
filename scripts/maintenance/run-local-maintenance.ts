import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ProxyAgent, setGlobalDispatcher } from 'undici'
import { getCcSwitchQuotaConfig } from '../ingestion/minimax-quota'
import { maintenanceScopeSchema, sourceSeedSchema } from './contracts'
import { ModelAdmission } from '../../workers/catalog-maintenance/src/admission'
import { processMessage } from '../../workers/catalog-maintenance/src/index'
import { control, seed, setControls } from '../../workers/catalog-maintenance/src/repository'
import { prepareExport, readExport } from '../../workers/catalog-maintenance/src/exports'
import { canonical, digest, nowIso, record } from '../../workers/catalog-maintenance/src/util'
import { assertSafeSourceUrl } from '../../workers/ingestion/src/security'
import type { MaintenanceEnv } from '../../workers/catalog-maintenance/src/types'
import { openLocalRuntime } from './local-runtime'

/** Temporary, durable execution staging. Canonical acceptance/publication stays in the cloud writer. */
export async function runLocalMaintenance(options: {
  directory: string; seedFile: string; sourceFile: string; workerUrl: string; adminToken: string;
  execute: boolean; maxJobs?: number; reparseCompletedPrograms?: boolean;
}) {
  const directory = resolve(options.directory)
  if (!options.execute) throw new Error('explicit_execute_required')
  if (!Number.isSafeInteger(options.maxJobs ?? 40) || (options.maxJobs ?? 40) < 1 || (options.maxJobs ?? 40) > 200) throw new Error('invalid_local_job_limit')
  if (existsSync(join(directory, 'handoff.json'))) throw new Error('offline_batch_frozen_for_handoff')
  const remote = new URL(options.workerUrl)
  if (remote.origin !== 'https://studyinchina-catalog-maintenance.13022037121.workers.dev' || remote.pathname !== '/') throw new Error('unexpected_maintenance_service')
  if (options.adminToken.length < 24) throw new Error('maintenance_admin_credential_unavailable')
  mkdirSync(directory, { recursive: true })
  const runtime = await openLocalRuntime({ directory })
  try {
    const seedInput = JSON.parse(readFileSync(resolve(options.seedFile), 'utf8'))
    const scope = maintenanceScopeSchema.parse(JSON.parse(readFileSync('content/maintenance/scope-272.v1.json', 'utf8')))
    if (seedInput.scopeRegistrySha256 !== scope.sha256 || seedInput.schools.length !== 272 || !seedInput.legacyGuards.entries.length) throw new Error('complete_pinned_history_required')
    const sourceBytes = readFileSync(resolve(options.sourceFile), 'utf8')
    const manifest = JSON.parse(sourceBytes)
    const sources = manifest.sources.map((entry: unknown) => {
      const { id, universityId, url, allowedHosts, sourceCategory, entityType, enabled, registration } = entry as Record<string, unknown>
      return sourceSeedSchema.parse({ id, universityId, url, allowedHosts, sourceCategory, entityType, enabled, registration })
    }).filter((entry: { enabled: boolean }) => entry.enabled)
    if (!sources.length || sources.length > 20) throw new Error('invalid_pilot_sources')
    for (const source of sources) {
      const school = scope.schools.find(school => school.universityId === source.universityId)
      if (!school) throw new Error('source_outside_fixed_scope')
      const host = new URL(source.url).hostname
      if (!school.officialHosts.some(family => host === family || host.endsWith(`.${family}`))) throw new Error('source_outside_official_host_family')
      assertSafeSourceUrl(source.url, [host])
    }
    const config = getCcSwitchQuotaConfig()
    if (config.model !== 'MiniMax-M3') throw new Error('subscription_model_mismatch')
    const base = config.endpoint.includes('minimax.io') ? 'https://api.minimax.io/anthropic' : 'https://api.minimaxi.com/anthropic'
    const localToken = randomBytes(32).toString('hex')
    const env: MaintenanceEnv = {
      PIPELINE_DB: runtime.db, SNAPSHOTS_BUCKET: runtime.bucket, MAINTENANCE_QUEUE: runtime.queue,
      MODEL_ADMISSION: null as never, MAINTENANCE_ADMIN_TOKEN: localToken,
      MINIMAX_SUBSCRIPTION_KEY: config.key, MINIMAX_MODEL: 'MiniMax-M3', MINIMAX_ANTHROPIC_BASE: base,
      MAINTENANCE_ENABLED: 'true', SCOPE_REGISTRY_SHA256: scope.sha256, MODEL_CONCURRENCY: '2',
      MINIMAX_CREDIT_FALLBACK_DISABLED: 'false',
    }
    await seed(env, seedInput)
    const cfg = await control(env)
    if (!cfg) throw new Error('local_seed_missing')
    const fencePath = join(directory, 'fence-private.json')
    const fenceInput = { scopeRegistrySha256: scope.sha256, inputCatalogSha256: cfg.input_catalog_sha256,
      seedSha256: cfg.seed_sha256, legacyGuardSha256: cfg.legacy_guard_sha256, sourceManifestSha256: await digest(sourceBytes) }
    const fence = existsSync(fencePath) ? JSON.parse(readFileSync(fencePath, 'utf8')) : {
      ...fenceInput, batchId: `offline-${crypto.randomUUID()}`, token: randomBytes(32).toString('hex'),
    }
    if (Object.entries(fenceInput).some(([key, value]) => fence[key] !== value)) throw new Error('offline_batch_input_conflict')
    if (!existsSync(fencePath)) writeFileSync(fencePath, JSON.stringify(fence), { flag: 'wx', mode: 0o600 })
    const remoteJson = async (path: string, body?: unknown) => {
      const response = await fetch(new URL(path, remote), { method: body === undefined ? 'GET' : 'POST', redirect: 'error',
        headers: { authorization: `Bearer ${options.adminToken}`, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) })
      if (!response.ok) throw new Error(`offline_cloud_coordination_http_${response.status}`)
      return response.json() as Promise<Record<string, unknown>>
    }
    const assertFence = async () => {
      const observed = record((await remoteJson('/offline-fence')).fence)
      if (!observed || observed.batchId !== fence.batchId || observed.phase !== 'active'
        || observed.tokenSha256 !== await digest(fence.token) || observed.scopeRegistrySha256 !== scope.sha256
        || observed.inputCatalogSha256 !== cfg.input_catalog_sha256) throw new Error('offline_cloud_fence_not_owned')
    }
    const bootstrap = await remoteJson('/artifacts?key=maintenance/bootstrap-pending/initial.v1.json')
    if (bootstrap.seedSha256 !== cfg.seed_sha256 || bootstrap.scopeRegistrySha256 !== scope.sha256)
      throw new Error('offline_seed_does_not_match_immutable_cloud_history')
    await remoteJson('/offline-fence/acquire', { batchId: fence.batchId, token: fence.token,
      scopeRegistrySha256: fence.scopeRegistrySha256, inputCatalogSha256: fence.inputCatalogSha256 })
    await assertFence()
    const admission = new ModelAdmission({ storage: runtime.storage }, env, async (input, init) => {
      // The final cloud lease check is immediately before a paid POST. The production
      // admission class has already durably reserved this request before calling us.
      if (init?.method === 'POST') await assertFence()
      return fetch(input, init)
    })
    env.MODEL_ADMISSION = { idFromName: name => name, get: () => ({ fetch: request => admission.fetch(request) }) }
    if (!cfg.enabled) await setControls(env, { expectedRevision: cfg.revision, enabled: true, modelsEnabled: true,
      legacyGuardSha256: cfg.legacy_guard_sha256, canaryUniversityIds: [...new Set(sources.map((source: { universityId: string }) => source.universityId))] })
    const selectedIds: string[] = []
    for (const source of sources) {
      const id = await digest(source.url), host = new URL(source.url).hostname
      if (!selectedIds.includes(id)) selectedIds.push(id)
      const previous = runtime.db.sqlite.prepare('SELECT * FROM maintenance_sources WHERE source_id=?').get(id)
      if (!previous) await runtime.db.prepare('INSERT INTO maintenance_sources(source_id,url,allowed_hosts_json,category,categories_json,enabled,interval_hours,due_at) VALUES(?,?,?,?,?,1,168,?)')
        .bind(id, source.url, JSON.stringify([host]), source.sourceCategory, JSON.stringify([source.sourceCategory]), nowIso()).run()
      else {
        const categories = [...new Set([...(JSON.parse(String(previous.categories_json)) as string[]), source.sourceCategory])]
        await runtime.db.prepare('UPDATE maintenance_sources SET categories_json=? WHERE source_id=?')
          .bind(JSON.stringify(categories), id).run()
      }
      await runtime.db.prepare('INSERT OR IGNORE INTO maintenance_source_schools VALUES(?,?)').bind(id, source.universityId).run()
      const jobId = await digest(`${fence.batchId}:capture:${id}`)
      await runtime.db.prepare("INSERT OR IGNORE INTO maintenance_jobs(job_id,source_id,stage,status,due_at,created_at,updated_at) VALUES(?,?,'capture','queued',?,?,?)")
        .bind(jobId, id, nowIso(), nowIso(), nowIso()).run()
    }
    if (options.reparseCompletedPrograms) {
      // Re-run deterministic validation over completed saved responses. Request keys
      // and payloads remain unchanged; unknown/in-flight jobs are never reopened.
      await runtime.db.batch([
        runtime.db.prepare('INSERT INTO maintenance_events VALUES(?,?,?,?)').bind(crypto.randomUUID(), 'offline_completed_program_reparse', nowIso(), canonical({ parserVersion: 2, sourceIds: selectedIds })),
        runtime.db.prepare(`UPDATE maintenance_jobs SET status='queued',due_at=?,updated_at=? WHERE source_id IN(${selectedIds.map(() => '?').join(',')}) AND stage='extract' AND status='done' AND lease_token IS NULL`)
          .bind(nowIso(), nowIso(), ...selectedIds),
      ])
    }
    let processed = 0
    for (; processed < (options.maxJobs ?? 40); processed++) {
      const job = await runtime.db.prepare(`SELECT job_id,stage,source_id FROM maintenance_jobs WHERE source_id IN(${selectedIds.map(() => '?').join(',')}) AND status IN('queued','retry') AND due_at<=? ORDER BY CASE stage WHEN 'capture' THEN 0 WHEN 'award' THEN 1 WHEN 'extract' THEN 2 ELSE 3 END,created_at LIMIT 1`)
        .bind(...selectedIds, nowIso()).first<{ job_id: string; stage: string; source_id: string }>()
      if (!job) break
      await assertFence()
      console.log(JSON.stringify({ event: 'job_started', stage: job.stage, sourceId: job.source_id }))
      await processMessage(env, { version: 1, jobId: job.job_id })
      console.log(JSON.stringify({ event: 'job_finished', ...await runtime.db.prepare('SELECT stage,status,error_code FROM maintenance_jobs WHERE job_id=?').bind(job.job_id).first() }))
    }
    const proposals = (await runtime.db.prepare('SELECT status,COUNT(*) count FROM maintenance_proposals GROUP BY status').all()).results
    const attempts = (await runtime.db.prepare('SELECT status,COUNT(*) count FROM maintenance_model_attempts GROUP BY status').all()).results
    const report = { batchId: fence.batchId, checkedAt: nowIso(), scopeSchoolCount: 272, processed, proposals, attempts,
      jobs: (await runtime.db.prepare('SELECT stage,status,error_code,COUNT(*) count FROM maintenance_jobs GROUP BY stage,status,error_code').all()).results,
      cloudFenceHeld: true, canonicalPublished: false }
    writeFileSync(join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n')
    const ready = await runtime.db.prepare("SELECT COUNT(*) count FROM maintenance_proposals WHERE status='ready'").first<{ count: number }>()
    if (ready?.count) {
      const exported = await prepareExport(env, { limit: 100 }), batch = await readExport(env, exported.batchId)
      const download = join(directory, 'download'); mkdirSync(join(download, 'artifacts'), { recursive: true })
      writeFileSync(join(download, 'export.json'), canonical(batch) + '\n')
      for (const artifact of await runtime.bucket.list()) {
        const object = await runtime.bucket.get(artifact.key)
        if (!object) throw new Error('staged_artifact_missing')
        const path = join(download, 'artifacts', artifact.key); mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, new Uint8Array(await object.arrayBuffer()))
      }
      console.log(JSON.stringify({ event: 'candidate_export_staged', ...exported, directory: download }))
    }
    console.log(JSON.stringify(report))
    return report
  } finally { await runtime.close() }
}

async function main() {
  const args = process.argv.slice(2), option = (name: string) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
  if (process.env.HTTPS_PROXY) setGlobalDispatcher(new ProxyAgent(process.env.HTTPS_PROXY))
  await runLocalMaintenance({ directory: option('--directory') ?? '.pipeline-build/maintenance-private/local-pilot',
    seedFile: option('--seed') ?? '.pipeline-build/maintenance-bootstrap/seed-v5.json',
    sourceFile: option('--sources') ?? 'scripts/maintenance/pilot-sources.json',
    workerUrl: process.env.CATALOG_MAINTENANCE_URL ?? '', adminToken: process.env.CATALOG_MAINTENANCE_TOKEN ?? '',
    execute: args.includes('--execute'), maxJobs: option('--max-jobs') ? Number(option('--max-jobs')) : undefined,
    reparseCompletedPrograms: args.includes('--reparse-completed-programs') })
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(() => {
  console.error('local_maintenance_failed; inspect the durable journal and report without replaying unknown sends')
  process.exitCode = 1
})
