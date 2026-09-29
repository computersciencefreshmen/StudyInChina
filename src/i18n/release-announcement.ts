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

export const LATEST_RELEASE_ANNOUNCEMENT_ID = '2026-09-29-map-and-evidence-release'
export const RELEASE_ANNOUNCEMENT_STORAGE_KEY = 'studyinchina.release-announcement.dismissed'

const copy = {
  en: {
    mark: 'NEW',
    eyebrow: 'Release note',
    title: 'Current evidence, clearer application decisions',
    summary: 'This release reviews the full catalogue for freshness and rechecks selected official admissions notices. Each record keeps its own verification date.',
    highlightsTitle: 'What changed',
    highlights: [
      'Explore a draggable, zoomable city map with linked results, university search and direct Google Maps links.',
      'Evidence past its review date is marked for rechecking; historical deadlines are never advanced to a new year automatically.',
      'University, programme and scholarship pages show verification and review dates alongside links to the official evidence.',
      'Comparisons refresh application status as the date changes and keep expired or conflicting fees separate from current confirmed facts.',
    ],
    universitiesLabel: 'universities',
    programsLabel: 'programme identities',
    scholarshipsLabel: 'scholarships',
    dataAsOf: 'Data release',
    explorePrograms: 'Explore open programmes',
    fullUpdate: 'View the full update',
    dismiss: 'Close update',
    storageNote: 'Shown only on your first visit. The viewed status stays only in this browser.',
  },
  zh: {
    mark: '新',
    eyebrow: '版本更新',
    title: '核验更及时，申请判断更清楚',
    summary: '本次更新完成全目录时效审查，并重新核对部分官方招生公告。每条记录保留独立的核验日期。',
    highlightsTitle: '本次变化',
    highlights: [
      '全新可拖动缩放的城市地图，与城市列表、高校搜索和详情联动，并可一键跳转 Google Maps。',
      '超过复核期限的证据明确标为待复核，历史截止日期不会自动改成新一年的日期。',
      '高校、项目和奖学金详情直接展示核验日期、复核期限和官方证据入口。',
      '项目对比随日期变化刷新申请状态，过期或有冲突的费用不会作为当前已确认事实展示。',
    ],
    universitiesLabel: '所高校',
    programsLabel: '个项目身份',
    scholarshipsLabel: '项奖学金',
    dataAsOf: '数据版本',
    explorePrograms: '查看开放申请项目',
    fullUpdate: '查看完整更新记录',
    dismiss: '关闭更新',
    storageNote: '仅首次访问时提示；已读状态保存在当前浏览器，后续更新不再自动弹出。',
  },
  ru: {
    mark: 'NEW',
    eyebrow: 'Обновление',
    title: 'Актуальность данных и ясные сроки подачи',
    summary: 'Проверена актуальность всего каталога и повторно изучены отдельные официальные объявления. У каждой записи остаётся собственная дата проверки.',
    highlightsTitle: 'Что изменилось',
    highlights: [
      'Интерактивная карта с масштабированием, связанным списком городов, поиском вузов и ссылками на Google Maps.',
      'Просроченные сведения помечаются для повторной проверки; старые сроки не переносятся автоматически на следующий год.',
      'Страницы вузов, программ и стипендий показывают даты проверки и пересмотра со ссылками на официальные источники.',
      'Сравнение обновляет статус подачи при смене даты и отделяет устаревшие или противоречивые сборы от подтверждённых данных.',
    ],
    universitiesLabel: 'вузов',
    programsLabel: 'программ',
    scholarshipsLabel: 'стипендий',
    dataAsOf: 'Версия данных',
    explorePrograms: 'Открытые программы',
    fullUpdate: 'Полный список изменений',
    dismiss: 'Закрыть обновление',
    storageNote: 'Показывается только при первом посещении; отметка хранится в этом браузере.',
  },
  de: {
    mark: 'NEU',
    eyebrow: 'Versionshinweis',
    title: 'Aktuelle Nachweise, klare Bewerbungsfristen',
    summary: 'Der gesamte Katalog wurde auf Aktualität geprüft und ausgewählte offizielle Zulassungshinweise erneut gelesen. Jeder Eintrag behält sein eigenes Prüfdatum.',
    highlightsTitle: 'Was sich geändert hat',
    highlights: [
      'Interaktive Stadtkarte mit Zoom, verknüpfter Ergebnisliste, Hochschulsuche und direkten Google-Maps-Links.',
      'Überfällige Nachweise werden zur erneuten Prüfung markiert; alte Fristen werden nie automatisch ins nächste Jahr verschoben.',
      'Hochschul-, Programm- und Stipendienseiten zeigen Prüfdatum, nächste Prüfung und Links zu offiziellen Nachweisen.',
      'Vergleiche aktualisieren den Bewerbungsstatus bei Datumswechsel und trennen veraltete oder widersprüchliche Gebühren von bestätigten Angaben.',
    ],
    universitiesLabel: 'Hochschulen',
    programsLabel: 'Programme',
    scholarshipsLabel: 'Stipendien',
    dataAsOf: 'Datenstand',
    explorePrograms: 'Offene Programme',
    fullUpdate: 'Vollständiges Update',
    dismiss: 'Update schließen',
    storageNote: 'Erscheint nur beim ersten Besuch; der Lesestatus bleibt in diesem Browser.',
  },
  fr: {
    mark: 'NOUV.',
    eyebrow: 'Note de version',
    title: 'Des preuves à jour, des candidatures plus claires',
    summary: 'La fraîcheur de tout le catalogue a été contrôlée et certaines annonces officielles ont été relues. Chaque fiche conserve sa propre date de vérification.',
    highlightsTitle: 'Ce qui change',
    highlights: [
      'Une carte interactive avec zoom, liste liée, recherche des universités et liens directs vers Google Maps.',
      'Les preuves dont la révision est échue sont signalées ; les anciennes échéances ne sont jamais reportées automatiquement à une nouvelle année.',
      'Les fiches des universités, programmes et bourses affichent les dates de vérification et de révision ainsi que les sources officielles.',
      'Les comparaisons actualisent le statut des candidatures au changement de date et distinguent les frais périmés ou contradictoires des faits confirmés.',
    ],
    universitiesLabel: 'universités',
    programsLabel: 'programmes',
    scholarshipsLabel: 'bourses',
    dataAsOf: 'Version des données',
    explorePrograms: 'Programmes ouverts',
    fullUpdate: 'Voir la mise à jour complète',
    dismiss: 'Fermer la mise à jour',
    storageNote: 'Affiché uniquement lors de la première visite ; l’état de lecture reste dans ce navigateur.',
  },
  es: {
    mark: 'NUEVO',
    eyebrow: 'Nota de versión',
    title: 'Evidencia actual, solicitudes más claras',
    summary: 'Se revisó la vigencia de todo el catálogo y se comprobaron de nuevo determinados avisos oficiales. Cada registro conserva su propia fecha de verificación.',
    highlightsTitle: 'Qué ha cambiado',
    highlights: [
      'Mapa interactivo con zoom, lista vinculada, búsqueda de universidades y enlaces directos a Google Maps.',
      'La evidencia cuya revisión ha vencido queda marcada; los plazos históricos nunca se trasladan automáticamente a otro año.',
      'Las páginas de universidades, programas y becas muestran las fechas de verificación y revisión junto a las fuentes oficiales.',
      'Las comparaciones actualizan el estado de solicitud al cambiar la fecha y separan las tasas vencidas o contradictorias de los datos confirmados.',
    ],
    universitiesLabel: 'universidades',
    programsLabel: 'programas',
    scholarshipsLabel: 'becas',
    dataAsOf: 'Versión de datos',
    explorePrograms: 'Programas abiertos',
    fullUpdate: 'Ver la actualización completa',
    dismiss: 'Cerrar actualización',
    storageNote: 'Se muestra solo en la primera visita; el estado leído queda en este navegador.',
  },
} satisfies Record<LaunchLocale, ReleaseAnnouncementCopy>

export function getReleaseAnnouncement(locale: LaunchLocale): ReleaseAnnouncementContent {
  return {
    id: LATEST_RELEASE_ANNOUNCEMENT_ID,
    publishedOn: '2026-09-29',
    copy: copy[locale],
  }
}
