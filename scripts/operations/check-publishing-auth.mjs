import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const PROJECT = 'prj_AgYJcsuat4kmLiinlvcBbZsYY3cg'
const TEAM = 'team_o5qghzfTOk24QwoYANzJ8hNH'
const ALIAS = 'studyinchina.vercel.app'
const TELEMETRY = 'https://studyinchina-catalog-api.13022037121.workers.dev/internal/v1/admin-telemetry'

/** GET-only credential check. Raw provider responses and credentials never leave this function. */
export async function checkPublishingAuthentication(environment = process.env, transport = fetch) {
  const admin = environment.ADMIN_TELEMETRY_TOKEN, vercel = environment.VERCEL_TOKEN
  if (!admin || admin.length < 32 || !vercel || vercel.length < 20 || environment.ADMIN_TELEMETRY_URL !== TELEMETRY) {
    throw new Error('publishing_credentials_missing_or_target_invalid')
  }
  const read = async (url, token) => {
    let response
    try {
      response = await transport(url, { method: 'GET', redirect: 'error', cache: 'no-store',
        headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) })
      if (!response.ok || !response.body || Number(response.headers.get('content-length')) > 512 * 1024) throw new Error()
      const reader = response.body.getReader(), chunks = []; let bytes = 0
      try {
        for (;;) {
          const item = await reader.read(); if (item.done) break
          bytes += item.value.byteLength
          if (bytes > 512 * 1024) { await reader.cancel(); throw new Error() }
          chunks.push(item.value)
        }
      } finally { reader.releaseLock() }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch { throw new Error('publishing_authenticated_read_failed') }
  }
  const api = path => `https://api.vercel.com${path}?teamId=${TEAM}`
  const project = await read(api(`/v9/projects/${PROJECT}`), vercel)
  if (project.id !== PROJECT || project.accountId !== TEAM) throw new Error('publishing_project_ownership_mismatch')
  const alias = await read(api(`/v4/aliases/${ALIAS}`), vercel)
  const writer = await read(new URL('/internal/v1/admin-releases?writer=1', TELEMETRY).href, admin)
  if (alias.projectId !== PROJECT || !/^dpl_[A-Za-z0-9]+$/u.test(alias.deploymentId ?? '')
    || writer.controlEnabled !== true || writer.state?.registry?.projectId !== PROJECT
    || writer.state.registry.alias !== ALIAS || writer.state.registry.currentId !== alias.deploymentId
    || !Number.isSafeInteger(writer.state.registry.revision) || writer.state.registry.revision < 0
    || writer.state.command && !['pending', 'claimed', 'completed', 'failed', 'uncertain', 'rejected'].includes(writer.state.command.status)) {
    throw new Error('publishing_registry_or_live_alias_mismatch')
  }
  return { authenticatedReadsPassed: true, checkedAt: new Date().toISOString(), projectId: PROJECT, ownerId: TEAM,
    deploymentId: alias.deploymentId, controlEnabled: true, revision: writer.state.registry.revision,
    commandStatus: writer.state.command?.status ?? null, cloudMutations: 0,
    limitation: 'Read-only credential verification does not authorize or perform a deployment, alias change, or CI override.' }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  checkPublishingAuthentication().then(value => console.log(JSON.stringify(value))).catch(() => {
    console.error('Publishing authentication check failed. Review secret names, project scope and registry; no mutation was attempted.')
    process.exitCode = 1
  })
}
