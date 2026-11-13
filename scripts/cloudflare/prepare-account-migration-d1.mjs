import { createHash } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, statSync, writeFileSync, writeSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { constants, DatabaseSync } from 'node:sqlite'
import { unstable_splitSqlQuery } from 'wrangler'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const MAX_SQL_BYTES = 90000
export const MAX_VALUE_BYTES = 2000000
export const sha256 = value => createHash('sha256').update(value).digest('hex')
export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
}
const identifier = value => `"${value.replaceAll('"', '""')}"`

/** Preserve quoted strings/identifiers while discarding only SQL comments and
 * insignificant whitespace. This never rewrites evidence stored in table rows. */
export function normalizedSql(sql) {
  const tokens = sql.match(/'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[(?:\]\]|[^\]])*\]|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/|\s+|[^\s'"`[\]/-]+|./gu) ?? []
  return tokens.filter(token => !/^\s|^--|^\/\*/u.test(token)).join('').replace(/;$/u, '')
}

export function trustedSchema(kind) {
  if (!['catalog', 'pipeline'].includes(kind)) throw new Error('migration_kind_invalid')
  const directory = join(ROOT, 'infra/d1', kind, 'migrations')
  const names = readdirSync(directory).filter(name => /^\d{4}_.+\.sql$/u.test(name)).sort()
  if (names.length < (kind === 'pipeline' ? 23 : 12) || names.some((name, index) => Number(name.slice(0, 4)) !== index + 1)) throw new Error('trusted_migrations_incomplete')
  const database = new DatabaseSync(':memory:')
  try {
    const migrations = names.map(name => {
      const sql = readFileSync(join(directory, name), 'utf8')
      database.exec(sql)
      return { name, sql, sha256: sha256(sql), bytes: Buffer.byteLength(sql) }
    })
    const tables = database.prepare("SELECT name FROM pragma_table_list WHERE schema='main' AND type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name<>'d1_migrations' ORDER BY name").all().map(row => row.name)
    const objects = database.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type,name").all()
      .filter(row => !/^search_fts_/u.test(row.name))
    const columns = Object.fromEntries(tables.map(table => [table, database.prepare(`PRAGMA table_xinfo(${identifier(table)})`).all().map(({ cid, name, type, notnull, dflt_value, pk, hidden }) => ({ cid, name, type, notnull, dflt_value, pk, hidden }))]))
    const triggers = objects.filter(row => row.type === 'trigger')
    const schemaSha256 = sha256(canonical({ objects: objects.map(row => ({ ...row, sql: normalizedSql(row.sql) })), columns }))
    return { database, migrations, tables, objects, columns, triggers, schemaSha256 }
  } catch (error) { database.close(); throw error }
}

export function validateTrustedSchema(database, kind) {
  const trusted = trustedSchema(kind)
  try {
    const actualTables = database.prepare("SELECT name FROM pragma_table_list WHERE schema='main' AND type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name<>'d1_migrations' ORDER BY name").all().map(row => row.name)
    const missing = trusted.tables.filter(name => !actualTables.includes(name))
    if (missing.length) throw new Error(`${kind} restore is missing core table(s): ${missing.join(', ')}`)
    const unexpected = actualTables.filter(name => !trusted.tables.includes(name))
    if (unexpected.length) throw new Error(`${kind} restore contains unexpected ordinary table(s): ${unexpected.join(', ')}`)
    for (const table of trusted.tables) {
      const actual = database.prepare(`PRAGMA table_xinfo(${identifier(table)})`).all().map(({ cid, name, type, notnull, dflt_value, pk, hidden }) => ({ cid, name, type, notnull, dflt_value, pk, hidden }))
      if (canonical(actual) !== canonical(trusted.columns[table])) throw new Error(`${kind} schema columns differ: ${table}`)
    }
    for (const object of trusted.objects) {
      const actual = database.prepare('SELECT type,sql FROM sqlite_schema WHERE name=?').get(object.name)
      if (!actual || actual.type !== object.type || normalizedSql(actual.sql ?? '') !== normalizedSql(object.sql)) throw new Error(`${kind} trusted schema object differs: ${object.type} ${object.name}`)
    }
    const expectedObjects = new Set(trusted.objects.map(object => `${object.type}:${object.name}`))
    const extraObjects = database.prepare("SELECT type,name FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name<>'d1_migrations' ORDER BY type,name").all()
      .filter(object => !/^search_fts_/u.test(object.name) && !expectedObjects.has(`${object.type}:${object.name}`))
    if (extraObjects.length) throw new Error(`${kind} contains untrusted schema object: ${extraObjects[0].type} ${extraObjects[0].name}`)
    return { tables: trusted.tables, migrations: trusted.migrations.map(({ name, sha256, bytes }) => ({ name, sha256, bytes })), schemaSha256: trusted.schemaSha256,
      triggerCount: trusted.triggers.length }
  } finally { trusted.database.close() }
}

export function scopeRegistry(scopeSha256) {
  const directory = join(ROOT, 'content/maintenance')
  const matches = readdirSync(directory).filter(name => /^scope-(?:272|295)\.v\d+\.json$/u.test(name)).map(name => JSON.parse(readFileSync(join(directory, name), 'utf8'))).filter(scope => scope.sha256 === scopeSha256)
  if (matches.length !== 1) throw new Error('Pipeline maintenance scope registry is unavailable or ambiguous')
  const { sha256: expected, ...content } = matches[0]
  const ids = content.schools?.map(school => school.universityId)
  if (sha256(canonical(content)) !== expected || content.format !== 'studyinchina.maintenance-scope'
    || ![272, 295].includes(content.expectedSchoolCount) || !Array.isArray(ids) || ids.length !== content.expectedSchoolCount
    || ids.some(id => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) throw new Error('Pipeline maintenance scope registry is invalid')
  return { sha256: expected, expectedSchoolCount: content.expectedSchoolCount, universityIds: ids }
}

function typed(value) {
  if (value === null) return ['null']
  if (typeof value === 'bigint') return ['integer', value.toString()]
  if (typeof value === 'number') return ['real', String(value)]
  if (typeof value === 'string') return ['text', value]
  if (value instanceof Uint8Array) return ['blob', Buffer.from(value).toString('hex')]
  throw new Error('migration_value_type_invalid')
}
function rowStatement(database, table) {
  const columns = database.prepare(`PRAGMA table_xinfo(${identifier(table)})`).all().filter(column => column.hidden === 0).map(column => column.name)
  const ordered = columns.flatMap(column => [`typeof(${identifier(column)})`, `${identifier(column)} COLLATE BINARY`]).join(',')
  const statement = database.prepare(`SELECT ${columns.map(identifier).join(',')} FROM ${identifier(table)} ORDER BY ${ordered}`)
  statement.setReadBigInts(true)
  return { columns, statement }
}
/** Parent tables precede children even if the destination commits every SQL
 * statement independently. Self references are handled using the actual rows. */
function tableImportOrder(database, tables) {
  const available = new Set(tables), dependencies = new Map(tables.map(table => [table, new Set()]))
  const selfReferenceTables = []
  for (const table of tables) {
    for (const foreign of database.prepare(`PRAGMA foreign_key_list(${identifier(table)})`).all()) {
      if (foreign.table === table) { if (!selfReferenceTables.includes(table)) selfReferenceTables.push(table) }
      else if (available.has(foreign.table)) dependencies.get(table).add(foreign.table)
      else throw new Error(`migration_foreign_parent_unavailable:${table}`)
    }
  }
  const ordered = []
  while (ordered.length < tables.length) {
    const next = tables.filter(table => !ordered.includes(table) && [...dependencies.get(table)].every(parent => ordered.includes(parent))).sort()
    if (!next.length) throw new Error('migration_cross_table_foreign_key_cycle_requires_atomic_plan')
    ordered.push(...next)
  }
  return { tables: ordered, selfReferenceTables }
}
function orderedRows(database, table) {
  const selected = rowStatement(database, table), groups = new Map()
  for (const foreign of database.prepare(`PRAGMA foreign_key_list(${identifier(table)})`).all().filter(foreign => foreign.table === table)) {
    if (!groups.has(foreign.id)) groups.set(foreign.id, [])
    groups.get(foreign.id).push(foreign)
  }
  const references = [...groups.values()].map(group => group.sort((a, b) => a.seq - b.seq))
  if (!references.length || !references.some(group => database.prepare(`SELECT 1 FROM ${identifier(table)} WHERE ${group.map(foreign => `${identifier(foreign.from)} IS NOT NULL`).join(' AND ')} LIMIT 1`).get())) return { ...selected, rows: selected.statement.iterate() }
  const columns = database.prepare(`PRAGMA table_xinfo(${identifier(table)})`).all(), primary = columns.filter(column => column.pk).sort((a, b) => a.pk - b.pk).map(column => column.name)
  if (!primary.length) throw new Error(`migration_self_reference_primary_key_required:${table}`)
  const rows = [...selected.statement.iterate()], key = row => canonical(primary.map(column => typed(row[column])))
  const byKey = new Map(rows.map((row, index) => [key(row), index])), parents = rows.map(() => new Set()), children = rows.map(() => [])
  const lookups = references.map(group => {
    const sql = database.prepare(`SELECT ${primary.map(identifier).join(',')} FROM ${identifier(table)} WHERE ${group.map((foreign, index) => `${identifier(foreign.to ?? primary[index])}=?`).join(' AND ')}`)
    sql.setReadBigInts(true); return sql
  })
  rows.forEach((row, index) => references.forEach((group, groupIndex) => {
    const values = group.map(foreign => row[foreign.from])
    if (values.some(value => value === null)) return
    const parent = lookups[groupIndex].get(...values), parentIndex = parent ? byKey.get(key(parent)) : undefined
    if (parentIndex === undefined) throw new Error(`migration_self_reference_parent_missing:${table}`)
    if (parentIndex !== index) parents[index].add(parentIndex)
  }))
  parents.forEach((values, index) => values.forEach(parent => children[parent].push(index)))
  const ready = [], output = []
  const push = value => { let index = ready.length; ready.push(value); while (index && ready[(index - 1) >> 1] > value) { ready[index] = ready[(index - 1) >> 1]; index = (index - 1) >> 1 }; ready[index] = value }
  const pop = () => {
    const result = ready[0], last = ready.pop()
    if (ready.length) { let index = 0; while (index * 2 + 1 < ready.length) { let child = index * 2 + 1; if (child + 1 < ready.length && ready[child + 1] < ready[child]) child++; if (ready[child] >= last) break; ready[index] = ready[child]; index = child }; ready[index] = last }
    return result
  }
  parents.forEach((values, index) => { if (!values.size) push(index) })
  while (ready.length) { const index = pop(); output.push(rows[index]); for (const child of children[index]) { parents[child].delete(index); if (!parents[child].size) push(child) } }
  if (output.length !== rows.length) throw new Error(`migration_self_reference_cycle_requires_atomic_plan:${table}`)
  return { ...selected, rows: output }
}
function resetSql(database, order, sourceTables, triggers) {
  const statements = ['-- ISOLATED NEW TARGET ONLY. Hold if an external writer or unexpected target row is possible.',
    ...triggers.map(trigger => `DROP TRIGGER IF EXISTS ${identifier(trigger.name)};`), 'PRAGMA defer_foreign_keys=TRUE;']
  for (const table of [...order.tables].reverse().filter(table => sourceTables.has(table))) {
    if (!order.selfReferenceTables.includes(table)) { statements.push(`DELETE FROM ${identifier(table)};`); continue }
    const primary = database.prepare(`PRAGMA table_xinfo(${identifier(table)})`).all().filter(column => column.pk).sort((a, b) => a.pk - b.pk).map(column => column.name)
    for (const row of [...orderedRows(database, table).rows].reverse()) statements.push(`DELETE FROM ${identifier(table)} WHERE ${primary.map(column => `${identifier(column)}=${sqlLiteral(row[column])}`).join(' AND ')};`)
  }
  return statements.join('\n') + '\n'
}
export function tableLogicalSummaries(database, tables) {
  return tables.map(table => {
    const { columns, statement } = rowStatement(database, table), hash = createHash('sha256')
    hash.update(canonical(columns) + '\n')
    let rows = 0
    for (const row of statement.iterate()) { hash.update(canonical(columns.map(column => typed(row[column]))) + '\n'); rows++ }
    return { table, columns, rows, logicalSha256: hash.digest('hex') }
  })
}
function baselineSummaries(database, tables) {
  return tableLogicalSummaries(database, tables).map(summary => {
    const columns = database.prepare(`PRAGMA table_xinfo(${identifier(summary.table)})`).all()
    const volatile = columns.filter(column => /CURRENT_TIMESTAMP|CURRENT_DATE|CURRENT_TIME/iu.test(column.dflt_value ?? '')).map(column => column.name)
    const stable = columns.filter(column => column.hidden === 0 && !volatile.includes(column.name)).map(column => column.name)
    const hash = createHash('sha256').update(canonical(stable) + '\n')
    const order = stable.flatMap(column => [`typeof(${identifier(column)})`, `${identifier(column)} COLLATE BINARY`]).join(',')
    const statement = database.prepare(`SELECT ${stable.map(identifier).join(',')} FROM ${identifier(summary.table)} ORDER BY ${order}`)
    statement.setReadBigInts(true)
    for (const row of statement.iterate()) hash.update(canonical(stable.map(column => typed(row[column]))) + '\n')
    return { ...summary, baselineComparisonColumns: stable, ignoredMigrationClockColumns: volatile, baselineComparisonSha256: hash.digest('hex') }
  })
}
function sqlLiteral(value) {
  if (value === null) return 'NULL'
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return value > 0 ? '9e999' : '-9e999'
    const text = String(value)
    return /[.e]/iu.test(text) ? text : `${text}.0`
  }
  if (value instanceof Uint8Array) return `X'${Buffer.from(value).toString('hex')}'`
  if (typeof value === 'string') return value.includes('\0') ? `CAST(X'${Buffer.from(value, 'utf8').toString('hex')}' AS TEXT)` : `'${value.replaceAll("'", "''")}'`
  throw new Error('migration_value_type_invalid')
}

/** Parse real SQL boundaries first. Authorize only literal INSERT operations
 * into trusted ordinary tables; never execute dump-supplied DDL or functions. */
function importDataOnly(database, sql, tables) {
  const allowed = new Set(tables)
  database.setAuthorizer((action, table, column, schema) => {
    if (action === constants.SQLITE_INSERT && allowed.has(table) && schema === 'main') return constants.SQLITE_OK
    if (action === constants.SQLITE_READ && allowed.has(table) && schema === 'main') return constants.SQLITE_OK
    // D1's official export encodes embedded line breaks as
    // replace('<literal>','<literal>',char(10)). These pure string functions
    // cannot read files, change schema, or invoke an external extension.
    if (action === constants.SQLITE_FUNCTION && ['replace', 'char'].includes(column?.toLowerCase())) return constants.SQLITE_OK
    return constants.SQLITE_DENY
  })
  try {
    let ordinal = 0
    for (const statement of unstable_splitSqlQuery(sql)) {
      const normalized = statement.replace(/^\s*(?:(?:--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)\s*)*/u, '').trim()
      if (!normalized || /^PRAGMA\s+defer_foreign_keys\s*=\s*(?:TRUE|ON|1)\s*;?$/iu.test(normalized)) continue
      const match = /^INSERT\s+INTO\s+(?:"([a-z_][a-z0-9_]*)"|`([a-z_][a-z0-9_]*)`|\[([a-z_][a-z0-9_]*)\]|([a-z_][a-z0-9_]*))\s*(?:\([^]*?\)\s*)?VALUES\s*\(/iu.exec(normalized)
      const table = match?.slice(1).find(Boolean)
      if (!table || !allowed.has(table)) throw new Error('migration_dump_statement_rejected')
      ordinal++
      try { database.exec(normalized) } catch { throw new Error(`migration_dump_insert_rejected:${table}:${ordinal}:${sha256(normalized)}`) }
    }
  } finally { database.setAuthorizer(null) }
}

export async function prepareAccountMigrationD1({ kind, dataOnlyPath, outputDirectory, sourceMetadataPath }) {
  const output = resolve(outputDirectory)
  if (existsSync(output) && readdirSync(output).length) throw new Error('migration_output_directory_must_be_empty')
  const trusted = trustedSchema(kind), database = trusted.database
  let validationDatabase
  try {
  const source = readFileSync(resolve(dataOnlyPath))
  const input = new TextDecoder('utf-8', { fatal: true }).decode(source)
  const sourceMetadataBytes = sourceMetadataPath ? readFileSync(resolve(sourceMetadataPath)) : null
  const sourceMetadata = sourceMetadataBytes ? JSON.parse(sourceMetadataBytes.toString('utf8')) : null
  if (sourceMetadata && (sourceMetadata.format !== 'studyinchina.account-migration-d1-export' || sourceMetadata.version !== 1
    || sourceMetadata.kind !== kind || sourceMetadata.sha256 !== sha256(source) || sourceMetadata.bytes !== source.byteLength
    || sourceMetadata.cutoverReady === true && sourceMetadata.sourceWritersFrozen !== true
    || !Array.isArray(sourceMetadata.tables) || new Set(sourceMetadata.tables).size !== sourceMetadata.tables.length
    || sourceMetadata.tables.some(table => !trusted.tables.includes(table)))) throw new Error('migration_source_metadata_invalid')
  const sourceTables = new Set(sourceMetadata?.tables ?? trusted.tables)
  const initializedTables = trusted.tables.filter(table => !sourceTables.has(table))
  if (initializedTables.length && (kind !== 'catalog' || canonical(initializedTables) !== canonical(['admin_release_rollbacks', 'release_pointer_revision']))) throw new Error('migration_source_schema_version_unsupported')
  const baseline = baselineSummaries(database, trusted.tables)
  const localBefore = trusted.triggers.map(trigger => `DROP TRIGGER ${identifier(trigger.name)};`).join('\n') + '\nPRAGMA defer_foreign_keys=TRUE;\n'
    + trusted.tables.filter(table => sourceTables.has(table) && baseline.find(row => row.table === table).rows).map(table => `DELETE FROM ${identifier(table)};`).join('\n') + '\n'
  const after = trusted.triggers.map(trigger => trigger.sql + ';').join('\n')
    + (kind === 'catalog' ? "\nINSERT INTO search_fts(search_fts) VALUES('rebuild');\n" : '\n')
    database.exec('BEGIN IMMEDIATE; PRAGMA defer_foreign_keys=TRUE;')
    database.exec(localBefore)
    importDataOnly(database, input, [...sourceTables])
    database.exec('COMMIT;')
    database.exec(after)
    const { verifyRestoredDatabase } = await import('./verify-restored-d1.mjs')
    const verification = verifyRestoredDatabase(database, kind, `${kind}.sqlite`)
    const tables = tableLogicalSummaries(database, trusted.tables)
    const importOrder = tableImportOrder(database, trusted.tables), before = resetSql(database, importOrder, sourceTables, trusted.triggers)
    validationDatabase = trustedSchema(kind).database
    validationDatabase.exec(before)
    validationDatabase.exec('PRAGMA defer_foreign_keys=FALSE;')
    mkdirSync(output, { recursive: true })
    const files = []
    function write(name, value) { writeFileSync(join(output, name), value, { mode: 0o600 }); files.push(name) }
    write('01-schema.sql', trusted.migrations.map(migration => `-- Trusted migration ${migration.name}; sha256 ${migration.sha256}\n${migration.sql}`).join('\n'))
    write('02-before-data.sql', before)
    write('04-after-data.sql', after)
    // D1 permits quick_check, but rejects the full integrity_check pragma.
    // The local export readback verifier still runs full integrity_check.
    write('05-check.sql', 'PRAGMA foreign_key_check;\nPRAGMA quick_check;\n' + trusted.tables.map(table => `SELECT '${table}' AS table_name,COUNT(*) AS rows FROM ${identifier(table)};`).join('\n') + '\n')
    const sqlPath = join(output, '03-data.sql'), boundPath = join(output, '03-data-bindings.jsonl'), planPath = join(output, '03-data-plan.jsonl')
    const descriptors = [sqlPath, boundPath, planPath].map(path => openSync(path, 'wx', 0o600))
    let ordinal = 0, sqlStatements = 0, boundRows = 0
    try {
      writeSync(descriptors[0], 'PRAGMA defer_foreign_keys=TRUE;\n')
      for (const table of importOrder.tables.filter(table => sourceTables.has(table))) {
        const { columns, rows } = orderedRows(database, table)
        for (const row of rows) {
          const values = columns.map(column => row[column]), params = values.map(typed), rowSha256 = sha256(canonical(params))
          for (const value of values) {
            if ((typeof value === 'string' || value instanceof Uint8Array) && Buffer.byteLength(value) > MAX_VALUE_BYTES) throw new Error(`migration_value_exceeds_limit:${table}:${rowSha256}`)
            if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`migration_nonfinite_real:${table}:${rowSha256}`)
          }
          const prefix = `INSERT INTO ${identifier(table)}(${columns.map(identifier).join(',')}) VALUES`
          const sql = `${prefix}(${values.map(sqlLiteral).join(',')});\n`, bytes = Buffer.byteLength(sql)
          ordinal++
          if (bytes <= MAX_SQL_BYTES) {
            validationDatabase.exec(sql)
            sqlStatements++; writeSync(descriptors[0], sql)
            writeSync(descriptors[2], canonical({ ordinal, table, rowSha256, lane: 'sql', sqlStatement: sqlStatements }) + '\n')
          } else {
            boundRows++
            const placeholders = params.map(([type]) => type === 'integer' ? 'CAST(? AS INTEGER)' : type === 'real' ? 'CAST(? AS REAL)' : type === 'text' ? 'CAST(? AS TEXT)' : '?')
            const boundSql = `${prefix}(${placeholders.join(',')})`
            validationDatabase.prepare(boundSql).run(...params.map(([type, value]) => type === 'null' ? null : type === 'blob' ? Buffer.from(value, 'hex') : value))
            writeSync(descriptors[1], canonical({ ordinal, table, rowSha256, sql: boundSql, params }) + '\n')
            writeSync(descriptors[2], canonical({ ordinal, table, rowSha256, lane: 'bound', boundLine: boundRows }) + '\n')
          }
        }
      }
    } finally { descriptors.forEach(closeSync) }
    validationDatabase.exec(after)
    const independent = verifyRestoredDatabase(validationDatabase, kind, `${kind}.autocommit.sqlite`)
    if (canonical(independent.logicalTables) !== canonical(tables)) throw new Error('migration_independent_transaction_roundtrip_mismatch')
    // The reset must also work against a fully loaded isolated target, not
    // only against migration seed rows. This covers partial-import retries.
    validationDatabase.exec('PRAGMA defer_foreign_keys=FALSE;')
    validationDatabase.exec(before)
    for (const table of sourceTables) if (validationDatabase.prepare(`SELECT COUNT(*) count FROM ${identifier(table)}`).get().count !== 0) throw new Error(`migration_isolated_reset_incomplete:${table}`)
    if (validationDatabase.prepare('PRAGMA foreign_key_check').all().length) throw new Error('migration_isolated_reset_foreign_key_failure')
    files.push('03-data.sql', '03-data-bindings.jsonl', '03-data-plan.jsonl')
    const fileDigests = files.sort().map(name => ({ name, bytes: statSync(join(output, name)).size, sha256: sha256(readFileSync(join(output, name))) }))
    const content = { format: 'studyinchina.account-migration-d1', version: 1, kind,
      input: { bytes: source.byteLength, sha256: sha256(source) }, schemaSha256: trusted.schemaSha256,
      sourceSchema: { tables: [...sourceTables].sort(), metadataSha256: sourceMetadataBytes ? sha256(sourceMetadataBytes) : null,
        initializedTables, sourceRows: tables.filter(table => sourceTables.has(table.table)).reduce((sum, table) => sum + table.rows, 0),
        initializedRows: tables.filter(table => !sourceTables.has(table.table)).reduce((sum, table) => sum + table.rows, 0),
        sourceWritersFrozen: sourceMetadata?.sourceWritersFrozen === true, cutoverReady: sourceMetadata?.cutoverReady === true },
      migrations: trusted.migrations.map(({ name, bytes, sha256 }) => ({ name, bytes, sha256 })), files: fileDigests,
      targetBaseline: baseline, tables, rows: tables.reduce((sum, table) => sum + table.rows, 0), importRows: ordinal, sqlStatements, boundRows, requiresBoundData: boundRows > 0,
      execution: { newTargetOnly: true, order: ['01-schema.sql', '02-before-data.sql', '03-data-plan.jsonl', '04-after-data.sql', '05-check.sql'],
        dataPlan: 'Interleave SQL statements and typed bound rows by ordinal. Parent tables and self-reference parents precede children; every INSERT was validated with immediate foreign keys in independent transactions.',
        importOrder, independentTransactionsValidated: true, independentResetValidated: true, foreignKeysPreserved: true,
        isolatedTargetOperatorCheckRequired: true, rejectIfUnexpectedTargetRowsOrWriters: true,
        targetBaselineComparison: 'Compare schema, row counts and baselineComparisonSha256 over baselineComparisonColumns; generated migration clock columns are ignored only before source import.',
        boundParams: 'null -> null; integer/real -> numeric text (SQL CAST restores SQLite type); text -> exact string; blob -> bytes decoded from hex.',
        maxSqlBytes: MAX_SQL_BYTES, maxValueBytes: MAX_VALUE_BYTES, dataOnlyShaRequired: true, allLanesRequired: true,
        remoteExecutionPerformed: false, evidenceObjectsVerified: false, durableObjectReservationsVerified: false }, verification }
    const manifest = { ...content, sha256: sha256(canonical(content)) }
    writeFileSync(join(output, 'manifest.json'), canonical(manifest) + '\n', { mode: 0o600 })
    return manifest
  } finally { validationDatabase?.close(); database.close() }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), value = name => args[args.indexOf(name) + 1]
  if (![6, 8].includes(args.length) || args.indexOf('--kind') < 0 || args.indexOf('--data-only') < 0 || args.indexOf('--output') < 0 || args.length === 8 && args.indexOf('--source-metadata') < 0) throw new Error('Usage: node prepare-account-migration-d1.mjs --kind catalog|pipeline --data-only <official-data.sql> --output <private-empty-directory> [--source-metadata <export.json>]')
  // Finish evaluating this module before the verifier imports its shared
  // schema helpers; top-level await here would create an ESM import cycle.
  prepareAccountMigrationD1({ kind: value('--kind'), dataOnlyPath: value('--data-only'), outputDirectory: value('--output'), sourceMetadataPath: args.includes('--source-metadata') ? value('--source-metadata') : undefined })
    .then(manifest => process.stdout.write(JSON.stringify({ format: manifest.format, kind: manifest.kind, tables: manifest.tables.length, rows: manifest.rows,
      requiresBoundData: manifest.requiresBoundData, sha256: manifest.sha256, manifestPath: join(resolve(value('--output')), 'manifest.json') })))
    .catch(error => { process.stderr.write((error instanceof Error ? error.message : 'migration_prepare_failed') + '\n'); process.exitCode = 1 })
}
