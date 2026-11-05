import fs from 'node:fs';
import path from 'node:path';
import type { Lang } from '../i18n/ui';

export type L10n = { ka: string; en: string };
/** `price` is the regular price; `sale_price` (from the API) is what the customer pays today. */
export interface Size { id: number; width: number; height: number; price: number; sale_percent?: number; sale_price?: number }
/** Summary of the per-size sale: biggest / smallest discount, shared end date, running today. */
export interface Sale { percent: number; min_percent?: number; ends_at: string; active: boolean }
export interface Product {
  id: number;
  slug: string;
  pattern: string;
  orientation: 'portrait' | 'landscape';
  featured: boolean;
  /** Missing (seed data) counts as in stock. */
  in_stock?: boolean;
  sale?: Sale;
  name: L10n;
  short: L10n;
  description: L10n;
  material: L10n;
  delivery_days: { min: number; max: number };
  installation_minutes: number;
  sizes: Size[];
  images: { id: number; url: string }[];
}
export interface Settings {
  phone: string;
  whatsapp: string;
  email: string;
  instagram: string;
  facebook: string;
  tiktok: string;
  address_ka: string;
  address_en: string;
  hours_ka: string;
  hours_en: string;
  default_palette: string;
  /** Online payment (Flitt) is switched on in the API. */
  payments?: boolean;
}

export const API_URL = (import.meta.env.PUBLIC_API_URL || 'http://localhost:8000/api').replace(/\/$/, '');

let cache: { products: Product[]; settings: Settings } | null = null;

function fromSeed() {
  const file = path.resolve(process.cwd(), '../backend/data/seed.json');
  const seed = JSON.parse(fs.readFileSync(file, 'utf8'));
  let sizeId = 1;
  const products: Product[] = seed.products.map((p: any, i: number) => ({
    id: i + 1,
    images: [],
    ...p,
    sizes: p.sizes.map((s: any) => ({ id: sizeId++, ...s })),
  }));
  products.forEach((p) => (p.orientation ||= orientationOf(p)));
  return { products, settings: seed.settings as Settings };
}

/**
 * Loads catalogue data at build time from the PHP API.
 * Falls back to the seed file so the site always builds, even with the API offline.
 */
export async function loadData() {
  // The build reads the API once; the dev server re-reads it so admin/config changes show on reload.
  if (cache && !import.meta.env.DEV) return cache;
  try {
    const ctrl = AbortSignal.timeout(4000);
    const [p, s] = await Promise.all([
      fetch(`${API_URL}/products`, { signal: ctrl }),
      fetch(`${API_URL}/settings`, { signal: ctrl }),
    ]);
    if (!p.ok || !s.ok) throw new Error(`API responded ${p.status}/${s.status}`);
    cache = { products: await p.json(), settings: await s.json() };
    cache.products.forEach((p) => (p.orientation ||= orientationOf(p)));
    console.log(`[symmetry] loaded ${cache.products.length} products from ${API_URL}`);
  } catch (err) {
    console.warn(`[symmetry] API unavailable (${(err as Error).message}); using backend/data/seed.json`);
    cache = fromSeed();
  }
  return cache;
}

export function orientationOf(p: Pick<Product, 'sizes'>): 'portrait' | 'landscape' {
  const s = p.sizes[0];
  return s && s.height > s.width ? 'portrait' : 'landscape';
}

export const priceFmt = (n: number) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n).replace(/,/g, ' ');

export const nowPrice = (s: Size) => s.sale_price ?? s.price;
export const onSale = (p: Product) => !!p.sale?.active && p.sale.percent > 0;
/** Is this size discounted today? */
export const sizeOnSale = (s: Size) => nowPrice(s) < s.price;
/** Do all discounted sizes share one percentage? (Otherwise cards say "up to".) */
export const saleUniform = (p: Product) => !p.sale?.min_percent || p.sale.min_percent === p.sale.percent;
/** Lowest price a customer pays today (sale included). */
export const minPrice = (p: Product) => Math.min(...p.sizes.map(nowPrice));
/** Regular price of the size that is cheapest today (crossed out when that size is on sale). */
export const minListPrice = (p: Product) => {
  const cheapest = p.sizes.reduce((a, b) => (nowPrice(b) < nowPrice(a) ? b : a), p.sizes[0]);
  return cheapest && sizeOnSale(cheapest) ? cheapest.price : null;
};

export const loc = (v: L10n, lang: Lang) => v[lang] || v.ka || v.en;

export const specimenNo = (i: number) => `№ ${String(i + 1).padStart(2, '0')}`;

export function waLink(number: string, text: string) {
  const digits = number.replace(/\D/g, '');
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export const telLink = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;
