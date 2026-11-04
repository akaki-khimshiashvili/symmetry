import { useEffect, useState } from 'preact/hooks';
import { api, type Order, type Message, fmtDate, fmtPrice, CHANNELS } from '../api';
import { Icon, Loading, toast } from '../ui';

type Stats = { products: number; published: number; orders_new: number; messages_new: number };

export function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [rebuilding, setRebuilding] = useState(false);

  useEffect(() => {
    Promise.all([api<Stats>('/admin/stats'), api<Order[]>('/admin/orders'), api<Message[]>('/admin/messages')])
      .then(([s, o, m]) => { setStats(s); setOrders(o.slice(0, 5)); setMessages(m.slice(0, 5)); })
      .catch((e) => toast.err(e.message));
  }, []);

  const rebuild = async () => {
    setRebuilding(true);
    try {
      await api('/admin/rebuild', { method: 'POST' });
      toast.ok('საიტის განახლება დაიწყო. რამდენიმე წუთში ცვლილებები გამოჩნდება');
    } catch (e: any) {
      toast.err(e.message);
    } finally {
      setRebuilding(false);
    }
  };

  if (!stats) return <Loading />;
  return (
    <section class="page">
      <header class="page-head">
        <div>
          <h1>მიმოხილვა</h1>
          <p class="muted">ახალი შეკვეთები და შეტყობინებები ერთ ადგილას.</p>
        </div>
        <button class="btn ghost" type="button" onClick={rebuild} disabled={rebuilding}>
          <Icon name="refresh" />{rebuilding ? 'იწყება…' : 'საიტის განახლება'}
        </button>
      </header>

      <div class="stats">
        <a class="stat" href="#/orders"><span class="stat-n">{stats.orders_new}</span><span>ახალი შეკვეთა</span></a>
        <a class="stat" href="#/messages"><span class="stat-n">{stats.messages_new}</span><span>ახალი შეტყობინება</span></a>
        <a class="stat" href="#/products"><span class="stat-n">{stats.published}<small> / {stats.products}</small></span><span>გამოქვეყნებული პროდუქტი</span></a>
      </div>

      <div class="two">
        <div class="card">
          <div class="card-head"><h2>ბოლო შეკვეთები</h2><a href="#/orders">ყველა</a></div>
          {orders.length === 0 ? <p class="muted pad">შეკვეთები ჯერ არ არის.</p> : (
            <ul class="feed">
              {orders.map((o) => (
                <li key={o.id}>
                  <div><b>{[o.first_name, o.last_name].filter(Boolean).join(' ')}</b> · {o.product_name} <span class="muted">{o.size_label}</span></div>
                  <div class="muted small">{fmtPrice(o.price)} · {CHANNELS[o.channel]} · {fmtDate(o.created_at)}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div class="card">
          <div class="card-head"><h2>ბოლო შეტყობინებები</h2><a href="#/messages">ყველა</a></div>
          {messages.length === 0 ? <p class="muted pad">შეტყობინებები ჯერ არ არის.</p> : (
            <ul class="feed">
              {messages.map((m) => (
                <li key={m.id}>
                  <div><b>{[m.first_name, m.last_name].filter(Boolean).join(' ')}</b> <span class="muted">· {m.phone}</span></div>
                  <div class="muted small clamp">{m.message || 'ტექსტის გარეშე'}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
