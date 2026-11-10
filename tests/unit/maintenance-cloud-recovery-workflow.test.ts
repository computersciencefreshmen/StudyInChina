import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const yaml = require('js-yaml') as { load: (value: string) => unknown }

type Step = {
  name?: string
  id?: string
  uses?: string
  run?: string
  if?: string
  'continue-on-error'?: boolean
  with?: Record<string, unknown>
}
type Workflow = {
  on: { schedule: { cron: string }[]; workflow_dispatch: null }
  concurrency: { group: string; 'cancel-in-progress': boolean }
  jobs: { publish: { if: string; steps: Step[] } }
}

const workflow = yaml.load(readFileSync(resolve('.github/workflows/catalog-maintenance-publish.yml'), 'utf8')) as Workflow
const steps = workflow.jobs.publish.steps
const ready = "steps.recovery.outputs.ready == 'true'"
const normalized = (condition: string) => condition.trim().replace(/\s+/gu, ' ')
function step(id: string): Step {
  const found = steps.find(item => item.id === id)
  if (!found) throw new Error('Missing cloud publisher safety stage: ' + id)
  return found
}
const recovery = step('recovery')
const uploads = steps.filter(item => item.uses?.startsWith('actions/upload-artifact@'))
const business = steps.slice(steps.indexOf(recovery) + 1).filter(item => !uploads.includes(item))

describe('cloud publisher automatic head recovery workflow', () => {
  it('reuses the existing publisher cadence and canonical writer lock', () => {
    expect(Object.keys(workflow.on).sort()).toEqual(['schedule', 'workflow_dispatch'])
    expect(workflow.on.schedule).toEqual([{ cron: '7,22,37,52 * * * *' }])
    expect(Object.keys(workflow.jobs)).toEqual(['publish'])
    expect(workflow.concurrency).toEqual({
      group: 'autonomous-catalog-maintenance-${{ github.repository }}',
      'cancel-in-progress': false,
    })
  })

  it('requires the owner main cloud job for both existing trigger types', () => {
    expect(normalized(workflow.jobs.publish.if).split(' && ')).toEqual([
      "vars.CATALOG_MAINTENANCE_MODE == 'cloud'",
      "github.repository == 'computersciencefreshmen/StudyInChina'",
      "github.ref == 'refs/heads/main'",
      "github.actor == 'computersciencefreshmen'",
      "github.triggering_actor == 'computersciencefreshmen'",
      "(github.event_name == 'schedule' || github.event_name == 'workflow_dispatch')",
    ])
  })

  it('runs one automatic recovery before any runtime, checkout recovery or publication work', () => {
    const setup = steps.slice(0, steps.indexOf(recovery))
    expect(setup.filter(item => item.run).map(item => item.run)).toEqual(['npm ci --ignore-scripts'])
    expect(setup.find(item => item.uses?.startsWith('actions/checkout@'))?.with)
      .toMatchObject({ ref: 'main', 'fetch-depth': 0 })
    expect(setup.find(item => item.uses?.startsWith('actions/setup-node@'))?.with)
      .toMatchObject({ 'node-version': 24 })
    expect(steps.filter(item => item.run?.includes('reconcile-maintenance-head.ts'))).toEqual([recovery])
    expect(recovery.run).toContain('reconcile-maintenance-head.ts --auto')
    expect(recovery.run).toContain('--output "$RUNNER_TEMP/maintenance-head-recovery"')
    expect(recovery['continue-on-error']).not.toBe(true)
    expect(business).toContain(step('runtime'))
    expect(business).toContain(step('resume'))
    expect(business).toContain(step('receipt_commit'))
    expect(business).toContain(step('commit'))
  })

  it('requires an explicit true recovery output for every downstream business step', () => {
    expect(business.length).toBeGreaterThan(0)
    for (const item of business) {
      // A missing output and the string "false" must both leave the lane held.
      const condition = normalized(item.if ?? '')
      expect(condition, item.name ?? item.id).toMatch(/^steps\.recovery\.outputs\.ready == 'true'(?:$| && )/u)
      expect(item['continue-on-error'], item.name ?? item.id).not.toBe(true)
    }
    expect(step('runtime').if).toBe(ready)
    expect(step('resume').if).toContain("steps.runtime.outputs.can_recover == 'true'")
    expect(step('download').if).toContain("steps.runtime.outputs.can_start == 'true'")
    expect(step('download').if).toContain("steps.resume.outputs.pending_publication != 'true'")
    expect(step('candidate').if).toContain("steps.download.outputs.has_export == 'true'")
    expect(step('commit').if).toContain("steps.candidate.outputs.changed == 'true'")
  })

  it('keeps every acknowledgement and replay alternative inside the recovery guard', () => {
    const alternatives = business.filter(item => item.if?.includes('||'))
    expect(alternatives).toHaveLength(3)
    expect(alternatives.some(item => item.run?.startsWith('npm run maintenance:prepare -- ack'))).toBe(true)
    expect(alternatives.some(item => item.run?.includes('gh workflow run ci.yml --ref main'))).toBe(true)
    expect(alternatives.some(item => item.run?.includes('verify-maintenance-publication.ts'))).toBe(true)
    for (const item of business) {
      const condition = normalized(item.if ?? '')
      if (condition.includes('||')) {
        expect(condition, item.name).toMatch(/^steps\.recovery\.outputs\.ready == 'true' && \(.+\)$/u)
      }
      let depth = 0
      for (let index = 0; index < condition.length; index++) {
        if (condition[index] === '(') depth++
        if (condition[index] === ')') depth--
        expect(depth, item.name).toBeGreaterThanOrEqual(0)
        if (condition.slice(index, index + 2) === '||') {
          // An OR at depth zero could run an ack or promotion while ready=false.
          expect(depth, item.name).toBeGreaterThan(0)
        }
      }
      expect(depth, item.name).toBe(0)
    }
  })

  it('retains the recovery audit even when later business work is skipped or fails', () => {
    expect(uploads).toHaveLength(1)
    expect(uploads[0].if).toBe('always()')
    expect(steps.indexOf(uploads[0])).toBeGreaterThan(steps.indexOf(step('commit')))
    expect(String(uploads[0].with?.path).trim().split('\n'))
      .toContain('${{ runner.temp }}/maintenance-head-recovery')
    expect(uploads[0].with?.['if-no-files-found']).toBe('ignore')
    expect(uploads[0].with?.['retention-days']).toBeLessThanOrEqual(30)
  })
})
