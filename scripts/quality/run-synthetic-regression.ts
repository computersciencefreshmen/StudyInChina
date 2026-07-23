import {
  loadSyntheticFixtureRegistry,
  runSyntheticRegression,
} from './synthetic-regression'

const registry = loadSyntheticFixtureRegistry()
const results = runSyntheticRegression(registry)

console.log(
  `Passed ${results.length} isolated synthetic regressions; official gold contribution remains ${registry.officialGoldContribution}.`,
)
