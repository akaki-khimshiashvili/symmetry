export const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8000/api').replace(/\/$/, '');
export const SITE_URL = (import.meta.env.VITE_SITE_URL || 'http://localhost:4321').replace(/\/$/, '');

export type L10n = { ka: string; en: string };
/** `sale_percent` is this size's own discount (0 = none). */
export interface Size { id?: number; width: number; height: number; price: number; sale_percent?: number; sale_price?: number }
/** Product-wide sale info: the end date (YYYY-MM-DD, inclusive) is shared by all sizes; percent / min_percent / active come from the API. */
export interface Sale { ends_at: string; percent?: number; min_percent?: number; active?: boolean }
export interface Product {
  id?: number;
  slug: string;
  pattern: string;
  orientation: 'portrait' | 'landscape';
  /** "panel" for the two panel types (their shape is `orientation`), otherwise the product type's key (shelf, wall, mirror or one added in the admin). */
  category: string;
  /** პროდუქტის განზომილება: a key from the dimension list (managed in the admin), one per product. */
  dimension: string;
  featured: boolean;
  /** Out-of-stock products are shown on the site but can't be ordered. */
  in_stock: boolean;
  sale: Sale;
  published: boolean;
  sort: number;
  name: L10n;
  short: L10n;
  description: L10n;
  material: L10n;
  delivery_days: { min: number; max: number };
  /** Installation time in minutes (shown as hours + minutes). */
  installation_minutes: number;
  sizes: Size[];
  images: { id: number; url: string }[];
  updated_at?: string;
}
export interface Order {
  id: number; product_id: number; product_name: string; size_label: string; price: number;
  first_name: string; last_name: string; phone: string; email: string; client_type: string;
  channel: string; message: string; lang: string; status: string; payment_status: PaymentStatus; created_at: string;
  /** Amount in tetri (GEL × 100). */
  amount: number; currency: string;
  /** Pieces of this design and size; `price` / `list_price` are totals, `unit_price` is one piece (null on older orders). */
  quantity: number; unit_price: number | null;
  list_price: number | null; sale_percent: number; card_mask: string; card_type: string; payment_error: string; payment_test: number;
  flitt_order_id: string; pay_token: string; held_at: string | null;
  /** Payment statuses whose receipt has been emailed, comma-separated. */
  receipt_emailed: string; receipt_emailed_at: string | null; captured_at: string | null; released_at: string | null;
}
export type PaymentStatus = 'unpaid' | 'pending' | 'held' | 'captured' | 'released' | 'refunded' | 'declined' | 'expired';
export interface PaymentConfig { enabled: boolean; test: boolean; hold_days: number; mail: 'smtp' | 'outbox' }
export const PAYMENT: Record<PaymentStatus, { label: string; hint: string }> = {
  unpaid: { label: 'გადახდის გარეშე', hint: 'მოთხოვნა ონლაინ გადახდის გარეშე.' },
  pending: { label: 'გადახდა არ დასრულებულა', hint: 'მომხმარებელი გადავიდა გადახდის გვერდზე, მაგრამ გადახდა ჯერ არ დაუსრულებია.' },
  held: { label: 'თანხა დაბლოკილია', hint: 'თანხა ბარათზე დაბლოკილია, მაგრამ ჯერ არ ჩამოჭრილა. დაადასტურეთ ან უარყავით შეკვეთა.' },
  captured: { label: 'გადახდილია', hint: 'შეკვეთა დადასტურდა და თანხა ჩამოიჭრა.' },
  released: { label: 'უარყოფილი, თანხა გათავისუფლდა', hint: 'დაბლოკილი თანხა დაუბრუნდა მომხმარებელს. არაფერი ჩამოჭრილა.' },
  refunded: { label: 'თანხა დაბრუნებულია', hint: 'ჩამოჭრილი თანხა დაუბრუნდა მომხმარებელს.' },
  declined: { label: 'გადახდა უარყო ბანკმა', hint: 'ბარათით გადახდა ვერ შესრულდა. მომხმარებელს შეუძლია თავიდან სცადოს.' },
  expired: { label: 'ვადა გავიდა', hint: 'გადახდის ან დაბლოკვის ვადა ამოიწურა. თანხა არ ჩამოჭრილა.' },
};
export interface Message {
  id: number; first_name: string; last_name: string; phone: string; email: string; client_type: string;
  channel: string; intent: string; message: string; lang: string; status: string; created_at: string;
}
export type Settings = Record<string, string>;

/** Invoice line: quantities and prices are kept as typed (strings) in the editor, numbers from the API. */
export interface InvoiceItem { description: string; qty: number | string; unit: string; price: number | string }
export type InvoiceStatus = 'draft' | 'issued' | 'paid' | 'cancelled';
export interface InvoiceSeller {
  legal_name: string; tax_id: string; address_ka: string; address_en: string; phone: string; email: string;
  bank_name: string; bank_swift: string; iban: string;
}
export interface Invoice {
  id: number | null; number: string | null; status: InvoiceStatus; lang: 'ka' | 'en'; order_id: number | null;
  /** YYYY-MM-DD */
  issue_date: string; due_date: string;
  client_name: string; client_tax_id: string; client_address: string; client_phone: string; client_email: string;
  items: InvoiceItem[]; vat: boolean; notes: string; seller: InvoiceSeller;
  totals?: { total: number; vat: number; net: number };
  issued_at?: string | null; paid_at?: string | null; created_at?: string; updated_at?: string;
}
export const INVOICE_STATUS: Record<InvoiceStatus, string> = {
  draft: 'პროექტი', issued: 'გაცემული', paid: 'გადახდილი', cancelled: 'გაუქმებული',
};

/** One period's headline figures (GET /admin/metrics). */
export interface PeriodTotals {
  visitors: number; pageviews: number; product_views: number; contacts: number;
  orders: number; sales: number; revenue: number; messages: number; conversion: number; aov: number;
}
export interface SeriesPoint { date: string; visitors: number; views: number; orders: number; messages: number; revenue: number }
export interface ProductMetric {
  id: number; name: string; slug: string; published: number; in_stock: number; category: string; orientation: string; image: string | null;
  views: number; viewers: number; orders: number; sales: number; revenue: number; conversion: number;
}
export type KeyCount = { key: string; n: number };
export type Mix = { key: string; orders: number; messages: number };
export interface Metrics {
  days: number; by_month: boolean;
  current: PeriodTotals; previous: PeriodTotals;
  series: SeriesPoint[];
  funnel: { key: 'visitors' | 'product_viewers' | 'orders' | 'sales'; n: number }[];
  products: ProductMetric[];
  sizes: { product: string; size: string; orders: number }[];
  types: { key: string; orders: number; revenue: number }[];
  sales: {
    by_status: Record<string, number>; by_payment: Record<string, number>;
    held_sum: number; held_count: number; refunded_sum: number; abandoned: number;
    discount_orders: number; discount_given: number; open: number;
  };
  customers: { client_types: Mix[]; channels: Mix[]; langs: Mix[]; repeat: number; unique: number };
  messages: { by_intent: Record<string, number>; by_status: Record<string, number>; waiting: number; oldest_waiting: string | null };
  traffic: {
    pages: { key: string; n: number; u: number }[]; referrers: KeyCount[]; direct: number;
    devices: KeyCount[]; langs: KeyCount[]; contacts: KeyCount[]; tracking_since: string | null;
  };
}
export const PERIODS: { days: number; label: string }[] = [
  { days: 7, label: '7 დღე' }, { days: 30, label: '30 დღე' }, { days: 90, label: '90 დღე' }, { days: 365, label: '12 თვე' },
];
export interface TextOption { id: number; ka: string; en: string }
export interface SizeOption { id: number; width: number; height: number }
/** A product type or dimension: `key` is what products store and the site filters on. Built-in ones can't be deleted. */
export interface KeyedOption extends TextOption { key: string; builtin: boolean }
/** Saved dropdown lists for the product editor. Sizes are in centimetres. */
export interface OptionSet { material: TextOption[]; size: SizeOption[]; type: KeyedOption[]; dimension: KeyedOption[] }

/** The home page shows this many featured products (same limit as the API). */
export const FEATURED_MAX = 4;

export class ApiError extends Error {
  constructor(public status: number, message: string, public fields: Record<string, string> = {}) {
    super(message);
  }
}

const TOKEN_KEY = 'symmetry-admin-token';
export const auth = {
  get: () => localStorage.getItem(TOKEN_KEY) || '',
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void) => (onUnauthorized = fn);

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = auth.get();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: opts.method || (opts.body || opts.form ? 'POST' : 'GET'),
      headers,
      body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    });
  } catch {
    throw new ApiError(0, 'სერვერთან კავშირი ვერ დამყარდა. შეამოწმეთ, რომ API გაშვებულია.');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/admin/login') {
    auth.clear();
    onUnauthorized();
  }
  if (!res.ok) throw new ApiError(res.status, data.error || 'მოთხოვნა ვერ შესრულდა', data.fields || {});
  return data as T;
}

export const CLIENT_TYPES: Record<string, string> = {
  restaurant: 'რესტორანი / კაფე',
  office: 'ოფისი / კომერციული',
  designer: 'ინტერიერის დიზაინერი',
  hotel: 'სასტუმრო',
  individual: 'კერძო პირი',
  other: 'სხვა',
};
export const CHANNELS: Record<string, string> = { whatsapp: 'WhatsApp', email: 'ელ-ფოსტა', phone: 'ზარი' };
/**
 * Product types (პროდუქტის ტიპი) and dimensions (პროდუქტის განზომილება) come from the database
 * (OptionSet.type / .dimension) and can be extended in the admin. The two panel types store
 * category "panel" plus their shape as the orientation; every other type stores its key as the category.
 */
export const PANEL_TYPES = ['portrait', 'landscape'] as const;
export const isPanelType = (key: string) => (PANEL_TYPES as readonly string[]).includes(key);
/** Short explanations shown under the built-in choices (added ones show their English name). */
export const TYPE_HINTS: Record<string, string> = {
  portrait: 'მაღალი, ვიწრო პანელი', landscape: 'ფართო პანელი', shelf: 'პარამეტრული თარო',
  wall: 'მთელი კედლის ინსტალაცია', mirror: 'პარამეტრული ჩარჩოთი',
};
export const DIMENSION_HINTS: Record<string, string> = {
  portrait: 'ვერტიკალური, მაღალი ფორმა', landscape: 'ფართო, ჰორიზონტალური ფორმა', wall: 'მთელ კედელზე',
};
export const typeOf = (p: Pick<Product, 'category' | 'orientation'>): string =>
  p.category === 'panel' || !p.category ? p.orientation : p.category;
/** Georgian name of a type key, or the key itself when the list doesn't have it. */
export const labelOf = (list: KeyedOption[] | undefined, key: string) => list?.find((o) => o.key === key)?.ka ?? key;
export const typeLabel = (p: Pick<Product, 'category' | 'orientation'>, types?: KeyedOption[]) => labelOf(types, typeOf(p));
/**
 * A home-page collection card (the slider under "კოლექცია"). `type` is a product type key: the card links
 * to the catalogue filtered by it. `image` is the cover photo (cropped to 4:5), '' = the type's product photo.
 */
export interface Collection { id: number; type: string; title: L10n; text: L10n; image: string; published: boolean; sort: number }
/** Width / height of a collection tile on the home page. */
export const COLLECTION_RATIO = 4 / 5;
export const ORIENTATIONS: Record<string, string> = { portrait: 'ვერტიკალური დიზაინი', landscape: 'ჰორიზონტალური დიზაინი' };
export const PATTERNS: Record<string, string> = {
  wave: 'ტალღა', dune: 'დიუნა', ripple: 'ექო (წრიული)', twist: 'სპირალი', prism: 'პრიზმა', mosaic: 'მოზაიკა',
};

const MONTHS = ['იან', 'თებ', 'მარ', 'აპრ', 'მაი', 'ივნ', 'ივლ', 'აგვ', 'სექ', 'ოქტ', 'ნოე', 'დეკ'];
export const fmtDate = (s: string) => {
  const d = new Date(s.replace(' ', 'T') + 'Z');
  if (isNaN(+d)) return s;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${p(d.getHours())}:${p(d.getMinutes())}`;
};
/** "2026-11-05" → "5 ნოე"; "2026-11" → "ნოე 2026". */
export const fmtDay = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return d ? `${d} ${MONTHS[m - 1]}` : `${MONTHS[m - 1]} ${y}`;
};
export const fmtNum = (n: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(n).replace(/,/g, ' ');
export const fmtPrice = (n: number) => `₾ ${new Intl.NumberFormat('en-US').format(n).replace(/,/g, ' ')}`;
