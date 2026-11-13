import type { DatabaseSync } from 'node:sqlite'
type Column = { cid: number; name: string; type: string; notnull: number; dflt_value: string | null; pk: number; hidden: number }
type Migration = { name: string; sql: string; sha256: string; bytes: number }
type SchemaObject = { type: string; name: string; tbl_name: string; sql: string }
export type TableLogicalSummary = { table: string; columns: string[]; rows: number; logicalSha256: string }
export type MigrationManifest = {
  format: string; version: number; kind: string; sha256: string; schemaSha256: string;
  input: { bytes: number; sha256: string }; files: Array<{ name: string; bytes: number; sha256: string }>;
  sourceSchema: { tables: string[]; metadataSha256: string | null; initializedTables: string[]; sourceRows: number; initializedRows: number; sourceWritersFrozen: boolean; cutoverReady: boolean };
  migrations: Array<Omit<Migration, 'sql'>>; tables: TableLogicalSummary[];
  targetBaseline: Array<TableLogicalSummary & { baselineComparisonColumns: string[]; ignoredMigrationClockColumns: string[]; baselineComparisonSha256: string }>;
  rows: number; importRows: number; sqlStatements: number; boundRows: number; requiresBoundData: boolean;
  execution: { newTargetOnly: boolean; order: string[]; dataPlan: string; targetBaselineComparison: string; boundParams: string; maxSqlBytes: number; maxValueBytes: number;
    importOrder: { tables: string[]; selfReferenceTables: string[] }; independentTransactionsValidated: boolean;
    independentResetValidated: boolean; foreignKeysPreserved: boolean; isolatedTargetOperatorCheckRequired: boolean; rejectIfUnexpectedTargetRowsOrWriters: boolean;
    dataOnlyShaRequired: boolean; allLanesRequired: boolean; remoteExecutionPerformed: boolean;
    evidenceObjectsVerified: boolean; durableObjectReservationsVerified: boolean };
  verification: Record<string, unknown>;
}
export const MAX_SQL_BYTES: number
export const MAX_VALUE_BYTES: number
export function sha256(value: string | Uint8Array): string
export function canonical(value: unknown): string
export function normalizedSql(sql: string): string
export function trustedSchema(kind: string): { database: DatabaseSync; migrations: Migration[]; tables: string[];
  objects: SchemaObject[]; columns: Record<string, Column[]>; triggers: SchemaObject[]; schemaSha256: string }
export function validateTrustedSchema(database: DatabaseSync, kind: string): { tables: string[];
  migrations: Array<Omit<Migration, 'sql'>>; schemaSha256: string; triggerCount: number }
export function scopeRegistry(scopeSha256: string): { sha256: string; expectedSchoolCount: number; universityIds: string[] }
export function tableLogicalSummaries(database: DatabaseSync, tables: string[]): TableLogicalSummary[]
export function prepareAccountMigrationD1(options: { kind: string; dataOnlyPath: string; outputDirectory: string; sourceMetadataPath?: string }): Promise<MigrationManifest>
