import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { api, type Message, fmtDate, CLIENT_TYPES, CHANNELS } from '../api';
import { Icon, Loading, Empty, toast, confirmAction, cap } from '../ui';
import { contactHref } from './Orders';
import { useLive } from '../live';

const STATUS: Record<string, string> = { new: 'ახალი', read: 'წაკითხული', archived: 'არქივი' };
const INTENT: Record<string, string> = { order: 'შეკვეთა', question: 'კითხვა', other: 'სხვა' };
const fullName = (m: Message) => [m.first_name, m.last_name].filter(Boolean).join(' ');
const digits = (s: string) => s.replace(/\D/g, '');
/** Search by name, phone (any formatting), email or the message text. Every word must match. */
const matchesQuery = (m: Message, q: string) => {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  // A phone number typed in any format ("599 12 34", "+995-599…") is matched as one run of digits.
  if (/^[\d\s+()-]+$/.test(q) && digits(q).length >= 3) return digits(m.phone).includes(digits(q));
  const hay = [m.first_name, m.last_name, m.email, m.message, CLIENT_TYPES[m.client_type] ?? ''].join(' ').toLowerCase();
  const phone = digits(m.phone);
  return words.every((w) => hay.includes(w) || (digits(w).length >= 3 && phone.includes(digits(w))));
};

export function MessagesPage({ onChange }: { onChange: () => void }) {
  const [items, setItems] = useState<Message[] | null>(null);
  const [filter, setFilter] = useState('new');
  const [openId, setOpenId] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const load = () => api<Message[]>('/admin/messages').then(setItems).catch((e) => toast.err(e.message));
  useEffect(() => { load(); }, []);
  useLive('messages', () => api<Message[]>('/admin/messages').then(setItems).catch(() => {})); // new messages appear by themselves

  const setStatus = async (m: Message, status: string, quiet = false) => {
    try {
      await api(`/admin/messages/${m.id}`, { method: 'PATCH', body: { status } });
      setItems((xs) => xs!.map((x) => (x.id === m.id ? { ...x, status } : x)));
      onChange();
      if (!quiet) toast.ok(status === 'archived' ? 'გადავიდა არქივში' : status === 'read' ? 'მოინიშნა წაკითხულად' : 'მოინიშნა ახლად');
    } catch (e: any) { toast.err(e.message); }
  };
  const remove = async (m: Message) => {
    if (!(await confirmAction('წავშალოთ ეს შეტყობინება?'))) return;
    try {
      await api(`/admin/messages/${m.id}`, { method: 'DELETE' });
      if (openId === m.id) setOpenId(null);
      load();
      onChange();
    } catch (e: any) { toast.err(e.message); }
  };

  const found = items?.filter((m) => matchesQuery(m, query)) ?? [];
  const shown = found.filter((m) => filter === 'all' || m.status === filter);
  const open = items?.find((m) => m.id === openId) ?? null;

  /** Opening a new message counts as reading it. */
  const view = (m: Message) => {
    setOpenId(m.id);
    if (m.status === 'new') setStatus(m, 'read', true);
  };

  return (
    <section class="page">
      <header class="page-head">
        <div>
          <h1>შეტყობინებები</h1>
          <p class="muted">საკონტაქტო ფორმიდან მიღებული შეტყობინებები. დააჭირეთ შეტყობინებას სრულად სანახავად.</p>
        </div>
      </header>
      <div class="tabs" role="tablist">
        {[...Object.entries(STATUS), ['all', 'ყველა']].map(([k, v]) => (
          <button key={k} type="button" role="tab" aria-selected={filter === k} class={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>
            {v}{items && <span class="count">{cap(k === 'all' ? found.length : found.filter((m) => m.status === k).length)}</span>}
          </button>
        ))}
        <label class="search">
          <Icon name="search" size={16} />
          <input
            type="search"
            value={query}
            onInput={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setQuery(''); }}
            placeholder="ძებნა: სახელი, ტელეფონი, ელ-ფოსტა, ტექსტი"
            aria-label="შეტყობინებების ძებნა"
          />
          {query && <button type="button" class="search-clear" onClick={() => setQuery('')} aria-label="გასუფთავება"><Icon name="close" size={14} /></button>}
        </label>
      </div>
      {!items ? <Loading /> : shown.length === 0 ? (
        query
          ? <Empty title={`„${query}“: ვერაფერი მოიძებნა`} />
          : <Empty title="შეტყობინებები არ არის" />
      ) : (
        <div class="list">
          {shown.map((m) => (
            <article class={`card entry msg-entry ${m.status === 'new' ? 'is-new' : ''}`} key={m.id}>
              <button type="button" class="entry-main entry-open" onClick={() => view(m)} aria-label={`${fullName(m)}: შეტყობინების გახსნა`}>
                <div class="entry-top">
                  <b>{fullName(m)}</b>
                  {m.intent && <span class="tag">{INTENT[m.intent]}</span>}
                  <span class="muted small">{fmtDate(m.created_at)} · {m.lang === 'en' ? 'EN' : 'KA'}</span>
                </div>
                <div class="meta">
                  <span>{CLIENT_TYPES[m.client_type] ?? m.client_type}</span>
                  <span class="num"><Icon name="phone" size={14} />{m.phone}</span>
                  {m.email && <span><Icon name="mail" size={14} />{m.email}</span>}
                  <span>სასურველი არხი: <b>{CHANNELS[m.channel]}</b></span>
                </div>
                {m.message ? <p class="msg msg-preview">{m.message}</p> : <p class="muted small">შეტყობინების ტექსტი არ არის.</p>}
                <span class="open-hint"><Icon name="eye" size={14} />სრულად ნახვა</span>
              </button>
              <div class="entry-side">
                <a class="btn primary sm" href={contactHref(m.channel, m.phone, m.email)} target="_blank" rel="noopener">პასუხი</a>
                {m.status !== 'read' && <button class="btn ghost sm" type="button" onClick={() => setStatus(m, 'read')}>წაკითხულად</button>}
                {m.status !== 'archived' && <button class="btn ghost sm" type="button" onClick={() => setStatus(m, 'archived')}>არქივში</button>}
                <button class="icon-btn danger" type="button" onClick={() => remove(m)} aria-label="წაშლა"><Icon name="trash" /></button>
              </div>
            </article>
          ))}
        </div>
      )}
      {open && (
        <MessageDialog
          m={open}
          list={shown.length && shown.some((x) => x.id === open.id) ? shown : [open]}
          onGo={view}
          onStatus={(s) => setStatus(open, s)}
          onRemove={() => remove(open)}
          onClose={() => setOpenId(null)}
        />
      )}
    </section>
  );
}

/** Everything the visitor sent through the contact form, in one window. */
function MessageDialog({ m, list, onGo, onStatus, onRemove, onClose }: {
  m: Message;
  list: Message[];
  onGo: (m: Message) => void;
  onStatus: (s: string) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => { dlg.current?.showModal(); }, []);
  const close = () => { dlg.current?.close(); onClose(); };

  const i = list.findIndex((x) => x.id === m.id);
  const prev = i > 0 ? list[i - 1] : null;
  const next = i >= 0 && i < list.length - 1 ? list[i + 1] : null;

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast.ok('დაკოპირდა'); } catch { toast.err('ვერ დაკოპირდა'); }
  };
  const tel = m.phone.replace(/[^\d+]/g, '');

  const rows: [string, ComponentChildren][] = [
    ['სახელი', m.first_name || '—'],
    ['გვარი', m.last_name || '—'],
    ['ტელეფონი', (
      <span class="md-val">
        <a class="num" href={`tel:${tel}`}>{m.phone}</a>
        <button type="button" class="icon-btn md-copy" onClick={() => copy(m.phone)} aria-label="ტელეფონის კოპირება" title="კოპირება"><Icon name="copy" size={15} /></button>
      </span>
    )],
    ['ელ-ფოსტა', m.email ? (
      <span class="md-val">
        <a href={`mailto:${m.email}`}>{m.email}</a>
        <button type="button" class="icon-btn md-copy" onClick={() => copy(m.email)} aria-label="ელ-ფოსტის კოპირება" title="კოპირება"><Icon name="copy" size={15} /></button>
      </span>
    ) : <span class="muted">არ მიუთითებია</span>],
    ['კლიენტის ტიპი', CLIENT_TYPES[m.client_type] ?? (m.client_type || '—')],
    ['სასურველი არხი', CHANNELS[m.channel] ?? (m.channel || '—')],
    ['მიზანი', INTENT[m.intent] ?? (m.intent || '—')],
    ['ფორმის ენა', m.lang === 'en' ? 'ინგლისური (EN)' : 'ქართული (KA)'],
    ['მიღებულია', fmtDate(m.created_at)],
    ['სტატუსი', STATUS[m.status] ?? m.status],
  ];

  return (
    <dialog
      ref={dlg}
      class="msg-dlg"
      aria-labelledby="md-title"
      onCancel={(e) => { e.preventDefault(); close(); }}
      onClick={(e) => { if (e.target === dlg.current) close(); }}
      onKeyDown={(e) => {
        if ((e.target as HTMLElement).closest('input, textarea')) return;
        if (e.key === 'ArrowLeft' && prev) onGo(prev);
        if (e.key === 'ArrowRight' && next) onGo(next);
      }}
    >
      <header class="md-head">
        <div class="md-who">
          <span class="md-avatar" aria-hidden="true">{(m.first_name || '?').slice(0, 1).toUpperCase()}</span>
          <div>
            <h2 id="md-title">{fullName(m) || 'უსახელო'}</h2>
            <p class="muted small">
              {m.intent && <span class="tag">{INTENT[m.intent]}</span>} {fmtDate(m.created_at)}
            </p>
          </div>
        </div>
        <div class="md-nav">
          {list.length > 1 && (
            <>
              <span class="muted small num">{i + 1} / {list.length}</span>
              <button type="button" class="icon-btn" disabled={!prev} onClick={() => prev && onGo(prev)} aria-label="წინა შეტყობინება"><Icon name="left" /></button>
              <button type="button" class="icon-btn" disabled={!next} onClick={() => next && onGo(next)} aria-label="შემდეგი შეტყობინება"><Icon name="right" /></button>
            </>
          )}
          <button type="button" class="icon-btn" onClick={close} aria-label="დახურვა"><Icon name="close" /></button>
        </div>
      </header>

      <div class="md-body">
        <section>
          <h3 class="md-label">შეტყობინება</h3>
          {m.message ? <p class="msg md-text">{m.message}</p> : <p class="muted small">შეტყობინების ტექსტი არ არის.</p>}
        </section>
        <section>
          <h3 class="md-label">საკონტაქტო ინფორმაცია</h3>
          <dl class="md-grid">
            {rows.map(([k, v]) => (
              <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
            ))}
          </dl>
        </section>
      </div>

      <footer class="md-foot">
        <button type="button" class="icon-btn danger" onClick={onRemove} aria-label="წაშლა" title="წაშლა"><Icon name="trash" /></button>
        <div class="md-actions">
          {m.status === 'archived'
            ? <button type="button" class="btn ghost sm" onClick={() => onStatus('read')}>არქივიდან დაბრუნება</button>
            : <button type="button" class="btn ghost sm" onClick={() => onStatus('archived')}>არქივში</button>}
          {m.status !== 'new' && <button type="button" class="btn ghost sm" onClick={() => onStatus('new')}>წაუკითხავად</button>}
          <a class="btn primary sm" href={contactHref(m.channel, m.phone, m.email)} target="_blank" rel="noopener">
            პასუხი: {CHANNELS[m.channel] ?? 'კონტაქტი'}
          </a>
        </div>
      </footer>
    </dialog>
  );
}
