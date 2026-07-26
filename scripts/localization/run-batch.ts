import { parseBatchRequest } from '../../workers/localization/src/schema'

type Arguments = {
  endpoint: string
  targets: string[]
  institutions: string[]
  kinds: string[]
  limit: number
  dryRun: boolean
}

function usage(): never {
  throw new Error(
    'Usage: tsx scripts/localization/run-batch.ts --endpoint https://<worker> '
    + '[--targets zh,en,ru] [--institutions university-id,...] '
    + '[--kinds program,scholarship] [--limit 120] [--dry-run]',
  )
}

function argumentsFrom(values: string[]): Arguments {
  const read = (name: string): string | undefined => {
    const index = values.indexOf(name)
    return index >= 0 ? values[index + 1] : undefined
  }
  const endpoint = read('--endpoint')
  if (!endpoint) usage()
  return {
    endpoint,
    targets: (read('--targets') ?? 'zh,en,ru').split(',').filter(Boolean),
    institutions: (read('--institutions') ?? '').split(',').filter(Boolean),
    kinds: (read('--kinds') ?? 'program,scholarship').split(',').filter(Boolean),
    limit: Number(read('--limit') ?? 120),
    dryRun: values.includes('--dry-run'),
  }
}

async function main(): Promise<void> {
  const input = argumentsFrom(process.argv.slice(2))
  const token = process.env.LOCALIZATION_ADMIN_TOKEN
  if (!token) throw new Error('LOCALIZATION_ADMIN_TOKEN is required')
  const endpoint = new URL('/v1/batches', input.endpoint)
  if (endpoint.protocol !== 'https:') throw new Error('Worker endpoint must use HTTPS')
  const request = parseBatchRequest({
    targetLocales: input.targets,
    institutionIds: input.institutions,
    recordKinds: input.kinds,
    limit: input.limit,
    dryRun: input.dryRun,
  })
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
    redirect: 'error',
  })
  const result = await response.json() as Record<string, unknown>
  if (!response.ok) {
    throw new Error(`Localization Worker returned HTTP ${response.status}: ${String(result.error)}`)
  }
  // Never print environment variables or model payloads.
  console.log(JSON.stringify({
    ok: result.ok,
    runId: result.runId,
    plannedJobs: result.plannedJobs,
    queuedBatches: result.queuedBatches,
    skippedCurrent: result.skippedCurrent,
    dryRun: result.dryRun,
  }, null, 2))
}

void main()

