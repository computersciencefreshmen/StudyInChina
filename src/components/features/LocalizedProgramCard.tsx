import type { ComponentProps } from 'react'
import { containsHan, localize } from '@/lib/data/format'
import { officialDisplayName } from '@/lib/program-display-name'
import { ProgramCard } from './RecordCards'

export function LocalizedProgramCard(props: ComponentProps<typeof ProgramCard>) {
  const name = localize(props.program.name, props.locale)
  if (props.locale !== 'en' || !containsHan(name)) return <ProgramCard {...props} displayName={name} />
  return officialDisplayName(props.program, props.university, props.locale).then(displayName => <ProgramCard {...props} displayName={displayName} />)
}
