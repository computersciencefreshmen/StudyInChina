import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizePlanQuota, quotaAdmission, type PlanQuota } from '../src/admission'

// Synthetic protocol cases, grounded in MiniMax-AI/cli types/api.ts and
// output/quota-table.ts; these are not observations of a particular account.
const now = Date.parse('2026-11-12T04:00:00Z'), hour = 3600000
function row(overrides: Record<string, unknown> = {}) {
  return { model_name: 'general', current_interval_remaining_percent: 100, current_weekly_remaining_percent: 80,
    current_interval_status: 1, current_weekly_status: 1, current_interval_total_count: 0, current_weekly_total_count: 0,
    start_time: now - hour, end_time: now + 4 * hour, weekly_start_time: now - 24 * hour, weekly_end_time: now + 6 * 24 * hour, ...overrides }
}
const normalize = (overrides: Record<string, unknown> = {}) => normalizePlanQuota({ base_resp: { status_code: 0 }, model_remains: [row(overrides)] }, now)
const unlimited = (overrides: Record<string, unknown> = {}) => normalize({ current_weekly_status: 3,
  current_weekly_remaining_percent: undefined, weekly_start_time: undefined, weekly_end_time: undefined, ...overrides })

for (const statuses of [true, false]) test(`limited weekly quotas preserve their previous serialized shape (statuses ${statuses ? 'present' : 'absent'})`, () => {
  const input = row(statuses ? {} : { current_interval_status: undefined, current_weekly_status: undefined })
  const quota = normalizePlanQuota({ base_resp: { status_code: 0 }, model_remains: [input] }, now)
  const expected = { checkedAt: new Date(now).toISOString(), fiveHourRemaining: 100, weeklyRemaining: 80,
    fiveHourStart: new Date(now - hour).toISOString(), fiveHourReset: new Date(now + 4 * hour).toISOString(),
    weeklyStart: new Date(now - 24 * hour).toISOString(), weeklyReset: new Date(now + 6 * 24 * hour).toISOString() }
  assert.equal(JSON.stringify(quota), JSON.stringify(expected)); assert.equal(quotaAdmission(quota, 'expansion', false, false, now).allow, true)
})

test('explicit weekly status 3 supports a real five-hour bucket without fabricating a percentage or week window', () => {
  const quota = unlimited()
  assert.deepEqual(quota, { checkedAt: new Date(now).toISOString(), fiveHourRemaining: 100, weeklyRemaining: null,
    fiveHourStart: new Date(now - hour).toISOString(), fiveHourReset: new Date(now + 4 * hour).toISOString(),
    weeklyStart: null, weeklyReset: null, weeklyUnlimited: true })
  assert.equal(quotaAdmission(quota, 'expansion', false, false, now).allow, true)
  // Token-count fields are not required to be positive: the explicit finite
  // percentage/status/window are the evidence, not zero placeholder counts.
  assert.equal(unlimited({ current_interval_total_count: 0 })?.weeklyUnlimited, true)
  assert.equal(unlimited({ current_interval_total_count: 1000 })?.weeklyUnlimited, true)
})

test('status 3 identifies the absent weekly limit independently of unused legacy week scalars', () => {
  const quota = unlimited({ current_weekly_remaining_percent: -1, weekly_start_time: 0, weekly_end_time: 0 })
  assert.equal(quota?.weeklyUnlimited, true); assert.equal(quota?.weeklyRemaining, null); assert.equal(quota?.weeklyReset, null)
})

for (const value of [undefined, null, -1, 0, 4, '3', false]) test(`weekly status ${String(value)} cannot turn missing week data into unlimited quota`, () => {
  assert.equal(unlimited({ current_weekly_status: value }), null)
})
for (const value of [undefined, null, -1, 101, NaN, '100']) test(`an invalid five-hour percentage ${String(value)} blocks the weekly-unlimited exception`, () => {
  assert.equal(unlimited({ current_interval_remaining_percent: value }), null)
})
for (const change of [{ start_time: now + hour, end_time: now + 6 * hour }, { start_time: now - 6 * hour, end_time: now - hour },
  { start_time: 0 }, { end_time: undefined }, { end_time: now + 2 * hour }]) test(`weekly unlimited still rejects an invalid five-hour window ${JSON.stringify(change)}`, () => {
  assert.equal(unlimited(change), null)
})

for (const change of [{ current_interval_status: 3 }, { current_interval_status: 3, current_interval_total_count: 0, current_weekly_total_count: 0 },
  { current_interval_status: 3, current_interval_total_count: 1000 }, { current_interval_status: 0 }, { current_interval_status: '1' }]) {
  test(`an unsupported/nonexistent five-hour bucket cannot admit through weekly unlimited ${JSON.stringify(change)}`, () => { assert.equal(unlimited(change), null) })
}

test('exhausted status 2 is accepted only with zero remaining and does not bypass quota stops', () => {
  assert.equal(normalize({ current_interval_status: 2, current_interval_remaining_percent: 50 }), null)
  assert.equal(normalize({ current_weekly_status: 2, current_weekly_remaining_percent: 50 }), null)
  const five = unlimited({ current_interval_status: 2, current_interval_remaining_percent: 0 })
  assert.ok(five); assert.equal(quotaAdmission(five, 'maintenance', false, false, now).allow, false)
  const week = normalize({ current_weekly_status: 2, current_weekly_remaining_percent: 0 })
  assert.ok(week); assert.equal(quotaAdmission(week, 'expansion', false, false, now).retryAfter, 6 * 24 * 3600)
})

test('weekly unlimited retains the five-percent overflow margin and retries at the real five-hour reset', () => {
  for (const remaining of [0, 5]) {
    const decision = quotaAdmission(unlimited({ current_interval_remaining_percent: remaining }), 'expansion', false, false, now)
    assert.equal(decision.allow, false); assert.equal(decision.code, 'quota_exhausted_or_overflow_margin'); assert.equal(decision.retryAfter, 4 * 3600)
  }
  assert.equal(quotaAdmission(unlimited({ current_interval_remaining_percent: 5.1 }), 'expansion', false, false, now).allow, true)
  assert.equal(quotaAdmission(unlimited({ current_interval_remaining_percent: 0 }), 'expansion', false, true, now).allow, false)
})

test('weekly unlimited retains the real urgent-maintenance reserve without restricting the maintenance lane', () => {
  const quota = unlimited({ current_interval_remaining_percent: 15 })
  assert.deepEqual(quotaAdmission(quota, 'expansion', true, false, now), { allow: false, code: 'maintenance_quota_reserved', retryAfter: 4 * 3600, low: true })
  assert.equal(quotaAdmission(quota, 'maintenance', true, false, now).allow, true)
  assert.equal(quotaAdmission(unlimited({ current_interval_remaining_percent: 20 }), 'expansion', true, false, now).allow, false)
  assert.equal(quotaAdmission(unlimited({ current_interval_remaining_percent: 20.1 }), 'expansion', true, false, now).allow, true)
})

test('stale observations and forged unlimited normalized data remain unknown', () => {
  const quota = unlimited(); assert.ok(quota)
  for (const changed of [{ checkedAt: new Date(now - 31000).toISOString() }, { checkedAt: new Date(now + 1000).toISOString() }, { checkedAt: 'invalid' },
    { fiveHourStart: new Date(now - 6 * hour).toISOString(), fiveHourReset: new Date(now - hour).toISOString() }, { weeklyRemaining: 100 }, { fiveHourRemaining: NaN }]) {
    const decision = quotaAdmission({ ...quota, ...changed } as PlanQuota, 'expansion', false, false, now)
    assert.deepEqual(decision, { allow: false, code: 'quota_unknown', retryAfter: 300, low: true })
  }
})

test('a finite weekly bucket still requires its own real current seven-day window', () => {
  for (const changed of [{ current_weekly_remaining_percent: -1 }, { weekly_start_time: undefined }, { weekly_end_time: now },
    { weekly_start_time: now - 24 * hour, weekly_end_time: now + 24 * hour }]) assert.equal(normalize(changed), null)
  assert.equal(quotaAdmission(normalize({ current_weekly_remaining_percent: 5 }), 'expansion', false, false, now).retryAfter, 6 * 24 * 3600)
})
