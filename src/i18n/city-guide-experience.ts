import type { PublicLocale } from '@/i18n/config'

type ExperienceCopy = {
  cities: {
    explorerLabel: string
    viewLabel: string
    constellationView: string
    directoryView: string
    searchLabel: string
    searchPlaceholder: string
    regionLabel: string
    allRegions: string
    sortLabel: string
    sortByUniversities: string
    sortByName: string
    resultSummary: string
    empty: string
  }
  guides: {
    flagship: string
    checklist: string
    chapters: string
    minuteRead: string
    openGuide: string
    contents: string
    officialSources: string
    sourcesIntro: string
    checkedOn: string
    openSource: string
    faq: string
    related: string
  }
}

const copy = {
  en: {
    cities: {
      explorerLabel: 'Explore student cities', viewLabel: 'View', constellationView: 'Constellation', directoryView: 'Directory',
      searchLabel: 'Search cities', searchPlaceholder: 'City or province', regionLabel: 'Region', allRegions: 'All regions',
      sortLabel: 'Sort', sortByUniversities: 'Most universities', sortByName: 'City name', resultSummary: 'cities in this view',
      empty: 'No cities match these filters.',
    },
    guides: {
      flagship: 'Flagship guide', checklist: 'Practical checklist', chapters: 'chapters', minuteRead: 'min read', openGuide: 'Open guide',
      contents: 'On this page', officialSources: 'Official sources', sourcesIntro: 'Use these authorities as a starting point, then confirm the current rules for your country and university.',
      checkedOn: 'Source checked', openSource: 'Open official source', faq: 'Frequently asked questions', related: 'Continue your research',
    },
  },
  zh: {
    cities: {
      explorerLabel: '探索留学城市', viewLabel: '视图', constellationView: '城市星图', directoryView: '城市目录',
      searchLabel: '搜索城市', searchPlaceholder: '城市或省份', regionLabel: '区域', allRegions: '全部区域',
      sortLabel: '排序', sortByUniversities: '高校数量优先', sortByName: '城市名称', resultSummary: '座城市符合当前条件',
      empty: '没有符合当前筛选条件的城市。',
    },
    guides: {
      flagship: '旗舰指南', checklist: '实用清单', chapters: '章', minuteRead: '分钟阅读', openGuide: '阅读指南',
      contents: '本页目录', officialSources: '官方来源', sourcesIntro: '先从这些主管机构的信息开始，再核对你所在国家和目标大学的当期规则。',
      checkedOn: '来源检查时间', openSource: '打开官方来源', faq: '常见问题', related: '继续探索',
    },
  },
  ru: {
    cities: {
      explorerLabel: 'Города для учёбы', viewLabel: 'Вид', constellationView: 'Созвездие', directoryView: 'Список',
      searchLabel: 'Поиск города', searchPlaceholder: 'Город или провинция', regionLabel: 'Регион', allRegions: 'Все регионы',
      sortLabel: 'Сортировка', sortByUniversities: 'Больше вузов', sortByName: 'По названию', resultSummary: 'городов в выборке',
      empty: 'По этим фильтрам городов нет.',
    },
    guides: {
      flagship: 'Главный гид', checklist: 'Практический список', chapters: 'разделов', minuteRead: 'мин чтения', openGuide: 'Открыть гид',
      contents: 'На этой странице', officialSources: 'Официальные источники', sourcesIntro: 'Начните с этих официальных материалов, затем уточните действующие правила для вашей страны и вуза.',
      checkedOn: 'Источник проверен', openSource: 'Открыть источник', faq: 'Частые вопросы', related: 'Продолжить поиск',
    },
  },
  de: {
    cities: {
      explorerLabel: 'Studienstädte entdecken', viewLabel: 'Ansicht', constellationView: 'Konstellation', directoryView: 'Verzeichnis',
      searchLabel: 'Städte suchen', searchPlaceholder: 'Stadt oder Provinz', regionLabel: 'Region', allRegions: 'Alle Regionen',
      sortLabel: 'Sortieren', sortByUniversities: 'Meiste Hochschulen', sortByName: 'Stadtname', resultSummary: 'Städte in dieser Auswahl',
      empty: 'Keine Stadt entspricht diesen Filtern.',
    },
    guides: {
      flagship: 'Hauptleitfaden', checklist: 'Praktische Checkliste', chapters: 'Kapitel', minuteRead: 'Min. Lesezeit', openGuide: 'Leitfaden öffnen',
      contents: 'Auf dieser Seite', officialSources: 'Offizielle Quellen', sourcesIntro: 'Beginnen Sie mit diesen Behördenquellen und prüfen Sie danach die aktuellen Regeln für Ihr Land und Ihre Hochschule.',
      checkedOn: 'Quelle geprüft', openSource: 'Offizielle Quelle öffnen', faq: 'Häufige Fragen', related: 'Recherche fortsetzen',
    },
  },
  fr: {
    cities: {
      explorerLabel: 'Explorer les villes étudiantes', viewLabel: 'Vue', constellationView: 'Constellation', directoryView: 'Répertoire',
      searchLabel: 'Rechercher une ville', searchPlaceholder: 'Ville ou province', regionLabel: 'Région', allRegions: 'Toutes les régions',
      sortLabel: 'Trier', sortByUniversities: "Plus d'universités", sortByName: 'Nom de la ville', resultSummary: 'villes dans cette sélection',
      empty: 'Aucune ville ne correspond à ces filtres.',
    },
    guides: {
      flagship: 'Guide essentiel', checklist: 'Liste pratique', chapters: 'chapitres', minuteRead: 'min de lecture', openGuide: 'Ouvrir le guide',
      contents: 'Sur cette page', officialSources: 'Sources officielles', sourcesIntro: 'Commencez par ces sources officielles, puis vérifiez les règles actuelles pour votre pays et votre université.',
      checkedOn: 'Source vérifiée', openSource: 'Ouvrir la source officielle', faq: 'Questions fréquentes', related: 'Poursuivre la recherche',
    },
  },
  es: {
    cities: {
      explorerLabel: 'Explorar ciudades universitarias', viewLabel: 'Vista', constellationView: 'Constelación', directoryView: 'Directorio',
      searchLabel: 'Buscar ciudades', searchPlaceholder: 'Ciudad o provincia', regionLabel: 'Región', allRegions: 'Todas las regiones',
      sortLabel: 'Ordenar', sortByUniversities: 'Más universidades', sortByName: 'Nombre de ciudad', resultSummary: 'ciudades en esta selección',
      empty: 'Ninguna ciudad coincide con estos filtros.',
    },
    guides: {
      flagship: 'Guía esencial', checklist: 'Lista práctica', chapters: 'capítulos', minuteRead: 'min de lectura', openGuide: 'Abrir guía',
      contents: 'En esta página', officialSources: 'Fuentes oficiales', sourcesIntro: 'Empieza por estas fuentes oficiales y después confirma las reglas vigentes para tu país y universidad.',
      checkedOn: 'Fuente revisada', openSource: 'Abrir fuente oficial', faq: 'Preguntas frecuentes', related: 'Continuar la búsqueda',
    },
  },
} satisfies Record<PublicLocale, ExperienceCopy>

export function getCityGuideExperience(locale: PublicLocale): ExperienceCopy {
  return copy[locale]
}
