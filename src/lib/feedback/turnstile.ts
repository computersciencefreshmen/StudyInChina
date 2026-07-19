type TurnstileResponse = {
  success?: boolean
  'error-codes'?: string[]
}

export async function verifyTurnstileToken(
  token: string,
  secret: string,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  if (!secret) throw new Error('TURNSTILE_SECRET_KEY is not configured')

  const form = new URLSearchParams({ secret, response: token })

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5_000)

  try {
    const response = await fetcher(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form,
        cache: 'no-store',
        signal: controller.signal,
      },
    )

    if (!response.ok) throw new Error('Turnstile verification request failed')
    const payload = (await response.json()) as TurnstileResponse
    return payload.success === true
  } finally {
    clearTimeout(timeout)
  }
}
