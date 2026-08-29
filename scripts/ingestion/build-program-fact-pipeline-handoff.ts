import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { sourceManifestSchema } from '../../workers/ingestion/src/manifest-schema'

type JsonRecord = Record<string, unknown>

type AuditRecord = {
  institutionId: string
  officialUrl: string
  programId: string | null
  status: string
}

type AuditDocument = {
  records: AuditRecord[]
}

export type ProgramFactPipelineHandoff = {
  format: 'studyinchina.pipeline.program-fact-reverification'
  formatVersion: 1
  generatedAt: string
  policy: {
    exactOfficialUrlMatch: true
    aiWritesCatalog: false
    pipelineCandidateOnly: true
  }
  requests: Array<{
    sourceId: string
    institutionId: string
    officialUrl: string
    entityType: string
    sourceCategory: string
    extractionMode: string
    programIds: string[]
    auditStatuses: string[]
  }>
  unmatchedOfficialUrls: string[]
  summary: {
    auditedRecords: number
    auditedOfficialUrls: number
    registeredSources: number
    requests: number
    unmatchedOfficialUrls: number
  }
}

function asRecord(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as JsonRecord
}

function canonicalOfficialUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error(`Official source URL must be credential-free HTTPS: ${value}`)
  }
  url.hash = ''
  return url.href
}

function normalizeAudit(input: unknown): AuditDocument {
  const root = asRecord(input, 'program fact audit')
  if (!Array.isArray(root.records)) throw new Error('program fact audit.records must be an array')
  return {
    records: root.records.map((value, index) => {
      const record = asRecord(value, `program fact audit.records[${index}]`)
      const institutionId = record.institutionId
      const officialUrl = record.officialUrl
      const programId = record.programId
      const status = record.status
      if (
        typeof institutionId !== 'string'
        || typeof officialUrl !== 'string'
        || (typeof programId !== 'string' && programId !== null)
        || typeof status !== 'string'
      ) {
        throw new Error(`program fact audit.records[${index}] is invalid`)
      }
      return {
        institutionId,
        officialUrl: canonicalOfficialUrl(officialUrl),
        programId,
        status,
      }
    }),
  }
}

export function buildProgramFactPipelineHandoff(input: {
  audit: unknown
  sourceManifestDocuments: unknown[]
  generatedAt?: string
}): ProgramFactPipelineHandoff {
  const audit = normalizeAudit(input.audit)
  const generatedAt = new Date(input.generatedAt ?? new Date().toISOString()).toISOString()
  const sources = input.sourceManifestDocuments.flatMap((document, index) => {
    const wrapper = asRecord(document, `source manifest document[${index}]`)
    if (wrapper.version !== 2 || !Array.isArray(wrapper.sources)) {
      throw new Error(`source manifest document[${index}] must be a V2 wrapper`)
    }
    return wrapper.sources.map((source) => sourceManifestSchema.parse(source))
  })
  const enabledSources = sources.filter((source) => (
    source.enabled
    && source.robots.mode === 'enforce'
    && (source.entityType === 'program' || source.entityType === 'program-cycle')
    && (source.extraction.mode === 'minimax' || source.extraction.mode === 'rules-then-minimax')
  ))
  const sourcesByUrl = new Map<string, typeof enabledSources>()
  for (const source of enabledSources) {
    const url = canonicalOfficialUrl(source.officialUrl)
    const matches = sourcesByUrl.get(url) ?? []
    matches.push(source)
    sourcesByUrl.set(url, matches)
  }

  const auditsByUrl = new Map<string, AuditRecord[]>()
  for (const record of audit.records) {
    const matches = auditsByUrl.get(record.officialUrl) ?? []
    matches.push(record)
    auditsByUrl.set(record.officialUrl, matches)
  }
  const requests = [] as ProgramFactPipelineHandoff['requests']
  const unmatchedOfficialUrls: string[] = []
  for (const [officialUrl, records] of auditsByUrl) {
    const matchedSources = sourcesByUrl.get(officialUrl) ?? []
    if (matchedSources.length === 0) {
      unmatchedOfficialUrls.push(officialUrl)
      continue
    }
    for (const source of matchedSources) {
      const institutionRecords = records.filter(
        (record) => record.institutionId === source.institutionId,
      )
      if (institutionRecords.length === 0) continue
      requests.push({
        sourceId: source.id,
        institutionId: source.institutionId,
        officialUrl,
        entityType: source.entityType,
        sourceCategory: source.sourceCategory,
        extractionMode: source.extraction.mode,
        programIds: [...new Set(
          institutionRecords
            .map((record) => record.programId)
            .filter((value): value is string => Boolean(value)),
        )].sort(),
        auditStatuses: [...new Set(institutionRecords.map((record) => record.status))].sort(),
      })
    }
    if (!requests.some((request) => request.officialUrl === officialUrl)) {
      unmatchedOfficialUrls.push(officialUrl)
    }
  }
  requests.sort((left, right) => left.sourceId.localeCompare(right.sourceId, 'en'))
  unmatchedOfficialUrls.sort((left, right) => left.localeCompare(right, 'en'))
  return {
    format: 'studyinchina.pipeline.program-fact-reverification',
    formatVersion: 1,
    generatedAt,
    policy: {
      exactOfficialUrlMatch: true,
      aiWritesCatalog: false,
      pipelineCandidateOnly: true,
    },
    requests,
    unmatchedOfficialUrls,
    summary: {
      auditedRecords: audit.records.length,
      auditedOfficialUrls: auditsByUrl.size,
      registeredSources: enabledSources.length,
      requests: requests.length,
      unmatchedOfficialUrls: unmatchedOfficialUrls.length,
    },
  }
}

async function readManifestDocuments(directory: string): Promise<unknown[]> {
  const documents: unknown[] = []
  const visit = async (current: string): Promise<void> => {
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile() && entry.name.endsWith('.json') && entry.name !== 'targets.v1.json') {
        documents.push(JSON.parse(await readFile(path, 'utf8')) as unknown)
      }
    }
  }
  await visit(directory)
  return documents
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function main(): Promise<void> {
  const auditPath = resolve(argument('--audit') ?? '')
  const manifestDirectory = resolve(argument('--manifest-dir') ?? 'content/source-manifests')
  const outputPath = resolve(argument('--output') ?? '.pipeline-build/program-fact-handoff.json')
  if (!argument('--audit')) throw new Error('--audit is required')
  const handoff = buildProgramFactPipelineHandoff({
    audit: JSON.parse(await readFile(auditPath, 'utf8')) as unknown,
    sourceManifestDocuments: await readManifestDocuments(manifestDirectory),
    generatedAt: argument('--generated-at'),
  })
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(handoff, null, 2)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify({ outputPath, ...handoff.summary })}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
