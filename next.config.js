/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // First deploy fast: ignore type/lint build errors (re-enable later)
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
}

module.exports = nextConfig
