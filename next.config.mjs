// Where the dev server proxies the API. Server-side only, read when Next loads
// this file; the browser always calls its own origin (`/api`, `/socket.io`).
// In production the reverse proxy routes both paths to the API first.
const apiProxyTarget = (process.env.API_PROXY_TARGET ?? 'http://localhost:4000').replace(/\/+$/, '')

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
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${apiProxyTarget}/api/:path*` },
      { source: '/socket.io/:path*', destination: `${apiProxyTarget}/socket.io/:path*` },
    ]
  },
}

export default nextConfig
