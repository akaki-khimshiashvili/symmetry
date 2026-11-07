import { useEffect, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { api, type Product, type Settings, SITE_URL, FEATURED_MAX } from '../api';
import { Icon, Loading, toast } from '../ui';
import { Collections } from '../collection';
import { Preview } from './Preview';

/** The site's built-in wording, shown as placeholders: an empty field keeps it. */
const DEFAULTS: Record<string, string> = {
  home_hero_title_ka: 'სივრცის ახალი განზომილება.',
  home_hero_title_en: 'Where form becomes art.',
  home_hero_lead_ka: '3D პარამეტრული კედლის დეკორი და სკულპტურული პანელები, შექმნილი საქართველოში.',
  home_hero_lead_en: '3D parametric wall art and sculptural panels, designed and made in Georgia.',
};

/** The page's sections, in the order they appear on the home page. */
const SECTIONS = [
  { id: 'home-hero', label: 'მთავარი ბანერი' },
  { id: 'home-collections', label: 'კოლექციები' },
  { id: 'home-featured', label: 'რჩეული დიზაინები' },
];

/**
 * მთავარი გვერდი: everything the public home page shows, in its own order, on one page:
 * hero text, the collection slider, the featured designs and the closing contact panel.
 */
export function HomePage() {
  const [s, setS] = useState<Settings | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  useEffect(() => { api<Settings>('/settings').then(setS).catch((e) => toast.err(e.message)); }, []);

  const rebuild = async () => {
    setRebuilding(true);
    try {
      await api('/admin/rebuild', { method: 'POST' });
      toast.ok('საიტის განახლება დაიწყო. რამდენიმე წუთში ცვლილებები გამოჩნდება');
    } catch (e: any) { toast.err(e.message); } finally { setRebuilding(false); }
  };
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <section class="page">
      <header class="page-head">
        <div>
          <h1>მთავარი გვერდი</h1>
          <p class="muted">ყველაფერი, რაც მთავარ გვერდზე ჩანს, იმავე თანმიმდევრობით. ცვლილებები საიტზე „საიტის განახლების“ შემდეგ გამოჩნდება.</p>
        </div>
        <div class="head-actions">
          <a class="btn ghost" href={`${SITE_URL}/`} target="_blank" rel="noopener"><Icon name="ext" />საიტზე ნახვა</a>
          <button class="btn primary" type="button" onClick={rebuild} disabled={rebuilding} title="ცვლილებების გამოქვეყნება საიტზე">
            <Icon name="refresh" />{rebuilding ? 'იწყება…' : 'საიტის განახლება'}
          </button>
        </div>
      </header>

      <nav class="home-map" aria-label="გვერდის სექციები">
        {SECTIONS.map((x, i) => (
          <button key={x.id} type="button" onClick={() => jump(x.id)}><span class="num">{String(i + 1).padStart(2, '0')}</span>{x.label}</button>
        ))}
      </nav>

      {!s ? <Loading /> : (
        <TextBlock id="home-hero" n={1} title="მთავარი ბანერი" note="გვერდის ზედა ნაწილი: დიდი სათაური და მოკლე ტექსტი ღილაკების ზემოთ. ცარიელი ველი საიტის ამჟამინდელ ტექსტს ტოვებს."
          settings={s} onSaved={setS}
          fields={[
            { key: 'home_hero_title', label: 'სათაური', max: 80 },
            { key: 'home_hero_lead', label: 'ტექსტი', area: true, max: 240 },
          ]} />
      )}

      <div id="home-collections" class="home-anchor"><Collections /></div>

      <div id="home-featured" class="home-anchor"><FeaturedPicker /></div>
    </section>
  );
}

function SectionHead({ n, title, note, children }: { n: number; title: string; note: string; children?: ComponentChildren }) {
  return (
    <div class="home-head">
      <div>
        <h2><span class="home-n num">{String(n).padStart(2, '0')}</span>{title}</h2>
        <p class="muted small">{note}</p>
      </div>
      {children}
    </div>
  );
}

type Field = { key: string; label: string; area?: boolean; max: number };

/** Bilingual text fields stored as settings (`<key>_ka`, `<key>_en`). */
function TextBlock({ id, n, title, note, fields, settings, onSaved }: {
  id: string; n: number; title: string; note: string; fields: Field[];
  settings: Settings; onSaved: (s: Settings) => void;
}) {
  const keys = fields.flatMap((f) => [`${f.key}_ka`, `${f.key}_en`]);
  const pick = (src: Settings) => Object.fromEntries(keys.map((k) => [k, src[k] ?? '']));
  const [v, setV] = useState<Record<string, string>>(() => pick(settings));
  const [saving, setSaving] = useState(false);
  const dirty = keys.some((k) => (v[k] ?? '') !== (settings[k] ?? ''));

  const save = async (e: Event) => {
    e.preventDefault();
    setSaving(true);
    try {
      const next = await api<Settings>('/admin/settings', { method: 'PUT', body: v });
      onSaved({ ...settings, ...next });
      setV(pick(next));
      toast.ok('შენახულია. საიტზე გამოჩნდება განახლების შემდეგ.');
    } catch (err: any) { toast.err(err.message); } finally { setSaving(false); }
  };
  const input = (k: string, f: Field, lang: 'ka' | 'en') => {
    const props = {
      lang, value: v[k], placeholder: DEFAULTS[k], maxLength: f.max,
      onInput: (e: any) => setV({ ...v, [k]: e.currentTarget.value }),
    };
    return f.area ? <textarea rows={3} {...props} /> : <input {...props} />;
  };

  return (
    <form id={id} class="card pad-lg home-anchor" onSubmit={save}>
      <SectionHead n={n} title={title} note={note}>
        <button class="btn primary sm" disabled={saving || !dirty}>{saving ? 'ინახება…' : 'შენახვა'}</button>
      </SectionHead>
      {fields.map((f) => (
        <div class="bi-row" key={f.key}>
          <label class="fld">
            <span>{f.label} <span class="lang-tag">· ქართული</span></span>
            {input(`${f.key}_ka`, f, 'ka')}
          </label>
          <label class="fld">
            <span>{f.label} <span class="lang-tag">· English</span></span>
            {input(`${f.key}_en`, f, 'en')}
          </label>
        </div>
      ))}
    </form>
  );
}

/** The "რჩეული დიზაინები" row: up to FEATURED_MAX products marked for the home page. */
function FeaturedPicker() {
  const [items, setItems] = useState<Product[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [adding, setAdding] = useState('');
  useEffect(() => { api<Product[]>('/admin/products').then(setItems).catch((e) => toast.err(e.message)); }, []);

  const featured = items?.filter((p) => p.featured) ?? [];
  const others = items?.filter((p) => !p.featured && p.published) ?? [];
  const full = featured.length >= FEATURED_MAX;

  const toggle = async (p: Product) => {
    setBusy(p.id!);
    try {
      const saved = await api<Product>(`/admin/products/${p.id}`, { method: 'PUT', body: { ...p, featured: !p.featured } });
      setItems((l) => l && l.map((x) => (x.id === saved.id ? saved : x)));
      setAdding('');
    } catch (e: any) { toast.err(e.message); } finally { setBusy(null); }
  };

  return (
    <section class="card pad-lg">
      <SectionHead n={3} title="რჩეული დიზაინები" note={`კოლექციების ქვემოთ ჩანს ${FEATURED_MAX} პროდუქტი. თუ ნაკლებია მონიშნული, ცარიელ ადგილებს კატალოგის პირველი პროდუქცია შეავსებს.`}>
        <span class={`small featured-count ${full ? 'full' : ''}`}><Icon name="star" size={13} /><b class="num">{featured.length} / {FEATURED_MAX}</b></span>
      </SectionHead>
      {!items ? <Loading /> : (
        <>
          <div class="feat-slots">
            {Array.from({ length: FEATURED_MAX }, (_, i) => {
              const p = featured[i];
              return p ? (
                <div class="feat-slot" key={p.id}>
                  <div class="feat-img">{p.images[0] ? <img src={p.images[0].url} alt="" /> : <Preview pattern={p.pattern} small />}</div>
                  <div class="feat-meta">
                    <a class="strong" href={`#/products/${p.id}`}>{p.name.ka}</a>
                    {!p.published && <span class="muted small">დამალულია საიტზე</span>}
                  </div>
                  <button type="button" class="icon-btn danger" onClick={() => toggle(p)} disabled={busy === p.id} aria-label={`მოხსნა: ${p.name.ka}`} title="მთავარი გვერდიდან მოხსნა"><Icon name="close" /></button>
                </div>
              ) : (
                <div class="feat-slot empty" key={`e${i}`}><span class="muted small">ცარიელი ადგილი</span></div>
              );
            })}
          </div>
          <div class="feat-add">
            <select value={adding} disabled={full || !others.length} onChange={(e) => setAdding(e.currentTarget.value)} aria-label="პროდუქტის არჩევა">
              <option value="">{full ? `უკვე ${FEATURED_MAX} პროდუქტია. ჯერ მოხსენით რომელიმე` : others.length ? '— აირჩიეთ პროდუქტი —' : 'სხვა გამოქვეყნებული პროდუქტი არ არის'}</option>
              {others.map((p) => <option key={p.id} value={String(p.id)}>{p.name.ka}</option>)}
            </select>
            <button type="button" class="btn ghost sm" disabled={!adding || full || busy != null}
              onClick={() => { const p = others.find((x) => String(x.id) === adding); if (p) toggle(p); }}>
              <Icon name="plus" />დამატება
            </button>
          </div>
        </>
      )}
    </section>
  );
}
