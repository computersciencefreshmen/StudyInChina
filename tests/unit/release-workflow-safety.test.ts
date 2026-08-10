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

  it('fails closed when the stable-alias credential is unavailable', () => {
    const workflow = readWorkflow('vercel-production-alias.yml')
    const credentialGate = workflow.indexOf('Require stable-alias credential')
    const missingCredential = workflow.indexOf('VERCEL_TOKEN is not configured')
    const promotion = workflow.indexOf('Promote stable production alias')
    const credentialBlock = workflow.slice(credentialGate, promotion)

    expect(credentialGate).toBeGreaterThan(-1)
    expect(missingCredential).toBeGreaterThan(credentialGate)
    expect(credentialBlock).toContain('::error title=Stable production alias was not promoted')
    expect(credentialBlock).toContain('exit 1')
    expect(credentialBlock).not.toContain('::warning::')
  })

  it('smoke-tests the immutable deployment before promotion and the stable alias after it', () => {
    const workflow = readWorkflow('vercel-production-alias.yml')
    const urlValidation = workflow.indexOf('Validate deployment URL')
    const immutableSmoke = workflow.indexOf('Verify immutable deployment release API')
    const promotion = workflow.indexOf('Promote stable production alias')
    const stableSmoke = workflow.indexOf('Verify stable alias release API')

    expect(urlValidation).toBeGreaterThan(-1)
    expect(immutableSmoke).toBeGreaterThan(urlValidation)
    expect(promotion).toBeGreaterThan(immutableSmoke)
    expect(stableSmoke).toBeGreaterThan(promotion)
    expect(workflow.slice(immutableSmoke, promotion)).toContain(
      '${DEPLOYMENT_URL%/}/api/v1/releases/current',
    )
    expect(workflow.slice(stableSmoke)).toContain(
      'https://studyinchina.vercel.app/api/v1/releases/current',
    )
  })

  it('exposes the Vercel token only to the credential gate and alias command', () => {
    const workflow = readWorkflow('vercel-production-alias.yml')
    const bindings = workflow.match(
      /^\s+VERCEL_TOKEN:\s+\$\{\{ secrets\.VERCEL_TOKEN \}\}$/gmu,
    ) ?? []
    const credentialGate = workflow.indexOf('Require stable-alias credential')
    const immutableSmoke = workflow.indexOf('Verify immutable deployment release API')
    const promotion = workflow.indexOf('Promote stable production alias')
    const stableSmoke = workflow.indexOf('Verify stable alias release API')

    expect(bindings).toHaveLength(2)
    expect(workflow.slice(0, credentialGate)).not.toContain(
      'VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}',
    )
    expect(workflow.slice(credentialGate, immutableSmoke)).toContain(
      'VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}',
    )
    expect(workflow.slice(immutableSmoke, promotion)).not.toContain(
      'VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}',
    )
    expect(workflow.slice(promotion, stableSmoke)).toContain(
      'VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}',
    )
    expect(workflow.slice(stableSmoke)).not.toContain(
      'VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}',
    )
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
