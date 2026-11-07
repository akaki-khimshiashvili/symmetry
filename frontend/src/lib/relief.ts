/**
 * Parametric relief generator.
 * Produces an inline SVG of a wooden 3D panel from a height field, lit from the upper left.
 * Colours are never baked in: every face uses a shade class (f0–f11 / s0–s11) that mixes
 * the active palette's --wood-lo and --wood-hi, so reliefs reskin when the palette changes.
 */

export type Pattern = 'wave' | 'dune' | 'ripple' | 'twist' | 'prism' | 'mosaic';

interface Opts {
  pattern: string;
  width?: number;      // viewBox width
  height?: number;     // viewBox height
  seed?: number;
  mirror?: boolean;    // book-match: render the mirrored leaf
  uid?: string;
  density?: number;    // ribs / cells multiplier
  depth?: number;      // relief strength for rib patterns
  className?: string;
  label?: string;
}

const LEVELS = 12;
const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const TAU = Math.PI * 2;

function rng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Height fields: u,v in 0..1 across the panel, a = aspect (w/h). Return 0..1. */
const fields: Record<string, (u: number, v: number, a: number) => number> = {
  wave: (u, v) => 0.5 + 0.5 * Math.sin(TAU * (u * 1.15 + 0.22 * Math.sin(TAU * (v * 0.85 + u * 0.35)))),
  dune: (u, v) =>
    0.5 + 0.5 * Math.sin(TAU * (v * 2.1 + 0.2 * Math.sin(TAU * u * 1.25) + 0.07 * Math.sin(TAU * u * 3.3 + 1.3))),
  ripple: (u, v, a) => {
    const dx = (u - 0.36) * a;
    const dy = v - 0.58;
    const d = Math.sqrt(dx * dx + dy * dy);
    return 0.5 + 0.5 * Math.cos(TAU * d * 4.2) * Math.exp(-d * 0.9);
  },
  twist: (u, v) => 0.5 + 0.5 * Math.sin(TAU * (u * 2.4 + v * 1.1 + 0.15 * Math.sin(TAU * v))),
};

const LIGHT = (() => {
  const l = [-0.62, -0.48, 0.62];
  const m = Math.hypot(...l);
  return l.map((x) => x / m);
})();

function shadeAt(f: (u: number, v: number, a: number) => number, u: number, v: number, a: number, relief: number) {
  const e = 0.004;
  const hx = (f(u + e, v, a) - f(u - e, v, a)) / (2 * e);
  const hy = (f(u, v + e, a) - f(u, v - e, a)) / (2 * e);
  const n = [-hx * relief, -hy * relief, 1];
  const m = Math.hypot(...n);
  const lambert = (n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]) / m;
  const h = f(u, v, a);
  return clamp(0.12 + (lambert - 0.25) * 1.05 + (h - 0.5) * 0.18);
}

const lvl = (s: number) => Math.round(clamp(s) * (LEVELS - 1));

export function relief(o: Opts): string {
  const W = o.width ?? 800;
  const H = o.height ?? 1000;
  const a = W / H;
  const uid = o.uid ?? `r${Math.random().toString(36).slice(2, 8)}`;
  const density = o.density ?? 1;
  const pattern = o.pattern in fields || o.pattern === 'prism' || o.pattern === 'mosaic' ? o.pattern : 'wave';
  let body = '';
  let defs = '';

  if (pattern === 'prism' || pattern === 'mosaic') {
    const cols = Math.max(4, Math.round(9 * density * Math.max(1, a)));
    const cell = W / cols;
    const rows = Math.ceil(H / cell);
    const rand = rng(o.seed ?? 7);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const x = i * cell;
        const y = j * cell;
        const u = (i + 0.5) / cols;
        const v = (j + 0.5) / rows;
        const field = 0.5 + 0.5 * Math.sin(TAU * (u * 0.9 + v * 0.7)) * Math.cos(TAU * (v * 0.6 - u * 0.3));
        if (pattern === 'prism') {
          const k = 0.35 + 0.65 * field;
          const cx = x + cell / 2 + (rand() - 0.5) * cell * 0.12;
          const cy = y + cell / 2 + (rand() - 0.5) * cell * 0.12;
          const g = 0.6;
          const x2 = x + cell;
          const y2 = y + cell;
          const tri = (pts: number[], s: number) =>
            `<polygon class="f${lvl(s)}" points="${pts.map((p) => p.toFixed(1)).join(' ')}"/>`;
          body +=
            tri([x + g, y + g, x2 - g, y + g, cx, cy], 0.55 + 0.4 * k) +
            tri([x + g, y + g, cx, cy, x + g, y2 - g], 0.45 + 0.3 * k) +
            tri([x2 - g, y + g, x2 - g, y2 - g, cx, cy], 0.32 - 0.22 * k) +
            tri([x + g, y2 - g, cx, cy, x2 - g, y2 - g], 0.2 - 0.14 * k);
        } else {
          const h = clamp(field * 0.75 + rand() * 0.35);
          const inset = cell * 0.06;
          const off = cell * (0.05 + h * 0.16);
          const s = cell - inset * 2;
          body +=
            `<rect class="f0" opacity="${(0.45 + h * 0.5).toFixed(2)}" x="${(x + inset + off).toFixed(1)}" y="${(y + inset + off).toFixed(1)}" width="${s.toFixed(1)}" height="${s.toFixed(1)}"/>` +
            `<rect class="f${lvl(0.3 + h * 0.62)}" x="${(x + inset).toFixed(1)}" y="${(y + inset).toFixed(1)}" width="${s.toFixed(1)}" height="${s.toFixed(1)}"/>` +
            `<rect class="f${lvl(0.55 + h * 0.45)}" x="${(x + inset).toFixed(1)}" y="${(y + inset).toFixed(1)}" width="${s.toFixed(1)}" height="${(cell * 0.05).toFixed(1)}"/>`;
        }
      }
    }
  } else {
    const f = fields[pattern];
    const ribs = Math.max(10, Math.round(30 * density * Math.sqrt(a)));
    const pitch = W / ribs;
    const ribW = pitch * 0.8;
    const stops = 10;
    for (let i = 0; i < ribs; i++) {
      const u = (i + 0.5) / ribs;
      const id = `${uid}g${i}`;
      const shades = Array.from({ length: stops }, (_, k) => lvl(shadeAt(f, u, k / (stops - 1), a, o.depth ?? 0.32)));
      // Inside a run of equal shades only its two ends matter (the gradient is flat between them):
      // dropping the middle stops draws the same pixels with far fewer DOM nodes.
      let st = '';
      for (let k = 0; k < stops; k++) {
        if (k > 0 && k < stops - 1 && shades[k] === shades[k - 1] && shades[k] === shades[k + 1]) continue;
        st += `<stop offset="${(k / (stops - 1)).toFixed(3)}" class="s${shades[k]}"/>`;
      }
      defs += `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">${st}</linearGradient>`;
      const x = i * pitch + (pitch - ribW) / 2;
      body += `<rect x="${x.toFixed(1)}" y="0" width="${ribW.toFixed(1)}" height="${H}" fill="url(#${id})"/>`;
      body += `<rect x="${x.toFixed(1)}" y="0" width="${ribW.toFixed(1)}" height="${H}" fill="url(#${uid}bevel)"/>`;
    }
    defs += `<linearGradient id="${uid}bevel" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset=".18" stop-color="#fff" stop-opacity="0"/><stop offset=".7" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".32"/></linearGradient>`;
  }

  const flip = o.mirror ? ` transform="translate(${W} 0) scale(-1 1)"` : '';
  const aria = o.label ? `role="img" aria-label="${o.label.replace(/"/g, '&quot;')}"` : 'aria-hidden="true"';
  return `<svg class="rl ${o.className ?? ''}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" ${aria} focusable="false"><defs>${defs}</defs><rect class="rl-ground" width="${W}" height="${H}"/><g${flip}>${body}</g></svg>`;
}

/** Stable per-slug seed so a product always draws the same leaf. */
export const seedFrom = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);
