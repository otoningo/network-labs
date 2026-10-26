import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // Los paquetes internos exportan TypeScript fuente (ver D-004).
  transpilePackages: ['@nos/core', '@nos/vendors'],
  turbopack: { root: fileURLToPath(new URL('../..', import.meta.url)) },
  // El layout raíz vive en [locale]: las direcciones que no existen se sirven con app/global-not-found.tsx.
  experimental: { globalNotFound: true },
};

export default config;
