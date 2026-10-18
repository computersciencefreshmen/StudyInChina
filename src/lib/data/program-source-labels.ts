import type { PublicLocale } from '@/i18n/config'
import { localize } from './format'
import type { Program, Source, University } from './types'

const localeIndex: Record<PublicLocale, number> = { en: 0, zh: 1, ru: 2, de: 3, fr: 4, es: 5 }
const labels: Record<Source['kind'], readonly string[]> = {
  university: ['Official university source', '大学官方资料', 'Официальный источник университета', 'Offizielle Hochschulquelle', 'Source officielle de l’université', 'Fuente oficial de la universidad'],
  program: ['Official programme source', '专业官方资料', 'Официальный источник программы', 'Offizielle Programmquelle', 'Source officielle du programme', 'Fuente oficial del programa'],
  admissions: ['Official admissions guide', '官方招生指南', 'Официальные правила приёма', 'Offizieller Zulassungsleitfaden', 'Guide officiel d’admission', 'Guía oficial de admisión'],
  scholarship: ['Official scholarship source', '奖学金官方资料', 'Официальный источник о стипендии', 'Offizielle Stipendienquelle', 'Source officielle de la bourse', 'Fuente oficial de la beca'],
  government: ['Official government source', '政府官方资料', 'Официальный государственный источник', 'Offizielle Regierungsquelle', 'Source gouvernementale officielle', 'Fuente gubernamental oficial'],
  city: ['Official city source', '城市官方资料', 'Официальный источник о городе', 'Offizielle Stadtquelle', 'Source officielle de la ville', 'Fuente oficial de la ciudad'],
  other: ['Official reference', '官方参考资料', 'Официальный справочный источник', 'Offizielle Referenzquelle', 'Référence officielle', 'Referencia oficial'],
}
const publisher = ['Official publisher', '官方发布机构', 'Официальный издатель', 'Offizieller Herausgeber', 'Organisme officiel', 'Entidad oficial']

function institutionalHost(url: string): string {
  const host = new URL(url).hostname.toLowerCase()
  return host.endsWith('.edu.cn') ? host.split('.').slice(-3).join('.') : host.replace(/^www\./u, '')
}

/** Localized reading labels do not rewrite the original source metadata. */
export function localizeProgramSource(source: Source, university: University, locale: PublicLocale) {
  const index = localeIndex[locale]
  const sameInstitution = institutionalHost(source.url) === institutionalHost(university.officialUrl)
  return { title: labels[source.kind][index]!, publisher: sameInstitution ? localize(university.name, locale) : publisher[index]! }
}

/** A captured POST catalogue has a browser-readable landing page at the same host. */
export function programSourceHref(source: Source, program: Program): string {
  const url = new URL(source.url), landing = new URL(program.programUrl)
  return url.pathname.endsWith('/querydetail') && url.hostname === landing.hostname ? program.programUrl : source.url
}
