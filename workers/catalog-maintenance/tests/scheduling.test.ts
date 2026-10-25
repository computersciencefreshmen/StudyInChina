import assert from 'node:assert/strict'
import test from 'node:test'
import { selectScheduledJobs } from '../src/scheduling'

const start = Date.parse('2026-10-24T03:15:00.000Z'), tickMs = 15 * 60 * 1000
const maintenance = (id: string) => ({ id, stage: 'maintain', priority: 1, source_last_success_at: null as string | null })
const expansion = (id: string) => ({ id, stage: 'capture', priority: 1, source_last_success_at: null as string | null })
const work = () => Array.from({ length: 30 }, (_, index) => [maintenance(`m-${index}`), expansion(`e-${index}`)]).flat()

test('initial round gives exactly 24 maintenance and 56 expansion slots across any ten ticks', () => {
  for (let offset = 0; offset < 10; offset++) {
    let maintained = 0, expanded = 0
    for (let index = 0; index < 10; index++) {
      const selected = selectScheduledJobs(work(), { limit: 8, firstRoundComplete: false, now: start + (index + offset) * tickMs })
      const maintenanceCount = selected.filter(job => job.stage === 'maintain').length
      assert.equal(selected.length, 8); assert.ok(maintenanceCount >= 2 && maintenanceCount <= 3)
      maintained += maintenanceCount; expanded += selected.length - maintenanceCount
    }
    assert.equal(maintained, 24); assert.equal(expanded, 56)
  }
})

test('after the first round the exact ten-tick share reverses to 56 maintenance and 24 expansion', () => {
  let maintained = 0, expanded = 0
  for (let index = 0; index < 10; index++) {
    const selected = selectScheduledJobs(work(), { limit: 8, firstRoundComplete: true, now: start + index * tickMs })
    const maintenanceCount = selected.filter(job => job.stage === 'maintain').length
    assert.ok(maintenanceCount >= 5 && maintenanceCount <= 6)
    maintained += maintenanceCount; expanded += selected.length - maintenanceCount
  }
  assert.equal(maintained, 56); assert.equal(expanded, 24)
})

test('seven-day urgent priorities run first even when they exceed the normal maintenance share', () => {
  const urgent = Array.from({ length: 6 }, (_, index) => ({ ...maintenance(`urgent-${index}`), priority: 0 }))
  const selected = selectScheduledJobs([...work(), ...urgent], { limit: 8, firstRoundComplete: false, now: start })
  assert.deepEqual(selected.slice(0, 6), urgent)
  assert.equal(selected.slice(6).filter(job => job.stage === 'capture').length, 2)
  const saturated = [...urgent, { ...maintenance('urgent-6'), priority: -1 }, { ...maintenance('urgent-7'), priority: 0 }]
  assert.deepEqual(selectScheduledJobs([...saturated, ...work()], { limit: 8, firstRoundComplete: false, now: start }), saturated)
})

test('both lanes borrow unused capacity without leaving slots idle', () => {
  const m = Array.from({ length: 12 }, (_, index) => maintenance(`m-${index}`))
  const e = Array.from({ length: 12 }, (_, index) => expansion(`e-${index}`))
  for (const firstRoundComplete of [false, true]) {
    const options = { limit: 8, firstRoundComplete, now: start }
    assert.deepEqual(selectScheduledJobs(m, options), m.slice(0, 8))
    assert.deepEqual(selectScheduledJobs(e, options), e.slice(0, 8))
    assert.equal(selectScheduledJobs([m[0], ...e], options).length, 8)
    assert.equal(selectScheduledJobs([e[0], ...m], options).length, 8)
  }
})

test('successful-source captures share maintenance capacity while extract and award remain expansion', () => {
  const existingCapture = { ...expansion('existing-capture'), source_last_success_at: '2026-10-23T00:00:00.000Z' }
  const jobs = [existingCapture, maintenance('m-0'), maintenance('m-1'),
    { ...expansion('extract-0'), stage: 'extract', source_last_success_at: existingCapture.source_last_success_at },
    { ...expansion('award-0'), stage: 'award' }, ...work()]
  const selected = selectScheduledJobs(jobs, { limit: 8, firstRoundComplete: false, now: start })
  assert.ok(selected.includes(existingCapture))
  assert.ok(selected.some(job => job.id === 'extract-0'))
  assert.ok(selected.some(job => job.id === 'award-0'))
  assert.ok(selected.filter(job => job.stage === 'maintain' || job === existingCapture).length <= 3)
})

test('selection preserves the original priority/due order within both lanes and changes no jobs', () => {
  const jobs = work().map((job, index) => ({ ...job, priority: Math.floor(index / 8) + 1, due_at: `due-${index}` }))
  const before = JSON.stringify(jobs), options = { limit: 8, firstRoundComplete: false, now: start }
  const selected = selectScheduledJobs(jobs, options)
  assert.deepEqual(selected.map(job => jobs.indexOf(job)), selected.map(job => jobs.indexOf(job)).sort((a, b) => a - b))
  for (const stage of ['maintain', 'capture']) {
    const chosen = selected.filter(job => job.stage === stage)
    assert.deepEqual(chosen, jobs.filter(job => job.stage === stage).slice(0, chosen.length))
  }
  assert.deepEqual(selectScheduledJobs(jobs, options), selected)
  assert.equal(JSON.stringify(jobs), before)
})
