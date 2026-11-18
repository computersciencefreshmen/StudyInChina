import { programWithdrawalReason } from '../../src/lib/program-publication-policy.mjs'

// Counts are about evidence available at capture time, never a claim of official approval.
export function profileCapturedPrograms(records) {
  const missing = { degree: 0, requirements: 0, materials: 0 }
  let captured = 0, archived = 0, withdrawn = 0, complete = 0
  for (const record of records) {
    if (record.status !== 'extracted') continue
    captured++
    if (record.archiveSha256 && record.archiveSha256 === record.evidenceHash) archived++
    if (programWithdrawalReason(record)) withdrawn++
    let hasAll = true
    for (const field of Object.keys(missing)) {
      const value = record.fields[field]?.trim()
      if (!value || /^(?:n\s*\/\s*a|unknown|not (?:provided|available|announced)|tba|requirements?|entry requirements?|application materials?)[:：]?$/iu.test(value)) {
        missing[field]++
        hasAll = false
      }
    }
    if (hasAll) complete++
  }
  return { captured, archived, withdrawn, degreeRequirementsMaterialsPresent: complete, missing }
}
