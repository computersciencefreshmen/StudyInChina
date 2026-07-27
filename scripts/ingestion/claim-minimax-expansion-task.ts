import { access, mkdir, open, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

type MiniMaxExpansionTask = {
  id: string
  kind: 'programs' | 'scholarships'
  status: 'pending'
  schools: Array<{
    targetId: string
    cohort: 'double_first_class' | 'regional_priority'
    officialNameZh: string
    officialNameEn: string | null
    institutionRef: string
    catalogInstitutionId: string | null
    province: string | null
    city: string | null
    focusTags: string[]
  }>
  promptPath: string
  outputJsonPath: string
  outputMarkdownPath: string
}

type MiniMaxExpansionQueue = {
  format: 'studyinchina.minimax-expansion-queue'
  formatVersion: 2
  tasks: MiniMaxExpansionTask[]
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function argument(name: string): string | null {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] ?? null : null
}

async function main(): Promise<void> {
  const worker = argument('--worker')
  if (!worker?.trim()) throw new Error('--worker is required')
  const queue = JSON.parse(
    await readFile(resolve('quality/minimax-expansion/queue.v2.json'), 'utf8'),
  ) as MiniMaxExpansionQueue
  for (const task of queue.tasks) {
    const completed = resolve(`quality/minimax-expansion/completed/${task.id}.json`)
    if (await exists(completed)) continue
    const claimPath = resolve(`quality/minimax-expansion/claims/${task.id}.json`)
    await mkdir(dirname(claimPath), { recursive: true })
    try {
      const claim = await open(claimPath, 'wx')
      await claim.writeFile(`${JSON.stringify({
        taskId: task.id,
        worker: worker.trim(),
        claimedAt: new Date().toISOString(),
        promptPath: task.promptPath,
        outputJsonPath: task.outputJsonPath,
        outputMarkdownPath: task.outputMarkdownPath,
      }, null, 2)}\n`, 'utf8')
      await claim.close()
      console.log(JSON.stringify({
        claimed: true,
        taskId: task.id,
        kind: task.kind,
        schools: task.schools.length,
        promptPath: task.promptPath,
        outputJsonPath: task.outputJsonPath,
        outputMarkdownPath: task.outputMarkdownPath,
      }))
      return
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error
        ? String(error.code)
        : ''
      if (code === 'EEXIST') continue
      throw error
    }
  }
  console.log(JSON.stringify({ claimed: false, reason: 'no-pending-unclaimed-task' }))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}