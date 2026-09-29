type PreviewEnvironment = {
  CONTENT_PREVIEW?: string
  NODE_ENV?: string
  VERCEL_ENV?: string
}

/** Drafts are permitted only in explicit preview or local development runtimes. */
export function isContentPreviewEnabled(environment: PreviewEnvironment): boolean {
  if (environment.CONTENT_PREVIEW !== 'true' || environment.VERCEL_ENV === 'production') return false
  return environment.VERCEL_ENV === 'preview'
    || environment.NODE_ENV === 'development'
    || environment.NODE_ENV === 'test'
}
