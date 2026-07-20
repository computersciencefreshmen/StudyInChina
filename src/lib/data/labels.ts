import { isPublicLocale, type Locale, type PublicLocale } from '@/i18n/config'
import type { DegreeLevel, Discipline, Region } from './types'

type TranslationTuple = readonly [string, string, string, string, string, string]

const localeIndex: Record<PublicLocale, number> = { en: 0, zh: 1, ru: 2, de: 3, fr: 4, es: 5 }
const pick = (locale: Locale, values: TranslationTuple) => values[isPublicLocale(locale) ? localeIndex[locale] : 0]

export const degreeLabels = (locale: Locale): Record<DegreeLevel, string> => ({
  bachelor: pick(locale, ['Bachelor', '本科', 'Бакалавриат', 'Bachelor', 'Licence', 'Grado']),
  master: pick(locale, ['Master', '硕士', 'Магистратура', 'Master', 'Master', 'Máster']),
  language: pick(locale, ['Chinese language', '中文语言', 'Китайский язык', 'Chinesischkurs', 'Langue chinoise', 'Lengua china']),
  foundation: pick(locale, ['Foundation', '预科', 'Подготовительное', 'Studienkolleg', 'Année préparatoire', 'Programa preparatorio']),
})

export const disciplineLabels = (locale: Locale): Record<Discipline, string> => ({
  engineering: pick(locale, ['Computing & engineering', '计算机与工程', 'IT и инженерия', 'Informatik & Ingenieurwissenschaften', 'Informatique et ingénierie', 'Informática e ingeniería']),
  business: pick(locale, ['Business & economics', '商科与经济', 'Бизнес и экономика', 'Wirtschaft & Ökonomie', 'Commerce et économie', 'Negocios y economía']),
  medicine: pick(locale, ['Medicine & public health', '医学与公共卫生', 'Медицина', 'Medizin & öffentliche Gesundheit', 'Médecine et santé publique', 'Medicina y salud pública']),
  'chinese-education': pick(locale, ['Chinese & education', '中文与教育', 'Китайский и образование', 'Chinesisch & Pädagogik', 'Chinois et éducation', 'Chino y educación']),
  humanities: pick(locale, ['Humanities & languages', '人文与语言', 'Гуманитарные науки', 'Geisteswissenschaften & Sprachen', 'Sciences humaines et langues', 'Humanidades e idiomas']),
  'law-ir': pick(locale, ['Law & international relations', '法律与国际关系', 'Право и МО', 'Recht & internationale Beziehungen', 'Droit et relations internationales', 'Derecho y relaciones internacionales']),
  science: pick(locale, ['Natural sciences', '自然科学', 'Естественные науки', 'Naturwissenschaften', 'Sciences naturelles', 'Ciencias naturales']),
  'art-design': pick(locale, ['Art & design', '艺术与设计', 'Искусство и дизайн', 'Kunst & Design', 'Arts et design', 'Arte y diseño']),
})

export const regionLabels = (locale: Locale): Record<Region, string> => ({
  north: pick(locale, ['North China', '华北', 'Северный Китай', 'Nordchina', 'Chine du Nord', 'Norte de China']),
  northeast: pick(locale, ['Northeast', '东北', 'Северо-Восток', 'Nordostchina', 'Nord-Est', 'Noreste']),
  east: pick(locale, ['East China', '华东', 'Восточный Китай', 'Ostchina', 'Chine de l’Est', 'Este de China']),
  south: pick(locale, ['South China', '华南', 'Южный Китай', 'Südchina', 'Chine du Sud', 'Sur de China']),
  central: pick(locale, ['Central China', '华中', 'Центральный Китай', 'Zentralchina', 'Chine centrale', 'China central']),
  southwest: pick(locale, ['Southwest', '西南', 'Юго-Запад', 'Südwestchina', 'Sud-Ouest', 'Suroeste']),
  northwest: pick(locale, ['Northwest', '西北', 'Северо-Запад', 'Nordwestchina', 'Nord-Ouest', 'Noroeste']),
})

export const languageLabel = (value: string, locale: Locale) => {
  const labels: Record<string, TranslationTuple> = {
    Chinese: ['Chinese', '中文', 'Китайский', 'Chinesisch', 'Chinois', 'Chino'],
    English: ['English', '英语', 'Английский', 'Englisch', 'Anglais', 'Inglés'],
    Bilingual: ['Chinese / English', '中英双语', 'Китайский / английский', 'Chinesisch / Englisch', 'Chinois / anglais', 'Chino / inglés'],
  }
  return labels[value] ? pick(locale, labels[value]) : value
}
