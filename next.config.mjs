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
  // socket.io requests `/socket.io/?EIO=4...`; Next's default 308 to the
  // slash-less path would never reach the rewrite below.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${apiProxyTarget}/api/:path*` },
      // The socket.io handshake is `/socket.io/?EIO=4...`: an empty `:path*`
      // would drop the trailing slash the API's engine.io requires.
      { source: '/socket.io/', destination: `${apiProxyTarget}/socket.io/` },
      { source: '/socket.io/:path*', destination: `${apiProxyTarget}/socket.io/:path*` },
    ]
  },
}

export default nextConfig
