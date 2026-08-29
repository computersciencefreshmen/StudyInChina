import assert from 'node:assert/strict'
import test from 'node:test'
import { gateDualExtractions, runDualMiniMaxExtraction } from '../src/minimax'
import { MINIMAX_PROMPT_SPEC_VERSION } from '../src/provenance'
import type { ExtractionEnvelope, IngestionEnv, SourceManifestV1 } from '../src/types'
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

  const manifest: SourceManifestV1 = sourceManifest()
  manifest.extraction.fields.push(
    { path: 'requirements', type: 'object' },
    { path: 'availableLanguages', type: 'string-array' },
  )
  const result = await runDualMiniMaxExtraction(
    environment,
    manifest,
    'https://admissions.example.edu.cn/programs/computer-science',
    sourceText,
    fetcher,
  )
  assert.equal(result.status, 'dual-pass')
  assert.deepEqual(passes.sort(), ['primary', 'secondary'])
  assert.deepEqual(redirectModes, ['manual', 'manual'])
  for (const body of requestBodies) {
    assert.equal(body.response_format, undefined)
    assert.equal(body.temperature, undefined)
    assert.equal(body.reasoning_split, true)
    assert.equal(body.max_completion_tokens, 4_096)
    const messages = body.messages as Array<{ role: string; content: string }>
    assert.equal(messages.length, 2)
    assert.equal(messages[0]?.role, 'system')
    assert.match(messages[0]!.content, /exactly one JSON object/i)
    assert.match(messages[0]!.content, /no Markdown, code fence, prose, wrapper/i)
    assert.match(messages[0]!.content, /exactly schemaVersion, sourceId, and facts/i)
    assert.match(messages[0]!.content, /never emit a dotted or nested child path/i)
    assert.match(messages[0]!.content, /complete object or array value at its allowed parent path/i)
    assert.match(messages[0]!.content, /exact, verbatim evidence quote/i)

    assert.equal(messages[1]?.role, 'user')
    const prompt = JSON.parse(messages[1]!.content) as {
      promptSpecVersion: string
      responseContract: Record<string, unknown>
      exactOutputShape: Record<string, unknown>
      allowedFields: Array<{ path: string; type: string }>
    }
    assert.equal(prompt.promptSpecVersion, MINIMAX_PROMPT_SPEC_VERSION)
    assert.equal(MINIMAX_PROMPT_SPEC_VERSION, 'studyinchina-minimax-dual-v3')
    assert.deepEqual(prompt.responseContract.exactTopLevelKeys, [
      'schemaVersion',
      'sourceId',
      'facts',
    ])
    assert.match(String(prompt.responseContract.responseFormat), /exactly one JSON object/i)
    assert.match(String(prompt.responseContract.responseFormat), /Do not use Markdown, code fences/i)
    assert.match(String(prompt.responseContract.rootRule), /Do not add an output wrapper or any other top-level key/i)
    assert.match(String(prompt.responseContract.schemaVersionRule), /"program-cycle-v1"/)
    assert.match(String(prompt.responseContract.sourceIdRule), /"example-program-source"/)
    assert.match(String(prompt.responseContract.factsRule), /facts must be a JSON array/i)
    assert.match(String(prompt.responseContract.fieldPathRule), /exactly equal one ALLOWED_FIELDS\.path parent path/i)
    assert.match(String(prompt.responseContract.fieldPathRule), /Never invent dotted or nested child paths/i)
    assert.match(String(prompt.responseContract.compoundValueRule), /object or string-array/i)
    assert.match(String(prompt.responseContract.compoundValueRule), /complete object or array as value at the parent fieldPath/i)
    assert.match(String(prompt.responseContract.omissionRule), /Omit any field that is absent, ambiguous/i)
    assert.match(String(prompt.responseContract.evidenceRule), /exact verbatim substring copied from SOURCE_TEXT/i)
    assert.deepEqual(
      Object.keys(prompt.exactOutputShape),
      ['schemaVersion', 'sourceId', 'facts'],
    )
    assert.deepEqual(
      prompt.allowedFields
        .filter((field) => ['requirements', 'availableLanguages'].includes(field.path))
        .sort((left, right) => left.path.localeCompare(right.path)),
      [
        { path: 'availableLanguages', type: 'string-array' },
        { path: 'requirements', type: 'object' },
      ],
    )
  }
})

test('MiniMax adapter classifies malformed model JSON as retryable without exposing output', async () => {
  const fetcher = async () => Response.json({
    choices: [{ message: { content: '{"schemaVersion":' } }],
  })
  const environment = {
    MINIMAX_API_URL: 'https://api.minimaxi.com/v1/chat/completions',
    MINIMAX_API_KEY: 'test-only',
    MINIMAX_MODEL: 'minimax-test',
  } as IngestionEnv

  await assert.rejects(
    runDualMiniMaxExtraction(
      environment,
      sourceManifest(),
      'https://admissions.example.edu.cn/programs/computer-science',
      sourceText,
      fetcher,
    ),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'minimax_output_json_invalid')
      assert.equal((error as { retryable?: boolean }).retryable, true)
      assert.equal(String((error as Error).message).includes('schemaVersion'), false)
      return true
    },
  )
})

test('MiniMax adapter classifies request failures as retryable transport errors', async () => {
  const fetcher = async () => {
    throw new TypeError('controlled transport failure')
  }
  const environment = {
    MINIMAX_API_URL: 'https://api.minimaxi.com/v1/chat/completions',
    MINIMAX_API_KEY: 'test-only',
    MINIMAX_MODEL: 'minimax-test',
  } as IngestionEnv

  await assert.rejects(
    runDualMiniMaxExtraction(
      environment,
      sourceManifest(),
      'https://admissions.example.edu.cn/programs/computer-science',
      sourceText,
      fetcher,
    ),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'minimax_transport_error')
      assert.equal((error as { retryable?: boolean }).retryable, true)
      assert.match(String((error as Error).message), /controlled transport failure/)
      return true
    },
  )
})

test('MiniMax adapter accepts a single output wrapper before applying the same envelope gate', async () => {
  const fetcher = async () => Response.json({
    choices: [{ message: { content: JSON.stringify({ output: extraction }) } }],
  })
  const environment = {
    MINIMAX_API_URL: 'https://api.minimaxi.com/v1/chat/completions',
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
  assert.equal(result.facts.length, 2)
})
