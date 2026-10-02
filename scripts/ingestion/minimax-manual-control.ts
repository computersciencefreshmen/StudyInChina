import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export type ManualControl = { desiredState: 'running' | 'paused'; commandId: string | null; updatedAt: string | null }

/** Missing control preserves existing authorized work; malformed control closes model admission. */
export async function readManualControl(root: string): Promise<ManualControl> {
  try {
    const text = await readFile(/* turbopackIgnore: true */ join(root, '.tmp', 'minimax-verification', 'manual-control.json'), 'utf8')
    if (Buffer.byteLength(text) > 4096) throw new Error('invalid_control')
    const value = JSON.parse(text)
    if (value.schemaVersion !== 1 || !['running', 'paused'].includes(value.desiredState) ||
      typeof value.commandId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value.commandId) ||
      typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))) throw new Error('invalid_control')
    return { desiredState: value.desiredState, commandId: value.commandId, updatedAt: value.updatedAt }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { desiredState: 'running', commandId: null, updatedAt: null }
    return { desiredState: 'paused', commandId: null, updatedAt: null }
  }
}

export async function assertMiniMaxRunning(root: string): Promise<void> {
  if ((await readManualControl(root)).desiredState === 'paused') throw new Error('MiniMax manually paused')
}
