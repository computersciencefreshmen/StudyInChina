import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  evaluateGoldGate,
  extractionFingerprintsSchema,
  goldPredictionBundleSchema,
  loadAndValidateGoldCorpus,
  loadGoldEvaluationState,
  type ExtractionFingerprints,
  type GoldPredictionBundle,
} from './gold-gate'

function currentFingerprints(): ExtractionFingerprints | undefined {
  const values = {
    model: process.env.GOLD_MODEL_FINGERPRINT,
    prompt: process.env.GOLD_PROMPT_FINGERPRINT,
    extractor: process.env.GOLD_EXTRACTOR_FINGERPRINT,
  }
  if (!values.model && !values.prompt && !values.extractor) return undefined
  return extractionFingerprintsSchema.parse(values)
}

function predictions(): GoldPredictionBundle | undefined {
  const configuredPath = process.env.GOLD_PREDICTIONS_FILE
  if (!configuredPath) return undefined
  const absolutePath = resolve(configuredPath)
  if (!existsSync(absolutePath)) {
    throw new Error(`GOLD_PREDICTIONS_FILE does not exist: ${absolutePath}`)
  }
  return goldPredictionBundleSchema.parse(
    JSON.parse(readFileSync(absolutePath, 'utf8')),
  )
}

const result = evaluateGoldGate({
  corpus: loadAndValidateGoldCorpus(),
  state: loadGoldEvaluationState(),
  currentFingerprints: currentFingerprints(),
  predictionBundle: predictions(),
})

console.log(JSON.stringify(result, null, 2))
if (!result.passed) process.exitCode = 2
