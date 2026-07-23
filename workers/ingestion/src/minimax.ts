import { IngestionError } from './errors'
import { readBoundedBody } from './body'
import { stableJson } from './hash'
import { boundedInteger } from './retry'
import { MINIMAX_SYSTEM_INSTRUCTIONS } from './provenance'
import { criticalEvidenceIssue, isFieldValueValid, normalizeEvidenceText } from './rules'
import { isForbiddenHostname } from './security'
import type {
  ExtractionEnvelope,
  ExtractionFact,
  Fetcher,
  IngestionEnv,
  SourceManifestV1,
} from './types'

export type DualExtractionGate = {
  status: 'dual-pass' | 'quarantined'
  facts: ExtractionFact[]
  issues: string[]
  primary: ExtractionEnvelope
  secondary: ExtractionEnvelope
}

const MINIMAX_API_HOSTS = new Set(['api.minimax.io', 'api.minimaxi.com'])

function stripCodeFence(value: string): string {
  const trimmed = value
    .trim()
    .replace(/^<think>[\s\S]*?<\/think>\s*/i, '')
    .trim()
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)
  return match?.[1] ?? trimmed
}

function decodeResponsePayload(payload: unknown): string {
  if (!payload || typeof payload !== 'object') throw new Error('MiniMax response is not an object')
  const record = payload as Record<string, unknown>
  if (typeof record.output_text === 'string') return record.output_text
  const choices = record.choices
  if (!Array.isArray(choices) || choices.length === 0) throw new Error('MiniMax response has no choices')
  const first = choices[0]
  if (!first || typeof first !== 'object') throw new Error('MiniMax choice is invalid')
  const message = (first as Record<string, unknown>).message
  if (!message || typeof message !== 'object') throw new Error('MiniMax choice has no message')
  const content = (message as Record<string, unknown>).content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!part || typeof part !== 'object') return ''
        const item = part as Record<string, unknown>
        return typeof item.text === 'string' ? item.text : ''
      })
      .join('')
  }
  throw new Error('MiniMax message content is invalid')
}

function isExtractionFact(value: unknown): value is ExtractionFact {
  if (!value || typeof value !== 'object') return false
  const fact = value as Record<string, unknown>
  if (typeof fact.fieldPath !== 'string') return false
  if (!fact.evidence || typeof fact.evidence !== 'object') return false
  const evidence = fact.evidence as Record<string, unknown>
  return (
    typeof evidence.quote === 'string' &&
    (evidence.locator === undefined || typeof evidence.locator === 'string') &&
    Object.hasOwn(fact, 'value')
  )
}

function parseEnvelope(value: string): ExtractionEnvelope {
  const parsed = JSON.parse(stripCodeFence(value)) as unknown
  if (!parsed || typeof parsed !== 'object') throw new Error('Extraction result is not an object')
  const record = parsed as Record<string, unknown>
  if (
    typeof record.schemaVersion !== 'string' ||
    typeof record.sourceId !== 'string' ||
    !Array.isArray(record.facts) ||
    !record.facts.every(isExtractionFact)
  ) {
    throw new Error('Extraction result does not match the required envelope')
  }
  return {
    schemaVersion: record.schemaVersion,
    sourceId: record.sourceId,
    facts: record.facts,
  }
}

function promptFor(
  pass: 'primary' | 'secondary',
  manifest: SourceManifestV1,
  sourceUrl: string,
  sourceText: string,
): Array<{ role: 'system' | 'user'; content: string }> {
  const fields = pass === 'primary'
    ? manifest.extraction.fields
    : [...manifest.extraction.fields].reverse()
  return [
    {
      role: 'system',
      content: MINIMAX_SYSTEM_INSTRUCTIONS.join(' '),
    },
    {
      role: 'user',
      content: JSON.stringify({
        task: `independent-${pass}-extraction`,
        output: {
          schemaVersion: manifest.extraction.schemaVersion,
          sourceId: manifest.id,
          facts: [
            {
              fieldPath: 'one of ALLOWED_FIELDS.path',
              value: 'must match ALLOWED_FIELDS.type',
              evidence: { quote: 'verbatim SOURCE_TEXT quote', locator: 'optional locator' },
            },
          ],
        },
        sourceId: manifest.id,
        sourceUrl,
        allowedFields: fields,
        sourceText,
      }),
    },
  ]
}

async function callMiniMax(
  pass: 'primary' | 'secondary',
  environment: IngestionEnv,
  manifest: SourceManifestV1,
  sourceUrl: string,
  sourceText: string,
  fetcher: Fetcher,
): Promise<ExtractionEnvelope> {
  const apiUrl = environment.MINIMAX_API_URL
  const apiKey = environment.MINIMAX_API_KEY
  const model = environment.MINIMAX_MODEL ?? manifest.extraction.minimaxModel
  if (!apiUrl || !apiKey || !model) {
    throw new IngestionError('MiniMax extraction is not configured', 'minimax_not_configured', false)
  }

  const endpoint = new URL(apiUrl)
  if (
    endpoint.protocol !== 'https:' ||
    endpoint.username ||
    endpoint.password ||
    (endpoint.port && endpoint.port !== '443') ||
    isForbiddenHostname(endpoint.hostname) ||
    !MINIMAX_API_HOSTS.has(endpoint.hostname.toLowerCase()) ||
    endpoint.pathname !== '/v1/chat/completions'
  ) {
    throw new IngestionError(
      'MiniMax API URL must be the official credential-free chat-completions endpoint',
      'minimax_url_invalid',
      false,
    )
  }
  const timeoutMs = boundedInteger(environment.MINIMAX_TIMEOUT_MS, 30_000, 5_000, 60_000)
  const maximumOutputTokens = boundedInteger(
    environment.MINIMAX_MAX_OUTPUT_TOKENS,
    4_096,
    256,
    8_192,
  )
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetcher(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-Ingestion-Extraction-Pass': pass,
      },
      body: JSON.stringify({
        model,
        // M2.7 does not support OpenAI response_format. Keep JSON enforcement in
        // the prompt and validate the decoded envelope locally instead.
        max_completion_tokens: maximumOutputTokens,
        reasoning_split: true,
        messages: promptFor(pass, manifest, sourceUrl, sourceText),
      }),
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new IngestionError(
        `MiniMax ${pass} extraction returned HTTP ${response.status}`,
        `minimax_http_${response.status}`,
        response.status === 408 || response.status === 429 || response.status >= 500,
      )
    }
    const responseBytes = await readBoundedBody(response, 1024 * 1024, controller.signal)
    const payload = JSON.parse(new TextDecoder().decode(responseBytes)) as unknown
    return parseEnvelope(decodeResponsePayload(payload))
  } catch (error) {
    if (error instanceof IngestionError) throw error
    const timedOut = error instanceof Error && error.name === 'AbortError'
    throw new IngestionError(
      timedOut ? `MiniMax ${pass} extraction timed out` : `MiniMax ${pass} extraction failed`,
      timedOut ? 'minimax_timeout' : 'minimax_invalid_response',
      timedOut,
    )
  } finally {
    clearTimeout(timeout)
  }
}

function validateEnvelope(
  envelope: ExtractionEnvelope,
  manifest: SourceManifestV1,
  sourceText: string,
  label: string,
): { facts: Map<string, ExtractionFact>; issues: string[] } {
  const issues: string[] = []
  const facts = new Map<string, ExtractionFact>()
  const fields = new Map(manifest.extraction.fields.map((field) => [field.path, field]))
  const normalizedSource = normalizeEvidenceText(sourceText)
  if (envelope.sourceId !== manifest.id) issues.push(`${label}: sourceId mismatch`)
  if (envelope.schemaVersion !== manifest.extraction.schemaVersion) {
    issues.push(`${label}: schemaVersion mismatch`)
  }

  for (const fact of envelope.facts) {
    const field = fields.get(fact.fieldPath)
    if (!field) {
      issues.push(`${label}: field is not allowlisted: ${fact.fieldPath}`)
      continue
    }
    if (facts.has(fact.fieldPath)) {
      issues.push(`${label}: duplicate field: ${fact.fieldPath}`)
      continue
    }
    if (!isFieldValueValid(field, fact.value)) {
      issues.push(`${label}: invalid ${field.type} value for ${fact.fieldPath}`)
      continue
    }
    const quote = normalizeEvidenceText(fact.evidence.quote)
    if (quote.length < 2 || quote.length > 1_000 || !normalizedSource.includes(quote)) {
      issues.push(`${label}: evidence is not grounded for ${fact.fieldPath}`)
      continue
    }
    const criticalIssue = criticalEvidenceIssue(field, fact.value, quote, manifest)
    if (criticalIssue) {
      issues.push(`${label}: ${criticalIssue} for ${fact.fieldPath}`)
      continue
    }
    facts.set(fact.fieldPath, {
      ...fact,
      evidence: { ...fact.evidence, quote },
    })
  }
  for (const field of manifest.extraction.fields) {
    if (field.required && !facts.has(field.path)) {
      issues.push(`${label}: missing required field: ${field.path}`)
    }
  }
  return { facts, issues }
}

export function gateDualExtractions(
  primary: ExtractionEnvelope,
  secondary: ExtractionEnvelope,
  manifest: SourceManifestV1,
  sourceText: string,
): DualExtractionGate {
  const first = validateEnvelope(primary, manifest, sourceText, 'primary')
  const second = validateEnvelope(secondary, manifest, sourceText, 'secondary')
  const issues = [...first.issues, ...second.issues]
  const fieldPaths = new Set([...first.facts.keys(), ...second.facts.keys()])
  const accepted: ExtractionFact[] = []

  for (const fieldPath of [...fieldPaths].sort()) {
    const left = first.facts.get(fieldPath)
    const right = second.facts.get(fieldPath)
    if (!left || !right) {
      issues.push(`dual: extraction coverage differs for ${fieldPath}`)
      continue
    }
    if (stableJson(left.value) !== stableJson(right.value)) {
      issues.push(`dual: extraction values disagree for ${fieldPath}`)
      continue
    }
    accepted.push({
      ...left,
      evidence: {
        quote: left.evidence.quote,
        locator: [left.evidence.locator, right.evidence.locator].filter(Boolean).join(' | ') || undefined,
      },
    })
  }

  if (issues.length > 0 || accepted.length === 0) {
    return { status: 'quarantined', facts: accepted, issues, primary, secondary }
  }
  return { status: 'dual-pass', facts: accepted, issues: [], primary, secondary }
}

export async function runDualMiniMaxExtraction(
  environment: IngestionEnv,
  manifest: SourceManifestV1,
  sourceUrl: string,
  sourceText: string,
  fetcher: Fetcher = fetch,
): Promise<DualExtractionGate> {
  const maximumInput = boundedInteger(
    environment.MINIMAX_MAX_INPUT_CHARS,
    60_000,
    5_000,
    200_000,
  )
  const boundedText = sourceText.slice(0, maximumInput)
  const [primary, secondary] = await Promise.all([
    callMiniMax('primary', environment, manifest, sourceUrl, boundedText, fetcher),
    callMiniMax('secondary', environment, manifest, sourceUrl, boundedText, fetcher),
  ])
  return gateDualExtractions(primary, secondary, manifest, boundedText)
}
