import type { Locale } from '@/i18n/config'
import type { DegreeLevel, Discipline, Region } from './types'

const pick = (locale: Locale, values: [string, string, string]) => locale === 'zh' ? values[1] : locale === 'ru' ? values[2] : values[0]

export const degreeLabels = (locale: Locale): Record<DegreeLevel, string> => ({
  bachelor: pick(locale, ['Bachelor', '本科', 'Бакалавриат']),
  master: pick(locale, ['Master', '硕士', 'Магистратура']),
  language: pick(locale, ['Chinese language', '中文语言', 'Китайский язык']),
  foundation: pick(locale, ['Foundation', '预科', 'Подготовительное']),
})

export const disciplineLabels = (locale: Locale): Record<Discipline, string> => ({
  engineering: pick(locale, ['Computing & engineering', '计算机与工程', 'IT и инженерия']),
  business: pick(locale, ['Business & economics', '商科与经济', 'Бизнес и экономика']),
  medicine: pick(locale, ['Medicine & public health', '医学与公共卫生', 'Медицина']),
  'chinese-education': pick(locale, ['Chinese & education', '中文与教育', 'Китайский и образование']),
  humanities: pick(locale, ['Humanities & languages', '人文与语言', 'Гуманитарные науки']),
  'law-ir': pick(locale, ['Law & international relations', '法律与国际关系', 'Право и МО']),
  science: pick(locale, ['Natural sciences', '自然科学', 'Естественные науки']),
  'art-design': pick(locale, ['Art & design', '艺术与设计', 'Искусство и дизайн']),
})

export const regionLabels = (locale: Locale): Record<Region, string> => ({
  north: pick(locale, ['North China', '华北', 'Северный Китай']),
  northeast: pick(locale, ['Northeast', '东北', 'Северо-Восток']),
  east: pick(locale, ['East China', '华东', 'Восточный Китай']),
  south: pick(locale, ['South China', '华南', 'Южный Китай']),
  central: pick(locale, ['Central China', '华中', 'Центральный Китай']),
  southwest: pick(locale, ['Southwest', '西南', 'Юго-Запад']),
  northwest: pick(locale, ['Northwest', '西北', 'Северо-Запад']),
})

export const languageLabel = (value: string, locale: Locale) => {
  const labels: Record<string, [string, string, string]> = {
    Chinese: ['Chinese', '中文', 'Китайский'], English: ['English', '英语', 'Английский'], Bilingual: ['Chinese / English', '中英双语', 'Китайский / английский'],
  }
  return labels[value] ? pick(locale, labels[value]) : value
}
