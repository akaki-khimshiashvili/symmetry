// @ts-check
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: process.env.SITE_URL || 'https://symmetry.ge',
  trailingSlash: 'always',
  build: { format: 'directory' },
  server: { port: 4321 },
});
