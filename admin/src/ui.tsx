import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

const paths: Record<string, string> = {
  grid: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
  panel: '<rect x="4" y="3.5" width="2.4" height="17"/><rect x="9" y="6.5" width="2.4" height="11"/><rect x="13.6" y="6.5" width="2.4" height="11"/><rect x="18" y="3.5" width="2.4" height="17"/>',
  bag: '<path d="M5 8h14l-1 12H6z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>',
  mail: '<rect x="3" y="5.5" width="18" height="13" rx="1.5"/><path d="m3.5 6.5 8.5 6.5 8.5-6.5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M5.6 18.4l1.6-1.6M16.8 7.2l1.6-1.6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M5 7h14"/><path d="M9.5 7V5h5v2"/><path d="M6.5 7l1 13h9l1-13"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  out: '<path d="M14 4h5v16h-5"/><path d="M10 8l-4 4 4 4"/><path d="M6 12h10"/>',
  ext: '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v6H4V6h6"/>',
  left: '<path d="M14.5 6 8.5 12l6 6"/>',
  right: '<path d="m9.5 6 6 6-6 6"/>',
  upload: '<path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 16v4h16v-4"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  close: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.5-4.5L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.5 4.5L20 16"/><path d="M20 20v-4h-4"/>',
  phone: '<path d="M6.6 3.5h2.6l1.3 4-1.9 1.3a12 12 0 0 0 6.6 6.6l1.3-1.9 4 1.3v2.6a2 2 0 0 1-2.2 2A16.6 16.6 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2Z"/>',
  star: '<path d="m12 4 2.4 5 5.4.6-4 3.7 1.1 5.3L12 16l-4.9 2.6 1.1-5.3-4-3.7 5.4-.6z"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/>',
  menu: '<path d="M4 8h16M4 16h16"/>',
};

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <svg class="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: paths[name] || '' }} />
  );
}

/* ---------- Toasts ---------- */
type Toast = { id: number; text: string; kind: 'ok' | 'err' };
let push: (t: Omit<Toast, 'id'>) => void = () => {};
export const toast = {
  ok: (text: string) => push({ text, kind: 'ok' }),
  err: (text: string) => push({ text, kind: 'err' }),
};
export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    push = (t) => {
      const id = Date.now() + Math.random();
      setItems((x) => [...x, { ...t, id }]);
      setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), t.kind === 'err' ? 6000 : 3200);
    };
  }, []);
  return (
    <div class="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} class={`toast ${t.kind}`}>
          <Icon name={t.kind === 'ok' ? 'check' : 'close'} size={16} />
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}

/* ---------- Confirm dialog ---------- */
let ask: (msg: string, action: string) => Promise<boolean> = async () => false;
export const confirmAction = (msg: string, action = 'წაშლა') => ask(msg, action);
export function ConfirmHost() {
  const ref = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<{ msg: string; action: string; resolve?: (v: boolean) => void }>({ msg: '', action: '' });
  useEffect(() => {
    ask = (msg, action) => new Promise((resolve) => {
      setState({ msg, action, resolve });
      ref.current?.showModal();
    });
  }, []);
  const done = (v: boolean) => {
    ref.current?.close();
    state.resolve?.(v);
  };
  return (
    <dialog ref={ref} class="confirm" onCancel={() => state.resolve?.(false)}>
      <p>{state.msg}</p>
      <div class="row-end">
        <button class="btn ghost" type="button" onClick={() => done(false)}>გაუქმება</button>
        <button class="btn danger" type="button" onClick={() => done(true)}>{state.action}</button>
      </div>
    </dialog>
  );
}

export function Empty({ title, children }: { title: string; children?: ComponentChildren }) {
  return (
    <div class="empty">
      <Icon name="panel" size={28} />
      <p class="empty-t">{title}</p>
      {children}
    </div>
  );
}

export function Loading() {
  return (
    <div class="loading" aria-busy="true" aria-label="იტვირთება">
      {[0, 1, 2].map((i) => <div key={i} class="skeleton" />)}
    </div>
  );
}
