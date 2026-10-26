import { z } from 'zod'
import { normalizeEvidenceText } from '../../ingestion/src/rules'
import { MaintenanceError } from './types'
import { canonical, digest } from './util'

const range = z.object({ start: z.number().int().nonnegative(), end: z.number().int().positive() }).strict()
const partitionSchema = z.object({
  kind: z.literal('program-identity-partition-v1'), fullTextSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  page: z.number().int().positive(), rowNumbers: z.array(z.number().int().positive()).min(1).max(20),
  contextRanges: z.array(range).max(8), targetRanges: z.array(range).min(1).max(20),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict()

/** A view references exact ranges of the saved full derivative; it never replaces that derivative. */
export async function programPartitionInput(text: string, fullTextSha256: string, input: string | null | undefined) {
  if (!input) return { text, targetText: null, metadata: null }
  let value: unknown
  try { value = JSON.parse(input) } catch { throw new MaintenanceError('program_partition_invalid') }
  const parsed = partitionSchema.safeParse(value)
  if (!parsed.success) throw new MaintenanceError('program_partition_invalid')
  const { sha256, ...content } = parsed.data
  if (content.fullTextSha256 !== fullTextSha256 || await digest(text) !== fullTextSha256
    || await digest(canonical(content)) !== sha256) throw new MaintenanceError('program_partition_checksum_mismatch')
  const ranges = [...content.contextRanges, ...content.targetRanges]
  for (const part of ranges) if (part.start >= part.end || part.end > text.length)
    throw new MaintenanceError('program_partition_range_invalid')
  const ordered = [...ranges].sort((a, b) => a.start - b.start)
  if (ordered.some((part, index) => index > 0 && part.start < ordered[index - 1].end)
    || new Set(content.rowNumbers).size !== content.rowNumbers.length)
    throw new MaintenanceError('program_partition_range_invalid')
  const context = content.contextRanges.map(part => text.slice(part.start, part.end)).join('\n')
  const targetText = content.targetRanges.map(part => text.slice(part.start, part.end)).join('\n')
  const view = [context, targetText].filter(Boolean).join('\n')
  if (!targetText.trim() || context.length > 10000 || view.length > 50000)
    throw new MaintenanceError('program_partition_size_invalid')
  return { text: view, targetText, metadata: { ...content, sha256 } }
}

export function namesBelongToPartition(name: { en?: string; zh?: string }, targetText: string | null): boolean {
  return targetText === null || Object.values(name).every(value => normalizeEvidenceText(targetText).includes(normalizeEvidenceText(value)))
}
