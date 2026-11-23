import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { programTranslationSource, protectTranslationText, restoreTranslationText, sourceIsTargetLanguage, translationKey, translationPath,
  validateTranslationRecord, type ProgramTranslationLocale, type ProgramTranslationRecord } from '@/lib/program-translation-contract'

const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const source = 'Applicants must be at least 18 years old. IELTS 6.0 is required unless exempt. Please submit a personal statement.'
function fixture(text: string, original = source, locale: ProgramTranslationLocale = 'zh'): ProgramTranslationRecord {
  return { schemaVersion: 1, version: 'v1', key: translationKey(original, locale), sourceHash: hash(original), targetLocale: locale,
    text, method: 'minimax', model: 'MiniMax-M3', translatedAt: '2026-11-17T06:00:00.000Z', validation: 'passed' }
}

describe('content-addressed programme translations and protected admissions facts', () => {
  it('binds every immutable path to exact original wording, locale and translation version', () => {
    expect(translationPath(source, 'zh')).toBe(`translations/v1/zh/${translationKey(source, 'zh')}.json`)
    expect(translationKey(source, 'zh')).not.toBe(translationKey(source + ' ', 'zh'))
    expect(translationKey(source, 'zh')).not.toBe(translationKey(source, 'en'))
    expect(() => translationKey(source, '../private' as ProgramTranslationLocale)).toThrow('translation_locale_invalid')
    expect(() => translationKey('', 'zh')).toThrow('translation_source_invalid')
  })

  it('skips standalone placeholders and retains actual admissions wording', () => {
    for (const value of ['Updating...', ' Updating… ', '更新中。', 'To be updated']) {
      expect(programTranslationSource({ fields: { requirements: value } }, 'requirements', 'en')).toBeUndefined()
    }
    expect(programTranslationSource({ fields: { requirements: 'No age limit.' } }, 'requirements', 'en')).toBe('No age limit.')
    expect(programTranslationSource({ fields: { requirements: 'Requirements are updating. IELTS 6 is required.' } }, 'requirements', 'en')).toBe('Requirements are updating. IELTS 6 is required.')
  })

  it('translates real admissions prose while preserving atomic ages, scores and their bound qualifiers', () => {
    const protection = protectTranslationText(source)
    expect(protection.spans).toEqual(['must', 'at least 18 years old', 'IELTS 6.0', 'required', 'unless', 'exempt'])
    expect(protection.text).toContain('Applicants ')
    expect(protection.text).toContain('Please submit a personal statement.')
    const masked = '申请人__SC_000000__达到__SC_000001__；__SC_000002__为__SC_000003__要求，__SC_000004__符合__SC_000005__情形。请提交一份个人陈述。'
    const restored = restoreTranslationText(masked, protection)
    expect(restored).toBe('申请人must达到at least 18 years old；IELTS 6.0为required要求，unless符合exempt情形。请提交一份个人陈述。')
    expect(validateTranslationRecord(fixture(restored), source, 'zh')).toEqual(fixture(restored))
  })

  it('protects fees, duration, dates, Chinese limitations and official links without changing a byte', () => {
    const original = '学制为４年；费用人民币20,000元；截至2027年6月1日；年龄不得超过三十岁；Submit via https://school.edu/apply. 请提交个人陈述。'
    const protection = protectTranslationText(original)
    expect(protection.spans).toEqual(expect.arrayContaining(['４年', '人民币20,000元', '2027年6月1日', '不得超过三十岁', 'https://school.edu/apply.']))
    const translated = restoreTranslationText(protection.text.replace(' 请提交个人陈述。', ' Please submit a personal statement.'), protection)
    for (const span of protection.spans) expect(translated).toContain(span)
    expect(translated).toContain('Please submit a personal statement.')
  })

  it('preserves language waivers and teaching-language conditions even without a numeric test score', () => {
    const original = 'Native English speakers are exempt. 中文授课的申请人无需提交英语证明。Please submit a personal statement.'
    const protection = protectTranslationText(original)
    expect(protection.spans).toEqual(['Native English speakers', 'exempt', '中文', '无需', '英语'])
    expect(validateTranslationRecord(fixture(original.replace('exempt', 'ineligible'), original), original, 'zh')).toBeNull()
    expect(validateTranslationRecord(fixture(original.replace('无需', '必须'), original), original, 'zh')).toBeNull()
  })

  it('protects Chinese duration and fee amounts written as words rather than Arabic digits', () => {
    const original = '课程为期四年。费用为五万元。请提交一份个人陈述。'
    const protection = protectTranslationText(original)
    expect(protection.spans).toEqual(['四年', '五万元'])
    expect(validateTranslationRecord(fixture(original.replace('四年', '三年'), original), original, 'en')).toBeNull()
    const english = 'Programme length: 四年. Fee: 五万元. Please submit a personal statement.'
    expect(validateTranslationRecord(fixture(english, original, 'en'), original, 'en')).not.toBeNull()
  })

  it('rejects missing, duplicated, unknown and altered model placeholders', () => {
    const protection = protectTranslationText(source)
    expect(() => restoreTranslationText(protection.text.replace('__SC_000000__', ''), protection)).toThrow('translation_placeholder_mismatch')
    expect(() => restoreTranslationText(protection.text + '__SC_000000__', protection)).toThrow('translation_placeholder_mismatch')
    expect(() => restoreTranslationText(protection.text + '__SC_000099__', protection)).toThrow('translation_added_critical_content')
    expect(() => restoreTranslationText(protection.text.replace('__SC_000000__', '__SC_００００００__'), protection)).toThrow('translation_placeholder_mismatch')
  })

  it('rejects changed scores, changed comparator meaning and invented dates or links even when marked passed', () => {
    expect(validateTranslationRecord(fixture(source.replace('6.0', '5.0')), source, 'zh')).toBeNull()
    expect(validateTranslationRecord(fixture(source.replace('at least', 'at most')), source, 'zh')).toBeNull()
    expect(validateTranslationRecord(fixture(source + ' Deadline 2028-01-01.'), source, 'zh')).toBeNull()
    expect(validateTranslationRecord(fixture(source + ' Apply https://evil.example/.'), source, 'zh')).toBeNull()
    expect(validateTranslationRecord(fixture(source + ' IELTS exempt.'), source, 'zh')).toBeNull()
  })

  it('binds exam identity and score when a source omits the space before the score', () => {
    const original = '达到HSK4级，并提供TOEFL80成绩。请提交个人陈述。'
    const protection = protectTranslationText(original)
    expect(protection.spans).toContain('HSK4')
    expect(protection.spans).toContain('TOEFL80')
    expect(validateTranslationRecord(fixture(original.replace('HSK4', 'HSKK4'), original), original, 'zh')).toBeNull()
    expect(validateTranslationRecord(fixture(original.replace('TOEFL80', 'IELTS80'), original), original, 'zh')).toBeNull()
  })

  it('supports repeated identical protected clauses while rejecting an extra copy', () => {
    const original = 'HSK 4. HSK 4. Please send a statement.'
    const protection = protectTranslationText(original)
    const translated = restoreTranslationText(protection.text.replace('Please send a statement.', '请提交一份陈述。'), protection)
    expect(translated.match(/HSK 4\./g)).toHaveLength(2)
    expect(validateTranslationRecord(fixture(translated, original), original, 'zh')).not.toBeNull()
    expect(validateTranslationRecord(fixture(translated + ' HSK 4.', original), original, 'zh')).toBeNull()
  })

  it('rejects stale source bindings, target-language mismatch, explicit truncation and empty outputs', () => {
    const record = fixture(source)
    expect(validateTranslationRecord(record, source + ' Changed.', 'zh')).toBeNull()
    expect(validateTranslationRecord(record, source, 'en')).toBeNull()
    expect(validateTranslationRecord({ ...record, text: '' }, source, 'zh')).toBeNull()
    expect(validateTranslationRecord({ ...record, text: source + ' [truncated]' }, source, 'zh')).toBeNull()
    expect(validateTranslationRecord({ ...record, model: 'external-provider' }, source, 'zh')).toBeNull()
    const long = 'Please send a thoughtful personal statement explaining your motivation for studying this subject and your future plans.'
    expect(validateTranslationRecord(fixture('好', long), long, 'zh')).toBeNull()
  })

  it('rejects unchanged English or a tiny Chinese prefix falsely reported as a Chinese translation', () => {
    const original = 'Applicants should submit the application documents with a personal statement explaining their motivation and future plans.'
    expect(validateTranslationRecord(fixture(original, original), original, 'zh')).toBeNull()
    expect(validateTranslationRecord(fixture('译文：' + original, original), original, 'zh')).toBeNull()
    expect(validateTranslationRecord(fixture(original, original, 'ru'), original, 'ru')).toBeNull()
    const translated = '申请人应提交申请材料及个人陈述，说明申请动机与未来规划。'
    expect(validateTranslationRecord(fixture(translated, original), original, 'zh')).not.toBeNull()
  })

  it('permits source reuse only as exact retained text with no model and sanitizes unknown properties', () => {
    const record = { ...fixture(source), method: 'source', model: null, privateProviderPayload: 'never expose' }
    const validated = validateTranslationRecord(record, source, 'zh')
    expect(validated?.method).toBe('source')
    expect(validated).not.toHaveProperty('privateProviderPayload')
    expect(validateTranslationRecord({ ...record, text: source + ' Extra.' }, source, 'zh')).toBeNull()
    expect(validateTranslationRecord({ ...record, model: 'MiniMax-M3' }, source, 'zh')).toBeNull()
  })

  it('conservatively reuses confident Chinese/English originals without treating other Latin scripts as English', () => {
    expect(sourceIsTargetLanguage('Students must provide the application documents and a personal statement.', 'en')).toBe(true)
    expect(sourceIsTargetLanguage('申请人请提交成绩单和个人陈述。', 'zh')).toBe(true)
    expect(sourceIsTargetLanguage('Les candidats doivent fournir une lettre de motivation.', 'en')).toBe(false)
    expect(sourceIsTargetLanguage('Bewerber müssen ihre Unterlagen einreichen.', 'en')).toBe(false)
    expect(sourceIsTargetLanguage('申请人请提交成绩单和个人陈述。', 'en')).toBe(false)
    expect(sourceIsTargetLanguage('Applicants must send the application documents.', 'fr')).toBe(false)
    expect(sourceIsTargetLanguage('Finance', 'en')).toBe(false)
  })
})
