import { getTodayDate } from '../../src/lib/data/freshness'

/** Resolves the China-calendar date used by the data validation gate. */
export function resolveDataValidationDate(
  explicitDate = process.env.DATA_VALIDATION_DATE,
  now = new Date(),
): string {
  return (explicitDate || getTodayDate(now)).slice(0, 10)
}
