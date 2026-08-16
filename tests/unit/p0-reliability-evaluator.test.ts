import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  P0_AUDIT_FORMAT,
  P0_OBSERVATION_FORMAT,
  P0_RELIABILITY_THRESHOLDS,
  evaluateP0Reliability,
  parseArguments,
} from '../../scripts/operations/evaluate-p0-reliability.mjs'

const NOW = '2026-08-10T12:00:00.000Z'

function healthyObservation() {
  return {
    format: P0_OBSERVATION_FORMAT,
    formatVersion: 1,
    observedAt: '2026-08-10T11:55:00.000Z',
    backup: {
      lastVerifiedAt: '2026-08-09T12:30:00.000Z',
      source: 'github-actions:cloudflare-backup/readback',
    },
    release: {
      lastActivatedAt: '2026-08-09T00:30:00.000Z',
      source: 'catalog-d1:catalog-releases/active',
    },
    scheduler: {
      lastHeartbeatAt: '2026-08-10T11:00:00.000Z',
      source: 'pipeline-d1:ingestion-jobs/scheduled',
    },
    dlq: {
      backlogCount: 0,
      oldestMessageAt: null as string | null,
      source: 'cloudflare-queues:realtime/dlq',
    },
    outbox: {
      backlogCount: 2,
      oldestPendingAt: '2026-08-04T13:00:00.000Z',
      source: 'pipeline-d1:outbox-events/pending',
    },
  }
}

function check(report: ReturnType<typeof evaluateP0Reliability>, id: string) {
  const result = report.checks.find((item) => item.id === id)
  if (!result) throw new Error(`Missing check: ${id}`)
  return result
}

describe('P0 reliability evaluator', () => {
  it('passes only an explicit, fresh and fully sourced observation document', () => {
    const report = evaluateP0Reliability(healthyObservation(), NOW)

    expect(report.format).toBe(P0_AUDIT_FORMAT)
    expect(report.status).toBe('pass')
    expect(report.summary).toEqual({ pass: 7, fail: 0, unobserved: 0 })
    expect(report.thresholds).toEqual({
      observationMaxAgeMinutes: 15,
      backupMaxAgeHours: 26,
      releaseMaxAgeHours: 48,
      schedulerMaxAgeMinutes: 90,
      dlqMaxBacklogCount: 0,
      outboxMaxAgeHours: 168,
    })
  })

  it('fails closed when observations are absent without echoing unrelated input', () => {
    const report = evaluateP0Reliability({
      format: P0_OBSERVATION_FORMAT,
      formatVersion: 1,
      observedAt: '2026-08-10T11:55:00.000Z',
      secret: 'must-never-appear-in-the-report',
    }, NOW)

    expect(report.status).toBe('fail')
    expect(report.summary.unobserved).toBe(5)
    expect(check(report, 'backup_age').status).toBe('unobserved')
    expect(check(report, 'dlq_backlog').status).toBe('unobserved')
    expect(JSON.stringify(report)).not.toContain('must-never-appear-in-the-report')
  })

  it('accepts inclusive age boundaries and enforces a strict outbox boundary', () => {
    const observation = healthyObservation()
    observation.backup.lastVerifiedAt = '2026-08-09T10:00:00.000Z'
    observation.release.lastActivatedAt = '2026-08-08T12:00:00.000Z'
    observation.scheduler.lastHeartbeatAt = '2026-08-10T10:30:00.000Z'
    observation.outbox.oldestPendingAt = '2026-08-03T12:00:01.000Z'

    const inside = evaluateP0Reliability(observation, NOW)
    expect(inside.status).toBe('pass')
    expect(check(inside, 'backup_age').value).toBe(26)
    expect(check(inside, 'release_age').value).toBe(48)
    expect(check(inside, 'scheduler_heartbeat_age').value).toBe(90)

    observation.outbox.oldestPendingAt = '2026-08-03T12:00:00.000Z'
    const boundary = evaluateP0Reliability(observation, NOW)
    expect(boundary.status).toBe('fail')
    expect(check(boundary, 'outbox_backlog_age')).toMatchObject({
      status: 'fail',
      value: { backlogCount: 2, oldestAgeHours: 168 },
    })
  })

  it.each([
    ['backup_age', (value: ReturnType<typeof healthyObservation>) => {
      value.backup.lastVerifiedAt = '2026-08-09T09:59:59.000Z'
    }],
    ['release_age', (value: ReturnType<typeof healthyObservation>) => {
      value.release.lastActivatedAt = '2026-08-08T11:59:59.000Z'
    }],
    ['scheduler_heartbeat_age', (value: ReturnType<typeof healthyObservation>) => {
      value.scheduler.lastHeartbeatAt = '2026-08-10T10:29:59.000Z'
    }],
    ['dlq_backlog', (value: ReturnType<typeof healthyObservation>) => {
      value.dlq.backlogCount = 1
      value.dlq.oldestMessageAt = '2026-08-10T11:50:00.000Z'
    }],
  ])('reports %s as failed beyond its exact threshold', (id, mutate) => {
    const observation = healthyObservation()
    mutate(observation)
    const report = evaluateP0Reliability(observation, NOW)
    expect(report.status).toBe('fail')
    expect(check(report, id).status).toBe('fail')
  })

  it('treats stale documents, future timestamps and inconsistent empty backlogs as untrusted', () => {
    const stale = healthyObservation()
    stale.observedAt = '2026-08-10T11:44:59.000Z'
    expect(check(evaluateP0Reliability(stale, NOW), 'observation_freshness').status).toBe('fail')

    const future = healthyObservation()
    future.scheduler.lastHeartbeatAt = '2026-08-10T12:00:01.000Z'
    expect(check(evaluateP0Reliability(future, NOW), 'scheduler_heartbeat_age').status)
      .toBe('unobserved')

    const inconsistent = healthyObservation()
    inconsistent.outbox.backlogCount = 0
    expect(check(evaluateP0Reliability(inconsistent, NOW), 'outbox_backlog_age').status)
      .toBe('unobserved')
  })

  it('parses only the bounded local-file CLI contract', () => {
    expect(parseArguments(['--input', 'observations.json'])).toEqual({
      inputPath: 'observations.json',
      outputPath: null,
    })
    expect(() => parseArguments([])).toThrow('--input is required')
    expect(() => parseArguments(['--input', 'same.json', '--output', 'same.json']))
      .toThrow('--output must not overwrite')
    expect(() => parseArguments(['--url', 'https://example.com'])).toThrow('Unknown argument')
  })

  it('emits machine-readable CLI output and exits non-zero for invalid input', () => {
    const directory = mkdtempSync(join(tmpdir(), 'studyinchina-p0-reliability-'))
    const script = resolve('scripts/operations/evaluate-p0-reliability.mjs')
    const validPath = join(directory, 'valid.json')
    writeFileSync(validPath, JSON.stringify({
      ...healthyObservation(),
      observedAt: new Date().toISOString(),
      backup: { ...healthyObservation().backup, lastVerifiedAt: new Date().toISOString() },
      release: { ...healthyObservation().release, lastActivatedAt: new Date().toISOString() },
      scheduler: { ...healthyObservation().scheduler, lastHeartbeatAt: new Date().toISOString() },
      outbox: { ...healthyObservation().outbox, backlogCount: 0, oldestPendingAt: null },
    }))

    const valid = spawnSync(process.execPath, [script, '--input', validPath], {
      encoding: 'utf8',
    })
    expect(valid.status).toBe(0)
    expect(JSON.parse(valid.stdout)).toMatchObject({ format: P0_AUDIT_FORMAT, status: 'pass' })

    const invalidPath = join(directory, 'invalid.json')
    writeFileSync(invalidPath, '{invalid-json')
    const invalid = spawnSync(process.execPath, [script, '--input', invalidPath], {
      encoding: 'utf8',
    })
    expect(invalid.status).toBe(1)
    expect(JSON.parse(invalid.stdout)).toMatchObject({ format: P0_AUDIT_FORMAT, status: 'fail' })
  })

  it('contains no network or environment-secret access path', () => {
    const source = readFileSync(
      resolve('scripts/operations/evaluate-p0-reliability.mjs'),
      'utf8',
    )
    expect(source).not.toMatch(/\bfetch\s*\(|node:https|node:http|https?:\/\//u)
    expect(source).not.toContain('process.env')
    expect(P0_RELIABILITY_THRESHOLDS.dlqMaxBacklogCount).toBe(0)
  })
})
