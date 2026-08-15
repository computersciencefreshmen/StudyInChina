import type { BetaLocale } from './config'

const betaContentFallbackNotices: Record<BetaLocale, string> = {
  de: 'Hinweis: Die Oberfläche ist auf Deutsch verfügbar; einzelne geprüfte Datentexte können auf Englisch erscheinen, wenn noch keine geprüfte Übersetzung vorliegt.',
  fr: 'Remarque : l’interface est disponible en français ; certains textes de données vérifiées peuvent apparaître en anglais lorsqu’aucune traduction révisée n’est encore disponible.',
  es: 'Nota: la interfaz está disponible en español; algunos textos de datos verificados pueden aparecer en inglés cuando todavía no exista una traducción revisada.',
}

export function betaContentFallbackNotice(locale: BetaLocale): string {
  return betaContentFallbackNotices[locale]
}
