import { loadAndValidateGoldCorpus } from './gold-gate'

const corpus = loadAndValidateGoldCorpus()
const readiness =
  corpus.annotatedSnapshotCount >= corpus.registry.minimumAnnotatedSnapshots
    ? 'ready_for_evaluation'
    : 'not_ready'

console.log(
  [
    `Validated ${corpus.registry.entries.length} official registry entries.`,
    `Captured official snapshots: ${corpus.capturedSnapshotCount}/${corpus.registry.expectedSourceCount}.`,
    `Annotated official snapshots: ${corpus.annotatedSnapshotCount}/${corpus.registry.minimumAnnotatedSnapshots}.`,
    `Gold gate status: ${readiness}.`,
  ].join(' '),
)
