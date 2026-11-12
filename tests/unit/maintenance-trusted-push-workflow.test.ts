import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const yaml = require('js-yaml') as { load: (value: string) => unknown }
type Step = { id?: string; name?: string; uses?: string; if?: string; env?: Record<string, string>; with?: Record<string, unknown>; run?: string }
type Publisher = { permissions: Record<string, string>; jobs: { publish: { env?: Record<string, string>; steps: Step[] } } }
const workflow = yaml.load(readFileSync(resolve('.github/workflows/catalog-maintenance-publish.yml'), 'utf8')) as Publisher
const steps = workflow.jobs.publish.steps
const publish = steps.find(step => step.id === 'commit')!
const script = publish.run!
const baseSha = 'a'.repeat(40), candidateSha = 'c'.repeat(40), changedBase = 'f'.repeat(40)

// Execute the actual workflow shell with functions replacing every git/gh call.
// No repository mutation, network access or real credential is involved.
function simulate(scenario: 'success' | 'ci-failed' | 'base-before' | 'base-after', token = 'test-only-dedicated-token') {
  const directory = mkdtempSync(join(tmpdir(), 'maintenance-push-test-')), output = join(directory, 'output')
  const bash = process.platform === 'win32' ? join(process.env.ProgramFiles ?? 'C:/Program Files', 'Git/bin/bash.exe') : 'bash'
  writeFileSync(output, '')
  try {
    const harness = `
      fetches=0
      committed=false
      git() {
        printf 'git:%s\\n' "$*" >&2
        case "$1" in
          rev-parse)
            if [[ "$2" == HEAD ]]; then
              if [[ "$committed" == true ]]; then echo '${candidateSha}'; else echo '${baseSha}'; fi
            elif [[ "$2" == origin/main ]]; then
              if [[ "$SCENARIO" == base-before || ( "$SCENARIO" == base-after && "$fetches" == 2 ) ]]; then echo '${changedBase}'; else echo '${baseSha}'; fi
            else return 91; fi ;;
          fetch) fetches=$((fetches + 1)) ;;
          diff) return 1 ;;
          commit) committed=true ;;
          switch|config|add|push) ;;
          *) return 92 ;;
        esac
      }
      gh() {
        printf 'gh:%s\\n' "$*" >&2
        [[ "$1" == api && "$2" == *'event=push&per_page=20' ]] || return 93
        [[ "$*" == *'.head_sha == "${candidateSha}"'* && "$*" == *'.head_branch == "codex/cloud-catalog-41-2"'* && "$*" == *'.event == "push"'* ]] || return 94
        if [[ "$SCENARIO" == ci-failed ]]; then echo failure; else echo success; fi
      }
      sleep() { return 95; }
    `
    const result = spawnSync(bash, ['--noprofile', '--norc'], { input: harness + script, encoding: 'utf8', timeout: 5000,
      env: { ...process.env, BASH_ENV: '', GH_TOKEN: token, SCENARIO: scenario, GITHUB_RUN_ID: '41', GITHUB_RUN_ATTEMPT: '2',
        GITHUB_REPOSITORY: 'computersciencefreshmen/StudyInChina', GITHUB_OUTPUT: output.replace(/\\/gu, '/') } })
    if (result.error) throw result.error
    return { status: result.status, stdout: result.stdout, trace: result.stderr, output: readFileSync(output, 'utf8') }
  } finally { if (existsSync(output)) unlinkSync(output); rmdirSync(directory) }
}

describe('cloud publication through trusted push CI', () => {
  it('runs the unchanged CI quality job for managed branch pushes as well as main and pull requests', () => {
    const ci = yaml.load(readFileSync(resolve('.github/workflows/ci.yml'), 'utf8')) as { on: { push: { branches: string[] }; pull_request: unknown; workflow_dispatch: unknown } }
    expect(ci.on.push.branches).toEqual(['main', 'codex/cloud-catalog-*'])
    expect(ci.on).toHaveProperty('pull_request'); expect(ci.on).toHaveProperty('workflow_dispatch')
    expect(readFileSync(resolve('.github/workflows/ci.yml'), 'utf8')).toContain('name: Lint, test, validate, and build')
  })

  it('uses the dedicated token for checkout and new publication, with GITHUB_TOKEN recovery preserved', () => {
    expect(steps.find(step => step.uses?.startsWith('actions/checkout@'))?.with?.token)
      .toBe('${{ secrets.CATALOG_PUBLISH_GITHUB_TOKEN || github.token }}')
    expect(publish.env?.GH_TOKEN).toBe('${{ secrets.CATALOG_PUBLISH_GITHUB_TOKEN }}')
    expect(workflow.jobs.publish.env).not.toHaveProperty('GH_TOKEN')
    const recovery = steps.find(step => step.name === 'Recover a missing main CI dispatch after an ambiguous push reply')!
    expect(recovery.env?.GH_TOKEN).toBe('${{ github.token }}')
    expect(recovery.run).toContain("if [[ \"$count\" == '0' ]]; then gh workflow run ci.yml --ref main; fi")
    for (const step of steps.filter(step => step.id !== 'commit')) {
      expect(step.if ?? '').not.toContain('CATALOG_PUBLISH_GITHUB_TOKEN')
      expect(step.run ?? '').not.toContain('${GH_TOKEN:-}')
    }
    expect(workflow.permissions).toEqual({ contents: 'write', actions: 'write' })
  })

  it('holds the immutable export before any git or CI action when the dedicated token is absent', () => {
    const result = simulate('success', '')
    expect(result.status).toBe(1); expect(result.trace).not.toMatch(/git:|gh:/u); expect(result.output).toBe('')
    expect(result.stdout).toContain('::error title=Cloud candidate publication held::')
    expect(result.stdout).toContain('CATALOG_PUBLISH_GITHUB_TOKEN')
    expect(result.stdout).toContain('Contents read/write and Actions read')
    expect(result.stdout).toContain('immutable export is retained')
    expect(publish.if).toContain("steps.candidate.outputs.changed == 'true'")
  })

  it('waits only for successful push CI on the exact candidate before pushing that same SHA to main', () => {
    const result = simulate('success')
    expect(result.status, result.stdout + result.trace).toBe(0)
    expect(result.trace).toContain('git:push origin HEAD:refs/heads/codex/cloud-catalog-41-2')
    expect(result.trace).toContain('event=push&per_page=20')
    expect(script).toContain('.status != \\"completed\\"')
    expect(result.trace).toContain(`git:push origin ${candidateSha}:refs/heads/main`)
    expect(result.trace.indexOf('gh:api')).toBeGreaterThan(result.trace.indexOf('HEAD:refs/heads/codex/cloud-catalog-41-2'))
    expect(result.trace.indexOf(`${candidateSha}:refs/heads/main`)).toBeGreaterThan(result.trace.indexOf('gh:api'))
    expect(result.output.trim()).toBe(`sha=${candidateSha}`)
    expect(script).not.toContain('gh workflow run'); expect(script).not.toContain('event=workflow_dispatch')
    expect(script).not.toMatch(/git push[^\n]*(?:--force|\s-f\s|\+refs)|\bgit (?:rebase|merge)\b/u)
  })

  it('rejects failed exact-head CI without updating main or emitting an application SHA', () => {
    const result = simulate('ci-failed')
    expect(result.status).toBe(1); expect(result.stdout).toContain('Exact candidate CI ended with failure')
    expect(result.trace).not.toContain(':refs/heads/main'); expect(result.output).toBe('')
  })

  it.each(['base-before', 'base-after'] as const)('holds a candidate when main advances %s', scenario => {
    const result = simulate(scenario)
    expect(result.status).toBe(1); expect(result.trace).not.toContain(':refs/heads/main'); expect(result.output).toBe('')
    expect(result.stdout).toContain(scenario === 'base-before' ? 'Main changed' : 'Main advanced')
    if (scenario === 'base-before') expect(result.trace).not.toContain('git:commit')
    else expect(result.trace).toContain('gh:api')
  })
})
