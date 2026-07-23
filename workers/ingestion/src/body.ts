import { IngestionError } from './errors'

export async function readBoundedBody(
  response: Response,
  maximumBytes: number,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const declaredLength = response.headers.get('content-length')
  if (declaredLength && Number(declaredLength) > maximumBytes) {
    throw new IngestionError(
      `Response Content-Length exceeds ${maximumBytes} bytes`,
      'response_too_large',
      false,
    )
  }
  if (!response.body) {
    throw new IngestionError('Response body is empty', 'empty_response', false)
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0
  let rejectAbort: ((reason: IngestionError) => void) | undefined
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject
  })
  const abort = () => {
    rejectAbort?.(new IngestionError('Response body timed out', 'response_timeout', true))
    void reader.cancel('response_timeout').catch(() => undefined)
  }
  signal?.addEventListener('abort', abort, { once: true })

  try {
    if (signal?.aborted) abort()
    while (true) {
      const { done, value } = await Promise.race([reader.read(), aborted])
      if (signal?.aborted) {
        throw new IngestionError('Response body timed out', 'response_timeout', true)
      }
      if (done) break
      byteLength += value.byteLength
      if (byteLength > maximumBytes) {
        await reader.cancel('response_too_large').catch(() => undefined)
        throw new IngestionError(
          `Response body exceeds ${maximumBytes} bytes`,
          'response_too_large',
          false,
        )
      }
      chunks.push(value)
    }
  } finally {
    signal?.removeEventListener('abort', abort)
  }

  if (byteLength === 0) {
    throw new IngestionError('Response body is empty', 'empty_response', false)
  }
  const body = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body.buffer
}
