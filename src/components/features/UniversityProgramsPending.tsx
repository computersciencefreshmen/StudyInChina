import { Card, LinkButton } from '@/components/ui'
import type { PublicLocale } from '@/i18n/config'

const copy = {
  en: {
    title: 'No current verified programme information',
    description: (name: string) => `This page currently has no verified, up-to-date programme information for ${name}. This does not mean the university has no programmes or is not admitting students. Check the official source for programmes and application requirements.`,
    official: 'Check the official source',
    feedback: 'Report a missing programme',
  },
  zh: {
    title: '暂无当前已核验的专业信息',
    description: (name: string) => `本页面目前没有${name}当前已核验的专业信息。这不代表该大学没有开设专业或没有招生。请通过官方来源查看专业及申请要求。`,
    official: '查看官方来源',
    feedback: '反馈缺失的专业',
  },
  ru: {
    title: 'Нет актуальных проверенных сведений о программах',
    description: (name: string) => `На этой странице сейчас нет актуальных проверенных сведений о программах университета ${name}. Это не означает, что у университета нет программ или что он не ведёт приём. Программы и требования к поступлению уточняйте в официальном источнике.`,
    official: 'Открыть официальный источник',
    feedback: 'Сообщить об отсутствующей программе',
  },
  de: {
    title: 'Keine aktuell geprüften Programminformationen',
    description: (name: string) => `Diese Seite enthält derzeit keine aktuellen, geprüften Informationen zu Studienprogrammen von ${name}. Das bedeutet nicht, dass die Universität keine Programme anbietet oder keine Studierenden aufnimmt. Informationen zu Programmen und Bewerbungsvoraussetzungen finden Sie in der offiziellen Quelle.`,
    official: 'Offizielle Quelle ansehen',
    feedback: 'Fehlendes Studienprogramm melden',
  },
  fr: {
    title: 'Aucune information actuelle vérifiée sur les programmes',
    description: (name: string) => `Cette page ne propose actuellement aucune information à jour et vérifiée sur les programmes de ${name}. Cela ne signifie pas que cette université ne propose aucun programme ou ne recrute pas d’étudiants. Consultez la source officielle pour connaître les programmes et les conditions de candidature.`,
    official: 'Consulter la source officielle',
    feedback: 'Signaler un programme manquant',
  },
  es: {
    title: 'No hay información actual verificada sobre los programas',
    description: (name: string) => `Esta página no dispone actualmente de información actualizada y verificada sobre los programas de ${name}. Esto no significa que la universidad no ofrezca programas o no admita estudiantes. Consulte la fuente oficial para conocer los programas y los requisitos de solicitud.`,
    official: 'Consultar la fuente oficial',
    feedback: 'Informar de un programa que falta',
  },
} satisfies Record<PublicLocale, {
  title: string
  description: (name: string) => string
  official: string
  feedback: string
}>

export function UniversityProgramsPending({
  locale,
  universityName,
  officialUrl,
}: {
  locale: PublicLocale
  universityName: string
  officialUrl: string
}) {
  const text = copy[locale]

  return (
    <Card as="div" variant="quiet" data-testid="university-programs-pending">
      <h3 className="atlas-card__title">{text.title}</h3>
      <p className="atlas-card__description">{text.description(universityName)}</p>
      <div className="atlas-card__footer">
        <LinkButton href={officialUrl} variant="secondary">
          {text.official}
        </LinkButton>
        <LinkButton href={`/${locale}/contact`} variant="quiet">
          {text.feedback}
        </LinkButton>
      </div>
    </Card>
  )
}
