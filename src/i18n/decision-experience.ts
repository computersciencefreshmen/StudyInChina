import type { LaunchLocale } from './config'

export type DecisionExperienceCopy = {
  applicationSnapshot: string
  fundingSnapshot: string
  currentCycle: string
  applicationFee: string
  fundingHighlights: string
  officialApplicationRoute: string
  deadlineAhead: string
  deadlineClosed: string
  verifiedFactsOnly: string
}

const copies = {
  en: {
    applicationSnapshot: 'Application snapshot',
    fundingSnapshot: 'Funding snapshot',
    currentCycle: 'Current cycle',
    applicationFee: 'Application fee',
    fundingHighlights: 'Funding highlights',
    officialApplicationRoute: 'Official application route',
    deadlineAhead: 'Deadline ahead',
    deadlineClosed: 'Deadline passed',
    verifiedFactsOnly: 'Only facts supported by the linked official sources are shown. Unannounced details remain explicitly unknown.',
  },
  zh: {
    applicationSnapshot: '申请概览',
    fundingSnapshot: '资助概览',
    currentCycle: '当前招生周期',
    applicationFee: '申请费',
    fundingHighlights: '资助重点',
    officialApplicationRoute: '官方申请入口',
    deadlineAhead: '截止日期未到',
    deadlineClosed: '截止日期已过',
    verifiedFactsOnly: '仅展示有所链接官方来源支持的信息；官方未公布的内容会明确标记为未公布。',
  },
  ru: {
    applicationSnapshot: 'Сводка по подаче',
    fundingSnapshot: 'Сводка по финансированию',
    currentCycle: 'Текущий цикл',
    applicationFee: 'Сбор за подачу',
    fundingHighlights: 'Основные меры поддержки',
    officialApplicationRoute: 'Официальный канал подачи',
    deadlineAhead: 'Срок ещё не истёк',
    deadlineClosed: 'Срок истёк',
    verifiedFactsOnly: 'Показаны только факты, подтверждённые связанными официальными источниками; необъявленные данные явно отмечены.',
  },
  de: {
    applicationSnapshot: 'Bewerbungsübersicht',
    fundingSnapshot: 'Förderübersicht',
    currentCycle: 'Aktueller Zyklus',
    applicationFee: 'Bewerbungsgebühr',
    fundingHighlights: 'Wichtigste Leistungen',
    officialApplicationRoute: 'Offizieller Bewerbungsweg',
    deadlineAhead: 'Frist noch nicht abgelaufen',
    deadlineClosed: 'Frist abgelaufen',
    verifiedFactsOnly: 'Es werden nur Angaben gezeigt, die durch die verlinkten offiziellen Quellen belegt sind. Nicht veröffentlichte Details bleiben ausdrücklich unbekannt.',
  },
  fr: {
    applicationSnapshot: 'Aperçu de la candidature',
    fundingSnapshot: 'Aperçu du financement',
    currentCycle: 'Cycle actuel',
    applicationFee: 'Frais de candidature',
    fundingHighlights: 'Principales aides',
    officialApplicationRoute: 'Voie officielle de candidature',
    deadlineAhead: 'Échéance à venir',
    deadlineClosed: 'Échéance dépassée',
    verifiedFactsOnly: 'Seuls les faits étayés par les sources officielles liées sont affichés. Les informations non publiées restent explicitement inconnues.',
  },
  es: {
    applicationSnapshot: 'Resumen de solicitud',
    fundingSnapshot: 'Resumen de financiación',
    currentCycle: 'Ciclo actual',
    applicationFee: 'Tasa de solicitud',
    fundingHighlights: 'Ayudas principales',
    officialApplicationRoute: 'Vía oficial de solicitud',
    deadlineAhead: 'Plazo aún vigente',
    deadlineClosed: 'Plazo vencido',
    verifiedFactsOnly: 'Solo se muestran datos respaldados por las fuentes oficiales enlazadas. La información no publicada permanece marcada expresamente como desconocida.',
  },
} satisfies Record<LaunchLocale, DecisionExperienceCopy>

export function getDecisionExperienceCopy(locale: LaunchLocale): DecisionExperienceCopy {
  return copies[locale]
}

export function formatUniversityCoverage(
  count: number,
  locale: LaunchLocale,
  allUniversitiesLabel: string,
): string {
  if (count === 0) return allUniversitiesLabel

  if (locale === 'zh') return `${count} 所高校`

  const category = new Intl.PluralRules(locale).select(count)
  const labels: Record<Exclude<LaunchLocale, 'zh'>, Partial<Record<Intl.LDMLPluralRule, string>>> = {
    en: { one: 'university', other: 'universities' },
    ru: { one: 'университет', few: 'университета', many: 'университетов', other: 'университета' },
    de: { one: 'Universität', other: 'Universitäten' },
    fr: { one: 'université', other: 'universités' },
    es: { one: 'universidad', other: 'universidades' },
  }
  const languageLabels = labels[locale]
  return `${count} ${languageLabels[category] || languageLabels.other}`
}
