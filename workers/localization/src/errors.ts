export class LocalizationError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
    readonly retryAfterSeconds?: number,
  ) {
    super(message)
    this.name = 'LocalizationError'
  }
}

export function asLocalizationError(error: unknown): LocalizationError {
  if (error instanceof LocalizationError) return error
  return new LocalizationError(
    error instanceof Error ? error.message.slice(0, 500) : 'Unknown localization error',
    'localization_internal_error',
    true,
  )
}

