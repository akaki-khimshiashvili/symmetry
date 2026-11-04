import { useEffect, useState } from 'preact/hooks';
import { api, type Message, fmtDate, CLIENT_TYPES, CHANNELS } from '../api';
import { Icon, Loading, Empty, toast, confirmAction } from '../ui';
import { contactHref } from './Orders';

const STATUS: Record<string, string> = { new: 'ახალი', read: 'წაკითხული', archived: 'არქივი' };
const INTENT: Record<string, string> = { order: 'შეკვეთა', question: 'კითხვა', other: 'სხვა' };

export function MessagesPage({ onChange }: { onChange: () => void }) {
  const [items, setItems] = useState<Message[] | null>(null);
  const [filter, setFilter] = useState('new');
  const load = () => api<Message[]>('/admin/messages').then(setItems).catch((e) => toast.err(e.message));
  useEffect(() => { load(); }, []);

  const setStatus = async (m: Message, status: string) => {
    try {
      await api(`/admin/messages/${m.id}`, { method: 'PATCH', body: { status } });
      setItems((xs) => xs!.map((x) => (x.id === m.id ? { ...x, status } : x)));
      onChange();
    } catch (e: any) { toast.err(e.message); }
  };
  const remove = async (m: Message) => {
    if (!(await confirmAction('წავშალოთ ეს შეტყობინება?'))) return;
    try { await api(`/admin/messages/${m.id}`, { method: 'DELETE' }); load(); onChange(); } catch (e: any) { toast.err(e.message); }
  };

  const shown = items?.filter((m) => filter === 'all' || m.status === filter) ?? [];

  return (
    <section class="page">
      <header class="page-head">
        <div>
          <h1>შეტყობინებები</h1>
          <p class="muted">საკონტაქტო ფორმიდან მიღებული შეტყობინებები.</p>
        </div>
      </header>
      <div class="tabs" role="tablist">
        {[...Object.entries(STATUS), ['all', 'ყველა']].map(([k, v]) => (
          <button key={k} type="button" role="tab" aria-selected={filter === k} class={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>
            {v}{items && <span class="count">{k === 'all' ? items.length : items.filter((m) => m.status === k).length}</span>}
          </button>
        ))}
      </div>
      {!items ? <Loading /> : shown.length === 0 ? <Empty title="შეტყობინებები არ არის" /> : (
        <div class="list">
          {shown.map((m) => (
            <article class={`card entry ${m.status === 'new' ? 'is-new' : ''}`} key={m.id}>
              <div class="entry-main">
                <div class="entry-top">
                  <b>{[m.first_name, m.last_name].filter(Boolean).join(' ')}</b>
                  {m.intent && <span class="tag">{INTENT[m.intent]}</span>}
                  <span class="muted small">{fmtDate(m.created_at)} · {m.lang === 'en' ? 'EN' : 'KA'}</span>
                </div>
                <div class="meta">
                  <span>{CLIENT_TYPES[m.client_type] ?? m.client_type}</span>
                  <a href={`tel:${m.phone.replace(/[^\d+]/g, '')}`} class="num"><Icon name="phone" size={14} />{m.phone}</a>
                  {m.email && <a href={`mailto:${m.email}`}><Icon name="mail" size={14} />{m.email}</a>}
                  <span>სასურველი არხი: <b>{CHANNELS[m.channel]}</b></span>
                </div>
                {m.message ? <p class="msg">{m.message}</p> : <p class="muted small">შეტყობინების ტექსტი არ არის.</p>}
              </div>
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
    </section>
  );
}
