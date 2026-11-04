import { useEffect, useRef, useState } from 'preact/hooks';
import { api, ApiError, type L10n, type OptionSet, type TextOption, type SizeOption } from './api';
import { Icon, toast, confirmAction } from './ui';

export const sizeLabel = (w: number, h: number) => `${w} × ${h} სმ`;
const NEW = '__new';

/* ---------- Shared: the inline "add a new option" panels ---------- */

/** Georgian + English, both required. Saved to the database so it is offered for every product from now on. */
function NewTextOption({ kind, onSaved, onCancel }: { kind: 'material'; onSaved: (o: TextOption) => void; onCancel?: () => void }) {
  const [ka, setKa] = useState('');
  const [en, setEn] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const kaRef = useRef<HTMLInputElement>(null);
  useEffect(() => kaRef.current?.focus(), []);

  const save = async () => {
    const errs: Record<string, string> = {};
    if (!ka.trim()) errs.ka = 'ქართული ვერსია სავალდებულოა';
    if (!en.trim()) errs.en = 'ინგლისური ვერსია სავალდებულოა';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      onSaved(await api<TextOption>('/admin/options', { body: { kind, ka: ka.trim(), en: en.trim() } }));
      setKa(''); setEn('');
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) setErrors(e.fields);
      else toast.err((e as Error).message);
    } finally { setBusy(false); }
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); save(); }
    if (e.key === 'Escape' && onCancel) { e.preventDefault(); onCancel(); }
  };

  return (
    <div class="opt-new">
      <div class="bi-row">
        <label class="fld">
          <span class="lang-tag">ქართული</span>
          <input ref={kaRef} lang="ka" value={ka} aria-invalid={!!errors.ka} onInput={(e) => setKa(e.currentTarget.value)} onKeyDown={onKey} />
          {errors.ka && <span class="err">{errors.ka}</span>}
        </label>
        <label class="fld">
          <span class="lang-tag">English <span class="req">*</span></span>
          <input lang="en" value={en} placeholder="სავალდებულოა" aria-invalid={!!errors.en} onInput={(e) => setEn(e.currentTarget.value)} onKeyDown={onKey} />
          {errors.en && <span class="err">{errors.en}</span>}
        </label>
      </div>
      <div class="opt-actions">
        <span class="muted small">შეინახება ჩამონათვალში და შემდეგ პროდუქტებზეც გამოჩნდება.</span>
        {onCancel && <button class="btn ghost sm" type="button" onClick={onCancel}>გაუქმება</button>}
        <button class="btn primary sm" type="button" disabled={busy} onClick={save}>{busy ? 'ინახება…' : 'დამატება'}</button>
      </div>
    </div>
  );
}

/** Width × height in centimetres. */
function NewSizeOption({ onSaved, onCancel }: { onSaved: (o: SizeOption) => void; onCancel?: () => void }) {
  const [w, setW] = useState('');
  const [h, setH] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const wRef = useRef<HTMLInputElement>(null);
  useEffect(() => wRef.current?.focus(), []);

  const save = async () => {
    const width = Math.round(Number(w));
    const height = Math.round(Number(h));
    if (!(width > 0 && height > 0)) return setErr('შეიყვანეთ სიგანე და სიმაღლე სანტიმეტრებში');
    setErr('');
    setBusy(true);
    try {
      onSaved(await api<SizeOption>('/admin/options', { body: { kind: 'size', width, height } }));
      setW(''); setH('');
    } catch (e) {
      setErr(e instanceof ApiError && e.status === 422 ? Object.values(e.fields)[0] || e.message : (e as Error).message);
    } finally { setBusy(false); }
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); save(); }
    if (e.key === 'Escape' && onCancel) { e.preventDefault(); onCancel(); }
  };

  return (
    <div class="opt-new">
      <div class="bi-row">
        <label class="fld"><span>სიგანე, სმ</span>
          <input ref={wRef} type="number" min="1" inputmode="numeric" value={w} aria-invalid={!!err} onInput={(e) => setW(e.currentTarget.value)} onKeyDown={onKey} />
        </label>
        <label class="fld"><span>სიმაღლე, სმ</span>
          <input type="number" min="1" inputmode="numeric" value={h} aria-invalid={!!err} onInput={(e) => setH(e.currentTarget.value)} onKeyDown={onKey} />
        </label>
      </div>
      {err && <span class="err">{err}</span>}
      <div class="opt-actions">
        <span class="muted small">ზომა შეინახება ჩამონათვალში.</span>
        {onCancel && <button class="btn ghost sm" type="button" onClick={onCancel}>გაუქმება</button>}
        <button class="btn primary sm" type="button" disabled={busy} onClick={save}>{busy ? 'ინახება…' : 'დამატება'}</button>
      </div>
    </div>
  );
}

/* ---------- Picker: a dropdown whose saved items can be chosen, deleted, or added to ---------- */

type PickItem = { key: string; label: string; sub?: string; deletable?: boolean };

function Picker({ items, selected, placeholder, addLabel, onSelect, onDelete, onAdd, invalid, ariaLabel }: {
  items: PickItem[]; selected: string; placeholder: string; addLabel: string;
  onSelect: (key: string) => void; onDelete: (key: string) => void; onAdd: () => void; invalid?: boolean; ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const root = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const uid = useRef(`pk${Math.random().toString(36).slice(2, 8)}`).current;
  const rows = [NEW, ...items.map((i) => i.key)];
  const current = items.find((i) => i.key === selected);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);
  useEffect(() => {
    if (open && active >= 0) listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const show = () => { setOpen(true); setActive(Math.max(0, rows.indexOf(selected))); };
  const choose = (key: string) => { setOpen(false); key === NEW ? onAdd() : onSelect(key); };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return show();
      setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (open && active >= 0) choose(rows[active]); else show();
    } else if (e.key === 'Escape' && open) {
      e.preventDefault(); setOpen(false);
    } else if (e.key === 'Delete' && open && active > 0) {
      const it = items[active - 1];
      if (it?.deletable) { e.preventDefault(); onDelete(it.key); }
    } else if (e.key === 'Tab') setOpen(false);
  };

  return (
    <div class={`picker ${open ? 'open' : ''}`} ref={root}>
      <button type="button" class="picker-btn" aria-haspopup="listbox" aria-expanded={open} aria-controls={uid} aria-label={ariaLabel}
        aria-invalid={invalid} aria-activedescendant={open && active >= 0 ? `${uid}-${active}` : undefined}
        onClick={() => (open ? setOpen(false) : show())} onKeyDown={onKey}>
        <span class={current ? '' : 'ph'}>{current ? current.label : placeholder}{current?.sub && <span class="muted"> · {current.sub}</span>}</span>
        <Icon name="down" size={16} />
      </button>
      {open && (
        <ul class="picker-list" id={uid} role="listbox" ref={listRef}>
          <li id={`${uid}-0`} role="option" aria-selected="false" class={`pk-add ${active === 0 ? 'act' : ''}`}
            onPointerMove={() => setActive(0)} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(NEW)}>
            <Icon name="plus" size={16} /><span>{addLabel}</span>
          </li>
          {items.map((it, i) => (
            <li key={it.key} id={`${uid}-${i + 1}`} role="option" aria-selected={it.key === selected}
              class={`${i + 1 === active ? 'act' : ''} ${it.key === selected ? 'sel' : ''}`}
              onPointerMove={() => setActive(i + 1)} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(it.key)}>
              <span class="pk-label">{it.label}{it.sub && <span class="muted"> · {it.sub}</span>}</span>
              {it.key === selected && <Icon name="check" size={16} />}
              {it.deletable && (
                <button type="button" class="icon-btn danger pk-del" aria-label={`წაშლა: ${it.label}`} title="ჩამონათვალიდან წაშლა" tabIndex={-1}
                  onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.stopPropagation(); onDelete(it.key); }}>
                  <Icon name="trash" size={15} />
                </button>
              )}
            </li>
          ))}
          {items.length === 0 && <li class="pk-empty muted small">ჩამონათვალი ცარიელია</li>}
        </ul>
      )}
    </div>
  );
}

/** Delete a saved option everywhere it is offered; products that already use it keep their value. */
async function deleteOption(kind: keyof OptionSet, id: number, name: string, opts: OptionSet, setOpts: (o: OptionSet) => void): Promise<boolean> {
  if (!(await confirmAction(`წავშალოთ „${name}“ ჩამონათვალიდან? პროდუქტებს, რომლებიც მას უკვე იყენებენ, არ შეეხება.`))) return false;
  try {
    await api(`/admin/options/${id}`, { method: 'DELETE' });
    setOpts({ ...opts, [kind]: (opts[kind] as { id: number }[]).filter((o) => o.id !== id) } as OptionSet);
    toast.ok('წაიშალა ჩამონათვალიდან');
    return true;
  } catch (e: any) { toast.err(e.message); return false; }
}

/* ---------- Product editor: pick a saved option or add a new one ---------- */

export function OptionSelect({ kind, label, hint, value, onChange, opts, setOpts, error }: {
  kind: 'material'; label: string; hint?: string; value: L10n; onChange: (v: L10n) => void;
  opts: OptionSet; setOpts: (o: OptionSet) => void; error?: string;
}) {
  const [adding, setAdding] = useState(false);
  const list = opts[kind];
  const match = list.find((o) => o.ka === value.ka && o.en === value.en);
  // A value saved before the lists existed (or since removed from them) still shows as the current choice.
  const legacy = !match && (value.ka || value.en);
  const selected = adding ? NEW : match ? String(match.id) : legacy ? '__cur' : '';

  return (
    <div class="fld">
      <span>{label}{hint && <span class="muted small"> ({hint})</span>}</span>
      <Picker
        selected={selected}
        invalid={!!error}
        ariaLabel={label}
        placeholder="— აირჩიეთ —"
        addLabel="ახალი ვარიანტის დამატება"
        items={[
          ...list.map((o) => ({ key: String(o.id), label: o.ka, sub: o.en, deletable: true })),
          ...(legacy ? [{ key: '__cur', label: value.ka || '—', sub: value.en || '—' }] : []),
        ]}
        onAdd={() => setAdding(true)}
        onSelect={(v) => {
          setAdding(false);
          const o = list.find((x) => String(x.id) === v);
          if (o) onChange({ ka: o.ka, en: o.en });
        }}
        onDelete={(v) => {
          const o = list.find((x) => String(x.id) === v);
          // Deleting the option this field is using also clears the field.
          if (o) deleteOption(kind, o.id, o.ka, opts, setOpts).then((ok) => { if (ok && v === selected) onChange({ ka: '', en: '' }); });
        }}
      />
      {error && <span class="err">{error}</span>}
      {adding && (
        <NewTextOption
          kind={kind}
          onCancel={() => setAdding(false)}
          onSaved={(o) => {
            if (!list.some((x) => x.id === o.id)) setOpts({ ...opts, [kind]: [...list, o] });
            onChange({ ka: o.ka, en: o.en });
            setAdding(false);
            toast.ok('ვარიანტი დაემატა ჩამონათვალს');
          }}
        />
      )}
    </div>
  );
}

export function SizeSelect({ width, height, onChange, opts, setOpts, invalid }: {
  width: number; height: number; onChange: (w: number, h: number) => void;
  opts: OptionSet; setOpts: (o: OptionSet) => void; invalid?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const match = opts.size.find((o) => o.width === width && o.height === height);
  const legacy = !match && width > 0 && height > 0;
  const selected = adding ? NEW : match ? String(match.id) : legacy ? '__cur' : '';

  return (
    <div class="size-pick">
      <Picker
        selected={selected}
        invalid={invalid}
        ariaLabel="ზომა"
        placeholder="— აირჩიეთ ზომა —"
        addLabel="ახალი ზომის დამატება"
        items={[
          ...opts.size.map((o) => ({ key: String(o.id), label: sizeLabel(o.width, o.height), deletable: true })),
          ...(legacy ? [{ key: '__cur', label: sizeLabel(width, height) }] : []),
        ]}
        onAdd={() => setAdding(true)}
        onSelect={(v) => {
          setAdding(false);
          const o = opts.size.find((x) => String(x.id) === v);
          if (o) onChange(o.width, o.height);
        }}
        onDelete={(v) => {
          const o = opts.size.find((x) => String(x.id) === v);
          if (o) deleteOption('size', o.id, sizeLabel(o.width, o.height), opts, setOpts).then((ok) => { if (ok && v === selected) onChange(0, 0); });
        }}
      />
      {adding && (
        <NewSizeOption
          onCancel={() => setAdding(false)}
          onSaved={(o) => {
            if (!opts.size.some((x) => x.id === o.id)) setOpts({ ...opts, size: [...opts.size, o].sort((a, b) => a.width - b.width || a.height - b.height) });
            onChange(o.width, o.height);
            setAdding(false);
            toast.ok('ზომა დაემატა ჩამონათვალს');
          }}
        />
      )}
    </div>
  );
}

/* ---------- Settings: manage the saved lists ---------- */

export function OptionLists() {
  const [opts, setOpts] = useState<OptionSet | null>(null);
  useEffect(() => { api<OptionSet>('/admin/options').then(setOpts).catch((e) => toast.err(e.message)); }, []);
  if (!opts) return null;

  const remove = (kind: keyof OptionSet, id: number, name: string) => deleteOption(kind, id, name, opts, setOpts);
  const added = (kind: keyof OptionSet, o: TextOption | SizeOption) => {
    const list = opts[kind] as { id: number }[];
    if (!list.some((x) => x.id === o.id)) setOpts({ ...opts, [kind]: [...list, o] } as OptionSet);
    toast.ok('დაემატა');
  };

  const textBlock = (kind: 'material', title: string) => (
    <div class="opt-list">
      <h3>{title} <span class="muted small">{opts[kind].length}</span></h3>
      <ul>
        {opts[kind].map((o) => (
          <li key={o.id}>
            <span><b>{o.ka}</b><span class="muted small">{o.en}</span></span>
            <button class="icon-btn danger" type="button" aria-label="წაშლა" onClick={() => remove(kind, o.id, o.ka)}><Icon name="trash" size={16} /></button>
          </li>
        ))}
      </ul>
      <NewTextOption kind={kind} onSaved={(o) => added(kind, o)} />
    </div>
  );

  return (
    <section class="card pad-lg">
      <h2>ჩამონათვლები</h2>
      <p class="muted small">ვარიანტები, რომლებიც პროდუქტის რედაქტირებისას ჩამოსაშლელ სიებში ჩანს. ახალი ვარიანტის დამატება პროდუქტის გვერდიდანაც შეიძლება.</p>
      <div class="opt-lists">
        {textBlock('material', 'მასალა')}
        <div class="opt-list">
          <h3>ზომები <span class="muted small">{opts.size.length}</span></h3>
          <ul class="opt-sizes">
            {opts.size.map((o) => (
              <li key={o.id}>
                <span class="num">{sizeLabel(o.width, o.height)}</span>
                <button class="icon-btn danger" type="button" aria-label="წაშლა" onClick={() => remove('size', o.id, sizeLabel(o.width, o.height))}><Icon name="trash" size={16} /></button>
              </li>
            ))}
          </ul>
          <NewSizeOption onSaved={(o) => added('size', o)} />
        </div>
      </div>
    </section>
  );
}
