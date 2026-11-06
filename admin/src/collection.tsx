import { useEffect, useRef, useState } from 'preact/hooks';
import { api, COLLECTION, COLLECTION_RATIO, type CollectionCovers, type CollectionKey } from './api';
import { Icon, toast, confirmAction } from './ui';
import { CropDialog } from './crop';

const MAX_BYTES = 8 * 1024 * 1024;

/**
 * Cover photos of the home page's collection tiles (სარკე, თაროები, მთლიანი კედელი).
 * Each photo goes through the same crop step as product photos, framed at the tile's 4:5,
 * so it shows on the site exactly as framed here. With no photo, the site uses a product photo.
 */
export function CollectionCovers() {
  const [covers, setCovers] = useState<CollectionCovers | null>(null);
  const [crop, setCrop] = useState<{ key: CollectionKey; file: File } | null>(null);
  const [busy, setBusy] = useState<CollectionKey | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const picking = useRef<CollectionKey | null>(null);

  useEffect(() => { api<CollectionCovers>('/collection').then(setCovers).catch((e) => toast.err(e.message)); }, []);

  const pick = (key: CollectionKey) => {
    picking.current = key;
    input.current!.value = '';
    input.current!.click();
  };
  const onFile = (e: Event) => {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    const key = picking.current;
    if (!file || !key) return;
    if (file.size > MAX_BYTES) return toast.err(`„${file.name}“ 8 MB-ზე დიდია`);
    setCrop({ key, file });
  };

  const upload = async (key: CollectionKey, list: File[]) => {
    setCrop(null);
    if (!list.length) return;
    setBusy(key);
    try {
      const form = new FormData();
      form.append('image', list[0]);
      setCovers(await api<CollectionCovers>(`/admin/collection/${key}/image`, { form }));
      toast.ok('ფოტო შეიცვალა. საიტზე გამოჩნდება განახლების შემდეგ.');
    } catch (err: any) { toast.err(err.message); } finally { setBusy(null); }
  };

  const remove = async (key: CollectionKey) => {
    if (!(await confirmAction('წავშალოთ ეს ფოტო? მის ნაცვლად საიტზე პროდუქტის ფოტო გამოჩნდება.'))) return;
    setBusy(key);
    try {
      setCovers(await api<CollectionCovers>(`/admin/collection/${key}/image`, { method: 'DELETE' }));
      toast.ok('ფოტო წაიშალა');
    } catch (err: any) { toast.err(err.message); } finally { setBusy(null); }
  };

  return (
    <section class="card pad-lg">
      <div>
        <h2>მთავარი გვერდის კოლექცია</h2>
        <p class="muted small">აირჩიეთ, რომელი ფოტო გამოჩნდეს თითოეულ ბარათზე. ფოტო კადრირდება ბარათის ფორმატში (4:5). ფოტოს გარეშე ბარათზე პროდუქტის ფოტო ჩანს.</p>
      </div>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/avif" hidden onChange={onFile} />
      <div class="coll-grid">
        {COLLECTION.map((c) => {
          const url = covers?.[c.key];
          return (
            <div class="coll-item" key={c.key}>
              <button type="button" class={`coll-frame ${url ? '' : 'empty'}`} onClick={() => pick(c.key)} disabled={!covers || busy === c.key} aria-label={`${c.label}: ფოტოს არჩევა`}>
                {url ? <img src={url} alt="" /> : <span class="muted small"><Icon name="upload" />ფოტოს არჩევა</span>}
                {busy === c.key && <span class="coll-busy">იტვირთება…</span>}
              </button>
              <div class="coll-foot">
                <b>{c.label}</b>
                <div class="row-end">
                  <button type="button" class="btn ghost sm" onClick={() => pick(c.key)} disabled={!covers || busy === c.key}>{url ? 'შეცვლა' : 'არჩევა'}</button>
                  {url && <button type="button" class="icon-btn danger" onClick={() => remove(c.key)} disabled={busy === c.key} aria-label="ფოტოს წაშლა" title="წაშლა"><Icon name="trash" /></button>}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {crop && (
        <CropDialog
          files={[crop.file]}
          ratio={COLLECTION_RATIO}
          title={`ფოტოს კადრირება · ${COLLECTION.find((c) => c.key === crop.key)!.label}`}
          hint="გადაათრიეთ და გაადიდეთ ფოტო. მთავარ გვერდზე ზუსტად ჩარჩოში მოქცეული ნაწილი გამოჩნდება."
          onDone={(list) => upload(crop.key, list)}
          onClose={() => setCrop(null)}
        />
      )}
    </section>
  );
}
