import type { Locale } from '@/i18n/config'
import type { Program } from './types'

type ProgramDuration = Pick<Program, 'durationMonths' | 'durationMonthsMax' | 'durationText'>

/** Official weeks/semesters stay as text; they never imply an integer month count. */
export function hasConfirmedProgramDuration(program: ProgramDuration): boolean {
  return program.durationMonths !== null
    || Object.values(program.durationText ?? {}).some(value => Boolean(value?.trim()))
}

export function formatProgramDuration(program: ProgramDuration, locale: Locale, monthsLabel: string): string | null {
  const text = program.durationText
  const exact = text && [text[locale], text.en, text.zh, text.ru, ...Object.values(text)]
    .find(value => Boolean(value?.trim()))?.trim()
  if (exact) return exact
  if (program.durationMonths === null) return null
  return program.durationMonthsMax && program.durationMonthsMax !== program.durationMonths
    ? `${program.durationMonths}–${program.durationMonthsMax} ${monthsLabel}`
    : `${program.durationMonths} ${monthsLabel}`
}

/** A textual duration and a month range are not a single ISO-8601 duration. */
export function programIsoDuration(program: ProgramDuration): string | undefined {
  if (program.durationMonths === null
    || program.durationMonthsMax && program.durationMonthsMax !== program.durationMonths) return undefined
  return `P${program.durationMonths}M`
}
