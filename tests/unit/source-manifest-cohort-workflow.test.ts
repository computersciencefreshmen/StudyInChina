import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const workflowPath = join(
  resolve('.'),
  '.github',
  'workflows',
  'source-manifest-cohort-candidates.yml',
)

describe('source-manifest candidate cohort workflow', () => {
  it('is manually triggered, read-only, and uploads a runner-temp artifact', () => {
    const workflow = readFileSync(workflowPath, 'utf8')

    expect(workflow).toContain('workflow_dispatch:')
    expect(workflow).toContain('contents: read')
    expect(workflow).not.toContain('contents: write')
    expect(workflow).toContain('${{ runner.temp }}/source-manifest-cohort-candidates')
    expect(workflow).toContain('npm run validate:double-first-class')
    expect(workflow).not.toContain('npm run validate:data')
    expect(workflow).toContain('--artifact-output "$ARTIFACT_DIRECTORY"')
    expect(workflow).toContain(
      'pipeline:verify-source-manifest-candidates -- "$ARTIFACT_DIRECTORY"',
    )
    expect(workflow).toContain('git diff --exit-code -- content/source-manifests')
    expect(workflow).toContain('actions/upload-artifact@v6')
    expect(workflow).not.toMatch(/\s--output(?:\s|$)/u)
  })
})
