import type { Locale } from '@/i18n/config'

/** Catalogue discovery and a current application opportunity are different promises. */
export function DiscoveryNotice({ locale }: { locale: Locale }) {
  const text: Record<Locale, string> = {
    zh: '目录收录不代表本期开放申请。申请日期、费用与资助条件仅展示仍有效的官方核验信息；待更新的项目可通过官网继续了解。',
    en: 'A catalogue entry does not mean applications are open. Dates, fees and funding conditions require current official verification. Entries awaiting an update retain their official discovery links.',
    ru: 'Наличие программы в каталоге не означает, что приём заявок открыт. Сроки, стоимость и условия финансирования публикуются только после актуальной проверки по официальным источникам. Пока сведения обновляются, можно перейти на официальный сайт.',
    de: 'Ein Katalogeintrag bedeutet nicht, dass Bewerbungen offen sind. Fristen, Gebühren und Förderbedingungen werden nur mit aktueller offizieller Bestätigung angezeigt. Während der Aktualisierung bleibt der Link zur offiziellen Quelle verfügbar.',
    fr: 'La présence dans le catalogue ne signifie pas que les candidatures sont ouvertes. Les dates, frais et conditions de financement exigent une vérification officielle à jour. Le lien officiel reste accessible pendant la mise à jour.',
    es: 'La inclusión en el catálogo no significa que las solicitudes estén abiertas. Las fechas, los costes y las condiciones de financiación requieren una verificación oficial vigente. El enlace oficial sigue disponible mientras se actualiza la información.',
    pt: 'A presença no catálogo não significa que as candidaturas estejam abertas. Datas, custos e condições de financiamento exigem verificação oficial atualizada. A ligação oficial continua disponível durante a atualização.',
    ar: 'وجود البرنامج في الدليل لا يعني أن التقديم مفتوح. لا تُعرض المواعيد والرسوم وشروط التمويل إلا بعد التحقق الحديث من المصادر الرسمية. يبقى الرابط الرسمي متاحًا أثناء تحديث المعلومات.',
  }
  return <div className="notice" data-discovery-notice>
    {text[locale]}
  </div>
}
