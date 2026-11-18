import 'server-only'
import { z } from 'zod'

const base = 'https://raw.githubusercontent.com/computersciencefreshmen/StudyInChina/catalog-program-feed/'
const count = z.number().int().nonnegative()
const proof = z.object({ verifiedAt: z.iso.datetime(), revision: z.string().regex(/^[a-f0-9]{64}$/), publicPrograms: count })
const review = z.object({ updatedAt: z.iso.datetime(), review: z.object({ approved: count, revise: count, blocked: count }) })

async function read<T>(path: string, contract: z.ZodType<T>) {
  try {
    const response = await fetch(base + path, { redirect: 'error', signal: AbortSignal.timeout(4000), next: { revalidate: 60 } })
    if (!response.ok || !response.body) return null
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if ((size += value.length) > 64_000) { await reader.cancel(); return null }
        chunks.push(value)
      }
    } finally { reader.releaseLock() }
    return contract.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
  } catch { return null }
}

export async function readProgrammeReceipts() {
  const [lastReadback, lastTranslationReview] = await Promise.all([
    read('receipts/site-readback.json', proof), read('translations/status.json', review),
  ])
  return { lastReadback, lastTranslationReview }
}
