// @ts-check
import { defineConfig } from 'astro/config';
import { loadEnv } from 'vite';

// The API serves the uploaded photos; Astro may fetch them at build time to make small, cached copies.
const env = loadEnv(process.env.NODE_ENV ?? 'production', process.cwd(), '');
const api = new URL(env.PUBLIC_API_URL || 'http://localhost:8000/api');

export default defineConfig({
  site: process.env.SITE_URL || 'https://symmetry.ge',
  trailingSlash: 'always',
  build: {
    format: 'directory',
    // The stylesheets are a few KiB each: inline them so they don't block the first paint.
    inlineStylesheets: 'always',
  },
  image: {
    remotePatterns: [{ protocol: api.protocol.replace(':', ''), hostname: api.hostname, ...(api.port ? { port: api.port } : {}) }],
  },
  // The 3D wall runs in a module worker (src/lib/slatwall.worker.ts).
  vite: { worker: { format: 'es' } },
  server: { port: 4321 },
});
