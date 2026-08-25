import type { PublicLocale } from './config'
import type { FactStatus } from '@/lib/catalog-api/types'

export type FactStatusMessage = {
  label: string
  description: string
}

const factStatusMessages = {
  en: {
    known: { label: 'Confirmed', description: 'Confirmed against a current official source.' },
    officially_not_announced: { label: 'Not yet announced', description: 'The current official information does not announce this fact yet.' },
    not_applicable: { label: 'Not applicable', description: 'This fact does not apply to this program or admissions cycle.' },
    source_unavailable: { label: 'Official source unavailable', description: 'An accessible official source could not be checked for this fact.' },
    conflict: { label: 'Official sources conflict', description: 'Official sources disagree, so the value is hidden until the conflict is resolved.' },
    stale: { label: 'Recheck required', description: 'The previous value is hidden because its official-source review is out of date.' },
  },
  zh: {
    known: { label: '已确认', description: '已根据当前官方来源确认。' },
    officially_not_announced: { label: '当前尚未公布', description: '当前官方信息尚未公布该字段。' },
    not_applicable: { label: '不适用', description: '该字段不适用于此项目或招生周期。' },
    source_unavailable: { label: '官方来源暂无法访问', description: '目前无法通过可访问的官方来源核验该字段。' },
    conflict: { label: '官方来源存在冲突', description: '官方来源说法不一致，冲突解决前隐藏该值。' },
    stale: { label: '需重新核验', description: '官方来源核验已过期，因此隐藏之前的值。' },
  },
  ru: {
    known: { label: 'Подтверждено', description: 'Подтверждено по актуальному официальному источнику.' },
    officially_not_announced: { label: 'Пока не объявлено', description: 'В текущей официальной информации этот факт пока не объявлен.' },
    not_applicable: { label: 'Не применяется', description: 'Этот факт не применим к данной программе или циклу приёма.' },
    source_unavailable: { label: 'Официальный источник недоступен', description: 'Не удалось проверить этот факт по доступному официальному источнику.' },
    conflict: { label: 'Официальные источники противоречат', description: 'Официальные источники расходятся, поэтому значение скрыто до устранения конфликта.' },
    stale: { label: 'Нужна повторная проверка', description: 'Прежнее значение скрыто, так как проверка официального источника устарела.' },
  },
  de: {
    known: { label: 'Bestätigt', description: 'Anhand einer aktuellen offiziellen Quelle bestätigt.' },
    officially_not_announced: { label: 'Noch nicht bekannt gegeben', description: 'Die aktuellen offiziellen Informationen enthalten diese Angabe noch nicht.' },
    not_applicable: { label: 'Nicht zutreffend', description: 'Diese Angabe gilt nicht für diesen Studiengang oder Zulassungszeitraum.' },
    source_unavailable: { label: 'Offizielle Quelle nicht erreichbar', description: 'Für diese Angabe konnte keine erreichbare offizielle Quelle geprüft werden.' },
    conflict: { label: 'Offizielle Quellen widersprechen sich', description: 'Offizielle Quellen widersprechen sich; der Wert bleibt bis zur Klärung verborgen.' },
    stale: { label: 'Erneute Prüfung erforderlich', description: 'Der frühere Wert wird ausgeblendet, weil die Prüfung der offiziellen Quelle veraltet ist.' },
  },
  fr: {
    known: { label: 'Confirmé', description: 'Confirmé à partir d’une source officielle actuelle.' },
    officially_not_announced: { label: 'Pas encore annoncé', description: 'Les informations officielles actuelles ne mentionnent pas encore cette donnée.' },
    not_applicable: { label: 'Sans objet', description: 'Cette donnée ne s’applique pas à ce programme ou à ce cycle d’admission.' },
    source_unavailable: { label: 'Source officielle indisponible', description: 'Aucune source officielle accessible n’a pu être vérifiée pour cette donnée.' },
    conflict: { label: 'Sources officielles contradictoires', description: 'Les sources officielles divergent ; la valeur est masquée jusqu’à la résolution du conflit.' },
    stale: { label: 'Nouvelle vérification requise', description: 'L’ancienne valeur est masquée car sa vérification auprès de la source officielle est périmée.' },
  },
  es: {
    known: { label: 'Confirmado', description: 'Confirmado mediante una fuente oficial actual.' },
    officially_not_announced: { label: 'Aún no anunciado', description: 'La información oficial actual aún no anuncia este dato.' },
    not_applicable: { label: 'No aplicable', description: 'Este dato no se aplica a este programa o ciclo de admisión.' },
    source_unavailable: { label: 'Fuente oficial no disponible', description: 'No se pudo comprobar este dato en una fuente oficial accesible.' },
    conflict: { label: 'Las fuentes oficiales discrepan', description: 'Las fuentes oficiales discrepan; el valor se oculta hasta resolver el conflicto.' },
    stale: { label: 'Requiere nueva verificación', description: 'El valor anterior se oculta porque la revisión de la fuente oficial está desactualizada.' },
  },
} satisfies Record<PublicLocale, Record<FactStatus, FactStatusMessage>>

export function getFactStatusMessage(locale: PublicLocale, status: FactStatus): FactStatusMessage {
  return factStatusMessages[locale][status]
}
