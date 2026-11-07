import fs from 'node:fs';
import path from 'node:path';
import { type Lang, useT } from '../i18n/ui';

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
  /** "panel" (split by orientation) or a product type key: shelf, wall, mirror or one added in the admin. Missing (older API / seed data) counts as a panel. */
  category?: string;
  /** პროდუქტის განზომილება: a dimension key from the admin's list. Missing (older data) follows the type. */
  dimension?: string;
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
  /** Home page texts set in the admin (home_hero_title_ka, …); read them with homeText(). */
  [key: string]: string | boolean | undefined;
}

/** A home page text from the admin, '' when not set (the caller then uses the site's own wording). */
export const homeText = (s: Settings, key: string, lang: Lang): string => {
  const v = s[`home_${key}_${lang}`];
  return typeof v === 'string' ? v.trim() : '';
};

/** A home-page collection card (managed in the admin): links to the catalogue filtered by `type`. */
export interface Collection { id: number; type: string; title: L10n; text: L10n; image: string }

/** The original three cards, used when the API is offline or older than /collections. */
function starterCollections(): Collection[] {
  const ka = useT('ka') as (k: string) => string;
  const en = useT('en') as (k: string) => string;
  return (['mirror', 'shelf', 'wall'] as const).map((type, i) => ({
    id: -(i + 1), type, image: '',
    title: { ka: ka(`type.${type}`), en: en(`type.${type}`) },
    text: { ka: ka(`type.${type}.d`), en: en(`type.${type}.d`) },
  }));
}

/** A product type or dimension as managed in the admin (GET /taxonomy), in the admin's order. */
export interface TaxItem { key: string; ka: string; en: string; builtin?: boolean }
export interface Taxonomy { types: TaxItem[]; dimensions: TaxItem[] }

/** Used when the API is offline or older than the /taxonomy endpoint. */
const BUILTIN_TAXONOMY: Taxonomy = {
  types: [
    { key: 'portrait', ka: 'ვერტიკალური დიზაინი', en: 'Portrait design', builtin: true },
    { key: 'landscape', ka: 'ჰორიზონტალური დიზაინი', en: 'Landscape design', builtin: true },
    { key: 'shelf', ka: 'თარო', en: 'Shelf', builtin: true },
    { key: 'wall', ka: 'მთლიანი კედელი', en: 'Whole wall', builtin: true },
    { key: 'mirror', ka: 'სარკე', en: 'Mirror', builtin: true },
  ],
  dimensions: [
    { key: 'portrait', ka: 'პორტრეტი', en: 'Portrait', builtin: true },
    { key: 'landscape', ka: 'ჰორიზონტალური დიზაინი', en: 'Landscape', builtin: true },
    { key: 'wall', ka: 'მთლიანი კედელი', en: 'Whole wall', builtin: true },
  ],
};

export const API_URL = (import.meta.env.PUBLIC_API_URL || 'http://localhost:8000/api').replace(/\/$/, '');

let cache: { products: Product[]; settings: Settings; taxonomy: Taxonomy; collections: Collection[] } | null = null;

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
  return { products: stockLast(products), settings: seed.settings as Settings, taxonomy: BUILTIN_TAXONOMY, collections: starterCollections() };
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
    const [p, s, tx, co] = await Promise.all([
      fetch(`${API_URL}/products`, { signal: ctrl }),
      fetch(`${API_URL}/settings`, { signal: ctrl }),
      // Types and dimensions added in the admin; an older API without the endpoint falls back to the built-in lists.
      fetch(`${API_URL}/taxonomy`, { signal: ctrl }).catch(() => null),
      // Home collection cards; an older API without the endpoint falls back to the original three.
      fetch(`${API_URL}/collections`, { signal: ctrl }).catch(() => null),
    ]);
    if (!p.ok || !s.ok) throw new Error(`API responded ${p.status}/${s.status}`);
    const taxonomy: Taxonomy = tx?.ok ? await tx.json() : BUILTIN_TAXONOMY;
    const collections: Collection[] = co?.ok ? await co.json() : starterCollections();
    cache = { products: await p.json(), settings: await s.json(), taxonomy, collections };
    cache.products.forEach((p) => (p.orientation ||= orientationOf(p)));
    cache.products = stockLast(cache.products);
    console.log(`[symmetry] loaded ${cache.products.length} products from ${API_URL}`);
  } catch (err) {
    console.warn(`[symmetry] API unavailable (${(err as Error).message}); using backend/data/seed.json`);
    cache = fromSeed();
  }
  return cache;
}

/** Products that can't be ordered go to the end of every list; otherwise the admin's order is kept (stable sort). */
const stockLast = (list: Product[]) => [...list].sort((a, b) => Number(a.in_stock === false) - Number(b.in_stock === false));

export function orientationOf(p: Pick<Product, 'sizes'>): 'portrait' | 'landscape' {
  const s = p.sizes[0];
  return s && s.height > s.width ? 'portrait' : 'landscape';
}

/**
 * The product type a product belongs to: panels split by shape (portrait / landscape); every other
 * type (shelf, wall, mirror, or one added in the admin) is its own group.
 */
export type Kind = string;
export const dimensionOf = (p: Pick<Product, 'dimension' | 'category' | 'orientation'>): string =>
  p.dimension || (p.category === 'wall' ? 'wall' : p.orientation === 'portrait' ? 'portrait' : 'landscape');
export const kindOf = (p: Pick<Product, 'category' | 'orientation'>): Kind =>
  !p.category || p.category === 'panel' ? p.orientation : p.category;

/** The admin's types and dimensions, from the last loadData() (pages load data before rendering components). */
export const taxonomy = (): Taxonomy => cache?.taxonomy ?? BUILTIN_TAXONOMY;

/**
 * Display name of a type. Built-in types keep the site's own wording (plural for filters and
 * sections, singular on cards); types added in the admin use their admin name in both.
 */
export function typeName(key: string, lang: Lang, form: 'plural' | 'single' = 'plural'): string {
  const item = taxonomy().types.find((x) => x.key === key);
  if (!item || item.builtin) {
    const own = (useT(lang) as (k: string) => string | undefined)(form === 'single' ? `type.${key}.s` : `type.${key}`);
    if (own) return own;
  }
  return item ? loc(item, lang) : key;
}

/** Display name of a dimension (built-in ones keep the site's wording). */
export function dimensionName(key: string, lang: Lang): string {
  const item = taxonomy().dimensions.find((x) => x.key === key);
  if (!item || item.builtin) {
    const own = (useT(lang) as (k: string) => string | undefined)(`dim.${key}`);
    if (own) return own;
  }
  return item ? loc(item, lang) : key;
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
