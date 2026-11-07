import { defineConfig, loadEnv, type Plugin } from 'vite';
import preact from '@preact/preset-vite';

/**
 * Content-Security-Policy for the built admin (a <meta> tag, so it works on any static host): only the
 * admin's own scripts and styles run, and the browser may only talk to the API. Build only: the dev
 * server injects inline scripts of its own.
 */
function csp(apiUrl: string): Plugin {
  const api = new URL(apiUrl).origin;
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "style-src-attr 'unsafe-inline'",
    `connect-src 'self' ${api}`,
    `img-src 'self' data: blob: ${api}`,
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  return {
    name: 'symmetry-admin-csp',
    apply: 'build',
    transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' }],
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [preact(), csp(env.VITE_API_URL || 'http://localhost:8000/api')],
    base: './',
    // The dev server may read the admin itself and the one shared folder it imports from the site
    // (relief.ts, palettes.css). Not the whole repository: that holds the database and config.local.php.
    server: { port: 5173, fs: { allow: ['.', '../frontend/src'] } },
  };
});
