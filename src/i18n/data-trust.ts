import type { LaunchLocale } from './config'

type DataTrustCopy = {
  title: string
  reviewed: string
  reviewNeeded: string
  profileEvidence: string
  cycleEvidence: string
  checked: string
  reviewDue: string
  evaluated: string
  explanation: string
  overdueExplanation: string
  sources: string
  catalogExplanation: string
  policy: string
}

const copies: Record<LaunchLocale, DataTrustCopy> = {
  en: {
    title: 'Evidence & freshness',
    reviewed: 'Within review period',
    reviewNeeded: 'Review needed',
    profileEvidence: 'Profile evidence',
    cycleEvidence: 'Selected admission cycle',
    checked: 'Record verified',
    reviewDue: 'Review due',
    evaluated: 'Evaluated on · China time',
    explanation: 'The review date is our next evidence check, not an application deadline. A verified profile does not mean applications are open.',
    overdueExplanation: 'This evidence needs another check. Confirm the current cycle, fees and requirements with the official source before planning an application.',
    sources: 'Read official evidence',
    catalogExplanation: 'A listed program is not necessarily open for applications. “Dates not announced” means no current schedule is confirmed; it does not mean applications are closed.',
    policy: 'How we verify information',
  },
  zh: {
    title: '信息来源与时效',
    reviewed: '在复核周期内',
    reviewNeeded: '需要重新核验',
    profileEvidence: '档案信息',
    cycleEvidence: '所列招生周期',
    checked: '记录核验日期',
    reviewDue: '下次复核日期',
    evaluated: '状态评估日期 · 中国时间',
    explanation: '复核日期是本站计划再次检查证据的时间，并非申请截止日期。档案已核验，也不代表目前正在招生。',
    overdueExplanation: '这份证据需要重新核验。规划申请前，请通过官方来源确认当前招生周期、费用和申请要求。',
    sources: '查看官方证据',
    catalogExplanation: '目录中的项目不一定正在接受申请。“日期未公布”表示尚无当前已确认的时间安排，并不表示申请已经截止。',
    policy: '了解信息核验方式',
  },
  ru: {
    title: 'Источники и актуальность',
    reviewed: 'Срок проверки не истёк',
    reviewNeeded: 'Нужна повторная проверка',
    profileEvidence: 'Сведения о программе или вузе',
    cycleEvidence: 'Выбранный цикл приёма',
    checked: 'Запись проверена',
    reviewDue: 'Следующая проверка',
    evaluated: 'Оценка на дату · время Китая',
    explanation: 'Дата проверки — срок повторной проверки источников, а не окончания подачи заявок. Проверенная запись не означает, что приём открыт.',
    overdueExplanation: 'Источники нужно проверить повторно. Перед планированием подачи уточните текущий цикл, стоимость и требования на официальном сайте.',
    sources: 'Официальные источники',
    catalogExplanation: 'Не все программы в каталоге принимают заявки. «Даты не объявлены» означает, что актуальное расписание не подтверждено, а не что приём закрыт.',
    policy: 'Как мы проверяем сведения',
  },
  de: {
    title: 'Quellen & Aktualität',
    reviewed: 'Im Prüfzeitraum',
    reviewNeeded: 'Erneute Prüfung nötig',
    profileEvidence: 'Profilangaben',
    cycleEvidence: 'Ausgewählter Zulassungszyklus',
    checked: 'Datensatz geprüft',
    reviewDue: 'Nächste Prüfung',
    evaluated: 'Bewertet am · chinesische Zeit',
    explanation: 'Das Prüfdatum ist der Termin für die erneute Quellenprüfung, keine Bewerbungsfrist. Ein geprüftes Profil bedeutet nicht, dass Bewerbungen offen sind.',
    overdueExplanation: 'Diese Quellen müssen erneut geprüft werden. Bestätigen Sie den aktuellen Zyklus, die Gebühren und die Anforderungen anhand der offiziellen Quelle.',
    sources: 'Offizielle Quellen ansehen',
    catalogExplanation: 'Nicht alle gelisteten Studiengänge nehmen Bewerbungen an. „Termine nicht veröffentlicht“ bedeutet, dass kein aktueller Zeitplan bestätigt ist, nicht dass die Bewerbung geschlossen ist.',
    policy: 'So prüfen wir Informationen',
  },
  fr: {
    title: 'Sources et actualité',
    reviewed: 'Dans la période de vérification',
    reviewNeeded: 'Nouvelle vérification nécessaire',
    profileEvidence: 'Informations du profil',
    cycleEvidence: 'Cycle d’admission sélectionné',
    checked: 'Fiche vérifiée le',
    reviewDue: 'Prochaine vérification',
    evaluated: 'Évaluation au · heure de Chine',
    explanation: 'La date de vérification concerne le prochain contrôle des sources, pas la clôture des candidatures. Un profil vérifié ne signifie pas que les candidatures sont ouvertes.',
    overdueExplanation: 'Ces sources doivent être vérifiées à nouveau. Confirmez le cycle actuel, les frais et les conditions auprès de la source officielle avant de préparer une candidature.',
    sources: 'Consulter les sources officielles',
    catalogExplanation: 'Les programmes répertoriés n’acceptent pas nécessairement de candidatures. « Dates non annoncées » signifie qu’aucun calendrier actuel n’est confirmé, pas que les candidatures sont closes.',
    policy: 'Notre méthode de vérification',
  },
  es: {
    title: 'Fuentes y actualidad',
    reviewed: 'Dentro del período de revisión',
    reviewNeeded: 'Se necesita otra verificación',
    profileEvidence: 'Información del perfil',
    cycleEvidence: 'Ciclo de admisión seleccionado',
    checked: 'Registro verificado',
    reviewDue: 'Próxima revisión',
    evaluated: 'Evaluado el · hora de China',
    explanation: 'La fecha de revisión indica la próxima comprobación de fuentes, no el plazo de solicitud. Un perfil verificado no significa que se acepten solicitudes.',
    overdueExplanation: 'Estas fuentes necesitan otra verificación. Confirma el ciclo actual, las tasas y los requisitos en la fuente oficial antes de planificar una solicitud.',
    sources: 'Consultar fuentes oficiales',
    catalogExplanation: 'Los programas del catálogo no siempre aceptan solicitudes. «Fechas no anunciadas» significa que no se ha confirmado un calendario actual, no que el plazo esté cerrado.',
    policy: 'Cómo verificamos la información',
  },
}

export function getDataTrustCopy(locale: LaunchLocale): DataTrustCopy {
  return copies[locale]
}
