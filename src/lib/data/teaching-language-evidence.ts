/** A language name in a catalogue heading is not a programme-level fact.
 * Accept only a single explicit assignment to this programme. Unsupported prose
 * and group policies without quoted membership remain held for review. This
 * pure check is shared by cloud extraction and the final canonical importer. */
const normalize = (text: string) => text.normalize('NFKC').replace(/\s+/gu, ' ').trim()
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
const languages: Record<string, string[]> = {
  English: ['English', '英语', '英文'], Chinese: ['Chinese', '中文', '汉语'], Russian: ['Russian', '俄语', '俄文'],
  French: ['French', '法语', '法文'], German: ['German', '德语', '德文'], Spanish: ['Spanish', '西班牙语'],
  Arabic: ['Arabic', '阿拉伯语'], Portuguese: ['Portuguese', '葡萄牙语'],
}
const degreeWords = { bachelor: /\bundergraduate|\bbachelor|本科|学士/iu, master: /\bmaster|硕士/iu,
  doctorate: /\bdoctor|\bph\.?d|博士/iu, language: /language programme|汉语进修/iu, foundation: /foundation|预科/iu }

export function teachingLanguageEvidenceIsSpecific(identity: { name: unknown; degreeLevel?: unknown }, value: unknown, quote: string): boolean {
  if (!Array.isArray(value) || !value.length || new Set(value).size !== value.length || value.some(v => typeof v !== 'string' || !languages[v])) return false
  // A cropped FAQ question is not an assertion. Require a complete declarative
  // quote, not a punctuation-free prefix which could precede a question mark in
  // the saved source. Multi-sentence retractions cannot lend their first clause.
  if (/[?？]/u.test(quote) || !/[.。]\s*$/u.test(quote)) return false
  const names = identity.name && typeof identity.name === 'object' && !Array.isArray(identity.name)
    ? Object.values(identity.name).filter((n): n is string => typeof n === 'string' && normalize(n).length >= 2).map(normalize) : []
  // Preserve sentence/row boundaries before collapsing whitespace. A separate
  // applicability quote cannot lend its programme name to a mixed-language title.
  const parts = quote.normalize('NFKC').split(/[\r\n.!;。！；]/u).map(normalize).filter(Boolean)
  if (parts.length !== 1) return false
  for (const part of parts) {
    const sentence = normalize(part)
    if (!sentence || /\b(?:not|untrue|except|unless|may|might|could|some|varies|depending)\b|并非|不是|不以|部分|除外|可能|取决/iu.test(sentence)) continue
    const degrees = Object.entries(degreeWords).filter(([, words]) => words.test(sentence)).map(([degree]) => degree)
    if (degrees.length && (!identity.degreeLevel || degrees.some(degree => degree !== identity.degreeLevel))) continue
    for (const name of names) {
      const namePattern = /\p{Script=Han}/u.test(name) ? escape(name) : `(?<![\\p{L}\\p{N}])${escape(name)}(?![\\p{L}\\p{N}])`
      // Explicit "all ... including <name>" establishes membership in the
      // quoted common policy. An unscoped "all programmes" heading does not.
      const group = new RegExp(`^All (?:undergraduate |bachelor(?:'s)? |master(?:'s)? |doctoral )?program(?:me)?s (?:listed here,? )?including ${namePattern},? (?:are|will be) (?:taught|delivered) in (.+)$`, 'iu').exec(sentence)
      const named = new RegExp(`^(?:The )?${namePattern}\\s*(?:(?:program(?:me)?|course|degree|专业|项目|课程)\\s*)?(?:[-—–|,:：]\\s*)?(?:(?:is|are|will be) (?:taught|delivered) in |(?:language|medium) of instruction\\s*[:：]\\s*|teaching language(?:s)?\\s*[:：]\\s*|授课(?:语言)?(?:为|是|[:：])\\s*)(.+)$`, 'iu').exec(sentence)
      const assignment = group?.[1] ?? named?.[1]
      if (!assignment) continue
      // The language list itself must be explicit and complete. A language
      // occurring inside the programme's name is not an instruction language.
      const aliases = Object.entries(languages).flatMap(([language, words]) => words.map(word => ({ language, word }))).sort((a, b) => b.word.length - a.word.length)
      const found = new Set<string>()
      let remaining = assignment
      for (const { language, word } of aliases) {
        const pattern = new RegExp(/\p{Script=Han}/u.test(word) ? escape(word) : `(?<![\\p{L}\\p{N}])${escape(word)}(?![\\p{L}\\p{N}])`, 'giu')
        if (pattern.test(remaining)) { found.add(language); remaining = remaining.replace(pattern, '') }
      }
      remaining = remaining.replace(/\band\b|\bboth\b|\bonly\b|以及|和|及|授课|教学|[\s,/&、，()（）]/giu, '')
      if (!remaining && found.size === value.length && value.every(language => found.has(language))) return true
    }
  }
  return false
}
