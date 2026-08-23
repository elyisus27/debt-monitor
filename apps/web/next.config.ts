import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // apps/api sirve las fotos en /media/... -- reescribimos para que el
  // navegador las pida al mismo origen que la página (evita configurar CORS
  // de imágenes aparte, y significa una sola URL a cambiar si el API se mueve).
  async rewrites() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
    return [
      { source: '/api/:path*', destination: `${apiUrl}/api/:path*` },
      { source: '/media/:path*', destination: `${apiUrl}/media/:path*` },
    ];
  },
};

export default nextConfig;
