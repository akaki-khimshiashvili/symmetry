import { useEffect, useRef, useState } from 'preact/hooks';
import { api, ApiError, type Product, type Size, type L10n, type OptionSet, ORIENTATIONS, SITE_URL, fmtPrice, FEATURED_MAX } from '../api';
import { Icon, Loading, toast, confirmAction } from '../ui';
import { OptionSelect, SizeSelect } from '../options';

const fmtDuration = (min: number) => {
  const h = Math.floor(min / 60), m = min % 60;
  return [h ? `${h} სთ` : '', m ? `${m} წთ` : ''].filter(Boolean).join(' ');
};

const blankL = (): L10n => ({ ka: '', en: '' });
const blank = (): Product => ({
  slug: '', pattern: 'wave', orientation: 'landscape', featured: false, in_stock: true, sale: { ends_at: '' }, published: true, sort: 0,
  name: blankL(), short: blankL(), description: blankL(), material: blankL(),
  delivery_days: { min: 14, max: 21 }, installation_minutes: 240,
  sizes: [{ width: 120, height: 80, price: 0, sale_percent: 0 }], images: [],
});

type Errors = Record<string, string>;

function Bilingual({ label, field, value, onChange, errors, multiline, hint }: {
  label: string; field: string; value: L10n; onChange: (v: L10n) => void; errors: Errors; multiline?: boolean; hint?: string;
}) {
  const Tag = (multiline ? 'textarea' : 'input') as any;
  return (
    <div class="bi">
      <div class="bi-label">{label}{hint && <span class="muted small"> ({hint})</span>}</div>
      <div class="bi-row">
        {(['ka', 'en'] as const).map((l) => (
          <label class="fld" key={l}>
            <span class="lang-tag">{l === 'ka' ? 'ქართული' : 'English'}</span>
            <Tag
              value={value[l]}
              rows={multiline ? 5 : undefined}
              lang={l}
              aria-invalid={!!errors[`${field}.${l}`]}
              onInput={(e: any) => onChange({ ...value, [l]: e.currentTarget.value })}
            />
            {errors[`${field}.${l}`] && <span class="err">{errors[`${field}.${l}`]}</span>}
          </label>
        ))}
      </div>
    </div>
  );
}

export function ProductEdit({ id }: { id: string }) {
  const isNew = id === 'new';
  const [p, setP] = useState<Product | null>(isNew ? blank() : null);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [opts, setOpts] = useState<OptionSet | null>(null);
  /** How many OTHER products are already on the home page. */
  const [othersFeatured, setOthersFeatured] = useState(0);
  // Photos chosen before the product's first save: uploaded right after it is created.
  const [pending, setPending] = useState<{ file: File; url: string }[]>([]);

  useEffect(() => {
    if (!isNew) api<Product>(`/admin/products/${id}`).then(setP).catch((e) => toast.err(e.message));
    api<OptionSet>('/admin/options').then(setOpts).catch((e) => toast.err(e.message));
    api<Product[]>('/admin/products')
      .then((all) => setOthersFeatured(all.filter((x) => x.featured && String(x.id) !== String(id)).length))
      .catch(() => {});
  }, [id]);
  useEffect(() => () => pending.forEach((x) => URL.revokeObjectURL(x.url)), []);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); } };
    addEventListener('beforeunload', warn);
    return () => removeEventListener('beforeunload', warn);
  }, [dirty]);

  if (!p || !opts) return <Loading />;

  const set = <K extends keyof Product>(k: K, v: Product[K]) => { setP({ ...p, [k]: v }); setDirty(true); };
  const setSize = (i: number, patch: Partial<Size>) => set('sizes', p.sizes.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const addSize = () => {
    // Next saved size this product doesn't use yet; the dropdown can switch it or add a new one.
    const used = new Set(p.sizes.map((s) => `${s.width}x${s.height}`));
    const next = opts.size.find((o) => !used.has(`${o.width}x${o.height}`));
    const last = p.sizes[p.sizes.length - 1];
    set('sizes', [...p.sizes, { width: next?.width ?? 0, height: next?.height ?? 0, price: last?.price ?? 0, sale_percent: 0 }]);
  };
  const removeSize = (i: number) => set('sizes', p.sizes.filter((_, j) => j !== i));
  const clampPct = (v: unknown) => Math.max(0, Math.min(90, Math.round(Number(v) || 0)));

  const save = async (e?: Event) => {
    e?.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      let saved = await api<Product>(isNew ? '/admin/products' : `/admin/products/${p.id}`, { method: isNew ? 'POST' : 'PUT', body: p });
      if (pending.length && saved.id) {
        try {
          saved = { ...saved, images: (await sendFiles(saved.id, pending.map((x) => x.file))).images };
          pending.forEach((x) => URL.revokeObjectURL(x.url));
          setPending([]);
        } catch (e: any) { toast.err(`პროდუქტი შეინახა, მაგრამ ფოტო ვერ აიტვირთა: ${e.message}`); }
      }
      setP(saved);
      setDirty(false);
      toast.ok(isNew ? 'პროდუქტი დაემატა' : 'ცვლილებები შენახულია');
      if (isNew) location.hash = `/products/${saved.id}`;
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        setErrors(err.fields);
        toast.err('შეამოწმეთ მონიშნული ველები');
      } else toast.err((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const sendFiles = (pid: number, list: File[]) => {
    const form = new FormData();
    list.forEach((f) => form.append('images[]', f));
    return api<Product>(`/admin/products/${pid}/images`, { form });
  };

  const upload = async (files: FileList | File[] | null) => {
    if (!files) return;
    const list = [...files].filter((f) => /^image\/(jpeg|png|webp|avif)$/.test(f.type));
    if (!list.length) return toast.err('დაშვებულია მხოლოდ JPG, PNG, WEBP, AVIF');
    const big = list.find((f) => f.size > 8 * 1024 * 1024);
    if (big) return toast.err(`„${big.name}“ 8 MB-ზე დიდია`);
    if (!p.id) {
      // Not saved yet: keep the photos here and upload them with the first save.
      setPending([...pending, ...list.map((file) => ({ file, url: URL.createObjectURL(file) }))]);
      setDirty(true);
      return;
    }
    setUploading(true);
    try {
      const updated = await sendFiles(p.id, list);
      setP({ ...p, images: updated.images });
      toast.ok(list.length > 1 ? `${list.length} ფოტო აიტვირთა` : 'ფოტო აიტვირთა');
    } catch (e: any) { toast.err(e.message); } finally { setUploading(false); }
  };
  const removePending = (i: number) => {
    URL.revokeObjectURL(pending[i].url);
    setPending(pending.filter((_, j) => j !== i));
  };

  const removeImage = async (imgId: number) => {
    if (!(await confirmAction('წავშალოთ ეს ფოტო?'))) return;
    try {
      await api(`/admin/images/${imgId}`, { method: 'DELETE' });
      setP({ ...p, images: p.images.filter((i) => i.id !== imgId) });
    } catch (e: any) { toast.err(e.message); }
  };

  const moveImage = async (idx: number, dir: -1 | 1) => {
    const imgs = [...p.images];
    const j = idx + dir;
    if (j < 0 || j >= imgs.length) return;
    [imgs[idx], imgs[j]] = [imgs[j], imgs[idx]];
    setP({ ...p, images: imgs });
    try {
      await api(`/admin/products/${p.id}/images/order`, { method: 'PUT', body: { ids: imgs.map((i) => i.id) } });
    } catch (e: any) { toast.err(e.message); }
  };

  const remove = async () => {
    if (!(await confirmAction(`წავშალოთ „${p.name.ka || 'პროდუქტი'}“? ეს ქმედება შეუქცევადია.`))) return;
    try {
      await api(`/admin/products/${p.id}`, { method: 'DELETE' });
      setDirty(false);
      toast.ok('პროდუქტი წაიშალა');
      location.hash = '/products';
    } catch (e: any) { toast.err(e.message); }
  };

  return (
    <form class="page edit" onSubmit={save} novalidate>
      <header class="page-head sticky">
        <div>
          <a class="crumb" href="#/products"><Icon name="left" size={16} />პროდუქცია</a>
          <h1>{isNew ? 'ახალი პროდუქტი' : p.name.ka || 'უსახელო'}</h1>
        </div>
        <div class="row-end">
          {dirty && <span class="muted small">შეუნახავი ცვლილებები</span>}
          {!isNew && <a class="btn ghost" href={`${SITE_URL}/products/${p.slug}/`} target="_blank" rel="noopener"><Icon name="eye" />ნახვა</a>}
          <button class="btn primary" disabled={saving}>{saving ? 'ინახება…' : 'შენახვა'}</button>
        </div>
      </header>

      <div class="edit-grid">
        <div class="col-main">
          <section class="card pad-lg">
            <h2>ძირითადი ინფორმაცია</h2>
            <fieldset class="seg-field">
              <legend>პროდუქტის ტიპი</legend>
              <div class="seg">
                {Object.entries(ORIENTATIONS).map(([k, v]) => (
                  <label key={k} class={p.orientation === k ? 'on' : ''}>
                    <input type="radio" name="orientation" value={k} checked={p.orientation === k} onChange={() => set('orientation', k as Product['orientation'])} />
                    {v}
                  </label>
                ))}
              </div>
              {errors.orientation && <span class="err">{errors.orientation}</span>}
            </fieldset>
            <Bilingual label="დასახელება" field="name" value={p.name} onChange={(v) => set('name', v)} errors={errors} />
            <Bilingual label="მოკლე აღწერა" hint="ჩანს კატალოგში" field="short" value={p.short} onChange={(v) => set('short', v)} errors={errors} />
            <Bilingual label="სრული აღწერა" field="description" value={p.description} onChange={(v) => set('description', v)} errors={errors} multiline />
            <OptionSelect kind="material" label="მასალა" hint="რისგან მზადდება" value={p.material} onChange={(v) => set('material', v)} opts={opts} setOpts={setOpts} error={errors['material.ka'] || errors['material.en']} />
          </section>

          <section class="card pad-lg">
            <div class="card-head flat">
              <h2>ზომები და ფასები</h2>
              <button class="btn ghost sm" type="button" onClick={addSize}><Icon name="plus" size={16} />ზომის დამატება</button>
            </div>
            <p class="muted small">თითოეულ ზომას აქვს საკუთარი ფასი. ფასდაკლებისთვის ჩაწერეთ პროცენტი — 0 ნიშნავს, რომ ფასდაკლება არ არის.</p>
            {errors.sizes && <p class="err">{errors.sizes}</p>}
            <div class="sizes">
              <div class="sizes-head"><span>ზომა (სმ)</span><span>ფასი, ₾</span><span>ფასდაკლება, %</span><span>საბოლოო ფასი</span><span></span></div>
              {p.sizes.map((s, i) => {
                const pct = s.sale_percent ?? 0;
                return (
                  <div class="size-row" key={s.id ?? `n${i}`}>
                    <SizeSelect width={s.width} height={s.height} opts={opts} setOpts={setOpts} invalid={!!errors[`sizes.${i}`]} onChange={(width, height) => setSize(i, { width, height })} />
                    <input type="number" min="0" step="10" inputmode="decimal" value={s.price} aria-label="ფასი" aria-invalid={!!errors[`sizes.${i}`]} onInput={(e) => setSize(i, { price: Number(e.currentTarget.value) })} />
                    <input type="number" min="0" max="90" step="1" inputmode="numeric" value={pct} aria-label="ფასდაკლება, %"
                      class={pct > 0 ? 'has-sale' : ''} onInput={(e) => setSize(i, { sale_percent: clampPct(e.currentTarget.value) })} />
                    <span class={`final num ${pct > 0 ? 'on-sale' : ''}`}>
                      {pct > 0 ? <><s>{fmtPrice(s.price)}</s> {fmtPrice(Math.round(s.price * (100 - pct) / 100))}</> : fmtPrice(s.price)}
                    </span>
                    <button class="icon-btn danger" type="button" onClick={() => removeSize(i)} disabled={p.sizes.length === 1} aria-label="ზომის წაშლა" title={p.sizes.length === 1 ? 'მინიმუმ ერთი ზომა საჭიროა' : 'წაშლა'}><Icon name="trash" /></button>
                    {errors[`sizes.${i}`] && <span class="err full">{errors[`sizes.${i}`]}</span>}
                  </div>
                );
              })}
            </div>
            {p.sizes.some((x) => (x.sale_percent ?? 0) > 0) && (
              <div class="sale-end">
                <label class="fld"><span>ფასდაკლება მოქმედებს (ჩათვლით)</span>
                  <input type="date" value={p.sale?.ends_at ?? ''} onInput={(e) => set('sale', { ...(p.sale ?? {}), ends_at: e.currentTarget.value })} />
                </label>
                <p class="muted small">ცარიელი = ვადის გარეშე. ვადის შემდეგ ფასდაკლება თავისით ითიშება.</p>
                {p.sale?.active === false && p.sale.ends_at && <p class="small warn">ვადა ამოიწურა ({p.sale.ends_at}) — ფასდაკლება საიტზე აღარ ჩანს.</p>}
              </div>
            )}
          </section>

          <section class="card pad-lg">
            <h2>მიტანა და მონტაჟი</h2>
            <div class="row4">
              <label class="fld"><span>მიტანა, მინ. დღე</span>
                <input type="number" min="0" value={p.delivery_days.min} onInput={(e) => set('delivery_days', { ...p.delivery_days, min: Number(e.currentTarget.value) })} />
              </label>
              <label class="fld"><span>მიტანა, მაქს. დღე</span>
                <input type="number" min="0" value={p.delivery_days.max} onInput={(e) => set('delivery_days', { ...p.delivery_days, max: Number(e.currentTarget.value) })} />
              </label>
              <label class="fld"><span>მონტაჟი, საათი</span>
                <input type="number" min="0" inputmode="numeric" value={Math.floor(p.installation_minutes / 60)}
                  onInput={(e) => set('installation_minutes', Math.max(0, Number(e.currentTarget.value) || 0) * 60 + (p.installation_minutes % 60))} />
              </label>
              <label class="fld"><span>მონტაჟი, წუთი</span>
                <input type="number" min="0" max="59" step="5" inputmode="numeric" value={p.installation_minutes % 60}
                  onInput={(e) => set('installation_minutes', Math.floor(p.installation_minutes / 60) * 60 + Math.min(59, Math.max(0, Number(e.currentTarget.value) || 0)))} />
              </label>
            </div>
            <p class="muted small">საიტზე ჩანს, მაგ.: „{fmtDuration(p.installation_minutes) || '0 წთ'}“. შეიძლება მხოლოდ საათები, მხოლოდ წუთები ან ორივე.</p>
          </section>
        </div>

        <aside class="col-side">
          <section class="card pad-lg">
            <h2>ფოტოები</h2>
            {!p.id && <p class="muted small">ფოტოები აიტვირთება პროდუქტის შენახვისას.</p>}
            {(
              <>
                <div
                  class={`drop ${drag ? 'over' : ''}`}
                  onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                  onDragLeave={() => setDrag(false)}
                  onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer?.files ?? null); }}
                >
                  <Icon name="upload" size={22} />
                  <p>{uploading ? 'იტვირთება…' : 'ჩააგდეთ ფოტოები აქ'}</p>
                  <button class="btn ghost sm" type="button" disabled={uploading} onClick={() => fileRef.current?.click()}>ფაილის არჩევა</button>
                  <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple hidden onChange={(e) => { upload(e.currentTarget.files); e.currentTarget.value = ''; }} />
                  <span class="muted small">JPG, PNG, WEBP, AVIF · მაქს. 8 MB</span>
                </div>
                {pending.length > 0 && (
                  <ul class="imgs">
                    {pending.map((x, i) => (
                      <li key={x.url}>
                        <img src={x.url} alt="" />
                        {i === 0 && p.images.length === 0 && <span class="cover">მთავარი</span>}
                        <span class="pending-tag">შენახვისას აიტვირთება</span>
                        <div class="img-tools">
                          <button type="button" class="icon-btn danger" onClick={() => removePending(i)} aria-label="წაშლა"><Icon name="trash" size={16} /></button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {p.images.length > 0 && (
                  <ul class="imgs">
                    {p.images.map((img, i) => (
                      <li key={img.id}>
                        <img src={img.url} alt="" />
                        {i === 0 && <span class="cover">მთავარი</span>}
                        <div class="img-tools">
                          <button type="button" class="icon-btn" onClick={() => moveImage(i, -1)} disabled={i === 0} aria-label="მარცხნივ"><Icon name="left" size={16} /></button>
                          <button type="button" class="icon-btn" onClick={() => moveImage(i, 1)} disabled={i === p.images.length - 1} aria-label="მარჯვნივ"><Icon name="right" size={16} /></button>
                          <button type="button" class="icon-btn danger" onClick={() => removeImage(img.id)} aria-label="წაშლა"><Icon name="trash" size={16} /></button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </section>

          <section class="card pad-lg">
            <h2>გამოქვეყნება</h2>
            <label class="switch">
              <input type="checkbox" checked={p.published} onChange={(e) => set('published', e.currentTarget.checked)} />
              <span class="track" aria-hidden="true" /><span>გამოქვეყნებულია საიტზე</span>
            </label>
            <label class="switch">
              <input type="checkbox" checked={p.in_stock !== false} onChange={(e) => set('in_stock', e.currentTarget.checked)} />
              <span class="track" aria-hidden="true" /><span>მარაგშია</span>
            </label>
            {p.in_stock === false && (
              <p class="small muted">საიტზე გამოჩნდება „მარაგში არ არის“. ყიდვის ღილაკის ნაცვლად მომხმარებელს შეეძლება დაგიკავშირდეთ და იკითხოს, როდის იქნება ხელმისაწვდომი.</p>
            )}
            <label class="switch">
              <input type="checkbox" checked={p.featured} disabled={!p.featured && othersFeatured >= FEATURED_MAX}
                onChange={(e) => set('featured', e.currentTarget.checked)} />
              <span class="track" aria-hidden="true" /><span>მთავარ გვერდზე ჩვენება</span>
            </label>
            <p class={`small ${!p.featured && othersFeatured >= FEATURED_MAX ? 'warn' : 'muted'}`}>
              {!p.featured && othersFeatured >= FEATURED_MAX
                ? `მთავარ გვერდზე უკვე ${FEATURED_MAX} პროდუქტია. ჯერ მოხსენით მონიშვნა სხვას.`
                : `მთავარ გვერდზე: ${othersFeatured + (p.featured ? 1 : 0)} / ${FEATURED_MAX}`}
            </p>
            {errors.featured && <span class="err">{errors.featured}</span>}
            <label class="fld"><span>რიგითობა</span>
              <input type="number" value={p.sort} onInput={(e) => set('sort', Number(e.currentTarget.value))} />
            </label>
            <label class="fld"><span>ბმული (slug)</span>
              <input value={p.slug} placeholder="ავტომატურად ინგლისური სახელიდან" onInput={(e) => set('slug', e.currentTarget.value)} />
            </label>
            {p.sizes.length > 0 && <p class="muted small">ფასი საიტზე: {fmtPrice(Math.min(...p.sizes.map((s) => s.price || 0)))}-დან</p>}
          </section>

          {!isNew && (
            <button class="btn danger-ghost wide" type="button" onClick={remove}><Icon name="trash" />პროდუქტის წაშლა</button>
          )}
        </aside>
      </div>
    </form>
  );
}
