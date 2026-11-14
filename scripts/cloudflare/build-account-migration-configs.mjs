import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const WORKERS = ['catalog-maintenance', 'ingestion', 'localization', 'entity-materializer', 'publisher', 'release-builder', 'catalog-api']
const ACCOUNT = /^[a-f0-9]{32}$/u, UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u
const FLAGS = ['MODEL_STATE_MIGRATION_ID', 'MODEL_STATE_MIGRATION_ROLE', 'MODEL_STATE_MIGRATION_SOURCE_ACCOUNT_ID', 'MODEL_STATE_MIGRATION_TARGET_ACCOUNT_ID']
const INTERNAL_SECRETS = new Set(['MAINTENANCE_ADMIN_TOKEN', 'INGESTION_ADMIN_TOKEN', 'LOCALIZATION_ADMIN_TOKEN', 'CATALOG_API_TOKEN', 'ADMIN_TELEMETRY_TOKEN'])
const PROVIDER_SECRETS = new Set(['MINIMAX_SUBSCRIPTION_KEY', 'MINIMAX_API_KEY', 'CLOUDFLARE_BILLING_READ_TOKEN'])
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value)
  ? `[${value.map(canonical).join(',')}]` : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
const fail = (code, worker = '', binding = '') => { throw new Error([code, worker, binding].filter(Boolean).join(':')) }

function resourceBindings(config, worker) {
  for (const key of ['kv_namespaces', 'vectorize', 'hyperdrive', 'dispatch_namespaces', 'pipelines', 'send_email', 'containers']) {
    if (config[key] && (!Array.isArray(config[key]) || config[key].length)) fail('unsupported_config_resources', worker, key)
  }
  if (config.services !== undefined && (!Array.isArray(config.services) || config.services.length !== 1 || worker !== 'catalog-api'
    || canonical(config.services[0]) !== canonical({ binding: 'MAINTENANCE_MONITOR', service: 'studyinchina-catalog-maintenance', entrypoint: 'MaintenanceMonitor' }))) fail('unsupported_config_resources', worker, 'services')
  if (config.env || config.unsafe || config.assets || config.site) fail('config_requires_explicit_review', worker)
  return [
    ...(config.services ?? []).map(binding => ({ name: binding.binding, type: 'service', binding })),
    ...(config.d1_databases ?? []).map(binding => ({ name: binding.binding, type: 'd1', binding })),
    ...(config.r2_buckets ?? []).map(binding => ({ name: binding.binding, type: 'r2_bucket', binding })),
    ...(config.queues?.producers ?? []).map(binding => ({ name: binding.binding, type: 'queue', binding })),
    ...(config.durable_objects?.bindings ?? []).map(binding => ({ name: binding.name, type: 'durable_object_namespace', binding })),
    ...(config.ai ? [{ name: config.ai.binding, type: 'ai', binding: config.ai }] : []),
    ...(config.browser ? [{ name: config.browser.binding, type: 'browser', binding: config.browser }] : []),
  ]
}
function absolutePaths(config, configPath) {
  const directory = dirname(configPath)
  for (const field of ['main', '$schema', 'tsconfig']) if (config[field] !== undefined) {
    if (typeof config[field] !== 'string') fail('config_path_invalid')
    config[field] = resolve(directory, config[field])
    if (!existsSync(config[field])) fail('config_path_missing')
  }
  for (const database of config.d1_databases ?? []) if (database.migrations_dir !== undefined) {
    database.migrations_dir = resolve(directory, database.migrations_dir)
    if (!statSync(database.migrations_dir).isDirectory()) fail('migration_directory_missing')
  }
  if (config.build?.cwd !== undefined) config.build.cwd = resolve(directory, config.build.cwd)
  return config
}

/** Offline preparation only. Secret metadata is inspected by name/type; secret
 * values, environment credentials, APIs and existing cloud resources are never read. */
export function buildAccountMigrationConfigs({ sourceAccountId, targetAccountId, pipelineId, catalogId, metadataDirectory, catalogMetadataPath, migrationId, outputDirectory }) {
  if (!ACCOUNT.test(sourceAccountId ?? '') || !ACCOUNT.test(targetAccountId ?? '') || sourceAccountId === targetAccountId) fail('migration_accounts_invalid')
  if (!UUID.test(pipelineId ?? '') || !UUID.test(catalogId ?? '') || pipelineId === catalogId) fail('target_database_ids_invalid')
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{7,95}$/u.test(migrationId ?? '')) fail('migration_id_invalid')
  const output = resolve(outputDirectory)
  if (existsSync(output) && readdirSync(output).length) fail('migration_output_must_be_empty')
  const newDatabases = { 'studyinchina-pipeline': pipelineId, 'studyinchina-catalog': catalogId }
  const oldDatabases = new Map(), prepared = [], workers = []
  for (const worker of WORKERS) {
    const configPath = join(ROOT, 'workers', worker, 'wrangler.jsonc'), original = readFileSync(configPath)
    const parsed = ts.parseConfigFileTextToJson(configPath, original.toString('utf8'))
    if (parsed.error || !parsed.config || parsed.config.name !== `studyinchina-${worker}` || parsed.config.account_id && parsed.config.account_id !== sourceAccountId) fail('source_config_invalid', worker)
    const config = parsed.config, expected = resourceBindings(config, worker)
    const metadataPath = worker === 'catalog-api' ? resolve(catalogMetadataPath) : join(resolve(metadataDirectory), `${worker}-after.json`)
    const raw = readFileSync(metadataPath), live = JSON.parse(raw.toString('utf8').replace(/^\uFEFF/u, '')), bindings = live.resources?.bindings
    if (!UUID.test(live.id ?? '') || !Array.isArray(bindings)) fail('source_version_metadata_invalid', worker)
    if (live.resources?.script_runtime?.compatibility_date !== config.compatibility_date
      || canonical([...(live.resources.script_runtime.compatibility_flags ?? [])].sort()) !== canonical([...(config.compatibility_flags ?? [])].sort())) fail('source_runtime_differs_from_trusted_config', worker)
    const names = new Set(), vars = {}, secrets = [], resources = []
    for (const binding of bindings) {
      if (!binding || typeof binding.name !== 'string' || !/^[A-Z][A-Z0-9_]*$/u.test(binding.name) || names.has(binding.name)) fail('source_binding_invalid_or_duplicate', worker)
      names.add(binding.name)
      if (binding.type === 'plain_text') {
        if (typeof binding.text !== 'string') fail('source_plain_text_invalid', worker, binding.name)
        if (binding.name.startsWith('MODEL_STATE_MIGRATION_') && !FLAGS.includes(binding.name)) fail('unknown_migration_flag', worker, binding.name)
        vars[binding.name] = binding.text
        continue
      }
      if (binding.type === 'secret_text') {
        if (Object.keys(binding).some(key => !['name', 'type'].includes(key))) fail('secret_value_or_unexpected_metadata_forbidden', worker, binding.name)
        secrets.push(binding.name); continue
      }
      const match = expected.filter(item => item.name === binding.name)
      if (match.length !== 1 || match[0].type !== binding.type) fail('untrusted_source_resource_binding', worker, binding.name)
      const wanted = match[0].binding
      if (binding.type === 'd1') {
        const targetId = newDatabases[wanted.database_name]
        if (!targetId || binding.database_id !== wanted.database_id || targetId === wanted.database_id) fail('source_database_mismatch', worker, binding.name)
        if (oldDatabases.has(wanted.database_name) && oldDatabases.get(wanted.database_name) !== wanted.database_id) fail('inconsistent_source_database_id', worker, binding.name)
        oldDatabases.set(wanted.database_name, wanted.database_id)
        resources.push({ name: binding.name, type: binding.type, databaseName: wanted.database_name, sourceId: binding.database_id, targetId })
      } else if (binding.type === 'r2_bucket') {
        if (binding.bucket_name !== wanted.bucket_name) fail('source_bucket_mismatch', worker, binding.name)
        resources.push({ name: binding.name, type: binding.type, bucketName: wanted.bucket_name, recreateInTargetAccount: true })
      } else if (binding.type === 'queue') {
        if (binding.queue_name !== wanted.queue) fail('source_queue_mismatch', worker, binding.name)
        resources.push({ name: binding.name, type: binding.type, queueName: wanted.queue, recreateInTargetAccount: true })
      } else if (binding.type === 'service') {
        if (binding.service !== wanted.service || binding.entrypoint !== wanted.entrypoint
          || binding.environment !== undefined && binding.environment !== 'production'
          || Object.keys(binding).some(key => !['name','type','service','entrypoint','environment'].includes(key))) fail('source_service_mismatch', worker, binding.name)
        resources.push({ name: binding.name, type: binding.type, serviceName: wanted.service, entrypoint: wanted.entrypoint, recreateInTargetAccount: true, crossAccountGrant: false })
      } else if (binding.type === 'durable_object_namespace') {
        if (binding.class_name !== wanted.class_name || wanted.script_name || binding.script_name || !(ACCOUNT.test(binding.namespace_id ?? '') || UUID.test(binding.namespace_id ?? ''))) fail('source_durable_object_mismatch', worker, binding.name)
        resources.push({ name: binding.name, type: binding.type, className: binding.class_name, sourceNamespaceId: binding.namespace_id, targetNamespaceId: null, requiresStateMigration: true })
      } else resources.push({ name: binding.name, type: binding.type, recreateInTargetAccount: true })
    }
    for (const binding of expected) if (!names.has(binding.name)) fail('source_resource_binding_missing', worker, binding.name)
    if (expected.some(binding => binding.type === 'durable_object_namespace') && live.resources.script_runtime.migration_tag !== config.migrations?.at(-1)?.tag) fail('source_durable_migration_tag_mismatch', worker)
    const removedTemporaryVarNames = Object.keys(vars).filter(name => FLAGS.includes(name) || name === 'ACCOUNT_MIGRATION_FROZEN').sort()
    for (const name of removedTemporaryVarNames) delete vars[name]
    const active = absolutePaths(structuredClone(config), configPath)
    active.account_id = targetAccountId; active.vars = { ...vars }
    for (const database of active.d1_databases ?? []) database.database_id = newDatabases[database.database_name]
    // The trusted local class binding allocates a new target namespace. Never
    // smuggle the old namespace ID or another account's script through metadata.
    for (const binding of active.durable_objects?.bindings ?? []) delete binding.namespace_id
    const staged = structuredClone(active)
    staged.triggers = { ...(staged.triggers ?? {}), crons: [] }
    if (staged.queues) delete staged.queues.consumers
    if (worker === 'catalog-maintenance') {
      Object.assign(staged.vars, { MAINTENANCE_ENABLED: 'false', MODEL_STATE_MIGRATION_ID: migrationId, MODEL_STATE_MIGRATION_ROLE: 'target',
        MODEL_STATE_MIGRATION_SOURCE_ACCOUNT_ID: sourceAccountId, MODEL_STATE_MIGRATION_TARGET_ACCOUNT_ID: targetAccountId })
    }
    if (worker === 'catalog-api') staged.vars.ACCOUNT_MIGRATION_FROZEN = 'true'
    const files = ['staged', 'active'].map(stage => {
      const name = `${worker}.${stage}.json`, text = JSON.stringify(stage === 'staged' ? staged : active, null, 2) + '\n'
      prepared.push({ name, text }); return { stage, name, sha256: hash(text), bytes: Buffer.byteLength(text) }
    })
    workers.push({ worker, name: config.name, sourceVersionId: live.id, sourceConfigSha256: hash(original), sourceMetadataSha256: hash(raw),
      sourceMetadataAccountVerifiedByThisOfflineTool: false, sourceBindingResourcesVerified: true, resourceBindings: resources,
      livePlainTextVarNames: Object.keys(vars).sort(), removedTemporaryVarNames,
      providerSecretNames: secrets.filter(name => PROVIDER_SECRETS.has(name)).sort(),
      internallyGeneratableSecretNames: secrets.filter(name => INTERNAL_SECRETS.has(name)).sort(),
      otherManualSecretNames: secrets.filter(name => !PROVIDER_SECRETS.has(name) && !INTERNAL_SECRETS.has(name)).sort(),
      requiredTargetSecretNames: secrets.sort(), targetSecretsProvisioned: false,
      triggers: { source: 'trusted-repository-config', liveSettingsVerified: false, crons: config.triggers?.crons ?? [], consumers: config.queues?.consumers ?? [] },
      files })
  }
  if (oldDatabases.size !== 2 || [...oldDatabases.values()].some(id => [pipelineId, catalogId].includes(id))) fail('database_account_mapping_invalid')
  const content = { format: 'studyinchina.account-migration-configs', version: 1, sourceAccountId, targetAccountId, migrationId,
    databases: [...oldDatabases].map(([databaseName, sourceId]) => ({ databaseName, sourceId, targetId: newDatabases[databaseName] })), workers,
    activation: { stagedHasNoCronSchedules: true, stagedHasNoConsumerConfigs: true, existingTargetConsumersMustBeDetached: true,
      activeRequiresReplaceVars: true, keepVars: false, secretValuesIncluded: false, targetResourcesExistenceVerified: false,
      requiresModelStateFinalized: true, requiresDataAndEvidenceVerified: true, cloudMutationPerformed: false, cutoverReady: false } }
  const manifest = { ...content, sha256: hash(canonical(content)) }
  mkdirSync(output, { recursive: true, mode: 0o700 })
  for (const file of prepared) writeFileSync(join(output, file.name), file.text, { mode: 0o600, flag: 'wx' })
  writeFileSync(join(output, 'manifest.json'), canonical(manifest) + '\n', { mode: 0o600, flag: 'wx' })
  return manifest
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), flags = ['--source-account', '--target-account', '--pipeline-id', '--catalog-id', '--metadata-dir', '--catalog-metadata', '--migration-id', '--output']
  if (args.length !== flags.length * 2 || flags.some(flag => args.filter(value => value === flag).length !== 1)) fail('Usage: build-account-migration-configs.mjs --source-account <id> --target-account <id> --pipeline-id <new-uuid> --catalog-id <new-uuid> --metadata-dir <six-live-versions> --catalog-metadata <live-version.json> --migration-id <id> --output <private-empty-dir>')
  const value = flag => args[args.indexOf(flag) + 1]
  const manifest = buildAccountMigrationConfigs({ sourceAccountId: value('--source-account'), targetAccountId: value('--target-account'), pipelineId: value('--pipeline-id'), catalogId: value('--catalog-id'),
    metadataDirectory: value('--metadata-dir'), catalogMetadataPath: value('--catalog-metadata'), migrationId: value('--migration-id'), outputDirectory: value('--output') })
  process.stdout.write(JSON.stringify({ format: manifest.format, workers: manifest.workers.length, configs: 14, sha256: manifest.sha256, secretValuesIncluded: false, cloudMutationPerformed: false }))
}
