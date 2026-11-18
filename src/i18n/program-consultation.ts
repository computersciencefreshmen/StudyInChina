import type { LaunchLocale } from './config'

export const consultationLabels: Record<LaunchLocale, string> = {
  en: 'Ask about this program', zh: '咨询这个项目', ru: 'Спросить о программе',
  de: 'Zum Studiengang nachfragen', fr: 'Poser une question sur ce programme', es: 'Consultar sobre este programa',
}
export const programConsultationHref = (locale: LaunchLocale, id: string) => `/${locale}/contact?program=${encodeURIComponent(id)}`
