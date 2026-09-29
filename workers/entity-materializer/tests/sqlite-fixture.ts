import { DatabaseSync } from 'node:sqlite'
import type { D1Database, D1PreparedStatement, D1Result } from '../../publisher/src/types'

type Value = string | number | bigint | Uint8Array | null
class Statement implements D1PreparedStatement {
  private values: Value[] = []
  constructor(private readonly database: DatabaseSync, private readonly sql: string) {}
  bind(...values: unknown[]): D1PreparedStatement { this.values = values as Value[]; return this }
  async first<T>(): Promise<T | null> { return (this.database.prepare(this.sql).get(...this.values) as T) ?? null }
  async all<T>(): Promise<D1Result<T>> { return { success: true, results: this.database.prepare(this.sql).all(...this.values) as T[] } }
  async run<T>(): Promise<D1Result<T>> { return this.runSync() as D1Result<T> }
  runSync(): D1Result { return { success: true, meta: { changes: Number(this.database.prepare(this.sql).run(...this.values).changes) } } }
}
export class SqliteD1 implements D1Database {
  constructor(readonly sqlite: DatabaseSync) {}
  prepare(sql: string): D1PreparedStatement { return new Statement(this.sqlite, sql) }
  async batch<T>(statements: D1PreparedStatement[]): Promise<Array<D1Result<T>>> {
    this.sqlite.exec('BEGIN IMMEDIATE')
    try {
      const results = statements.map((statement) => (statement as Statement).runSync() as D1Result<T>)
      this.sqlite.exec('COMMIT')
      return results
    } catch (error) { this.sqlite.exec('ROLLBACK'); throw error }
  }
}
