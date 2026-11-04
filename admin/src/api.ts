export const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8000/api').replace(/\/$/, '');
export const SITE_URL = (import.meta.env.VITE_SITE_URL || 'http://localhost:4321').replace(/\/$/, '');

export type L10n = { ka: string; en: string };
export interface Size { id?: number; width: number; height: number; price: number }
export interface Product {
  id?: number;
  slug: string;
  pattern: string;
  orientation: 'portrait' | 'landscape';
  featured: boolean;
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
  channel: string; message: string; lang: string; status: string; payment_status: string; created_at: string;
}
export interface Message {
  id: number; first_name: string; last_name: string; phone: string; email: string; client_type: string;
  channel: string; intent: string; message: string; lang: string; status: string; created_at: string;
}
export type Settings = Record<string, string>;
export interface TextOption { id: number; ka: string; en: string }
export interface SizeOption { id: number; width: number; height: number }
/** Saved dropdown lists for the product editor. Sizes are in centimetres. */
export interface OptionSet { material: TextOption[]; size: SizeOption[] }

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
