import type { LaunchLocale } from './config'

const copy = {
  en: ['Find programs for my profile', 'Highest completed qualification', 'High school', 'Annual tuition budget (CNY)', 'Optional CV prefill (.txt, on this device only)', 'Confirm choices and find programs', 'Matches', 'Needs confirmation', 'No current program matches the confirmed preferences.', 'Only current official intakes are compared. Check all admission requirements on the source page.', 'Please select a UTF-8 text file under 256 KB.', 'No labeled qualification or language preference was found. Enter your choices below.'],
  zh: ['按我的条件选专业', '已取得的最高学历', '高中', '每学年学费预算（人民币）', '可选：用简历预填（.txt，仅在本机读取）', '确认条件并匹配项目', '符合', '待确认', '当前没有符合已确认偏好的当期项目。', '仅比较有官方依据的当期批次。申请前请核对完整招生条件。', '请选择小于 256 KB 的 UTF-8 文本文件。', '未找到明确标注的最高学历或意向授课语言，可在下方填写。'],
  ru: ['Подбор программ', 'Полученная квалификация', 'Средняя школа', 'Годовой бюджет (CNY)', 'Заполнить из резюме (.txt, только на устройстве)', 'Подтвердить и подобрать', 'Совпадает', 'Требует проверки', 'Подходящих программ не найдено.', 'Сравниваются действующие официальные наборы. Проверьте все условия в источнике.', 'Выберите файл UTF-8 до 256 КБ.', 'Заполните квалификацию и язык вручную.'],
  de: ['Passende Studiengänge finden', 'Höchster Abschluss', 'Schulabschluss', 'Jährliches Gebührenbudget (CNY)', 'Optional aus Lebenslauf ausfüllen (.txt, nur lokal)', 'Angaben bestätigen und suchen', 'Erfüllt', 'Zu prüfen', 'Kein aktuelles Angebot passt.', 'Verglichen werden aktuelle offizielle Angebote. Prüfen Sie alle Zulassungsbedingungen in der Quelle.', 'UTF-8-Textdatei unter 256 KB wählen.', 'Bitte Abschluss und Unterrichtssprache eingeben.'],
  fr: ['Trouver des programmes adaptés', 'Diplôme obtenu', 'Secondaire', 'Budget annuel de scolarité (CNY)', 'Préremplir avec un CV (.txt, sur cet appareil)', 'Confirmer et rechercher', 'Correspond', 'À confirmer', 'Aucun programme actuel ne correspond.', 'Seules les sessions officielles actuelles sont comparées. Vérifiez les conditions à la source.', 'Choisissez un fichier texte UTF-8 de moins de 256 Ko.', 'Renseignez votre diplôme et la langue souhaitée.'],
  es: ['Encontrar programas para mi perfil', 'Máxima titulación obtenida', 'Secundaria', 'Presupuesto anual de matrícula (CNY)', 'Rellenar desde un CV (.txt, solo en este dispositivo)', 'Confirmar y buscar', 'Coincide', 'Por confirmar', 'Ningún programa actual coincide.', 'Se comparan convocatorias oficiales vigentes. Consulte todos los requisitos en la fuente.', 'Elija un archivo UTF-8 de menos de 256 KB.', 'Introduzca su titulación y el idioma de preferencia.'],
} satisfies Record<LaunchLocale, string[]>

export function studentMatchCopy(locale: LaunchLocale) {
  const [title, education, secondary, budget, cv, submit, met, unknown, empty, note, fileError, noFields] = copy[locale]
  const conflict = { en: 'Conflicts with preference', zh: '与所选条件冲突', ru: 'Не соответствует', de: 'Abweichung', fr: 'Critère incompatible', es: 'Criterio incompatible' }[locale]
  return { title, education, secondary, budget, cv, submit, met, unknown, conflict, empty, note, fileError, noFields }
}
