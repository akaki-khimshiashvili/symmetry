import { useEffect, useState } from 'preact/hooks';
import { api, type Settings } from '../api';
import { Loading, toast } from '../ui';
import { OptionLists } from '../options';

const FIELDS: { key: string; label: string; hint?: string; type?: string }[] = [
  { key: 'phone', label: 'ტელეფონის ნომერი', hint: 'მაგ. +995 555 12 34 56', type: 'tel' },
  { key: 'whatsapp', label: 'WhatsApp ნომერი', hint: 'მხოლოდ ციფრები, ქვეყნის კოდით: 995555123456' },
  { key: 'email', label: 'ელ-ფოსტა', type: 'email' },
  { key: 'instagram', label: 'Instagram ბმული', type: 'url' },
  { key: 'facebook', label: 'Facebook ბმული', type: 'url' },
  { key: 'tiktok', label: 'TikTok ბმული', type: 'url', hint: 'ცარიელი ველი საიტზე არ გამოჩნდება' },
  { key: 'address_ka', label: 'მისამართი (ქართულად)' },
  { key: 'address_en', label: 'მისამართი (ინგლისურად)' },
  { key: 'hours_ka', label: 'სამუშაო საათები (ქართულად)' },
  { key: 'hours_en', label: 'სამუშაო საათები (ინგლისურად)' },
];

export function SettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { api<Settings>('/settings').then(setS).catch((e) => toast.err(e.message)); }, []);
  if (!s) return <Loading />;

  const save = async (e: Event) => {
    e.preventDefault();
    setSaving(true);
    try {
      setS(await api<Settings>('/admin/settings', { method: 'PUT', body: s }));
      toast.ok('პარამეტრები შენახულია. საიტზე გამოჩნდება განახლების შემდეგ.');
    } catch (err: any) { toast.err(err.message); } finally { setSaving(false); }
  };

  return (
    <form class="page" onSubmit={save}>
      <header class="page-head">
        <div>
          <h1>პარამეტრები</h1>
          <p class="muted">საკონტაქტო ინფორმაცია, რომელიც საიტზე ჩანს.</p>
        </div>
        <button class="btn primary" disabled={saving}>{saving ? 'ინახება…' : 'შენახვა'}</button>
      </header>

      <section class="card pad-lg">
        <h2>კონტაქტი</h2>
        <div class="grid2">
          {FIELDS.map((f) => (
            <label class="fld" key={f.key}>
              <span>{f.label}</span>
              <input type={(f.type || 'text') as any} value={s[f.key] || ''} onInput={(e) => setS({ ...s, [f.key]: e.currentTarget.value })} />
              {f.hint && <span class="muted small">{f.hint}</span>}
            </label>
          ))}
        </div>
      </section>

      <OptionLists />
    </form>
  );
}
