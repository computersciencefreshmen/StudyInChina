import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const yaml = createRequire(import.meta.url)('js-yaml') as { load(value: string): unknown }
type Step = { name?: string; run?: string; if?: string; id?: string; uses?: string; 'continue-on-error'?: boolean }
type Job = { needs?: string | string[]; if: string; concurrency: { group: string; 'cancel-in-progress': boolean }; steps: Step[]; outputs?: Record<string, string> }
const workflow = yaml.load(readFileSync('.github/workflows/catalog-maintenance-tick.yml', 'utf8')) as { on: { schedule: unknown[]; workflow_dispatch: { inputs: Record<string, unknown> } }; concurrency?: unknown; jobs: Record<string, Job> }
const writer = { group: 'autonomous-catalog-maintenance-${{ github.repository }}', 'cancel-in-progress': false }
const script = (job: Job) => job.steps.map(step => step.run ?? '').join('\n')
const normalized = (value: string) => value.replace(/\s+/g, ' ')

describe('one existing schedule with independent ordinary dispatch and canonical writer jobs', () => {
  it('keeps exactly one cadence, no whole-workflow lock and the same explicit manual inputs', () => {
    expect(workflow.on.schedule).toEqual([{ cron: '11,26,41,56 * * * *' }])
    expect(Object.keys(workflow.on).sort()).toEqual(['schedule', 'workflow_dispatch'])
    expect(Object.keys(workflow.on.workflow_dispatch.inputs).sort()).toEqual(['configure_budget', 'recheck_backend', 'resume_budget'])
    expect(workflow.concurrency).toBeUndefined()
    expect(Object.keys(workflow.jobs).sort()).toEqual(['canonical', 'dispatch', 'operator'])
    expect(JSON.stringify(workflow)).not.toContain('queue:max')
    const config = JSON.parse(readFileSync('workers/catalog-maintenance/wrangler.jsonc', 'utf8'))
    expect(config.triggers?.crons).toBeUndefined()
  })

  it('the normal scheduled dispatch cannot depend on a waiting canonical writer job', () => {
    const { dispatch, operator, canonical } = workflow.jobs
    expect(dispatch.needs).toBe('operator')
    expect(dispatch.concurrency).toEqual({ group: 'catalog-maintenance-dispatch-${{ github.repository }}', 'cancel-in-progress': false })
    expect(operator.concurrency).toEqual(writer); expect(canonical.concurrency).toEqual(writer)
    expect(operator.if).toContain("github.event_name == 'workflow_dispatch'")
    expect(normalized(dispatch.if)).toContain("(needs.operator.result == 'success' || needs.operator.result == 'skipped')")
    expect(dispatch.if).toContain('!cancelled()')
    expect(dispatch.if).not.toContain('needs.canonical')
    expect(dispatch.outputs?.work_allowed).toBe('${{ steps.budget.outputs.work_allowed }}')
    expect(canonical.needs).toEqual(['operator', 'dispatch'])
    expect(canonical.if).toContain("needs.dispatch.result == 'success'")
    expect(canonical.if).toContain("needs.dispatch.outputs.work_allowed == 'true'")
    for (const name of ['catalog-maintenance-publish.yml', 'catalog-maintenance-reconcile.yml', 'autonomous-catalog.yml']) {
      const sibling = yaml.load(readFileSync('.github/workflows/' + name, 'utf8')) as { concurrency: unknown }
      expect(sibling.concurrency).toEqual(writer)
    }
  })

  it('configure/resume/budget/recheck retain their ordered fail-closed dependency before dispatch', () => {
    const steps = workflow.jobs.operator.steps
    const commands = ['configure-budget', 'resume-budget', 'check-budget', 'recheck-backend']
    let previous = -1
    for (const command of commands) {
      const index = steps.findIndex(step => step.run?.includes(`catalog-maintenance-client.ts ${command}`))
      expect(index).toBeGreaterThan(previous); previous = index
      expect(steps[index]['continue-on-error']).not.toBe(true)
    }
    expect(steps.find(step => step.run?.includes(' configure-budget'))?.if).toContain('inputs.configure_budget == true')
    expect(steps.find(step => step.run?.includes(' resume-budget'))?.if).toContain('inputs.resume_budget == true')
    expect(steps.find(step => step.run?.includes(' recheck-backend'))?.if).toContain('inputs.recheck_backend == true')
  })

  it('dispatch only checks the budget, observes quota and calls the explicit bounded mode', () => {
    const { dispatch, canonical } = workflow.jobs, body = script(dispatch), admin = script(canonical)
    expect(body).toContain('catalog-maintenance-client.ts check-budget')
    expect(body).toContain('catalog-maintenance-client.ts tick-dispatch')
    expect(body).toContain('catalog-maintenance-client.ts status')
    expect(body).not.toMatch(/refresh-cloud-targets|upgrade-maintenance-scope|maintenance:coverage|advance-rollout|tick-administrative|configure-budget|resume-budget|recheck-backend/)
    const quota = dispatch.steps.find(step => step.run?.includes('catalog-maintenance-client.ts quota'))!
    expect(quota['continue-on-error']).toBe(true); expect(quota.if).toBeUndefined()
    for (const required of ['refresh-cloud-targets.ts', 'upgrade-maintenance-scope.ts --auto', 'maintenance:coverage', 'tick-administrative', 'advance-rollout']) expect(admin).toContain(required)
    expect(admin).not.toContain('tick-dispatch')
    for (const step of canonical.steps.filter(step => /refresh-cloud-targets|upgrade-maintenance-scope|maintenance:coverage|tick-administrative/.test(step.run ?? ''))) expect(step.if).toBe("steps.budget.outputs.work_allowed == 'true'")
    expect(body).not.toMatch(/MINIMAX_.*(?:KEY|TOKEN)|CLOUDFLARE_API_TOKEN/)
  })
})
