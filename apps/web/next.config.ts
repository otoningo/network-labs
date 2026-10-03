import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // Los paquetes internos exportan TypeScript fuente (ver D-004).
  transpilePackages: ['@nos/core', '@nos/vendors'],
  turbopack: { root: fileURLToPath(new URL('../..', import.meta.url)) },
};

export default config;
