import type { LaunchLocale } from './config'

export type ReleaseAnnouncementCopy = {
  mark: string
  eyebrow: string
  title: string
  summary: string
  highlightsTitle: string
  highlights: string[]
  universitiesLabel: string
  programsLabel: string
  scholarshipsLabel: string
  dataAsOf: string
  explorePrograms: string
  fullUpdate: string
  dismiss: string
  storageNote: string
}

export type ReleaseAnnouncementContent = {
  id: string
  publishedOn: string
  copy: ReleaseAnnouncementCopy
}

export const LATEST_RELEASE_ANNOUNCEMENT_ID = '2026-08-26-trust-platform-release'
export const RELEASE_ANNOUNCEMENT_STORAGE_KEY = 'studyinchina.release-announcement.dismissed'

const copy = {
  en: {
    mark: 'NEW',
    eyebrow: 'Release note',
    title: 'A broader catalogue, with clearer evidence',
    summary: 'The latest atlas release expands official decision facts while making unknown, historical and conflicting values easier to distinguish.',
    highlightsTitle: 'What changed',
    highlights: [
      'Deeper official programme coverage now adds more duration, tuition, requirements and application-route evidence across leading and regional universities.',
      'Programme facts now distinguish confirmed, reference, not announced, unavailable, conflicting and stale information instead of hiding every gap behind one label.',
      'Shortlists and comparisons bring application status, fees, related scholarships, verification dates and official sources into one decision view.',
    ],
    universitiesLabel: 'universities',
    programsLabel: 'programme identities',
    scholarshipsLabel: 'scholarships',
    dataAsOf: 'Data release',
    explorePrograms: 'Explore open programmes',
    fullUpdate: 'View the full update',
    dismiss: 'Close update',
    storageNote: 'Shown once for this release. The dismissed version stays only in this browser.',
  },
  zh: {
    mark: '新',
    eyebrow: '版本更新',
    title: '选择更广，证据更清楚',
    summary: '本次图谱更新继续扩充官方决策信息，并把未知、历史参考和来源冲突清楚地区分开。',
    highlightsTitle: '本次变化',
    highlights: [
      '面向重点高校与地方强校继续深化官方项目资料，补充更多学制、学费、申请条件和官方申请入口证据。',
      '项目事实现在明确区分已确认、参考值、尚未公布、来源不可用、冲突和过期，不再让所有空白看起来都一样。',
      '收藏与项目对比集中展示申请状态、费用、关联奖学金、核验日期和官方来源，减少来回查找成本。',
    ],
    universitiesLabel: '所高校',
    programsLabel: '个项目身份',
    scholarshipsLabel: '项奖学金',
    dataAsOf: '数据版本',
    explorePrograms: '查看开放申请项目',
    fullUpdate: '查看完整更新记录',
    dismiss: '关闭更新',
    storageNote: '本版本仅提示一次；已读状态只保存在当前浏览器。',
  },
  ru: {
    mark: 'NEW',
    eyebrow: 'Обновление',
    title: 'Больше вариантов, яснее доказательства',
    summary: 'Новая версия атласа расширяет официальные данные для принятия решений и чётко отделяет неизвестные, исторические и противоречивые сведения.',
    highlightsTitle: 'Что изменилось',
    highlights: [
      'Для ведущих и сильных региональных вузов добавлено больше официальных сведений о длительности, стоимости, требованиях и способах подачи.',
      'Факты теперь разделены на подтверждённые, справочные, не объявленные, недоступные, противоречивые и устаревшие.',
      'В избранном и сравнении вместе показаны статус подачи, сборы, связанные стипендии, дата проверки и официальные источники.',
    ],
    universitiesLabel: 'вузов',
    programsLabel: 'программ',
    scholarshipsLabel: 'стипендий',
    dataAsOf: 'Версия данных',
    explorePrograms: 'Открытые программы',
    fullUpdate: 'Полный список изменений',
    dismiss: 'Закрыть обновление',
    storageNote: 'Показывается один раз для этой версии; отметка хранится только в этом браузере.',
  },
  de: {
    mark: 'NEU',
    eyebrow: 'Versionshinweis',
    title: 'Mehr Auswahl, klarere Nachweise',
    summary: 'Die neue Atlas-Version erweitert offizielle Entscheidungsdaten und trennt unbekannte, historische und widersprüchliche Angaben klar voneinander.',
    highlightsTitle: 'Was sich geändert hat',
    highlights: [
      'Für führende und starke regionale Hochschulen stehen mehr offizielle Angaben zu Dauer, Gebühren, Voraussetzungen und Bewerbungswegen bereit.',
      'Programmfakten unterscheiden nun bestätigt, Referenzwert, nicht angekündigt, Quelle nicht verfügbar, Konflikt und veraltet.',
      'Merkliste und Vergleich bündeln Bewerbungsstatus, Gebühren, zugehörige Stipendien, Prüfdatum und offizielle Quellen.',
    ],
    universitiesLabel: 'Hochschulen',
    programsLabel: 'Programme',
    scholarshipsLabel: 'Stipendien',
    dataAsOf: 'Datenstand',
    explorePrograms: 'Offene Programme',
    fullUpdate: 'Vollständiges Update',
    dismiss: 'Update schließen',
    storageNote: 'Erscheint einmal pro Version; der Lesestatus bleibt nur in diesem Browser.',
  },
  fr: {
    mark: 'NOUV.',
    eyebrow: 'Note de version',
    title: 'Plus de choix, des preuves plus claires',
    summary: 'Cette version enrichit les données officielles utiles à la décision et distingue clairement les valeurs inconnues, historiques ou contradictoires.',
    highlightsTitle: 'Ce qui change',
    highlights: [
      'Davantage de preuves officielles sur la durée, les frais, les conditions et les voies de candidature couvrent les grandes universités comme les établissements régionaux solides.',
      'Les faits distinguent désormais confirmé, référence, non annoncé, source indisponible, conflit et périmé.',
      'Les favoris et la comparaison réunissent l’état des candidatures, les frais, les bourses liées, la date de vérification et les sources officielles.',
    ],
    universitiesLabel: 'universités',
    programsLabel: 'programmes',
    scholarshipsLabel: 'bourses',
    dataAsOf: 'Version des données',
    explorePrograms: 'Programmes ouverts',
    fullUpdate: 'Voir la mise à jour complète',
    dismiss: 'Fermer la mise à jour',
    storageNote: 'Affiché une fois pour cette version ; l’état de lecture reste dans ce navigateur.',
  },
  es: {
    mark: 'NUEVO',
    eyebrow: 'Nota de versión',
    title: 'Más opciones, evidencia más clara',
    summary: 'La nueva versión amplía los datos oficiales para decidir y separa con claridad los valores desconocidos, históricos y contradictorios.',
    highlightsTitle: 'Qué ha cambiado',
    highlights: [
      'Hay más evidencia oficial sobre duración, matrícula, requisitos y vías de solicitud en universidades líderes y regionales destacadas.',
      'Los datos ahora distinguen entre confirmado, referencia, no anunciado, fuente no disponible, conflicto y desactualizado.',
      'Favoritos y comparación reúnen el estado de solicitud, las tasas, las becas relacionadas, la fecha de verificación y las fuentes oficiales.',
    ],
    universitiesLabel: 'universidades',
    programsLabel: 'programas',
    scholarshipsLabel: 'becas',
    dataAsOf: 'Versión de datos',
    explorePrograms: 'Programas abiertos',
    fullUpdate: 'Ver la actualización completa',
    dismiss: 'Cerrar actualización',
    storageNote: 'Se muestra una vez por versión; el estado leído solo queda en este navegador.',
  },
} satisfies Record<LaunchLocale, ReleaseAnnouncementCopy>

export function getReleaseAnnouncement(locale: LaunchLocale): ReleaseAnnouncementContent {
  return {
    id: LATEST_RELEASE_ANNOUNCEMENT_ID,
    publishedOn: '2026-08-26',
    copy: copy[locale],
  }
}
