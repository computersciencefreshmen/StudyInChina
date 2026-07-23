import assert from 'node:assert/strict'
import test from 'node:test'
import { gateDualExtractions, runDualMiniMaxExtraction } from '../src/minimax'
import type { ExtractionEnvelope, IngestionEnv } from '../src/types'
import { sourceManifest } from './fixtures'

const sourceText = 'Applications close on 2026-09-01. Tuition is 30000 CNY per academic year.'
const extraction: ExtractionEnvelope = {
  schemaVersion: 'program-cycle-v1',
  sourceId: 'example-program-source',
  facts: [
    {
      fieldPath: 'deadline',
      value: '2026-09-01',
      evidence: { quote: 'Applications close on 2026-09-01.' },
    },
    {
      fieldPath: 'tuitionCny',
      value: 30_000,
      evidence: { quote: 'Tuition is 30000 CNY per academic year.' },
    },
  ],
}

test('dual extraction passes only when values agree and evidence is grounded', () => {
  const manifest = sourceManifest()
  const accepted = gateDualExtractions(extraction, structuredClone(extraction), manifest, sourceText)
  assert.equal(accepted.status, 'dual-pass')
  assert.equal(accepted.facts.length, 2)

  const conflicting = structuredClone(extraction)
  conflicting.facts[1]!.value = 32_000
  const rejected = gateDualExtractions(extraction, conflicting, manifest, sourceText)
  assert.equal(rejected.status, 'quarantined')
  assert.ok(rejected.issues.length > 0)
  assert.equal(rejected.facts.some((fact) => fact.fieldPath === 'tuitionCny'), false)

  const ungrounded = structuredClone(extraction)
  ungrounded.facts[0]!.evidence.quote = 'Deadline supplied by an aggregator.'
  assert.equal(
    gateDualExtractions(extraction, ungrounded, manifest, sourceText).status,
    'quarantined',
  )

  const unsupportedValue = structuredClone(extraction)
  unsupportedValue.facts[1]!.value = 31_000
  unsupportedValue.facts[1]!.evidence.quote = 'Tuition is 30000 CNY per academic year.'
  assert.equal(
    gateDualExtractions(unsupportedValue, structuredClone(unsupportedValue), manifest, sourceText).status,
    'quarantined',
  )
})

test('MiniMax adapter performs two independent passes through a configurable endpoint', async () => {
  const passes: string[] = []
  const redirectModes: Array<RequestRedirect | undefined> = []
  const requestBodies: Array<Record<string, unknown>> = []
  const fetcher = async (_input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    passes.push(headers.get('x-ingestion-extraction-pass') ?? '')
    redirectModes.push(init?.redirect)
    requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
    return Response.json({
      choices: [{ message: { content: `<think>internal reasoning</think>\n${JSON.stringify(extraction)}` } }],
    })
  }
  const environment = {
    MINIMAX_API_URL: 'https://api.minimax.io/v1/chat/completions',
    MINIMAX_API_KEY: 'test-only',
    MINIMAX_MODEL: 'minimax-test',
  } as IngestionEnv

  const result = await runDualMiniMaxExtraction(
    environment,
    sourceManifest(),
    'https://admissions.example.edu.cn/programs/computer-science',
    sourceText,
    fetcher,
  )
  assert.equal(result.status, 'dual-pass')
  assert.deepEqual(passes.sort(), ['primary', 'secondary'])
  assert.deepEqual(redirectModes, ['error', 'error'])
  for (const body of requestBodies) {
    assert.equal(body.response_format, undefined)
    assert.equal(body.temperature, undefined)
    assert.equal(body.reasoning_split, true)
    assert.equal(body.max_completion_tokens, 4_096)
  }
})
