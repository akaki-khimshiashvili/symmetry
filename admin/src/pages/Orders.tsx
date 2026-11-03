import { useEffect, useState } from 'preact/hooks';
import { api, type Order, fmtDate, fmtPrice, CLIENT_TYPES, CHANNELS } from '../api';
import { Icon, Loading, Empty, toast, confirmAction } from '../ui';

const STATUS: Record<string, string> = { new: 'ახალი', in_progress: 'მუშავდება', done: 'დასრულებული', cancelled: 'გაუქმებული' };

export function contactHref(channel: string, phone: string, email: string) {
  const digits = phone.replace(/\D/g, '');
  if (channel === 'whatsapp') return `https://wa.me/${digits}`;
  if (channel === 'email' && email) return `mailto:${email}`;
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

export function OrdersPage({ onChange }: { onChange: () => void }) {
  const [items, setItems] = useState<Order[] | null>(null);
  const [filter, setFilter] = useState('all');
  const load = () => api<Order[]>('/admin/orders').then(setItems).catch((e) => toast.err(e.message));
  useEffect(() => { load(); }, []);

  const setStatus = async (o: Order, status: string) => {
    try {
      await api(`/admin/orders/${o.id}`, { method: 'PATCH', body: { status } });
      setItems((xs) => xs!.map((x) => (x.id === o.id ? { ...x, status } : x)));
      onChange();
    } catch (e: any) { toast.err(e.message); }
  };
  const remove = async (o: Order) => {
    if (!(await confirmAction(`წავშალოთ შეკვეთა #${o.id}?`))) return;
    try {
      await api(`/admin/orders/${o.id}`, { method: 'DELETE' });
      load(); onChange();
    } catch (e: any) { toast.err(e.message); }
  };

  const shown = items?.filter((o) => filter === 'all' || o.status === filter) ?? [];

  return (
    <section class="page">
      <header class="page-head">
        <div>
          <h1>შეკვეთები</h1>
          <p class="muted">შეკვეთის მოთხოვნები საიტიდან. ონლაინ გადახდა (Flitt) დაემატება შემდეგ ეტაპზე.</p>
        </div>
      </header>
      <div class="tabs" role="tablist">
        {[['all', 'ყველა'], ...Object.entries(STATUS)].map(([k, v]) => (
          <button key={k} type="button" role="tab" aria-selected={filter === k} class={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>
            {v}{items && <span class="count">{k === 'all' ? items.length : items.filter((o) => o.status === k).length}</span>}
          </button>
        ))}
      </div>
      {!items ? <Loading /> : shown.length === 0 ? <Empty title="ამ ფილტრით შეკვეთები არ არის" /> : (
        <div class="list">
          {shown.map((o) => (
            <article class={`card entry ${o.status === 'new' ? 'is-new' : ''}`} key={o.id}>
              <div class="entry-main">
                <div class="entry-top">
                  <b>{o.first_name} {o.last_name}</b>
                  <span class="muted small">#{o.id} · {fmtDate(o.created_at)} · {o.lang === 'en' ? 'EN' : 'KA'}</span>
                </div>
                <div class="entry-product">
                  <span>{o.product_name}</span><span class="muted">{o.size_label}</span><b class="num">{fmtPrice(o.price)}</b>
                </div>
                <div class="meta">
                  <span>{CLIENT_TYPES[o.client_type] ?? o.client_type}</span>
                  <a href={`tel:${o.phone.replace(/[^\d+]/g, '')}`} class="num"><Icon name="phone" size={14} />{o.phone}</a>
                  {o.email && <a href={`mailto:${o.email}`}><Icon name="mail" size={14} />{o.email}</a>}
                  <span>სასურველი არხი: <b>{CHANNELS[o.channel]}</b></span>
                </div>
                {o.message && <p class="msg">{o.message}</p>}
              </div>
              <div class="entry-side">
                <select value={o.status} onChange={(e) => setStatus(o, e.currentTarget.value)} aria-label="სტატუსი" class={`status s-${o.status}`}>
                  {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <a class="btn primary sm" href={contactHref(o.channel, o.phone, o.email)} target="_blank" rel="noopener">დაკავშირება</a>
                <button class="icon-btn danger" type="button" onClick={() => remove(o)} aria-label="წაშლა"><Icon name="trash" /></button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
