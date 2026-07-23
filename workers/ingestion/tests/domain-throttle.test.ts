import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { acquireDomainLease, releaseDomainLease } from '../src/repository'
import type { D1Database, D1PreparedStatement, D1Result } from '../src/types'

type SqlValue = string | number | bigint | null | Uint8Array

class SqliteD1Statement implements D1PreparedStatement {
  constructor(
    private readonly database: DatabaseSync,
    private readonly query: string,
    private readonly values: SqlValue[] = [],
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    return new SqliteD1Statement(this.database, this.query, values as SqlValue[])
  }

  async first<T>(): Promise<T | null> {
    return (this.database.prepare(this.query).get(...this.values) as T | undefined) ?? null
  }

  async all<T>(): Promise<D1Result<T>> {
    return { success: true, results: this.database.prepare(this.query).all(...this.values) as T[] }
  }

  async run<T>(): Promise<D1Result<T>> {
    const result = this.database.prepare(this.query).run(...this.values)
    return { success: true, meta: { changes: Number(result.changes) } }
  }
}

class SqliteD1 implements D1Database {
  constructor(readonly database: DatabaseSync) {}

  prepare(query: string): D1PreparedStatement {
    return new SqliteD1Statement(this.database, query)
  }

  async batch<T>(statements: D1PreparedStatement[]): Promise<Array<D1Result<T>>> {
    return Promise.all(statements.map((statement) => statement.run<T>()))
  }
}

function databaseWithLeaseSchema() {
  const database = new DatabaseSync(':memory:')
  database.exec('PRAGMA foreign_keys = ON')
  for (const migration of ['0004_worker_runtime.sql', '0005_domain_throttle.sql']) {
    database.exec(readFileSync(resolve('infra/d1/pipeline/migrations', migration), 'utf8'))
  }
  return database
}

test('domain lease enforces concurrency one and five-second spacing', async () => {
  const database = databaseWithLeaseSchema()
  try {
    const environment = { INGESTION_DB: new SqliteD1(database) }
    const start = new Date('2026-07-20T00:00:00.000Z')
    const first = await acquireDomainLease(environment, 'admissions.example.edu.cn', start)
    assert.ok(first)
    assert.equal(
      await acquireDomainLease(environment, 'admissions.example.edu.cn', start),
      null,
    )

    await releaseDomainLease(environment, first, start)
    assert.equal(
      await acquireDomainLease(
        environment,
        'admissions.example.edu.cn',
        new Date(start.getTime() + 4_999),
      ),
      null,
    )
    const next = await acquireDomainLease(
      environment,
      'admissions.example.edu.cn',
      new Date(start.getTime() + 5_000),
    )
    assert.ok(next)
  } finally {
    database.close()
  }
})

test('an expired domain lease can be recovered without an old token clearing it', async () => {
  const database = databaseWithLeaseSchema()
  try {
    const environment = { INGESTION_DB: new SqliteD1(database) }
    const start = new Date('2026-07-20T00:00:00.000Z')
    const expired = await acquireDomainLease(
      environment,
      'admissions.example.edu.cn',
      start,
      { leaseSeconds: 10 },
    )
    assert.ok(expired)
    const recoveredAt = new Date(start.getTime() + 10_001)
    const recovered = await acquireDomainLease(
      environment,
      'admissions.example.edu.cn',
      recoveredAt,
      { leaseSeconds: 10 },
    )
    assert.ok(recovered)
    await releaseDomainLease(environment, expired, new Date(start.getTime() + 10_002))
    const row = database.prepare(
      'SELECT lease_token FROM ingestion_domain_leases WHERE host = ?',
    ).get('admissions.example.edu.cn') as { lease_token: string }
    assert.equal(row.lease_token, recovered.token)
  } finally {
    database.close()
  }
})
