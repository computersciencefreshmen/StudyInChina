import type { NextConfig } from 'next'

const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''} https://challenges.cloudflare.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://challenges.cloudflare.com https://*.vercel-insights.com",
  "frame-src https://challenges.cloudflare.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
].join('; ')

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  outputFileTracingIncludes: {
    // Scoped official names are checked against immutable server-side receipts.
    // Their ledger-provided paths cannot be reliably inferred by static tracing.
    '/*': [
      './quality/minimum-one/*/*/identity-import-receipt.json',
      './quality/maintenance/batches/*/identity-receipt.json',
    ],
    '/api/v1/minimax-verification': ['./content/verification/minimax.json'],
  },
  // These files belong to the local executor and must never enter website bundles.
  outputFileTracingExcludes: {
    '/*': ['./.official-harvest/**/*', './.pipeline-build/**/*', './.tmp/**/*', './.env*', './.vercel/**/*'],
  },
  experimental: {
    globalNotFound: true,
  },
  turbopack: {
    root: process.cwd(),
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: contentSecurityPolicy },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        ],
      },
    ]
  },
}

export default nextConfig
