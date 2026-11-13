import type { DurableStorage, MaintenanceEnv } from './types'
import { canonical, digest, HASH, json, record } from './util'

// Private DO storage only: these bytes must never enter the generic R2 artifact API.
export const MODEL_STATE_MIGRATION_KEY = '__model_state_migration_v1'
const PAGE_ENTRIES = 32, SCAN_LIMIT = PAGE_ENTRIES + 2, PAGE_BYTES = 4 * 1024 * 1024, MAX_PAGES = 4096
const STATES = ['send_started', 'completed', 'unknown', 'known_failed'] as const
type Counts = Record<typeof STATES[number], number>
type Binding = { migrationId: string; sourceAccountId: string; targetAccountId: string }
type Config = Binding & { role: 'source' | 'target' }
type Entry = { key: string; value: unknown }
type Page = Binding & { format: 'studyinchina.model-state-page'; version: 1; index: number; entries: Entry[] }
type PageRef = { index: number; sha256: string; byteLength: number; entryCount: number; firstKey: string | null; lastKey: string | null; startAfter: string | null }
export type ModelStateManifest = Binding & { format: 'studyinchina.model-state-manifest'; version: 1; frozenAt: string; pages: PageRef[]; entryCount: number; requestCount: number; gatePresent: boolean; states: Counts }
type Lock = Config & { version: 1; phase: 'frozen' | 'exporting' | 'exported' | 'importing' | 'finalized'; frozenAt: string; pages: PageRef[]; states: Counts; entryCount: number; requestCount: number; gatePresent: boolean; manifest?: ModelStateManifest; manifestSha256?: string; importedPages?: number; finalizedAt?: string }

export class ModelStateMigrationError extends Error {
  constructor(readonly code: string) { super(code) }
}
const fail = (code: string): never => { throw new ModelStateMigrationError(code) }
const zero = (): Counts => ({ send_started: 0, completed: 0, unknown: 0, known_failed: 0 })
const size = (bytes: string) => new TextEncoder().encode(bytes).byteLength
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0
const integer = (n: unknown): n is number => Number.isSafeInteger(n) && Number(n) >= 0
const same = (a: Binding, b: Binding) => a.migrationId === b.migrationId && a.sourceAccountId === b.sourceAccountId && a.targetAccountId === b.targetAccountId
const binding = ({ migrationId, sourceAccountId, targetAccountId }: Binding): Binding => ({ migrationId, sourceAccountId, targetAccountId })

function configured(env: MaintenanceEnv) {
  return [env.MODEL_STATE_MIGRATION_ID, env.MODEL_STATE_MIGRATION_ROLE, env.MODEL_STATE_MIGRATION_SOURCE_ACCOUNT_ID, env.MODEL_STATE_MIGRATION_TARGET_ACCOUNT_ID].some(v => v !== undefined)
}
function config(env: MaintenanceEnv): Config {
  if (!configured(env)) return fail('model_state_migration_disabled')
  const migrationId = env.MODEL_STATE_MIGRATION_ID, role = env.MODEL_STATE_MIGRATION_ROLE
  const sourceAccountId = env.MODEL_STATE_MIGRATION_SOURCE_ACCOUNT_ID, targetAccountId = env.MODEL_STATE_MIGRATION_TARGET_ACCOUNT_ID
  if (!migrationId || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{7,95}$/.test(migrationId) || role !== 'source' && role !== 'target'
    || !sourceAccountId || !targetAccountId || !/^[a-f0-9]{32}$/.test(sourceAccountId) || !/^[a-f0-9]{32}$/.test(targetAccountId) || sourceAccountId === targetAccountId) return fail('model_state_migration_configuration_invalid')
  return { migrationId, role, sourceAccountId, targetAccountId }
}
function requireRole(cfg: Config, role: Config['role']) {
  if (cfg.role !== role) fail('model_state_migration_role_mismatch')
}
function requireId(raw: Record<string, unknown>, cfg: Config) {
  if (raw.migrationId !== cfg.migrationId) fail('model_state_migration_id_mismatch')
}
function checkedLock(value: unknown): Lock | undefined {
  if (value === undefined) return undefined
  const raw = record(value)
  if (!raw || raw.version !== 1 || !['source', 'target'].includes(String(raw.role)) || !['frozen', 'exporting', 'exported', 'importing', 'finalized'].includes(String(raw.phase))
    || typeof raw.migrationId !== 'string' || typeof raw.sourceAccountId !== 'string' || typeof raw.targetAccountId !== 'string' || !Array.isArray(raw.pages)) return fail('model_state_migration_lock_invalid')
  return value as Lock
}
function matchLock(lock: Lock | undefined, cfg: Config): Lock {
  if (!lock || !same(lock, cfg) || lock.role !== cfg.role) return fail('model_state_migration_lock_mismatch')
  return lock
}
async function list(storage: DurableStorage, startAfter?: string) {
  if (!storage.list) return fail('model_state_migration_storage_list_unavailable')
  return storage.list<unknown>({ ...(startAfter === undefined ? {} : { startAfter }), limit: SCAN_LIMIT })
}

/** New admissions stop even before freeze; a durable source lock survives env removal.
 * Existing admitted operations drain normally and are counted by ModelAdmission. */
export async function assertModelStateBusinessOpen(storage: DurableStorage, env: MaintenanceEnv): Promise<void> {
  if (configured(env)) fail('model_state_migration_locked')
  const lock = checkedLock(await storage.get(MODEL_STATE_MIGRATION_KEY))
  if (lock && (lock.role !== 'target' || lock.phase !== 'finalized' || !lock.manifestSha256 || !lock.finalizedAt)) fail('model_state_migration_locked')
}
export async function assertModelStateCleanupOpen(storage: DurableStorage, env: MaintenanceEnv): Promise<void> {
  const lock = checkedLock(await storage.get(MODEL_STATE_MIGRATION_KEY))
  const cfg = configured(env) ? config(env) : null
  if (cfg?.role === 'target' || cfg && lock && (!same(lock, cfg) || lock.role !== 'source')) fail('model_state_migration_locked')
  if (lock && !(lock.role === 'source' && lock.phase === 'frozen') && !(lock.role === 'target' && lock.phase === 'finalized' && !cfg)) fail('model_state_migration_locked')
}

function validateEntry(entry: Entry) {
  // Canonicalization rejects undefined, non-finite numbers and non-JSON objects.
  try { canonical(entry.value) } catch { return fail('model_state_migration_value_invalid') }
  const value = record(entry.value)
  if (!value) return fail('model_state_migration_value_invalid')
  if (entry.key === 'gate') {
    if (!Array.isArray(value.fetches) || !Array.isArray(value.models) || !record(value.nextHost) || !finite(value.successes) || !finite(value.cooldownUntil)
      || value.modelLimit !== undefined && (!finite(value.modelLimit) || value.modelLimit < 1)) return fail('model_state_migration_gate_invalid')
    for (const permit of [...value.fetches, ...value.models]) {
      const p = record(permit)
      if (!p || typeof p.token !== 'string' || !finite(p.expiresAt)) return fail('model_state_migration_gate_invalid')
    }
    if (Object.values(value.nextHost as Record<string, unknown>).some(v => !finite(v))) return fail('model_state_migration_gate_invalid')
    return
  }
  if (!/^request:[a-f0-9]{64}$/.test(entry.key)) return fail('model_state_migration_unknown_key')
  if (!STATES.includes(value.state as typeof STATES[number]) || typeof value.attemptId !== 'string' || !value.attemptId || !HASH.test(String(value.requestSha256))) return fail('model_state_migration_reservation_invalid')
}
function hasInflight(gate: unknown, now: number) {
  if (gate === undefined) return false
  validateEntry({ key: 'gate', value: gate })
  const value = gate as { fetches: Array<{ expiresAt: number }>; models: Array<{ expiresAt: number }> }
  return [...value.fetches, ...value.models].some(p => p.expiresAt > now)
}
function addCounts(lock: Pick<Lock, 'states' | 'entryCount' | 'requestCount' | 'gatePresent'>, entries: Entry[]) {
  for (const entry of entries) {
    lock.entryCount++
    if (entry.key === 'gate') lock.gatePresent = true
    else { lock.requestCount++; lock.states[(entry.value as { state: typeof STATES[number] }).state]++ }
  }
}
async function readPage(storage: DurableStorage, cfg: Binding, index: number, startAfter: string | null) {
  const rows = await list(storage, startAfter ?? undefined), entries: Entry[] = []
  let complete = rows.size < SCAN_LIMIT
  for (const [key, value] of rows) {
    if (key === MODEL_STATE_MIGRATION_KEY) continue
    if (entries.length === PAGE_ENTRIES) { complete = false; break }
    const entry = { key, value }; validateEntry(entry)
    const candidate: Page = { format: 'studyinchina.model-state-page', version: 1, ...binding(cfg), index, entries: [...entries, entry] }
    if (size(canonical(candidate)) > PAGE_BYTES) {
      if (!entries.length) return fail('model_state_migration_entry_too_large')
      complete = false; break
    }
    entries.push(entry)
  }
  const page: Page = { format: 'studyinchina.model-state-page', version: 1, ...binding(cfg), index, entries }
  const pageBytes = canonical(page), sha256 = await digest(pageBytes)
  const ref: PageRef = { index, sha256, byteLength: size(pageBytes), entryCount: entries.length, firstKey: entries[0]?.key ?? null, lastKey: entries.at(-1)?.key ?? null, startAfter }
  return { page, pageBytes, ref, complete }
}
function manifestFrom(lock: Lock): ModelStateManifest {
  return { format: 'studyinchina.model-state-manifest', version: 1, ...binding(lock), frozenAt: lock.frozenAt,
    pages: lock.pages, entryCount: lock.entryCount, requestCount: lock.requestCount, gatePresent: lock.gatePresent, states: lock.states }
}
function status(lock: Lock | undefined, cfg: Config) {
  return { ok: true, ...binding(cfg), role: cfg.role, state: lock?.phase ?? 'not_started', pageCount: lock?.pages.length ?? 0,
    importedPages: lock?.importedPages ?? 0, entryCount: lock?.entryCount ?? null, requestCount: lock?.requestCount ?? null,
    states: lock?.states ?? null, manifestSha256: lock?.manifestSha256 ?? null, finalizedAt: lock?.finalizedAt ?? null }
}
async function parseManifest(raw: Record<string, unknown>, cfg: Config) {
  const manifest = record(raw.manifest)
  if (!manifest || !HASH.test(String(raw.manifestSha256)) || await digest(canonical(manifest)) !== raw.manifestSha256
    || manifest.format !== 'studyinchina.model-state-manifest' || manifest.version !== 1 || !same(manifest as unknown as Binding, cfg)
    || typeof manifest.frozenAt !== 'string' || !Number.isFinite(Date.parse(manifest.frozenAt)) || !Array.isArray(manifest.pages) || !manifest.pages.length || manifest.pages.length > MAX_PAGES
    || !integer(manifest.entryCount) || !integer(manifest.requestCount) || typeof manifest.gatePresent !== 'boolean') return fail('model_state_migration_manifest_invalid')
  const states = record(manifest.states)
  if (!states || Object.keys(states).length !== STATES.length || STATES.some(s => !integer(states[s])) || STATES.reduce((n, s) => n + Number(states[s]), 0) !== manifest.requestCount
    || manifest.entryCount !== manifest.requestCount + Number(manifest.gatePresent)) return fail('model_state_migration_manifest_invalid')
  let count = 0, previous: string | null = null
  for (let i = 0; i < manifest.pages.length; i++) {
    const p = record(manifest.pages[i])
    if (!p || p.index !== i || !HASH.test(String(p.sha256)) || !integer(p.byteLength) || p.byteLength > PAGE_BYTES || !integer(p.entryCount) || p.entryCount > PAGE_ENTRIES || p.startAfter !== previous
      || p.entryCount === 0 && (p.firstKey !== null || p.lastKey !== null || i !== manifest.pages.length - 1)
      || p.entryCount > 0 && (typeof p.firstKey !== 'string' || typeof p.lastKey !== 'string' || p.firstKey > p.lastKey || previous !== null && p.firstKey <= previous)) return fail('model_state_migration_manifest_invalid')
    count += p.entryCount; previous = p.lastKey as string | null
  }
  if (count !== manifest.entryCount) return fail('model_state_migration_manifest_invalid')
  return { manifest: manifest as unknown as ModelStateManifest, manifestSha256: raw.manifestSha256 as string }
}
async function parsePage(raw: Record<string, unknown>, manifest: ModelStateManifest) {
  if (typeof raw.pageBytes !== 'string' || size(raw.pageBytes) > PAGE_BYTES) return fail('model_state_migration_page_invalid')
  let page: Record<string, unknown> | null
  try { page = record(JSON.parse(raw.pageBytes)) } catch { return fail('model_state_migration_page_invalid') }
  if (!page || canonical(page) !== raw.pageBytes || page.format !== 'studyinchina.model-state-page' || page.version !== 1 || !same(page as unknown as Binding, manifest) || !integer(page.index)
    || !Array.isArray(page.entries) || page.entries.length > PAGE_ENTRIES) return fail('model_state_migration_page_invalid')
  const ref = manifest.pages[page.index]
  if (!ref || await digest(raw.pageBytes) !== ref.sha256 || size(raw.pageBytes) !== ref.byteLength || page.entries.length !== ref.entryCount) return fail('model_state_migration_page_hash_mismatch')
  let previous = ref.startAfter
  for (const value of page.entries) {
    const entry = record(value)
    if (!entry || Object.keys(entry).length !== 2 || typeof entry.key !== 'string' || previous !== null && entry.key <= previous) return fail('model_state_migration_page_invalid')
    validateEntry(entry as Entry); previous = entry.key
  }
  if ((page.entries[0] as Entry | undefined)?.key !== (ref.firstKey ?? undefined) || previous !== (ref.lastKey ?? ref.startAfter)) return fail('model_state_migration_page_invalid')
  return page as unknown as Page
}

export async function handleModelStateMigration(storage: DurableStorage, env: MaintenanceEnv, path: string, body: unknown, activeOperations: number, now = Date.now()): Promise<Response> {
  try {
    const cfg = config(env), raw = record(body)
    if (!raw) return fail('model_state_migration_request_invalid')
    if (path === '/model-state-migration/status') {
      const lock = checkedLock(await storage.get(MODEL_STATE_MIGRATION_KEY))
      if (lock) matchLock(lock, cfg)
      return json(status(lock, cfg))
    }
    requireId(raw, cfg)
    if (path === '/model-state-migration/freeze') {
      requireRole(cfg, 'source')
      const lock = await storage.transaction(async txn => {
        let lock = checkedLock(await txn.get(MODEL_STATE_MIGRATION_KEY))
        if (lock) matchLock(lock, cfg)
        else { lock = { version: 1, ...cfg, phase: 'frozen', frozenAt: new Date(now).toISOString(), pages: [], states: zero(), entryCount: 0, requestCount: 0, gatePresent: false }; await txn.put(MODEL_STATE_MIGRATION_KEY, lock) }
        return lock
      })
      // Commit the freeze even if validation of old state subsequently fails.
      const inflight = activeOperations > 0 || hasInflight(await storage.get('gate'), now)
      return json({ ...status(lock, cfg), frozen: true, ...(inflight ? { error: 'model_state_migration_inflight' } : {}) }, inflight ? 409 : 200)
    }
    if (path === '/model-state-migration/export') {
      requireRole(cfg, 'source')
      if (!integer(raw.pageIndex) || raw.pageIndex >= MAX_PAGES) return fail('model_state_migration_page_invalid')
      return await storage.transaction(async txn => {
        const lock = matchLock(checkedLock(await txn.get(MODEL_STATE_MIGRATION_KEY)), cfg)
        if (activeOperations > 0 || hasInflight(await txn.get('gate'), now)) return fail('model_state_migration_inflight')
        if (!['frozen', 'exporting', 'exported'].includes(lock.phase)) return fail('model_state_migration_phase_invalid')
        if (raw.pageIndex as number > lock.pages.length || lock.phase === 'exported' && raw.pageIndex === lock.pages.length) return fail('model_state_migration_page_out_of_order')
        const old = lock.pages[raw.pageIndex as number], startAfter = old ? old.startAfter : lock.pages.at(-1)?.lastKey ?? null
        const result = await readPage(txn, cfg, raw.pageIndex as number, startAfter)
        if (old) { if (canonical(old) !== canonical(result.ref)) return fail('model_state_migration_source_changed') }
        else {
          lock.pages.push(result.ref); addCounts(lock, result.page.entries); lock.phase = result.complete ? 'exported' : 'exporting'
          if (result.complete) { lock.manifest = manifestFrom(lock); lock.manifestSha256 = await digest(canonical(lock.manifest)) }
          await txn.put(MODEL_STATE_MIGRATION_KEY, lock)
        }
        return json({ ok: true, state: lock.phase, pageIndex: result.ref.index, pageBytes: result.pageBytes, pageSha256: result.ref.sha256,
          nextPageIndex: result.ref.index + 1 < lock.pages.length || lock.phase !== 'exported' ? result.ref.index + 1 : null,
          manifest: lock.manifest ?? null, manifestSha256: lock.manifestSha256 ?? null })
      })
    }
    if (path === '/model-state-migration/import') {
      requireRole(cfg, 'target')
      if (env.MAINTENANCE_ENABLED !== 'false') return fail('model_state_migration_target_must_be_disabled')
      const { manifest, manifestSha256 } = await parseManifest(raw, cfg), page = await parsePage(raw, manifest)
      return await storage.transaction(async txn => {
        let lock = checkedLock(await txn.get(MODEL_STATE_MIGRATION_KEY))
        if (!lock) {
          if ((await list(txn)).size) return fail('model_state_migration_target_not_empty')
          lock = { version: 1, ...cfg, phase: 'importing', frozenAt: manifest.frozenAt, pages: manifest.pages, states: zero(), entryCount: 0, requestCount: 0, gatePresent: false, manifest, manifestSha256, importedPages: 0 }
        } else {
          matchLock(lock, cfg)
          if (lock.manifestSha256 !== manifestSha256 || canonical(lock.manifest) !== canonical(manifest) || !['importing', 'finalized'].includes(lock.phase)) return fail('model_state_migration_manifest_conflict')
        }
        if (page.index > (lock.importedPages ?? 0)) return fail('model_state_migration_page_out_of_order')
        const repeated = page.index < (lock.importedPages ?? 0)
        for (const entry of page.entries) {
          const existing = await txn.get(entry.key)
          if (existing !== undefined && canonical(existing) !== canonical(entry.value) || repeated && existing === undefined) return fail('model_state_migration_entry_conflict')
          if (!repeated && existing === undefined) await txn.put(entry.key, entry.value)
        }
        if (!repeated) { addCounts(lock, page.entries); lock.importedPages = page.index + 1; await txn.put(MODEL_STATE_MIGRATION_KEY, lock) }
        return json({ ...status(lock, cfg), reused: repeated })
      })
    }
    if (path === '/model-state-migration/finalize') {
      requireRole(cfg, 'target')
      if (env.MAINTENANCE_ENABLED !== 'false') return fail('model_state_migration_target_must_be_disabled')
      return await storage.transaction(async txn => {
        const lock = matchLock(checkedLock(await txn.get(MODEL_STATE_MIGRATION_KEY)), cfg)
        if (!lock.manifest || lock.manifestSha256 !== raw.manifestSha256 || lock.importedPages !== lock.pages.length) return fail('model_state_migration_incomplete')
        const totals = { states: zero(), entryCount: 0, requestCount: 0, gatePresent: false }
        for (let i = 0; i < lock.pages.length; i++) {
          const page = await readPage(txn, cfg, i, lock.pages[i].startAfter)
          if (canonical(page.ref) !== canonical(lock.pages[i]) || page.complete !== (i === lock.pages.length - 1)) return fail('model_state_migration_target_changed')
          addCounts(totals, page.page.entries)
        }
        if (totals.entryCount !== lock.manifest.entryCount || totals.requestCount !== lock.manifest.requestCount || totals.gatePresent !== lock.manifest.gatePresent || canonical(totals.states) !== canonical(lock.manifest.states)) return fail('model_state_migration_target_changed')
        lock.phase = 'finalized'; lock.finalizedAt ??= new Date(now).toISOString(); await txn.put(MODEL_STATE_MIGRATION_KEY, lock)
        return json(status(lock, cfg))
      })
    }
    return json({ ok: false, error: 'not_found' }, 404)
  } catch (error) {
    return json({ ok: false, error: error instanceof ModelStateMigrationError ? error.code : 'model_state_migration_unavailable' }, 409)
  }
}
