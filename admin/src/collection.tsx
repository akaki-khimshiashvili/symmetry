import { useEffect, useRef, useState } from 'preact/hooks';
import { api, ApiError, COLLECTION_RATIO, labelOf, type Collection, type KeyedOption, type L10n, type OptionSet } from './api';
import { Icon, toast, confirmAction } from './ui';
import { CropDialog } from './crop';

const MAX_BYTES = 8 * 1024 * 1024;
/** Card text limits (same as the API): longer text would break the slider's even rows. */
const TITLE_MAX = 40;
const TEXT_MAX = 120;

/** "37 / 120" under a field; turns red near the limit. */
const Count = ({ value, max }: { value: string; max: number }) => (
  <span class={`small count ${value.length >= max * 0.9 ? 'near' : 'muted'}`}>{value.length} / {max}</span>
);
const empty = (): L10n => ({ ka: '', en: '' });
type Draft = { id?: number; type: string; title: L10n; text: L10n; published: boolean };

/**
 * The home page's collection slider: one card per row in the database. Each card points at a product
 * type (it links to the catalogue filtered by it), has its own title and text, and a cover photo that
 * goes through the same crop step as product photos, framed at the card's 4:5. Without a photo the
 * site uses the type's product photo. Cards can be added, hidden, reordered and deleted.
 */
export function Collections() {
  const [list, setList] = useState<Collection[] | null>(null);
  const [types, setTypes] = useState<KeyedOption[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [crop, setCrop] = useState<{ id: number; file: File } | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const picking = useRef<number | null>(null);

  useEffect(() => {
    api<Collection[]>('/admin/collections').then(setList).catch((e) => toast.err(e.message));
    api<OptionSet>('/admin/options').then((o) => setTypes(o.type)).catch(() => {});
  }, []);

  const replace = (c: Collection) => setList((l) => l && l.map((x) => (x.id === c.id ? c : x)));

  /* ---------- Photo ---------- */
  const pick = (id: number) => {
    picking.current = id;
    input.current!.value = '';
    input.current!.click();
  };
  const onFile = (e: Event) => {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    const id = picking.current;
    if (!file || id == null) return;
    if (file.size > MAX_BYTES) return toast.err(`„${file.name}“ 8 MB-ზე დიდია`);
    setCrop({ id, file });
  };
  const upload = async (id: number, files: File[]) => {
    setCrop(null);
    if (!files.length) return;
    setBusy(id);
    try {
      const form = new FormData();
      form.append('image', files[0]);
      replace(await api<Collection>(`/admin/collections/${id}/image`, { form }));
      toast.ok('ფოტო შეიცვალა. საიტზე გამოჩნდება განახლების შემდეგ.');
    } catch (err: any) { toast.err(err.message); } finally { setBusy(null); }
  };
  const removePhoto = async (c: Collection) => {
    if (!(await confirmAction('წავშალოთ ეს ფოტო? მის ნაცვლად საიტზე პროდუქტის ფოტო გამოჩნდება.'))) return;
    setBusy(c.id);
    try {
      replace(await api<Collection>(`/admin/collections/${c.id}/image`, { method: 'DELETE' }));
      toast.ok('ფოტო წაიშალა');
    } catch (err: any) { toast.err(err.message); } finally { setBusy(null); }
  };

  /* ---------- Cards ---------- */
  const move = async (i: number, dir: -1 | 1) => {
    if (!list) return;
    const next = [...list];
    [next[i], next[i + dir]] = [next[i + dir], next[i]];
    setList(next);
    try {
      setList(await api<Collection[]>('/admin/collections/order', { method: 'PUT', body: { ids: next.map((c) => c.id) } }));
    } catch (err: any) { toast.err(err.message); setList(list); }
  };
  const togglePublished = async (c: Collection) => {
    try {
      replace(await api<Collection>(`/admin/collections/${c.id}`, { method: 'PUT', body: { ...c, published: !c.published } }));
    } catch (err: any) { toast.err(err.message); }
  };
  const remove = async (c: Collection) => {
    if (!(await confirmAction(`წავშალოთ კოლექცია „${c.title.ka}“? მთავარი გვერდიდან გაქრება (პროდუქტებს არ შეეხება).`))) return;
    try {
      await api(`/admin/collections/${c.id}`, { method: 'DELETE' });
      setList((l) => l && l.filter((x) => x.id !== c.id));
      if (draft?.id === c.id) setDraft(null);
      toast.ok('კოლექცია წაიშალა');
    } catch (err: any) { toast.err(err.message); }
  };

  const startNew = () => setDraft({ type: '', title: empty(), text: empty(), published: true });
  const edit = (c: Collection) => setDraft({ id: c.id, type: c.type, title: { ...c.title }, text: { ...c.text }, published: c.published });
  const saved = (c: Collection, isNew: boolean) => {
    setList((l) => (isNew ? [...(l ?? []), c] : (l ?? []).map((x) => (x.id === c.id ? c : x))));
    setDraft(null);
    toast.ok(isNew ? 'კოლექცია დაემატა. ახლა აირჩიეთ მისი ფოტო.' : 'შენახულია. საიტზე გამოჩნდება განახლების შემდეგ.');
  };

  return (
    <section class="card pad-lg">
      <div class="home-head">
        <div>
          <h2><span class="home-n num">02</span>კოლექციები</h2>
          <p class="muted small">ბარათები მთავარი გვერდის სლაიდერში. თითოეული მიბმულია პროდუქტის ტიპზე და ამ ტიპის პროდუქციაზე გადადის. ფოტო კადრირდება ბარათის ფორმატში (4:5); ფოტოს გარეშე ბარათზე პროდუქტის ფოტო ჩანს.</p>
        </div>
        <button type="button" class="btn primary sm" onClick={startNew} disabled={!list}><Icon name="plus" />ახალი კოლექცია</button>
      </div>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/avif" hidden onChange={onFile} />

      {draft && <CollectionForm draft={draft} types={types} onCancel={() => setDraft(null)} onSaved={saved} />}

      {list && list.length === 0 && !draft && <p class="muted small">კოლექციები ჯერ არ არის. მთავარ გვერდზე ეს სექცია დამალული იქნება.</p>}
      <div class="coll-grid">
        {list?.map((c, i) => (
          <div class={`coll-item ${c.published ? '' : 'is-hidden'}`} key={c.id}>
            <div class="coll-pic">
              <button type="button" class={`coll-frame ${c.image ? '' : 'empty'}`} onClick={() => pick(c.id)} disabled={busy === c.id} aria-label={`${c.title.ka}: ფოტოს ${c.image ? 'შეცვლა' : 'არჩევა'}`} title={c.image ? 'ფოტოს შეცვლა' : 'ფოტოს არჩევა'}>
                {c.image ? <img src={c.image} alt="" /> : <span class="muted small"><Icon name="upload" />ფოტოს არჩევა</span>}
                {busy === c.id && <span class="coll-busy">იტვირთება…</span>}
                {!c.published && <span class="coll-flag">დამალული</span>}
              </button>
              {c.image && <button type="button" class="icon-btn coll-unpic" onClick={() => removePhoto(c)} disabled={busy === c.id} aria-label="ფოტოს წაშლა" title="ფოტოს წაშლა"><Icon name="close" size={16} /></button>}
            </div>
            <div class="coll-meta">
              <b>{c.title.ka}</b>
              <span class="muted small">{labelOf(types, c.type)}</span>
            </div>
            <div class="coll-foot">
              <div class="row-start">
                <button type="button" class="icon-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="მარცხნივ გადატანა" title="მარცხნივ"><Icon name="left" /></button>
                <button type="button" class="icon-btn" onClick={() => move(i, 1)} disabled={i === list.length - 1} aria-label="მარჯვნივ გადატანა" title="მარჯვნივ"><Icon name="right" /></button>
              </div>
              <div class="row-end">
                <button type="button" class="icon-btn" onClick={() => togglePublished(c)} aria-label={c.published ? 'დამალვა' : 'გამოჩენა'} title={c.published ? 'მთავარ გვერდზე დამალვა' : 'მთავარ გვერდზე ჩვენება'}><Icon name={c.published ? 'eye' : 'lock'} /></button>
                <button type="button" class="icon-btn" onClick={() => edit(c)} aria-label="რედაქტირება" title="რედაქტირება"><Icon name="edit" /></button>
                <button type="button" class="icon-btn danger" onClick={() => remove(c)} aria-label="კოლექციის წაშლა" title="კოლექციის წაშლა"><Icon name="trash" /></button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {crop && (
        <CropDialog
          files={[crop.file]}
          ratio={COLLECTION_RATIO}
          title={`ფოტოს კადრირება · ${list?.find((c) => c.id === crop.id)?.title.ka ?? ''}`}
          hint="გადაათრიეთ და გაადიდეთ ფოტო. მთავარ გვერდზე ზუსტად ჩარჩოში მოქცეული ნაწილი გამოჩნდება."
          onDone={(files) => upload(crop.id, files)}
          onClose={() => setCrop(null)}
        />
      )}
    </section>
  );
}

/** Add / edit a card's text: product type, bilingual title (required) and short description. */
function CollectionForm({ draft, types, onCancel, onSaved }: {
  draft: Draft; types: KeyedOption[]; onCancel: () => void; onSaved: (c: Collection, isNew: boolean) => void;
}) {
  const [d, setD] = useState<Draft>(draft);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => { setD(draft); setErrors({}); }, [draft]);

  // Choosing a type fills in its name while the title is still empty (it can be changed after).
  const setType = (key: string) => {
    const o = types.find((x) => x.key === key);
    setD((v) => ({ ...v, type: key, title: o && !v.title.ka && !v.title.en ? { ka: o.ka, en: o.en } : v.title }));
  };
  const field = (group: 'title' | 'text', lang: keyof L10n, value: string) => setD((v) => ({ ...v, [group]: { ...v[group], [lang]: value } }));

  const save = async (e: Event) => {
    e.preventDefault();
    setSaving(true);
    try {
      const c = await api<Collection>(d.id ? `/admin/collections/${d.id}` : '/admin/collections', { method: d.id ? 'PUT' : 'POST', body: d });
      onSaved(c, !d.id);
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) setErrors(err.fields);
      else toast.err((err as Error).message);
    } finally { setSaving(false); }
  };

  return (
    <form class="opt-new coll-form" onSubmit={save}>
      <b>{d.id ? 'კოლექციის რედაქტირება' : 'ახალი კოლექცია'}</b>
      <label class="fld">
        <span>პროდუქტის ტიპი</span>
        <select value={d.type} aria-invalid={!!errors.type} onChange={(e) => setType(e.currentTarget.value)}>
          <option value="" disabled>— აირჩიეთ —</option>
          {types.map((o) => <option key={o.key} value={o.key}>{o.ka} · {o.en}</option>)}
        </select>
        {errors.type ? <span class="err">{errors.type}</span> : <span class="muted small">ბარათი ამ ტიპის პროდუქციაზე გადავა. ახალი ტიპი პარამეტრებში ან პროდუქტის გვერდზე ემატება.</span>}
      </label>
      <div class="bi-row">
        <label class="fld">
          <span class="lang-tag">სათაური · ქართული</span>
          <input lang="ka" value={d.title.ka} aria-invalid={!!errors.title_ka} onInput={(e) => field('title', 'ka', e.currentTarget.value)} maxLength={TITLE_MAX} />
          {errors.title_ka ? <span class="err">{errors.title_ka}</span> : <Count value={d.title.ka} max={TITLE_MAX} />}
        </label>
        <label class="fld">
          <span class="lang-tag">Title · English</span>
          <input lang="en" value={d.title.en} aria-invalid={!!errors.title_en} onInput={(e) => field('title', 'en', e.currentTarget.value)} maxLength={TITLE_MAX} />
          {errors.title_en ? <span class="err">{errors.title_en}</span> : <Count value={d.title.en} max={TITLE_MAX} />}
        </label>
      </div>
      <div class="bi-row">
        <label class="fld">
          <span class="lang-tag">მოკლე აღწერა · ქართული</span>
          <textarea lang="ka" rows={2} value={d.text.ka} aria-invalid={!!errors.text_ka} onInput={(e) => field('text', 'ka', e.currentTarget.value)} maxLength={TEXT_MAX} />
          {errors.text_ka ? <span class="err">{errors.text_ka}</span> : <Count value={d.text.ka} max={TEXT_MAX} />}
        </label>
        <label class="fld">
          <span class="lang-tag">Short text · English</span>
          <textarea lang="en" rows={2} value={d.text.en} aria-invalid={!!errors.text_en} onInput={(e) => field('text', 'en', e.currentTarget.value)} maxLength={TEXT_MAX} />
          {errors.text_en ? <span class="err">{errors.text_en}</span> : <Count value={d.text.en} max={TEXT_MAX} />}
        </label>
      </div>
      <p class="muted small">მოკლედ: ბარათზე აღწერის მაქსიმუმ 3 სტრიქონი ჩანს (ტელეფონზე 2), დანარჩენი „…“-ით იჭრება.</p>
      <div class="opt-actions">
        <label class="switch muted small">
          <input type="checkbox" checked={d.published} onChange={(e) => setD((v) => ({ ...v, published: e.currentTarget.checked }))} />
          <span class="track" aria-hidden="true" />მთავარ გვერდზე ჩვენება
        </label>
        <button class="btn ghost sm" type="button" onClick={onCancel}>გაუქმება</button>
        <button class="btn primary sm" type="submit" disabled={saving}>{saving ? 'ინახება…' : d.id ? 'შენახვა' : 'დამატება'}</button>
      </div>
    </form>
  );
}
