import assert from 'node:assert/strict'
import test from 'node:test'
import {
  infrastructureCostPolicy,
  permitsBrowserForSource,
  permitsScheduledReason,
  scheduledJobReason,
} from '../src/cost-policy'
import { scheduleDueSources } from '../src/index'
import type { IngestionEnv, IngestionJob } from '../src/types'
import { sourceManifest } from './fixtures'

test('infrastructure forecast has deterministic threshold boundaries', () => {
  assert.equal(infrastructureCostPolicy('59.99').mode, 'normal')
  assert.equal(infrastructureCostPolicy('60').mode, 'warning')
  assert.equal(infrastructureCostPolicy('79.99').mode, 'warning')
  assert.equal(infrastructureCostPolicy('80').mode, 'constrained')
  assert.equal(infrastructureCostPolicy('94.99').mode, 'constrained')
  assert.equal(infrastructureCostPolicy('95').mode, 'freeze_discovery')
})

test('constrained policy reserves browser rendering for admissions facts and freeze blocks discovery only', () => {
  const constrained = infrastructureCostPolicy('80')
  assert.equal(constrained.allowBrowserFallback, true)
  assert.equal(constrained.allowDiscovery, true)
  assert.equal(permitsBrowserForSource(constrained, 'dates_deadlines'), true)
  assert.equal(permitsBrowserForSource(constrained, 'university_scholarship'), true)
  assert.equal(permitsBrowserForSource(constrained, 'contacts'), false)
  assert.equal(permitsBrowserForSource(constrained, 'catalog_anchor'), false)

  const frozen = infrastructureCostPolicy('95')
  assert.equal(permitsScheduledReason(frozen, 'discovery'), false)
  assert.equal(permitsScheduledReason(frozen, 'scheduled'), true)
  assert.equal(permitsBrowserForSource(frozen, 'current_guide'), true)
})

test('only catalog anchors become discovery jobs', () => {
  assert.equal(scheduledJobReason('catalog_anchor'), 'discovery')
  assert.equal(scheduledJobReason('dates_deadlines'), 'scheduled')
  assert.equal(scheduledJobReason('international_admissions_home'), 'scheduled')
  assert.equal(scheduledJobReason('university_scholarship'), 'scheduled')
  assert.equal(scheduledJobReason('faculty_scholarship'), 'scheduled')
  assert.equal(scheduledJobReason('government_scholarship'), 'scheduled')
})

test('a malformed configured forecast fails closed for optional work', () => {
  const policy = infrastructureCostPolicy('not-a-number')
  assert.equal(policy.mode, 'freeze_discovery')
  assert.equal(policy.allowDiscovery, false)
  assert.equal(policy.allowBrowserFallback, false)
  assert.equal(policy.browserScope, 'none')
})

test('scheduler keeps registered critical checks while discovery is frozen', async () => {
  const manifests = new Map([
    ['catalog-seed', sourceManifest({ id: 'catalog-seed', sourceCategory: 'catalog_anchor' })],
    ['deadline-source', sourceManifest({ id: 'deadline-source', sourceCategory: 'dates_deadlines' })],
  ])
  const sent: IngestionJob[] = []
  const queryBindings: unknown[][] = []
  const database = {
    prepare(query: string) {
      let bindings: unknown[] = []
      return {
        bind(...values: unknown[]) {
          bindings = values
          queryBindings.push(values)
          return this
        },
        async all() {
          assert.match(query, /json_extract\(manifest_json/)
          return {
            success: true,
            // Return both to verify the scheduler's own policy in addition to
            // the production SQL pre-filter.
            results: [...manifests.keys()].map((source_id) => ({ source_id })),
          }
        },
        async first() {
          const manifest = manifests.get(String(bindings[0]))
          if (!manifest) return null
          return {
            source_id: manifest.id,
            manifest_json: JSON.stringify(manifest),
            etag: null,
            last_modified: null,
            raw_sha256: null,
            canonical_sha256: null,
            next_fetch_at: null,
            consecutive_failures: 0,
          }
        },
        async run() {
          return { success: true, meta: { changes: 1 } }
        },
      }
    },
    async batch() {
      return []
    },
  }
  const environment = {
    INGESTION_DB: database,
    INFRA_FORECAST_CNY: '95',
    INGESTION_QUEUE: {
      async send(job: IngestionJob) {
        sent.push(job)
      },
    },
  } as unknown as IngestionEnv

  await scheduleDueSources(
    { cron: '17 * * * *', scheduledTime: Date.UTC(2026, 6, 20) },
    environment,
  )

  assert.equal(queryBindings[0]?.[2], 0)
  assert.deepEqual(sent.map(({ sourceId, reason }) => ({ sourceId, reason })), [
    { sourceId: 'deadline-source', reason: 'scheduled' },
  ])
})
