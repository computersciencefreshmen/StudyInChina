import type { LaunchLocale } from '@/i18n/config'
import type { Scholarship } from './types'

type TranslationTuple = readonly [string, string, string, string, string, string]
const localeIndex: Record<LaunchLocale, number> = { en: 0, zh: 1, ru: 2, de: 3, fr: 4, es: 5 }
const pick = (locale: LaunchLocale, values: TranslationTuple) => values[localeIndex[locale]]

export function providerLabel(value: Scholarship['providerType'], locale: LaunchLocale) {
  const values: Record<Scholarship['providerType'], TranslationTuple> = {
    csc: ['Chinese Government', '中国政府', 'Правительство Китая', 'Chinesische Regierung', 'Gouvernement chinois', 'Gobierno chino'],
    university: ['University', '高校', 'Университет', 'Hochschule', 'Université', 'Universidad'],
    province: ['Province', '省级', 'Провинция', 'Provinz', 'Province', 'Provincia'],
    city: ['City', '市级', 'Город', 'Stadt', 'Ville', 'Ciudad'],
    other: ['Other', '其他', 'Другое', 'Sonstige', 'Autre', 'Otro'],
  }
  return pick(locale, values[value])
}

export function coverageLabel(value: 'full' | 'partial' | 'none' | 'unknown', locale: LaunchLocale) {
  const values: Record<typeof value, TranslationTuple> = {
    full: ['Full', '全额', 'Полностью', 'Vollständig', 'Intégrale', 'Completa'],
    partial: ['Partial', '部分', 'Частично', 'Teilweise', 'Partielle', 'Parcial'],
    none: ['Not covered', '不覆盖', 'Не покрывается', 'Nicht abgedeckt', 'Non couverte', 'No cubierta'],
    unknown: ['Not announced', '尚未公布', 'Не объявлено', 'Nicht bekannt gegeben', 'Non annoncé', 'No anunciado'],
  }
  return pick(locale, values[value])
}
