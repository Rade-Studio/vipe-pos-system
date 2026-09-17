/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: false,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  output: 'standalone',
  experimental: {
    outputFileTracingRoot: '/app',
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig