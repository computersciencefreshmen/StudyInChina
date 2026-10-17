import type { PublicLocale } from './config'

export function officialReferenceTuitionCopy(locale: PublicLocale) {
  return {
    zh: { label: '官方参考学费', notice: '官方参考标准，最终学费以大学录取通知书为准。' },
    en: { label: 'Official reference tuition', notice: 'Official reference rate. Final tuition is determined by the university admission notice.' },
    ru: { label: 'Официальная ориентировочная стоимость', notice: 'Официальный ориентировочный тариф. Окончательная стоимость указана в уведомлении университета о зачислении.' },
    de: { label: 'Offizieller Richtwert der Studiengebühren', notice: 'Offizieller Richtwert. Die endgültigen Studiengebühren stehen im Zulassungsbescheid der Universität.' },
    fr: { label: 'Frais de scolarité indicatifs officiels', notice: 'Tarif indicatif officiel. Les frais définitifs sont indiqués dans la notification d’admission de l’université.' },
    es: { label: 'Matrícula de referencia oficial', notice: 'Tarifa de referencia oficial. El importe definitivo figura en la notificación de admisión de la universidad.' },
  }[locale]
}
