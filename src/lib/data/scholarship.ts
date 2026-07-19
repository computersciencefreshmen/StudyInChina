import type { LaunchLocale } from '@/i18n/config'
import type { Scholarship } from './types'

const pick = (locale: LaunchLocale, en: string, zh: string, ru: string) => locale === 'zh' ? zh : locale === 'ru' ? ru : en

export function providerLabel(value: Scholarship['providerType'], locale: LaunchLocale) {
  const values: Record<Scholarship['providerType'], [string, string, string]> = {
    csc: ['Chinese Government', '中国政府', 'Правительство Китая'], university: ['University', '高校', 'Университет'], province: ['Province', '省级', 'Провинция'], city: ['City', '市级', 'Город'], other: ['Other', '其他', 'Другое'],
  }
  const [en, zh, ru] = values[value]
  return pick(locale, en, zh, ru)
}

export function coverageLabel(value: 'full' | 'partial' | 'none' | 'unknown', locale: LaunchLocale) {
  const values = { full: ['Full', '全额', 'Полностью'], partial: ['Partial', '部分', 'Частично'], none: ['Not covered', '不覆盖', 'Не покрывается'], unknown: ['Not announced', '尚未公布', 'Не объявлено'] } as const
  const [en, zh, ru] = values[value]
  return pick(locale, en, zh, ru)
}
