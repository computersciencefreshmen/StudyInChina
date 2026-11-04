import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { renderEnvironment, renderPort, runNode } from './start-render.mjs'

test('candidate Blueprint preserves production distributed login limiting and requests existing secrets without provisioning infrastructure', () => {
  const require = createRequire(import.meta.url), yaml = require('js-yaml')
  const blueprint = yaml.load(readFileSync(new URL('../../render.yaml', import.meta.url), 'utf8'))
  assert.equal(blueprint.services.length, 1)
  assert.equal(blueprint.databases, undefined)
  const service = blueprint.services[0], environment = new Map(service.envVars.map(variable => [variable.key, variable]))
  assert.equal(service.type, 'web')
  assert.equal(service.disk, undefined)
  assert.equal(environment.get('ADMIN_LOGIN_RATE_LIMIT_MODE').value, 'distributed')
  for (const key of ['ADMIN_ACCESS_TOKEN', 'ADMIN_SESSION_SECRET', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) {
    assert.deepEqual(environment.get(key), { key, sync: false })
  }
  // The launch wrapper preserves this deployment choice instead of silently
  // replacing shared counters with process-local counters on a new host.
  assert.equal(renderEnvironment({ ADMIN_LOGIN_RATE_LIMIT_MODE: environment.get('ADMIN_LOGIN_RATE_LIMIT_MODE').value }).ADMIN_LOGIN_RATE_LIMIT_MODE, 'distributed')
})

test('candidate startup overrides inherited draft/write controls while preserving real credentials', () => {
  const environment = renderEnvironment({ CONTENT_PREVIEW: 'true', CATALOG_BACKEND: 'd1', ADMIN_LOCAL_VERIFICATION_ENABLED: 'true', ADMIN_REMOTE_CONTROL_ENABLED: 'true', ADMIN_RELEASE_CONTROL_ENABLED: 'true', ADMIN_ACCESS_TOKEN: 'provided-by-secret-store', PORT: '12345' })
  assert.equal(environment.RENDER, 'true')
  assert.equal(environment.NODE_ENV, 'production')
  assert.equal(environment.CONTENT_PREVIEW, 'false')
  assert.equal(environment.CATALOG_BACKEND, 'json')
  for (const key of ['ADMIN_LOCAL_VERIFICATION_ENABLED', 'ADMIN_VERIFICATION_USE_CCSWITCH', 'ADMIN_REMOTE_CONTROL_ENABLED', 'ADMIN_RELEASE_CONTROL_ENABLED']) assert.equal(environment[key], 'false')
  assert.equal(environment.ADMIN_ACCESS_TOKEN, 'provided-by-secret-store')
  assert.equal(renderPort(environment.PORT), '12345')
  for (const port of ['0', '65536', '-1', '3000 --inspect', '']) assert.throws(() => renderPort(port), /render_port_invalid/u)
})

test('a failed validation child rejects startup, and a successful child leaves no shutdown listeners', async () => {
  const before = [process.listenerCount('SIGTERM'), process.listenerCount('SIGINT')]
  await assert.rejects(runNode(['-e', 'process.exit(7)']), { message: 'render_child_failed:7', exitCode: 7 })
  await runNode(['-e', 'process.exit(0)'])
  assert.deepEqual([process.listenerCount('SIGTERM'), process.listenerCount('SIGINT')], before)
})
