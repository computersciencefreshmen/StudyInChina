import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import ts from 'typescript'
import { afterEach, describe, expect, it } from 'vitest'
import { buildAccountMigrationConfigs, type MigrationConfigOptions } from '../../scripts/cloudflare/build-account-migration-configs.mjs'

const workers = ['catalog-maintenance', 'ingestion', 'localization', 'entity-materializer', 'publisher', 'release-builder', 'catalog-api']
const temporary: string[] = [], source = 'b75f28d574289c29e9bda60a2fca27ed', target = 'b'.repeat(32)
const flags = ['MODEL_STATE_MIGRATION_ID', 'MODEL_STATE_MIGRATION_ROLE', 'MODEL_STATE_MIGRATION_SOURCE_ACCOUNT_ID', 'MODEL_STATE_MIGRATION_TARGET_ACCOUNT_ID']
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'))
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'studyinchina-migration-configs-')); temporary.push(root)
  const configs = new Map<string, ReturnType<typeof JSON.parse>>(), metadata = new Map<string, string>(), originalHashes = new Map<string, string>()
  for (const worker of workers) {
    const path = `workers/${worker}/wrangler.jsonc`, bytes = readFileSync(path), config = ts.parseConfigFileTextToJson(path, bytes.toString('utf8')).config
    configs.set(worker, config); originalHashes.set(path, createHash('sha256').update(bytes).digest('hex'))
    const bindings = [
      ...Object.entries(config.vars ?? {}).map(([name, text]) => ({ name, type: 'plain_text', text })),
      { name: 'LIVE_ONLY_VALUE', type: 'plain_text', text: `private fixture ${worker}: preserve spaces/quotes " and 中文` },
      ...(config.d1_databases ?? []).map((b: { binding: string; database_id: string }) => ({ name: b.binding, type: 'd1', database_id: b.database_id })),
      ...(config.r2_buckets ?? []).map((b: { binding: string; bucket_name: string }) => ({ name: b.binding, type: 'r2_bucket', bucket_name: b.bucket_name })),
      ...(config.queues?.producers ?? []).map((b: { binding: string; queue: string }) => ({ name: b.binding, type: 'queue', queue_name: b.queue })),
      ...(config.durable_objects?.bindings ?? []).map((b: { name: string; class_name: string }) => ({ name: b.name, type: 'durable_object_namespace', class_name: b.class_name, namespace_id: 'e'.repeat(32) })),
      ...(config.ai ? [{ name: config.ai.binding, type: 'ai', project: 'source-account-project' }] : []),
      ...(config.browser ? [{ name: config.browser.binding, type: 'browser', version: '1' }] : []),
    ]
    const secrets = worker === 'catalog-maintenance' ? ['MAINTENANCE_ADMIN_TOKEN', 'MINIMAX_SUBSCRIPTION_KEY']
      : worker === 'ingestion' ? ['INGESTION_ADMIN_TOKEN', 'MINIMAX_API_KEY'] : worker === 'catalog-api' ? ['CATALOG_API_TOKEN', 'ADMIN_TELEMETRY_TOKEN'] : []
    bindings.push(...secrets.map(name => ({ name, type: 'secret_text' })))
    if (worker === 'catalog-maintenance') {
      for (const b of bindings) if (b.name === 'MAINTENANCE_ENABLED') Object.assign(b, { text: 'true' })
      for (const [name, text] of Object.entries({ SCOPE_SCHOOL_COUNT: '295', MODEL_STATE_MIGRATION_ID: 'old-source-migration', MODEL_STATE_MIGRATION_ROLE: 'source', MODEL_STATE_MIGRATION_SOURCE_ACCOUNT_ID: source, MODEL_STATE_MIGRATION_TARGET_ACCOUNT_ID: target })) bindings.push({ name, type: 'plain_text', text })
    }
    const pathOut = join(root, `${worker}-after.json`); metadata.set(worker, pathOut)
    writeFileSync(pathOut, JSON.stringify({ id: '11111111-1111-4111-8111-111111111111', resources: { bindings,
      script_runtime: { compatibility_date: config.compatibility_date, compatibility_flags: config.compatibility_flags ?? [], migration_tag: config.migrations?.at(-1)?.tag } } }))
  }
  const options: MigrationConfigOptions = { sourceAccountId: source, targetAccountId: target,
    pipelineId: '22222222-2222-4222-8222-222222222222', catalogId: '33333333-3333-4333-8333-333333333333',
    metadataDirectory: root, catalogMetadataPath: metadata.get('catalog-api')!, migrationId: 'new-target-migration', outputDirectory: join(root, 'configs') }
  return { root, configs, metadata, originalHashes, options }
}
function change(f: ReturnType<typeof fixture>, worker: string, mutate: (metadata: ReturnType<typeof JSON.parse>) => void) {
  const path = f.metadata.get(worker)!, data = read(path); mutate(data); writeFileSync(path, JSON.stringify(data))
}
afterEach(() => { for (const root of temporary.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('private cross-account Worker configurations', () => {
  it('preserves every live plaintext value and rewires both D1 IDs without changing trusted source configurations', () => {
    const f = fixture(), manifest = buildAccountMigrationConfigs(f.options)
    expect(manifest.workers).toHaveLength(7); expect(readdirSync(f.options.outputDirectory)).toHaveLength(15)
    for (const worker of workers) {
      const active = read(join(f.options.outputDirectory, `${worker}.active.json`)), staged = read(join(f.options.outputDirectory, `${worker}.staged.json`))
      expect(active.account_id).toBe(target); expect(active.vars.LIVE_ONLY_VALUE).toBe(`private fixture ${worker}: preserve spaces/quotes " and 中文`)
      expect(isAbsolute(active.main)).toBe(true); expect(isAbsolute(active.$schema)).toBe(true)
      expect(staged.triggers.crons).toEqual([]); expect(staged.queues?.consumers).toBeUndefined()
      expect(staged.queues?.producers).toEqual(f.configs.get(worker).queues?.producers)
      expect(active.triggers?.crons).toEqual(f.configs.get(worker).triggers?.crons)
      expect(active.queues?.consumers).toEqual(f.configs.get(worker).queues?.consumers)
      for (const database of active.d1_databases) {
        expect(database.database_id).toBe(database.database_name === 'studyinchina-pipeline' ? f.options.pipelineId : f.options.catalogId)
        expect(isAbsolute(database.migrations_dir)).toBe(true)
      }
      for (const flag of [...flags, 'ACCOUNT_MIGRATION_FROZEN']) expect(active.vars).not.toHaveProperty(flag)
    }
    for (const [path, sha] of f.originalHashes) expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(sha)
    const maintenance = read(join(f.options.outputDirectory, 'catalog-maintenance.staged.json'))
    expect(maintenance.vars).toMatchObject({ MAINTENANCE_ENABLED: 'false', SCOPE_SCHOOL_COUNT: '295', MODEL_STATE_MIGRATION_ID: 'new-target-migration', MODEL_STATE_MIGRATION_ROLE: 'target', MODEL_STATE_MIGRATION_SOURCE_ACCOUNT_ID: source, MODEL_STATE_MIGRATION_TARGET_ACCOUNT_ID: target })
    expect(read(join(f.options.outputDirectory, 'catalog-maintenance.active.json')).vars.MAINTENANCE_ENABLED).toBe('true')
    expect(maintenance.durable_objects.bindings[0]).not.toHaveProperty('namespace_id')
    expect(read(join(f.options.outputDirectory, 'catalog-api.staged.json')).vars.ACCOUNT_MIGRATION_FROZEN).toBe('true')
  })
  it('redacts values, classifies secret names and states the required activation and unverified trigger boundaries', () => {
    const f = fixture(), manifest = buildAccountMigrationConfigs(f.options), serialized = JSON.stringify(manifest)
    expect(serialized).not.toContain('private fixture'); expect(serialized).not.toContain('source-account-project')
    expect(manifest.activation).toMatchObject({ activeRequiresReplaceVars: true, keepVars: false, targetResourcesExistenceVerified: false, cloudMutationPerformed: false, cutoverReady: false })
    for (const worker of manifest.workers) expect(worker.triggers).toMatchObject({ source: 'trusted-repository-config', liveSettingsVerified: false })
    expect(manifest.workers.find(worker => worker.worker === 'catalog-maintenance')).toMatchObject({ providerSecretNames: ['MINIMAX_SUBSCRIPTION_KEY'], internallyGeneratableSecretNames: ['MAINTENANCE_ADMIN_TOKEN'], targetSecretsProvisioned: false })
    expect(manifest.workers.find(worker => worker.worker === 'catalog-api')?.internallyGeneratableSecretNames).toEqual(['ADMIN_TELEMETRY_TOKEN', 'CATALOG_API_TOKEN'])
    for (const worker of manifest.workers) for (const file of worker.files) expect(createHash('sha256').update(readFileSync(join(f.options.outputDirectory, file.name))).digest('hex')).toBe(file.sha256)
  })
  it.each(['wrong-d1', 'wrong-r2', 'wrong-queue', 'wrong-do', 'missing', 'extra-resource', 'duplicate', 'secret-value', 'runtime', 'unknown-flag'] as const)('fails before emitting any target configuration for %s source metadata', mode => {
    const f = fixture()
    change(f, 'catalog-maintenance', meta => {
      const bindings = meta.resources.bindings
      if (mode === 'wrong-d1') bindings.find((b: { type: string }) => b.type === 'd1').database_id = f.options.pipelineId
      if (mode === 'wrong-r2') bindings.find((b: { type: string }) => b.type === 'r2_bucket').bucket_name = 'unrelated-bucket'
      if (mode === 'wrong-queue') bindings.find((b: { type: string }) => b.type === 'queue').queue_name = 'unrelated-queue'
      if (mode === 'wrong-do') bindings.find((b: { type: string }) => b.type === 'durable_object_namespace').script_name = 'source-account-service'
      if (mode === 'missing') meta.resources.bindings = bindings.filter((b: { type: string }) => b.type !== 'd1')
      if (mode === 'extra-resource') bindings.push({ name: 'UNREVIEWED_KV', type: 'kv_namespace', namespace_id: 'not-allowed' })
      if (mode === 'duplicate') bindings.push({ ...bindings[0] })
      if (mode === 'secret-value') bindings.find((b: { type: string }) => b.type === 'secret_text').value = 'do-not-read-or-print-this-fixture'
      if (mode === 'runtime') meta.resources.script_runtime.compatibility_date = '2020-01-01'
      if (mode === 'unknown-flag') bindings.push({ name: 'MODEL_STATE_MIGRATION_UNKNOWN', type: 'plain_text', text: 'not-allowed' })
    })
    expect(() => buildAccountMigrationConfigs(f.options)).toThrow()
    expect(() => readFileSync(join(f.options.outputDirectory, 'manifest.json'))).toThrow()
  })
  it('rejects account/UUID mistakes and refuses to overwrite a previous private result', () => {
    const f = fixture()
    for (const change of [{ targetAccountId: source }, { targetAccountId: '../not-an-account' }, { pipelineId: f.options.catalogId }, { pipelineId: 'not-a-uuid' }, { migrationId: 'short' }]) expect(() => buildAccountMigrationConfigs({ ...f.options, ...change })).toThrow()
    buildAccountMigrationConfigs(f.options)
    const previous = readFileSync(join(f.options.outputDirectory, 'manifest.json'), 'utf8')
    expect(() => buildAccountMigrationConfigs(f.options)).toThrow('must_be_empty')
    expect(readFileSync(join(f.options.outputDirectory, 'manifest.json'), 'utf8')).toBe(previous)
  })
})
