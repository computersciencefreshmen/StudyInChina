import { LocalizationError } from './errors'

export type ProtectedText = {
  text: string
  tokens: Array<{ placeholder: string; value: string }>
}

// Order matters: URLs/emails and structured money/date fragments are captured
// before the broad digit-bearing token fallback.
const PROTECTED_FRAGMENT = new RegExp([
  String.raw`https?:\/\/[^\s<>"']+`,
  String.raw`[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}`,
  String.raw`(?:CNY|RMB|USD|EUR|GBP|JPY|CAD|AUD|HKD|¥|￥|\$|€|£)\s*[\d][\d,.]*(?:\s*(?:-|–|—|to)\s*(?:CNY|RMB|USD|EUR|GBP|JPY|CAD|AUD|HKD|¥|￥|\$|€|£)?\s*[\d][\d,.]*)?`,
  String.raw`[\d][\d,.]*\s*(?:CNY|RMB|USD|EUR|GBP|JPY|CAD|AUD|HKD|元|万元|人民币|美元|欧元|英镑)`,
  String.raw`\d{4}[-/.年]\d{1,2}(?:[-/.月]\d{1,2}日?)?`,
  String.raw`\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b`,
  String.raw`\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?(?:,\s*\d{4})?\b`,
  String.raw`\b\d+(?:[.,]\d+)*(?:\s*[+:/-]\s*\d+(?:[.,]\d+)*)*(?:%|％)?\b`,
].map((value) => `(?:${value})`).join('|'), 'giu')

const PLACEHOLDER = /__SIC_PROTECTED_[0-9]{4}__/g

export function protectStructuredFacts(sourceText: string): ProtectedText {
  const tokens: ProtectedText['tokens'] = []
  const text = sourceText.replace(PROTECTED_FRAGMENT, (value) => {
    const placeholder = `__SIC_PROTECTED_${String(tokens.length).padStart(4, '0')}__`
    tokens.push({ placeholder, value })
    return placeholder
  })
  return { text, tokens }
}

export function restoreStructuredFacts(
  translatedText: string,
  protectedText: ProtectedText,
): string {
  const occurrences: string[] = translatedText.match(PLACEHOLDER) ?? []
  const expected = protectedText.tokens.map((token) => token.placeholder)
  if (
    occurrences.length !== expected.length
    || new Set(occurrences).size !== expected.length
    || expected.some((placeholder) => !occurrences.includes(placeholder))
  ) {
    throw new LocalizationError(
      'Translation changed, removed, or duplicated a protected date/amount token',
      'translation_protected_token_mismatch',
      true,
    )
  }
  const known = new Set(expected)
  if (occurrences.some((placeholder) => !known.has(placeholder))) {
    throw new LocalizationError(
      'Translation introduced an unknown protected token',
      'translation_protected_token_mismatch',
      true,
    )
  }
  let restored = translatedText
  for (const token of protectedText.tokens) {
    restored = restored.replace(token.placeholder, token.value)
  }
  if (PLACEHOLDER.test(restored)) {
    throw new LocalizationError(
      'Translation contains an unresolved protected token',
      'translation_protected_token_mismatch',
      true,
    )
  }
  return restored.trim()
}

