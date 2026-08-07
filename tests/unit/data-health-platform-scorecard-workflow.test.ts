import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const workflow = readFileSync('.github/workflows/data-health.yml', 'utf8')

describe('data-health platform scorecard workflow', () => {
  it('generates and retains an advisory four-week scorecard', () => {
    expect(workflow).toContain('npm ci --ignore-scripts')
    expect(workflow).toContain('npm run quality:platform-scorecard --')
    expect(workflow).toContain('--output "$RUNNER_TEMP/platform-data-quality.json"')
    expect(workflow).toContain('${{ runner.temp }}/platform-data-quality.json')

    const scorecardStep = workflow.slice(
      workflow.indexOf('- name: Build platform quality scorecard'),
      workflow.indexOf('- name: Add report to workflow summary'),
    )
    expect(scorecardStep).not.toContain('--strict')
  })

  it('fails only when scorecard generation fails, not while targets are incomplete', () => {
    expect(workflow).toContain(
      'PLATFORM_SCORECARD_OUTCOME: ${{ steps.platform_scorecard.outcome }}',
    )
    expect(workflow).toContain(
      'if [[ "$PLATFORM_SCORECARD_OUTCOME" == "failure" ]]; then',
    )
  })
})
