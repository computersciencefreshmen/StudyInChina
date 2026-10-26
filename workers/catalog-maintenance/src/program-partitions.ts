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

/** Hints preserve readable row cells from noisy PDF text. Models must still
 * independently prove every emitted name, degree and admissions scope. */
export function programPartitionRowHints(targetText: string | null, rowNumbers: number[] = []) {
  if (targetText === null) return []
  const rows = [...targetText.matchAll(/(?:^|\s)(\d{1,3})\s+([\p{Script=Han}][\p{Script=Han}·]{1,30})(?=\s|$)/gu)]
  return rows.flatMap((match, index) => {
    if (!rowNumbers.includes(Number(match[1])) || /^(?:全日制|学术学位|专业学位|硕士|博士|中文|英文)$/u.test(match[2])) return []
    const row = targetText.slice(match.index, rows[index + 1]?.index ?? targetText.length)
    const degreeLevel = /博士|Ph\.?D\.?/iu.test(row) ? 'doctorate' : /硕士|\bMaster\b/iu.test(row) ? 'master' : null
    return [{ kind: 'numbered-program-row', name: match[2], degreeLevel, rowNumber: Number(match[1]) }]
  })
}
