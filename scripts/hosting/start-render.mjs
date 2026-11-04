import { spawn } from 'node:child_process'
import { constants } from 'node:os'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(import.meta.url)

/** The candidate cannot accidentally acquire draft access or production writes
 * from dashboard settings copied from a different hosting environment. */
export function renderEnvironment(inherited = process.env) {
  return {
    ...inherited,
    RENDER: 'true',
    NODE_ENV: 'production',
    CONTENT_PREVIEW: 'false',
    CATALOG_BACKEND: 'json',
    NEXT_TELEMETRY_DISABLED: '1',
    ADMIN_LOCAL_VERIFICATION_ENABLED: 'false',
    ADMIN_VERIFICATION_USE_CCSWITCH: 'false',
    ADMIN_REMOTE_CONTROL_ENABLED: 'false',
    ADMIN_RELEASE_CONTROL_ENABLED: 'false',
  }
}

export function renderPort(value = process.env.PORT ?? '10000') {
  if (!/^[1-9]\d*$/u.test(value) || Number(value) > 65535) throw Error('render_port_invalid')
  return value
}

/** Forward platform shutdown to Next so it can finish in-flight work. Keeping
 * the parent alive until the child's close event also drains its output. */
export function runNode(args, environment = renderEnvironment()) {
  return new Promise((accept, reject) => {
    const child = spawn(process.execPath, args, { cwd: projectRoot, env: environment, stdio: 'inherit', windowsHide: true })
    const forward = signal => { if (!child.killed) child.kill(signal) }
    const term = () => forward('SIGTERM'), interrupt = () => forward('SIGINT')
    process.on('SIGTERM', term); process.on('SIGINT', interrupt)
    const cleanup = () => { process.off('SIGTERM', term); process.off('SIGINT', interrupt) }
    child.once('error', error => { cleanup(); reject(error) })
    child.once('close', (code, signal) => {
      cleanup()
      if (code === 0) accept()
      else {
        const error = Error(`render_child_failed:${code ?? signal ?? 'unknown'}`)
        error.exitCode = code ?? (128 + (constants.signals[signal] ?? 1))
        reject(error)
      }
    })
  })
}

export async function startRender() {
  const environment = renderEnvironment(), port = renderPort(environment.PORT ?? '10000')
  // Keep the complete checkout: receipts are outside public/ and are validated,
  // not copied into static assets or replaced with weaker runtime assertions.
  await runNode(['--import', 'tsx', 'scripts/quality/validate-directory.ts'], environment)
  await runNode([require.resolve('next/dist/bin/next'), 'start', '--hostname', '0.0.0.0', '--port', port], environment)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  startRender().catch(error => { console.error(error.message); process.exitCode = error.exitCode ?? 1 })
}
