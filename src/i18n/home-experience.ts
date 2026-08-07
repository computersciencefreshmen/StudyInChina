import type { LaunchLocale } from './config'

export type HomeExperienceCopy = {
  catalogEyebrow: string
  catalogTitle: string
  catalogIntro: string
  officialSources: string
  latestSourceCheck: string
  policyLink: string
  noGuessing: string
  pathwayEyebrow: string
  pathwayTitle: string
  pathwayIntro: string
  steps: Array<{
    title: string
    description: string
  }>
}

const copy = {
  en: {
    catalogEyebrow: 'Live catalogue',
    catalogTitle: 'A national catalogue you can audit.',
    catalogIntro: 'Every public record keeps its official route visible. Unknown, conflicting or outdated fields stay empty instead of being guessed.',
    officialSources: 'official source records',
    latestSourceCheck: 'Latest source check',
    policyLink: 'Read the data policy',
    noGuessing: 'Unknown means unknown — never an invented deadline, fee or requirement.',
    pathwayEyebrow: 'Applicant pathway',
    pathwayTitle: 'From first search to official application.',
    pathwayIntro: 'Narrow your options, compare what is known, verify the evidence and finish on the university’s own application system.',
    steps: [
      { title: 'Discover the right environment', description: 'Start with location, institution profile and fields available to international applicants.' },
      { title: 'Compare eligible programs', description: 'Filter by degree, field, teaching language, tuition evidence and application status.' },
      { title: 'Verify the evidence', description: 'Open the cited official page and check the record’s review status before relying on it.' },
      { title: 'Apply through the official route', description: 'Use the university or scholarship provider’s own system; this atlas never takes applications.' },
    ],
  },
  zh: {
    catalogEyebrow: '实时公开目录',
    catalogTitle: '一份可以逐条追溯的全国留学目录。',
    catalogIntro: '每条公开记录都保留官方入口；尚未公布、相互冲突或已经过期的字段保持为空，不用猜测值填补。',
    officialSources: '条官方来源记录',
    latestSourceCheck: '最近来源检查',
    policyLink: '查看数据政策',
    noGuessing: '未知就是未知——绝不编造截止日期、费用或申请条件。',
    pathwayEyebrow: '申请者路径',
    pathwayTitle: '从第一次搜索，到进入官方申请系统。',
    pathwayIntro: '先缩小范围，再比较已知信息、核对官方证据，最终通过学校自己的系统完成申请。',
    steps: [
      { title: '找到合适的学习环境', description: '从城市、学校定位和面向国际申请者开放的学科开始探索。' },
      { title: '比较可申请的项目', description: '按学位、学科、授课语言、学费证据和申请状态进行筛选。' },
      { title: '核对每一条证据', description: '打开所引用的官方页面，并在使用信息前查看记录的复核状态。' },
      { title: '通过官方渠道申请', description: '前往大学或奖学金提供方的系统；本平台不接收任何申请材料。' },
    ],
  },
  ru: {
    catalogEyebrow: 'Актуальный каталог',
    catalogTitle: 'Национальный каталог, который можно проверить.',
    catalogIntro: 'У каждой опубликованной записи виден официальный источник. Неизвестные, спорные или устаревшие поля остаются пустыми — без догадок.',
    officialSources: 'официальных источников',
    latestSourceCheck: 'Последняя проверка источников',
    policyLink: 'Политика данных',
    noGuessing: 'Неизвестное остаётся неизвестным — без вымышленных сроков, цен и требований.',
    pathwayEyebrow: 'Путь абитуриента',
    pathwayTitle: 'От первого поиска до официальной заявки.',
    pathwayIntro: 'Сузьте выбор, сравните известные данные, проверьте источники и завершите подачу в системе университета.',
    steps: [
      { title: 'Найдите подходящую среду', description: 'Начните с города, профиля университета и направлений для иностранных абитуриентов.' },
      { title: 'Сравните доступные программы', description: 'Фильтруйте по уровню, области, языку, данным о стоимости и статусу приёма.' },
      { title: 'Проверьте доказательства', description: 'Откройте официальный источник и проверьте статус пересмотра записи.' },
      { title: 'Подайте заявку официально', description: 'Используйте систему университета или стипендиальной организации; атлас не принимает заявки.' },
    ],
  },
  de: {
    catalogEyebrow: 'Live-Katalog',
    catalogTitle: 'Ein landesweiter Katalog, den Sie prüfen können.',
    catalogIntro: 'Jeder öffentliche Eintrag zeigt den offiziellen Weg. Unbekannte, widersprüchliche oder veraltete Felder bleiben leer, statt geschätzt zu werden.',
    officialSources: 'offizielle Quelldatensätze',
    latestSourceCheck: 'Letzte Quellenprüfung',
    policyLink: 'Datenrichtlinie lesen',
    noGuessing: 'Unbekannt bleibt unbekannt — keine erfundenen Fristen, Gebühren oder Voraussetzungen.',
    pathwayEyebrow: 'Bewerbungsweg',
    pathwayTitle: 'Von der ersten Suche zur offiziellen Bewerbung.',
    pathwayIntro: 'Grenzen Sie Ihre Auswahl ein, vergleichen Sie bekannte Fakten, prüfen Sie die Belege und bewerben Sie sich im System der Universität.',
    steps: [
      { title: 'Das passende Umfeld finden', description: 'Beginnen Sie mit Ort, Hochschulprofil und Fachgebieten für internationale Bewerbende.' },
      { title: 'Bewerbbare Programme vergleichen', description: 'Filtern Sie nach Abschluss, Fach, Unterrichtssprache, Gebührenbeleg und Bewerbungsstatus.' },
      { title: 'Belege überprüfen', description: 'Öffnen Sie die zitierte offizielle Seite und prüfen Sie den Überprüfungsstatus des Eintrags.' },
      { title: 'Offiziell bewerben', description: 'Nutzen Sie das System der Hochschule oder des Stipendiengebers; der Atlas nimmt keine Bewerbungen an.' },
    ],
  },
  fr: {
    catalogEyebrow: 'Catalogue en ligne',
    catalogTitle: 'Un catalogue national que vous pouvez vérifier.',
    catalogIntro: 'Chaque fiche publique conserve son accès officiel. Les champs inconnus, contradictoires ou périmés restent vides au lieu d’être devinés.',
    officialSources: 'sources officielles',
    latestSourceCheck: 'Dernière vérification des sources',
    policyLink: 'Lire la politique des données',
    noGuessing: 'Inconnu signifie inconnu — aucun délai, tarif ou critère n’est inventé.',
    pathwayEyebrow: 'Parcours de candidature',
    pathwayTitle: 'De la première recherche à la candidature officielle.',
    pathwayIntro: 'Affinez votre choix, comparez les faits connus, vérifiez les preuves puis terminez sur le système de l’université.',
    steps: [
      { title: 'Trouver le bon environnement', description: 'Commencez par la ville, le profil de l’établissement et les domaines ouverts aux candidats internationaux.' },
      { title: 'Comparer les programmes accessibles', description: 'Filtrez par niveau, domaine, langue, preuve des frais et statut de candidature.' },
      { title: 'Vérifier les preuves', description: 'Ouvrez la page officielle citée et contrôlez le statut de révision de la fiche.' },
      { title: 'Candidater par la voie officielle', description: 'Utilisez le système de l’université ou du financeur ; cet atlas ne reçoit aucune candidature.' },
    ],
  },
  es: {
    catalogEyebrow: 'Catálogo activo',
    catalogTitle: 'Un catálogo nacional que puedes auditar.',
    catalogIntro: 'Cada registro público mantiene visible su vía oficial. Los campos desconocidos, contradictorios o caducados quedan vacíos en lugar de estimarse.',
    officialSources: 'fuentes oficiales',
    latestSourceCheck: 'Última revisión de fuentes',
    policyLink: 'Leer la política de datos',
    noGuessing: 'Desconocido significa desconocido: nunca inventamos plazos, tasas ni requisitos.',
    pathwayEyebrow: 'Ruta del solicitante',
    pathwayTitle: 'De la primera búsqueda a la solicitud oficial.',
    pathwayIntro: 'Reduce tus opciones, compara los datos conocidos, verifica las pruebas y termina en el sistema de la universidad.',
    steps: [
      { title: 'Encontrar el entorno adecuado', description: 'Empieza por la ciudad, el perfil institucional y las áreas abiertas a estudiantes internacionales.' },
      { title: 'Comparar programas disponibles', description: 'Filtra por nivel, área, idioma, evidencia de matrícula y estado de solicitud.' },
      { title: 'Verificar las pruebas', description: 'Abre la página oficial citada y comprueba el estado de revisión del registro.' },
      { title: 'Solicitar por la vía oficial', description: 'Usa el sistema de la universidad o de la beca; este atlas no recibe solicitudes.' },
    ],
  },
} satisfies Record<LaunchLocale, HomeExperienceCopy>

export function getHomeExperienceCopy(locale: LaunchLocale): HomeExperienceCopy {
  return copy[locale]
}
