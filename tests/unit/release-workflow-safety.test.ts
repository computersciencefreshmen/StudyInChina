import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function readWorkflow(name: string): string {
  return readFileSync(resolve(process.cwd(), '.github/workflows', name), 'utf8')
}

describe('production release workflow safety', () => {
  it('promotes only a successful Production deployment whose SHA is current main', () => {
    const workflow = readWorkflow('vercel-production-alias.yml')

    expect(workflow).toContain("github.event.deployment_status.state == 'success'")
    expect(workflow).toContain("github.event.deployment.environment == 'Production'")
    expect(workflow).toContain('DEPLOYMENT_SHA: ${{ github.event.deployment.sha }}')
    expect(workflow).toContain('main_sha="$(git rev-parse HEAD)"')
    expect(workflow).toContain("steps.main.outputs.matches == 'true'")
    expect(workflow).not.toContain("github.event.deployment.ref == 'main'")

    const comparison = workflow.indexOf('Verify deployment commit is current main')
    const promotion = workflow.indexOf('Promote stable production alias')
    expect(comparison).toBeGreaterThan(-1)
    expect(promotion).toBeGreaterThan(comparison)
  })

  it('keeps fact refresh read-only and publishes an audit artifact', () => {
    const workflow = readWorkflow('program-fact-refresh.yml')

    expect(workflow).toMatch(/permissions:\s+contents: read/u)
    expect(workflow).toContain('persist-credentials: false')
    expect(workflow).toContain('actions/upload-artifact@v6')
    expect(workflow).toContain('catalog-changes.patch')
    expect(workflow).not.toMatch(/\bgit\s+(?:commit|push)\b/u)
    expect(workflow).not.toMatch(/contents:\s+write/u)
  })
})
