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
  /** Wall panel, shelf or whole wall (shown as separate sections on the site). */
  category: 'panel' | 'shelf' | 'wall';
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
  amount: number; currency: string; list_price: number | null; sale_percent: number; card_mask: string; card_type: string; payment_error: string; payment_test: number;
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
export interface TextOption { id: number; ka: string; en: string }
export interface SizeOption { id: number; width: number; height: number }
/** Saved dropdown lists for the product editor. Sizes are in centimetres. */
export interface OptionSet { material: TextOption[]; size: SizeOption[] }

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
export const CATEGORIES: Record<string, string> = { panel: 'კედლის პანელი', shelf: 'თარო', wall: 'მთლიანი კედელი' };
/** The one "type" choice in the admin: panels split by shape, then shelves and whole walls. */
export type ProductType = 'portrait' | 'landscape' | 'shelf' | 'wall';
export const PRODUCT_TYPES: { key: ProductType; label: string; hint: string }[] = [
  { key: 'portrait', label: 'ვერტიკალური დიზაინი', hint: 'მაღალი, ვიწრო პანელი' },
  { key: 'landscape', label: 'ჰორიზონტალური დიზაინი', hint: 'ფართო პანელი' },
  { key: 'shelf', label: 'თარო', hint: 'პარამეტრული თარო' },
  { key: 'wall', label: 'მთლიანი კედელი', hint: 'მთელი კედლის ინსტალაცია' },
];
export const typeOf = (p: Pick<Product, 'category' | 'orientation'>): ProductType =>
  p.category === 'shelf' || p.category === 'wall' ? p.category : p.orientation;
export const typeLabel = (p: Pick<Product, 'category' | 'orientation'>) => PRODUCT_TYPES.find((t) => t.key === typeOf(p))!.label;
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
export const fmtPrice = (n: number) => `₾ ${new Intl.NumberFormat('en-US').format(n).replace(/,/g, ' ')}`;
