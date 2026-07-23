export class IngestionError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
    readonly retryAfterSeconds?: number,
  ) {
    super(message)
    this.name = 'IngestionError'
  }
}

export function asIngestionError(error: unknown): IngestionError {
  if (error instanceof IngestionError) return error
  const message = error instanceof Error ? error.message : String(error)
  return new IngestionError(message, 'unexpected_error', true)
}
