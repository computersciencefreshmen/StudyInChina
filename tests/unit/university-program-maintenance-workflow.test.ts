import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const yaml = require('js-yaml') as { load: (value: string) => unknown }
type Step = {
  name: string
  id?: string
  uses?: string
  run?: string
  if?: string
  'continue-on-error'?: boolean
  with?: Record<string, unknown>
  env?: Record<string, string>
}
type Workflow = {
  on: { schedule: { cron: string }[]; workflow_dispatch: null }
  permissions: Record<string, string>
  concurrency: { group: string; 'cancel-in-progress': boolean }
  jobs: { capture: { 'timeout-minutes': number; env: Record<string, string>; steps: Step[] } }
}
const source = readFileSync(resolve('.github/workflows/university-program-maintenance.yml'), 'utf8')
const workflow = yaml.load(source) as Workflow
const steps = workflow.jobs.capture.steps
function step(id: string): Step {
  const found = steps.find(item => item.id === id)
  if (!found) throw new Error('Missing maintenance safety stage: ' + id)
  return found
}

describe('source-only university maintenance workflow', () => {
  it('runs one finite hourly batch with a read-only token and no publication or paid calls', () => {
    expect(Object.keys(workflow.on).sort()).toEqual(['schedule', 'workflow_dispatch'])
    expect(workflow.on.schedule).toHaveLength(1)
    expect(workflow.on.schedule[0].cron).toMatch(/^\d{1,2} \* \* \* \*$/u)
    expect(workflow.permissions).toEqual({ contents: 'read' })
    expect(Object.keys(workflow.jobs)).toEqual(['capture'])
    expect(workflow.jobs.capture).not.toHaveProperty('permissions')
    expect(workflow.concurrency['cancel-in-progress']).toBe(false)
    expect(workflow.concurrency.group).not.toContain('github.ref')
    expect(workflow.jobs.capture['timeout-minutes']).toBeLessThanOrEqual(30)
    expect(steps.find(item => item.uses?.startsWith('actions/checkout@'))?.with)
      .toMatchObject({ 'persist-credentials': false })
    expect(steps.find(item => item.uses?.startsWith('actions/setup-node@'))?.with)
      .toMatchObject({ 'node-version': 24 })
    expect(step('plan').run).toMatch(/--limit 20(?:\s|$)/u)
    expect(steps.filter(item => item.run?.includes('capture-university-maintenance-sources.ts')))
      .toHaveLength(1)
    expect(step('capture').run).not.toMatch(/\b(?:while|until|workflow_dispatch|workflow run)\b/u)
    const commands = steps.map(item => item.run ?? '').join('\n')
    expect(commands).not.toMatch(/\b(?:git push|git commit|wrangler|vercel|curl|enqueue|promote|minimax|openai|anthropic)\b/iu)
    expect(JSON.stringify(workflow)).not.toMatch(/\$\{\{\s*(?:secrets|vars)\./u)
    const environmentNames = [workflow.jobs.capture.env, ...steps.map(item => item.env ?? {})]
      .flatMap(environment => Object.keys(environment))
    expect(environmentNames.some(name => /TOKEN|API_KEY|SECRET|PASSWORD|COOKIE|PRIVATE_KEY/u.test(name)))
      .toBe(false)
  })

  it('validates first and mirrors the original capture into SQLite before recording exact outcomes', () => {
    const position = (id: string) => steps.findIndex(item => item.id === id)
    expect(position('validation')).toBeLessThan(position('capture'))
    expect(step('validation').run).toContain('university-maintenance-plan.test.ts')
    expect(step('validation').run).toContain('university-maintenance-capture.test.ts')
    expect(step('validation').run).toContain('university-maintenance-db.test.ts')
    expect(position('checkpoint_cache')).toBeLessThan(position('plan'))
    expect(position('capture')).toBeLessThan(position('receipts'))
    expect(position('receipts')).toBeLessThan(position('ledger'))
    expect(position('ledger')).toBeLessThan(position('record'))
    expect(step('ledger').run).toContain('--plan .tmp/university-maintenance/plan.json')
    expect(step('ledger').run).toContain('--report "$CAPTURE_DIRECTORY/report.json"')
    expect(step('ledger').run).toContain('--database .tmp/university-maintenance/maintenance.sqlite')
    expect(step('empty_ledger').if).toContain("steps.batch.outputs.has_work == 'false'")
    expect(step('empty_ledger').run).toContain('--plan .tmp/university-maintenance/plan.json')
    expect(step('empty_ledger').run).not.toContain('--report')
    expect(step('record').if).toContain("steps.ledger.outcome == 'success'")
    expect(step('record').run).toContain('--record-attempts "$CAPTURE_DIRECTORY/results.json"')
    expect(step('record').run).toContain('--output .tmp/university-maintenance/next-plan.json')
    expect(step('record').run).not.toContain('--output .tmp/university-maintenance/plan.json')
    expect(step('canonical').if).toBe('always()')
    expect(step('canonical').run).toContain('git diff --exit-code -- content/data content/source-manifests')
  })

  it('restores a coherent branch generation and saves interrupted markers even when capture fails', () => {
    const restore = step('checkpoint_cache'), save = step('checkpoint_save')
    expect(restore.uses).toMatch(/^actions\/cache\/restore@/u)
    expect(save.uses).toMatch(/^actions\/cache\/save@/u)
    const paths = String(restore.with?.path).trim().split('\n')
    expect(paths).toEqual([
      '.tmp/university-maintenance/state.json',
      '.tmp/university-maintenance/state.json.lock',
      '.tmp/university-maintenance/maintenance.sqlite',
      '.tmp/university-maintenance/maintenance.sqlite-journal',
      '.official-harvest/university-maintenance',
    ])
    expect(save.with?.path).toBe(restore.with?.path)
    expect(restore.with?.key).toContain('github.ref')
    expect(restore.with?.key).toContain('github.run_id')
    expect(restore.with?.key).toContain('github.run_attempt')
    expect(String(restore.with?.['restore-keys']).trim().split('\n')).toHaveLength(1)
    expect(restore.with?.['restore-keys']).toContain('github.ref')
    expect(save.if).toContain('always()')
    expect(save.if).not.toContain("steps.capture.outcome == 'success'")
    expect(steps.map(item => item.run ?? '').join('\n')).not.toMatch(/(?:\brm\b|unlink).*(?:capture\.lock|\.started)/u)
    const enforcement = steps.find(item => item.name === 'Preserve a failure signal for incomplete maintenance execution')!
    expect(enforcement.if).toBe('always()')
    expect(enforcement.env).toMatchObject({
      CAPTURE_OUTCOME: expect.stringContaining('steps.capture.outcome'),
      LEDGER_OUTCOME: expect.stringContaining('steps.ledger.outcome'),
      RECORD_OUTCOME: expect.stringContaining('steps.record.outcome'),
      CACHE_OUTCOME: expect.stringContaining('steps.checkpoint_save.outcome'),
    })
    expect(enforcement.run).toContain("['failure', 'cancelled']")
  })

  it('uploads only inspection metadata and a closed database, never raw pages or the checkpoint tree', () => {
    const uploads = steps.filter(item => item.uses?.startsWith('actions/upload-artifact@'))
    expect(uploads).toHaveLength(1)
    expect(String(uploads[0].with?.path).trim().split('\n')).toEqual([
      '.tmp/university-maintenance/plan.json',
      '.tmp/university-maintenance/report.json',
      '.tmp/university-maintenance/results.json',
      '.tmp/university-maintenance/maintenance.sqlite',
    ])
    expect(uploads[0].with?.['include-hidden-files']).toBe(true)
    expect(uploads[0].with?.['retention-days']).toBeLessThanOrEqual(30)
    const summary = steps.find(item => item.name === 'Explain observed outcomes and remaining verification work')!
    expect(summary.run).toContain('Facts verified: 0. Publication performed: false.')
    expect(summary.run).toContain("'captured_pending_review', 'held', 'no_sources'")
    expect(summary.run).toContain('repository-accessible and evictable')
    expect(summary.run).toContain('prior fairness/checkpoint history unavailable')
    expect(summary.run).toContain('default-branch registration')
  })
})
