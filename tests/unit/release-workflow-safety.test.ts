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
    expect(workflow).toMatch(/permissions:\s+actions: read\s+contents: read/u)
    expect(workflow).toContain("github.event.deployment.environment == 'Production'")
    expect(workflow).toContain('DEPLOYMENT_SHA: ${{ github.event.deployment.sha }}')
    expect(workflow).toContain('main_sha="$(git rev-parse HEAD)"')
    expect(workflow).toContain("steps.main.outputs.matches == 'true'")
    expect(workflow).toContain('cancel-in-progress: false')
    expect(workflow).not.toContain('cancel-in-progress: true')
    expect(workflow).not.toContain("github.event.deployment.ref == 'main'")

    const comparison = workflow.indexOf('Verify deployment commit is current main')
    const ciGate = workflow.indexOf('Wait for successful CI on the exact deployment SHA')
    const currentMainRecheck = workflow.indexOf('Reconfirm deployment SHA is still current main')
    const promotion = workflow.indexOf('Promote stable production alias transaction')
    expect(comparison).toBeGreaterThan(-1)
    expect(ciGate).toBeGreaterThan(comparison)
    expect(currentMainRecheck).toBeGreaterThan(ciGate)
    expect(promotion).toBeGreaterThan(currentMainRecheck)
    expect(workflow).toContain('branch=main&per_page=20')
    expect(workflow).toContain('(.event == "push" or .event == "workflow_dispatch")')
    expect(workflow).toContain('.status == "completed"')
    expect(workflow).toContain('.head_sha == $sha')
    expect(workflow).toContain('.conclusion == "success"')
    expect(workflow).toContain("steps.ci.outputs.passed == 'true'")
    expect(workflow).toContain('/git/ref/heads/main')
    expect(workflow).toContain("steps.current.outputs.matches == 'true'")
  })

  it('keeps alias mutation and stable smoke in one fail-closed rollback transaction', () => {
    const workflow = readWorkflow('vercel-production-alias.yml')
    const transactionStart = workflow.indexOf('Promote stable production alias transaction')
    const transaction = workflow.slice(transactionStart)
    const rollbackFunction = transaction.indexOf('rollback_on_failure()')
    const rollbackTrap = transaction.indexOf('trap rollback_on_failure EXIT')
    const previousTarget = transaction.indexOf('previous_target="$(current_stable_target)"')
    const finalMainCheck = transaction.indexOf('final_main_sha=')
    const mutationArmed = transaction.indexOf('mutation_attempted=true')
    const candidateAliasSet = transaction.indexOf(
      'npx --yes vercel@58.0.0 alias set',
      mutationArmed,
    )
    const postPromotionCheck = transaction.indexOf('post_promotion_main_sha=')
    const stableSmoke = transaction.indexOf(
      'https://studyinchina.vercel.app/api/v1/releases/current',
    )
    const transactionCommit = transaction.indexOf('transaction_committed=true')
    const rollbackAliasSet = transaction.indexOf(
      'npx --yes vercel@58.0.0 alias set',
      rollbackFunction,
    )

    expect(transactionStart).toBeGreaterThan(-1)
    expect(rollbackFunction).toBeGreaterThan(-1)
    expect(rollbackTrap).toBeGreaterThan(rollbackFunction)
    expect(previousTarget).toBeGreaterThan(rollbackTrap)
    expect(finalMainCheck).toBeGreaterThan(previousTarget)
    expect(mutationArmed).toBeGreaterThan(finalMainCheck)
    expect(candidateAliasSet).toBeGreaterThan(mutationArmed)
    expect(postPromotionCheck).toBeGreaterThan(candidateAliasSet)
    expect(stableSmoke).toBeGreaterThan(postPromotionCheck)
    expect(transactionCommit).toBeGreaterThan(stableSmoke)
    expect(rollbackAliasSet).toBeGreaterThan(rollbackFunction)
    expect(rollbackAliasSet).toBeLessThan(rollbackTrap)
    expect(transaction).toContain('${GITHUB_API_URL}/repos/${GITHUB_REPOSITORY}/git/ref/heads/main')
    expect(transaction).toContain('"${previous_target}"')
    expect(transaction).toContain('Production promotion raced with main')
    expect(transaction).toContain('Stable alias rollback failed')
    expect(transaction).toContain('Stable alias rollback verification failed')
    expect(transaction).toContain('restored_target="$(current_stable_target || true)"')
    expect(transaction).toContain('"${restored_target}" == "${previous_target}"')
    expect(transaction.match(/vercel@58\.0\.0 alias set/gu)).toHaveLength(2)
  })

  it('fails closed when the stable-alias credential is unavailable', () => {
    const workflow = readWorkflow('vercel-production-alias.yml')
    const credentialGate = workflow.indexOf('Require stable-alias credential')
    const missingCredential = workflow.indexOf('VERCEL_TOKEN is not configured')
    const promotion = workflow.indexOf('Promote stable production alias transaction')
    const credentialBlock = workflow.slice(credentialGate, promotion)

    expect(credentialGate).toBeGreaterThan(-1)
    expect(missingCredential).toBeGreaterThan(credentialGate)
    expect(credentialBlock).toContain('::error title=Stable production alias was not promoted')
    expect(credentialBlock).toContain('exit 1')
    expect(credentialBlock).not.toContain('::warning::')
  })

  it('smoke-tests the immutable deployment before the fail-closed stable-alias transaction', () => {
    const workflow = readWorkflow('vercel-production-alias.yml')
    const urlValidation = workflow.indexOf('Validate deployment URL')
    const ciGate = workflow.indexOf('Wait for successful CI on the exact deployment SHA')
    const immutableSmoke = workflow.indexOf('Verify immutable deployment release API')
    const transaction = workflow.indexOf('Promote stable production alias transaction')
    const stableSmoke = workflow.indexOf(
      'https://studyinchina.vercel.app/api/v1/releases/current',
      transaction,
    )

    expect(urlValidation).toBeGreaterThan(-1)
    expect(ciGate).toBeGreaterThan(-1)
    expect(immutableSmoke).toBeGreaterThan(ciGate)
    expect(immutableSmoke).toBeGreaterThan(urlValidation)
    expect(transaction).toBeGreaterThan(immutableSmoke)
    expect(stableSmoke).toBeGreaterThan(transaction)
    expect(workflow.slice(immutableSmoke, transaction)).toContain(
      '${DEPLOYMENT_URL%/}/api/v1/releases/current',
    )
    expect(workflow.slice(immutableSmoke, transaction)).toContain('.data.deploymentSha == $sha')
    expect(workflow.slice(transaction)).toContain('.data.deploymentSha == $sha')
    expect(workflow.slice(transaction)).toContain(
      '.data.publicCounts.programs | type == "number" and . > 0',
    )
    expect(workflow.slice(stableSmoke)).toContain('transaction_committed=true')
  })

  it('authenticates immutable smoke with an existing project credential and read-only APIs', () => {
    const workflow = readWorkflow('vercel-production-alias.yml')
    const immutableSmoke = workflow.indexOf('Verify immutable deployment release API')
    const nodeSetup = workflow.indexOf('Use Node.js 24')
    const block = workflow.slice(immutableSmoke, nodeSetup)
    const ownershipCheck = block.indexOf('.projectId == $projectId and .ownerId == $ownerId')
    const credentialSelection = block.indexOf('bypass_secret=')
    const credentialMask = block.indexOf("printf '::add-mask::%s\\n'")
    const smokeRequest = block.indexOf('if curl --fail --silent --show-error')

    expect(block).toContain('https://api.vercel.com/v9/projects/studyinchina?slug=henry-yangs-projects-c9706eac')
    expect(block).toContain('https://api.vercel.com/v13/deployments/${deployment_host}?teamId=${team_id}')
    expect(block).toContain('select(.name == "studyinchina")')
    expect(block).toContain('.url == $host and .readyState == "READY" and .target == "production"')
    expect(ownershipCheck).toBeGreaterThan(-1)
    expect(credentialSelection).toBeGreaterThan(ownershipCheck)
    expect(credentialMask).toBeGreaterThan(credentialSelection)
    expect(smokeRequest).toBeGreaterThan(credentialMask)
    expect(block).toContain('.value.scope == "automation-bypass"')
    expect(block).toContain('No existing automation-bypass credential is available.')
    expect(block).toContain('The smoke test will not change Deployment Protection')
    expect(block.slice(smokeRequest)).toContain('--header "x-vercel-protection-bypass: ${bypass_secret}"')
    expect(block.slice(smokeRequest)).not.toContain('VERCEL_TOKEN')
    expect(block).not.toMatch(/\b(?:npx|npm|vercel)\s/u)
    expect(block).not.toMatch(/--(?:request|location|insecure|proxy|verbose|debug)\b/u)
    expect(block).not.toMatch(/GITHUB_ENV|GITHUB_OUTPUT|\btee\b/u)
    expect(block).toContain('set -euo pipefail')
    expect(block).toContain('--connect-timeout 10 --max-time 30')
    expect(block).toContain('jq -e --arg sha "${DEPLOYMENT_SHA}"')
    expect(block).toContain('.data.deploymentSha == $sha')
    expect(block).toContain('.data.id | type == "string" and length > 0')
    expect(block).toContain('.data.publicCounts.programs | type == "number" and . > 0')
    expect(block).toContain('the stable alias was not changed.')
    expect(block).toContain('exit 1')
  })

  it('exposes the Vercel token only to the credential gate, authenticated smoke, and alias transaction', () => {
    const workflow = readWorkflow('vercel-production-alias.yml')
    const bindings = workflow.match(
      /^\s+VERCEL_TOKEN:\s+\$\{\{ secrets\.VERCEL_TOKEN \}\}$/gmu,
    ) ?? []
    const credentialGate = workflow.indexOf('Require stable-alias credential')
    const immutableSmoke = workflow.indexOf('Verify immutable deployment release API')
    const transaction = workflow.indexOf('Promote stable production alias transaction')

    expect(bindings).toHaveLength(3)
    expect(workflow.slice(0, credentialGate)).not.toContain(
      'VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}',
    )
    expect(workflow.slice(credentialGate, immutableSmoke)).toContain(
      'VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}',
    )
    expect(workflow.slice(immutableSmoke, transaction)).toContain(
      'VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}',
    )
    expect(workflow.slice(transaction).match(
      /^\s+VERCEL_TOKEN:\s+\$\{\{ secrets\.VERCEL_TOKEN \}\}$/gmu,
    )).toHaveLength(1)
    expect(workflow.slice(transaction)).toContain(
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

describe('autonomous maintenance protected branch publication', () => {
  it('waits for successful exact-commit maintenance-branch CI before a non-force main update', () => {
    const workflow = readWorkflow('autonomous-catalog.yml')
    const start = workflow.indexOf('Publish the exact catalog commit only after protected-branch CI passes')
    const block = workflow.slice(start, workflow.indexOf('Build complete official-source seed inventory', start))
    const branchPush = block.indexOf('git push origin "HEAD:refs/heads/${maintenance_branch}"')
    const branchDispatch = block.indexOf('gh workflow run ci.yml --ref "$maintenance_branch"')
    const wait = block.indexOf('deadline=$((SECONDS + 1200))')
    const passed = block.indexOf('if [[ "$ci_passed" != \'true\' ]]')
    const recheck = block.indexOf('git fetch origin main --depth=1', passed)
    const mainPush = block.indexOf('git push origin "${candidate_sha}:refs/heads/main"')
    expect(start).toBeGreaterThan(-1)
    expect(branchPush).toBeGreaterThan(-1)
    expect(branchDispatch).toBeGreaterThan(branchPush)
    expect(wait).toBeGreaterThan(branchDispatch)
    expect(passed).toBeGreaterThan(wait)
    expect(recheck).toBeGreaterThan(passed)
    expect(mainPush).toBeGreaterThan(recheck)
    expect(block).toContain('.head_sha == $sha and .head_branch == $branch and .event == "workflow_dispatch"')
    expect(block).toContain('.status == "completed"')
    expect(block).toContain('"$outcome" == \'success\'')
    expect(block).toContain('"$(git rev-parse origin/main)" != "$base_sha"')
    expect(block).toContain('--max-time "$request_timeout"')
    expect(block).toContain('remaining=$((deadline - SECONDS))')
    expect(block).not.toMatch(/git push[^\n]*(?:--force|\s-f\s|\+refs)/u)
    expect(block.slice(mainPush)).toContain('gh workflow run ci.yml --ref main')
    expect(workflow).toContain('group: autonomous-catalog-maintenance-${{ github.repository }}')
    expect(workflow).toContain('cancel-in-progress: false')
  })

  it('fails the Pipeline handoff when required credentials are missing while retaining evidence artifacts', () => {
    const workflow = readWorkflow('program-fact-refresh.yml')
    const start = workflow.indexOf("echo 'configured=false'")
    const block = workflow.slice(start, workflow.indexOf('enqueue_url=', start))
    expect(start).toBeGreaterThan(-1)
    expect(block).toContain('exit 1')
    expect(block).not.toContain('exit 0')
    expect(workflow).toContain("always() && steps.enqueue.outcome == 'failure'")
    expect(workflow).toContain('Upload Pipeline re-verification handoff')
  })
})
