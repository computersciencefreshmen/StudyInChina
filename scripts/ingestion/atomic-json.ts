import { randomUUID } from 'node:crypto'
import { mkdir, open, rename, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'

const WINDOWS_REPLACE_DELAYS_MS = [50, 100, 200, 400, 750] as const
type ReplaceDependencies = {
  platform: NodeJS.Platform
  rename: typeof rename
  wait: (milliseconds: number) => Promise<void>
}

/** Keep the old JSON intact while Windows readers briefly prevent replacement. */
export async function atomicJson(path: string, value: unknown, dependencies: Partial<ReplaceDependencies> = {}): Promise<void> {
  const platform = dependencies.platform ?? process.platform
  const replace = dependencies.rename ?? rename
  const wait = dependencies.wait ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)))
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    const file = await open(/* turbopackIgnore: true */ temporary, 'wx')
    try { await file.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8') } finally { await file.close() }
    for (let attempt = 0; ; attempt++) {
      try { await replace(temporary, path); return } catch (error) {
        const code = (error as NodeJS.ErrnoException | null)?.code
        if (platform !== 'win32' || !['EPERM', 'EBUSY', 'EACCES'].includes(code || '') || attempt >= WINDOWS_REPLACE_DELAYS_MS.length) throw error
        // Never remove the destination: a permanent denial must retain its last valid value.
        await wait(WINDOWS_REPLACE_DELAYS_MS[attempt])
      }
    }
  } finally { await unlink(temporary).catch(() => undefined) }
}
