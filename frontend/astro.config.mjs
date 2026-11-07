// @ts-check
import { defineConfig } from 'astro/config';
import { loadEnv } from 'vite';
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Astro's CSP hashes the scripts it bundles, but not `<script is:inline>` (ours run before first paint:
 * the js class, the header state, scroll restore, the hero entrance). After the build, hash every inline
 * script exactly as written into each page and add it to that page's policy, so they run and nothing else does.
 */
function cspInlineScripts() {
  const files = async (dir) => (await readdir(dir, { withFileTypes: true, recursive: true }))
    .filter((d) => d.isFile() && d.name.endsWith('.html')).map((d) => join(d.parentPath, d.name));
  return {
    name: 'symmetry-csp-inline-scripts',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        let pages = 0;
        for (const file of await files(fileURLToPath(dir))) {
          let html = await readFile(file, 'utf8');
          const meta = html.match(/<meta http-equiv="content-security-policy" content="([^"]*)"/i);
          if (!meta) continue;
          const hashes = new Set();
          for (const [, attrs, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
            if (/\bsrc\s*=/i.test(attrs) || !body.trim()) continue;
            // Browsers hash the text after HTML parsing, which turns CRLF / CR into LF.
            hashes.add(`'sha256-${createHash('sha256').update(body.replace(/\r\n?/g, '\n')).digest('base64')}'`);
          }
          const missing = [...hashes].filter((h) => !meta[1].includes(h));
          if (!missing.length) continue;
          const policy = meta[1].replace(/script-src ([^;]*)/, (all, list) => `script-src ${list.trim()} ${missing.join(' ')}`);
          html = html.replace(meta[0], meta[0].replace(meta[1], policy));
          await writeFile(file, html);
          pages++;
        }
        logger.info(`inline script hashes added to the CSP of ${pages} pages`);
      },
    },
  };
}

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
  // Content-Security-Policy (a <meta> tag on every page): Astro hashes each script and stylesheet it emits,
  // so only the site's own code runs. The browser may talk to this site and the API, nothing else.
  // frame-ancestors can't be set from <meta>: netlify.toml sends it as a header.
  security: {
    csp: {
      directives: [
        "default-src 'self'",
        `connect-src 'self' ${api.origin}`,
        `img-src 'self' data: blob: ${api.origin}`,
        "font-src 'self'",
        "worker-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ],
      // Inline style="" attributes (layout variables such as --d) are allowed; style elements stay hashed.
      styleDirective: { resources: ["'self'", { resource: "'unsafe-inline'", kind: 'attribute' }] },
    },
  },
  integrations: [cspInlineScripts()],
  // The 3D wall runs in a module worker (src/lib/slatwall.worker.ts).
  vite: { worker: { format: 'es' } },
  server: { port: 4321 },
});
