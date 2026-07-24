import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { isAbsolute, resolve, sep } from 'node:path'
import { z } from 'zod'

export const SYNTHETIC_CASE_KINDS = [
  'static_html',
  'pdf_converted',
  'dynamic_rendered',
  'scanned',
  'conflict',
  'http_404',
  'prompt_injection',
] as const

const SIGNALS = [
  'static_html_detected',
  'pdf_converted_text_detected',
  'browser_render_detected',
  'ocr_low_confidence',
  'conflict_detected',
  'http_404',
  'prompt_injection_detected',
] as const

const fixtureSchema = z
  .object({
    fixtureId: z.string().min(1).max(120),
    caseKind: z.enum(SYNTHETIC_CASE_KINDS),
    inputPath: z
      .string()
      .min(1)
      .refine((value) => !isAbsolute(value), 'inputPath must be repository-relative')
      .refine(
        (value) => !value.replaceAll('\\', '/').split('/').includes('..'),
        'inputPath must not traverse outside the repository',
      ),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    officialGoldEligible: z.literal(false),
    expected: z
      .object({
        disposition: z.enum(['process', 'manual_review', 'quarantine', 'unavailable']),
        signals: z.array(z.enum(SIGNALS)).min(1),
      })
      .strict(),
  })
  .strict()

export const syntheticFixtureRegistrySchema = z
  .object({
    version: z.literal(1),
    datasetKind: z.literal('synthetic_regression_registry'),
    officialGoldContribution: z.literal(0),
    fixtures: z.array(fixtureSchema).length(SYNTHETIC_CASE_KINDS.length),
  })
  .strict()

export type SyntheticFixtureRegistry = z.infer<
  typeof syntheticFixtureRegistrySchema
>

export type SyntheticFixtureResult = {
  fixtureId: string
  caseKind: (typeof SYNTHETIC_CASE_KINDS)[number]
  disposition: 'process' | 'manual_review' | 'quarantine' | 'unavailable'
  signals: (typeof SIGNALS)[number][]
}

function digest(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right))
}

function inspectFixture(
  fixture: SyntheticFixtureRegistry['fixtures'][number],
  bytes: Buffer,
): SyntheticFixtureResult {
  const text = bytes.toString('utf8')
  switch (fixture.caseKind) {
    case 'static_html':
      if (!/<html\b/i.test(text) || !/data-program-code=/i.test(text)) {
        throw new Error(`${fixture.fixtureId}: static HTML markers are missing`)
      }
      return {
        fixtureId: fixture.fixtureId,
        caseKind: fixture.caseKind,
        disposition: 'process',
        signals: ['static_html_detected'],
      }
    case 'pdf_converted':
      if (!text.includes('[PDF_CONVERTED_TEXT]')) {
        throw new Error(`${fixture.fixtureId}: converted PDF marker is missing`)
      }
      return {
        fixtureId: fixture.fixtureId,
        caseKind: fixture.caseKind,
        disposition: 'process',
        signals: ['pdf_converted_text_detected'],
      }
    case 'dynamic_rendered':
      if (!/<meta\s+name="capture-mode"\s+content="browser-rendered"/i.test(text)) {
        throw new Error(`${fixture.fixtureId}: browser-render marker is missing`)
      }
      return {
        fixtureId: fixture.fixtureId,
        caseKind: fixture.caseKind,
        disposition: 'process',
        signals: ['browser_render_detected'],
      }
    case 'scanned': {
      const confidence = text.match(/\[OCR_CONFIDENCE=(0(?:\.\d+)?|1(?:\.0+)?)\]/)?.[1]
      if (confidence === undefined || Number(confidence) >= 0.8) {
        throw new Error(`${fixture.fixtureId}: expected OCR confidence below 0.8`)
      }
      return {
        fixtureId: fixture.fixtureId,
        caseKind: fixture.caseKind,
        disposition: 'manual_review',
        signals: ['ocr_low_confidence'],
      }
    }
    case 'conflict': {
      const value = z
        .object({ primary: z.unknown(), secondary: z.unknown() })
        .strict()
        .parse(JSON.parse(text))
      if (JSON.stringify(value.primary) === JSON.stringify(value.secondary)) {
        throw new Error(`${fixture.fixtureId}: conflict sides unexpectedly agree`)
      }
      return {
        fixtureId: fixture.fixtureId,
        caseKind: fixture.caseKind,
        disposition: 'quarantine',
        signals: ['conflict_detected'],
      }
    }
    case 'http_404': {
      const value = z
        .object({ status: z.literal(404), url: z.url() })
        .strict()
        .parse(JSON.parse(text))
      void value
      return {
        fixtureId: fixture.fixtureId,
        caseKind: fixture.caseKind,
        disposition: 'unavailable',
        signals: ['http_404'],
      }
    }
    case 'prompt_injection':
      if (!/ignore\s+(?:all\s+)?(?:previous|prior)\s+instructions/i.test(text)) {
        throw new Error(`${fixture.fixtureId}: prompt-injection marker is missing`)
      }
      return {
        fixtureId: fixture.fixtureId,
        caseKind: fixture.caseKind,
        disposition: 'quarantine',
        signals: ['prompt_injection_detected'],
      }
  }
}

function fixturePath(projectRoot: string, inputPath: string): string {
  const normalized = inputPath.replaceAll('\\', '/')
  const requiredPrefix = 'quality/regression/fixtures/'
  if (!normalized.startsWith(requiredPrefix)) {
    throw new Error(`${inputPath}: fixture must be under ${requiredPrefix}`)
  }
  const absolute = resolve(projectRoot, ...normalized.split('/'))
  const root = `${resolve(projectRoot, 'quality', 'regression', 'fixtures')}${sep}`
  if (!absolute.startsWith(root)) {
    throw new Error(`${inputPath}: fixture resolves outside the fixture directory`)
  }
  return absolute
}

export function loadSyntheticFixtureRegistry(
  projectRoot = process.cwd(),
): SyntheticFixtureRegistry {
  return syntheticFixtureRegistrySchema.parse(
    JSON.parse(
      readFileSync(
        resolve(projectRoot, 'quality', 'regression', 'registry.json'),
        'utf8',
      ),
    ),
  )
}

export function runSyntheticRegression(
  registry: SyntheticFixtureRegistry,
  projectRoot = process.cwd(),
): SyntheticFixtureResult[] {
  const ids = registry.fixtures.map((fixture) => fixture.fixtureId)
  if (new Set(ids).size !== ids.length) {
    throw new Error('Synthetic fixture IDs must be unique')
  }
  const kinds = registry.fixtures.map((fixture) => fixture.caseKind)
  if (new Set(kinds).size !== SYNTHETIC_CASE_KINDS.length) {
    throw new Error('Synthetic registry must contain each required case kind exactly once')
  }

  return registry.fixtures.map((fixture) => {
    if (fixture.officialGoldEligible !== false) {
      throw new Error(`${fixture.fixtureId}: synthetic fixture cannot be official gold`)
    }
    const bytes = readFileSync(fixturePath(projectRoot, fixture.inputPath))
    if (digest(bytes) !== fixture.sha256) {
      throw new Error(`${fixture.fixtureId}: fixture checksum mismatch`)
    }
    const result = inspectFixture(fixture, bytes)
    if (result.disposition !== fixture.expected.disposition) {
      throw new Error(`${fixture.fixtureId}: disposition regression`)
    }
    if (
      JSON.stringify(sorted(result.signals)) !==
      JSON.stringify(sorted(fixture.expected.signals))
    ) {
      throw new Error(`${fixture.fixtureId}: signal regression`)
    }
    return result
  })
}
