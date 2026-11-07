import { useEffect, useState } from 'preact/hooks';
import { useLive } from '../live';
import { api, type Order, type PaymentConfig, PAYMENT, fmtDate, fmtPrice, CLIENT_TYPES, CHANNELS, SITE_URL } from '../api';
import { Icon, Loading, Empty, toast, confirmAction, cap } from '../ui';

const STATUS: Record<string, string> = { new: 'ახალი', in_progress: 'მუშავდება', done: 'დასრულებული', cancelled: 'გაუქმებული' };
const HELD = 'held';
/** Payment states that have a receipt (same list as the API's Receipts::STATES). */
const RECEIPT_STATES = ['held', 'captured', 'released', 'refunded', 'expired'];
const receiptUrl = (o: Order) => `${SITE_URL}${o.lang === 'en' ? '/en' : ''}/receipt/?t=${o.pay_token}`;

type Check = { valid: false } | {
  valid: true; number: string; status: string; amount: number; customer: string; phone_end: string;
  card_end: string; item: { product: string; size: string }; test: boolean;
  issued_at: string; captured_at: string | null; released_at: string | null;
};

/** "SYM-2026-00012" → 12 (the receipt number carries the order id). */
const orderIdOf = (number: string) => Number(number.match(/-(\d+)$/)?.[1] || 0);

/**
 * Staff check a receipt a customer shows them (number + code from the receipt, or scan its QR).
 * A genuine receipt opens a summary card with links to its order and to the full receipt.
 */
function ReceiptCheck({ orders, onShowOrder }: { orders: Order[] | null; onShowOrder: (id: number) => void }) {
  const [n, setN] = useState('');
  const [c, setC] = useState('');
  const [res, setRes] = useState<Check | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (e: Event) => {
    e.preventDefault();
    if (!n.trim() || !c.trim()) return;
    setBusy(true);
    setRes(null);
    try {
      setRes(await api<Check>(`/receipts/verify?n=${encodeURIComponent(n.trim())}&c=${encodeURIComponent(c.trim())}`));
    } catch (err: any) { toast.err(err.message); } finally { setBusy(false); }
  };
  const order = res?.valid ? orders?.find((o) => o.id === orderIdOf(res.number)) : undefined;
  return (
    <div class="rcheck-wrap">
      <form class="card rcheck" onSubmit={run}>
        <div class="rcheck-row">
          <label class="fld"><span>ქვითრის №</span><input value={n} onInput={(e) => setN(e.currentTarget.value)} placeholder="SYM-2026-00012" /></label>
          <label class="fld"><span>გადამოწმების კოდი</span><input value={c} onInput={(e) => setC(e.currentTarget.value)} placeholder="XXXX-XXXX-XXXX-XXXX" /></label>
          <button class="btn primary" disabled={busy}>{busy ? 'მოწმდება…' : 'შემოწმება'}</button>
        </div>
      </form>

      {res && !res.valid && (
        <div class="card rcheck-result is-bad" role="alert">
          <span class="rcheck-mark"><Icon name="close" size={18} /></span>
          <div>
            <b>ქვითარი ვერ დადასტურდა</b>
            <p class="muted small">ნომერი და კოდი არ ემთხვევა არცერთ ქვითარს — შესაძლოა ყალბია ან შეცვლილი.</p>
          </div>
        </div>
      )}

      {res && res.valid && (
        <div class="card rcheck-result is-ok" role="status">
          <div class="rcheck-top">
            <span class="rcheck-mark"><Icon name="check" size={18} /></span>
            <div class="rcheck-title">
              <b>ქვითარი ნამდვილია · <span class="num">{res.number}</span></b>
              <p class="muted small">მიმდინარე სტატუსი: <b class={`st st-${res.status}`}>{PAYMENT[res.status as keyof typeof PAYMENT]?.label ?? res.status}</b>{res.test && ' · ტესტი'}</p>
            </div>
            <b class="order-price num">{fmtPrice(res.amount)}</b>
          </div>
          <dl class="order-facts">
            <div><dt>პროდუქტი</dt><dd>{res.item.product} <span class="muted num">{res.item.size}</span></dd></div>
            <div><dt>მყიდველი</dt><dd>{res.customer}{res.phone_end && <span class="muted num"> · ••{res.phone_end}</span>}</dd></div>
            <div><dt>ბარათი</dt><dd class="num">{res.card_end ? `•••• ${res.card_end}` : '—'}</dd></div>
            <div><dt>გაცემულია</dt><dd>{fmtDate(res.issued_at)}</dd></div>
            {res.captured_at && <div><dt>ჩამოჭრილია</dt><dd>{fmtDate(res.captured_at)}</dd></div>}
            {res.released_at && <div><dt>გაუქმდა / დაბრუნდა</dt><dd>{fmtDate(res.released_at)}</dd></div>}
          </dl>
          <div class="rcheck-actions">
            <button class="btn primary sm" type="button" disabled={!order} onClick={() => order && onShowOrder(order.id)}>
              <Icon name="right" size={16} />შეკვეთის ნახვა #{orderIdOf(res.number)}
            </button>
            {order?.pay_token && (
              <a class="btn ghost sm" href={receiptUrl(order)} target="_blank" rel="noopener"><Icon name="ext" size={15} />სრული ქვითრის გახსნა</a>
            )}
            {!order && orders && <span class="muted small">შეკვეთა სიაში ვერ მოიძებნა (შესაძლოა წაშლილია).</span>}
          </div>
        </div>
      )}
    </div>
  );
}

export function contactHref(channel: string, phone: string, email: string) {
  const digits = phone.replace(/\D/g, '');
  if (channel === 'whatsapp') return `https://wa.me/${digits}`;
  if (channel === 'email' && email) return `mailto:${email}`;
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

/** Days left before Flitt's pre-authorization hold lapses and the money returns to the customer by itself. */
function holdDaysLeft(o: Order, holdDays: number) {
  if (!o.held_at) return null;
  const heldAt = new Date(o.held_at.replace(' ', 'T') + 'Z').getTime();
  return Math.ceil((heldAt + holdDays * 86400000 - Date.now()) / 86400000);
}

export function OrdersPage({ onChange }: { onChange: () => void }) {
  const [items, setItems] = useState<Order[] | null>(null);
  const [pay, setPay] = useState<PaymentConfig | null>(null);
  const [filter, setFilter] = useState('new');
  const [busy, setBusy] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const [flash, setFlash] = useState<number | null>(null);

  /** Jump to an order card (from the receipt check) and briefly highlight it. */
  const showOrder = (id: number) => {
    setFilter('all');
    setFlash(id);
    requestAnimationFrame(() => {
      const el = document.getElementById(`order-${id}`);
      el?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      el?.focus({ preventScroll: true });
    });
    setTimeout(() => setFlash((f) => (f === id ? null : f)), 2400);
  };
  const load = () => api<Order[]>('/admin/orders').then(setItems).catch((e) => toast.err(e.message));
  useLive('orders', () => api<Order[]>('/admin/orders').then(setItems).catch(() => {})); // new orders / payments appear by themselves
  useEffect(() => {
    load();
    api<PaymentConfig>('/admin/payments').then(setPay).catch(() => {});
  }, []);

  const replace = (o: Order) => setItems((xs) => xs!.map((x) => (x.id === o.id ? o : x)));

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

  /** Accept / decline / refund / sync go through Flitt; the server returns the updated order. */
  const act = async (o: Order, action: 'accept' | 'decline' | 'refund' | 'sync' | 'email-receipt', done?: string) => {
    setBusy(o.id);
    try {
      const updated = await api<Order>(`/admin/orders/${o.id}/${action}`, { method: 'POST' });
      replace(updated);
      onChange();
      if (done) toast.ok(done);
      else if (updated.payment_status !== o.payment_status) toast.ok(`სტატუსი: ${PAYMENT[updated.payment_status]?.label}`);
      else toast.ok('ცვლილება არ არის');
    } catch (e: any) {
      toast.err(e.message);
      load();
    } finally { setBusy(null); }
  };

  const accept = async (o: Order) => {
    if (!(await confirmAction(`დავადასტუროთ შეკვეთა #${o.id}? მომხმარებელს ჩამოეჭრება ${fmtPrice(o.amount / 100)}.`, 'დადასტურება და ჩამოჭრა', 'primary'))) return;
    act(o, 'accept', 'შეკვეთა დადასტურდა, თანხა ჩამოიჭრა');
  };
  const decline = async (o: Order) => {
    const msg = o.payment_status === HELD
      ? `უარვყოთ შეკვეთა #${o.id}? დაბლოკილი ${fmtPrice(o.amount / 100)} დაუბრუნდება მომხმარებელს. არაფერი ჩამოიჭრება.`
      : `გავაუქმოთ შეკვეთა #${o.id}?`;
    if (!(await confirmAction(msg, 'უარყოფა'))) return;
    act(o, 'decline', o.payment_status === HELD ? 'შეკვეთა უარყოფილია, თანხა გათავისუფლდა' : 'შეკვეთა გაუქმდა');
  };
  const refund = async (o: Order) => {
    if (!(await confirmAction(`დავუბრუნოთ ${fmtPrice(o.amount / 100)} მომხმარებელს (შეკვეთა #${o.id})? Flitt-ის საკომისიო, როგორც წესი, არ ბრუნდება.`, 'თანხის დაბრუნება'))) return;
    act(o, 'refund', 'თანხა დაბრუნდა');
  };

  const { new: newLabel, ...restStatus } = STATUS;
  const tabs: [string, string][] = [['new', newLabel], ['all', 'ყველა'], [HELD, 'დასადასტურებელი'], ...Object.entries(restStatus)];
  const matches = (o: Order, k: string) => k === 'all' || (k === HELD ? o.payment_status === HELD : o.status === k);
  const shown = items?.filter((o) => matches(o, filter)) ?? [];

  return (
    <section class="page">
      <header class="page-head">
        <div>
          <div class="title-row">
            <h1>შეკვეთები</h1>
            {pay?.enabled && pay.test && <span class="test-pill" title="Flitt-ის სატესტო მერჩანტი: რეალური თანხა არ მოძრაობს">სატესტო რეჟიმი</span>}
          </div>
          <p class="muted">
            {pay?.enabled
              ? 'გადახდილი თანხა ჯერ მხოლოდ იბლოკება. დაადასტურეთ შეკვეთა თანხის ჩამოსაჭრელად.'
              : 'შეკვეთის მოთხოვნები საიტიდან.'}
          </p>
        </div>
        {pay?.enabled && (
          <button class={`btn ${checking ? 'primary' : 'ghost'}`} type="button" aria-expanded={checking} onClick={() => setChecking(!checking)}>
            <Icon name="check" size={16} />ქვითრის შემოწმება
          </button>
        )}
      </header>
      {pay?.enabled && checking && <ReceiptCheck orders={items} onShowOrder={showOrder} />}
      <div class="tabs" role="tablist">
        {tabs.map(([k, v]) => (
          <button key={k} type="button" role="tab" aria-selected={filter === k} class={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>
            {v}{items && <span class="count">{cap(items.filter((o) => matches(o, k)).length)}</span>}
          </button>
        ))}
      </div>
      {!items ? <Loading /> : shown.length === 0 ? <Empty title="ამ ფილტრით შეკვეთები არ არის" /> : (
        <div class="list">
          {shown.map((o) => {
            const ps = PAYMENT[o.payment_status] ?? PAYMENT.unpaid;
            const left = o.payment_status === HELD && pay ? holdDaysLeft(o, pay.hold_days) : null;
            const working = busy === o.id;
            const name = [o.first_name, o.last_name].filter(Boolean).join(' ');
            const hasReceipt = !!(o.held_at && o.pay_token && RECEIPT_STATES.includes(o.payment_status));
            const canSync = !!o.flitt_order_id && !['captured', 'released', 'refunded'].includes(o.payment_status);
            const canDelete = !['held', 'captured'].includes(o.payment_status);
            return (
              <article id={`order-${o.id}`} tabIndex={-1} class={`card order ${o.status === 'new' ? 'is-new' : ''} ${o.payment_status === HELD ? 'is-held' : ''} ${flash === o.id ? 'is-flash' : ''}`} key={o.id}>
                <header class="order-head">
                  <div class="order-who">
                    <h2>{name}{o.status === 'new' && <span class="new-dot" title="ახალი" />}</h2>
                    <p class="muted small num">#{o.id} · {fmtDate(o.created_at)} · {o.lang === 'en' ? 'English' : 'ქართული'}</p>
                  </div>
                  <div class="order-sum">
                    <span class="order-price-wrap">
                      {o.sale_percent > 0 && o.list_price && <span class="order-sale num"><s>{fmtPrice(o.list_price)}</s> −{o.sale_percent}%</span>}
                      <b class="order-price num">{fmtPrice(o.price)}</b>
                    </span>
                    <select value={o.status} onChange={(e) => setStatus(o, e.currentTarget.value)} aria-label="შეკვეთის სტატუსი" class={`status s-${o.status}`}>
                      {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                </header>

                <dl class="order-facts">
                  <div><dt>პროდუქტი</dt><dd>{o.product_name} <span class="muted num">{o.size_label}</span></dd></div>
                  <div><dt>რაოდენობა</dt><dd class="num"><b>{o.quantity ?? 1} ც</b>{(o.quantity ?? 1) > 1 && <span class="muted"> · ცალი {fmtPrice(o.unit_price ?? o.price / (o.quantity || 1))}</span>}</dd></div>
                  <div><dt>მომხმარებელი</dt><dd>{CLIENT_TYPES[o.client_type] ?? o.client_type}</dd></div>
                  <div><dt>ტელეფონი</dt><dd><a class="num" href={`tel:${o.phone.replace(/[^\d+]/g, '')}`}>{o.phone}</a></dd></div>
                  <div><dt>ელ-ფოსტა</dt><dd>{o.email ? <a href={`mailto:${o.email}`}>{o.email}</a> : <span class="muted">—</span>}</dd></div>
                  <div><dt>სასურველი არხი</dt><dd>{CHANNELS[o.channel]}</dd></div>
                </dl>

                {o.message && <p class="msg">{o.message}</p>}

                {o.payment_status !== 'unpaid' && (
                  <section class={`pay pay-${o.payment_status}`}>
                    <div class="pay-head">
                      <span class="pay-dot" aria-hidden="true" />
                      <b>{ps.label}</b>
                      {o.amount > 0 && <span class="num">{fmtPrice(o.amount / 100)}</span>}
                      {o.card_mask && <span class="muted num">{o.card_type} •••• {o.card_mask.slice(-4)}</span>}
                      {!!o.payment_test && <span class="tag">ტესტი</span>}
                    </div>
                    {o.payment_status === HELD && (
                      <>
                        <p class="pay-note">
                          თანხა ჯერ არ ჩამოჭრილა.{' '}
                          {left !== null && (left > 0
                            ? <span class={left <= 2 ? 'warn' : ''}>ბლოკი იწურება ~{left} დღეში.</span>
                            : <span class="warn">ბლოკის ვადა შესაძლოა ამოწურულია — განაახლეთ სტატუსი.</span>)}
                        </p>
                        <div class="pay-actions">
                          <button class="btn primary" type="button" disabled={working} onClick={() => accept(o)}><Icon name="check" size={16} />დადასტურება და ჩამოჭრა</button>
                          <button class="btn danger-ghost" type="button" disabled={working} onClick={() => decline(o)}><Icon name="close" size={16} />უარყოფა</button>
                        </div>
                      </>
                    )}
                    {o.payment_status === 'declined' && o.payment_error && <p class="pay-note warn">{o.payment_error}</p>}
                    {hasReceipt && (
                      <p class="pay-note mail-note">
                        <Icon name="mail" size={14} />
                        {!o.email
                          ? <span class="warn">ელ-ფოსტა არ არის — ქვითარი ვერ გაიგზავნება.</span>
                          : o.receipt_emailed.split(',').includes(o.payment_status)
                            ? <>ქვითარი გაეგზავნა: <b>{o.email}</b>{o.receipt_emailed_at && <span class="muted"> · {fmtDate(o.receipt_emailed_at)}</span>}{pay?.mail === 'outbox' && <span class="muted"> (ლოკალური outbox)</span>}</>
                            : <span class="warn">ქვითარი ჯერ არ გაგზავნილა ({o.email}).</span>}
                      </p>
                    )}
                  </section>
                )}
                {o.payment_status === 'unpaid' && o.payment_error && (
                  <p class="small warn">გადახდის გვერდი ვერ შეიქმნა: {o.payment_error}</p>
                )}

                <footer class="order-foot">
                  <div class="order-links">
                    {hasReceipt && <a class="link-btn" href={receiptUrl(o)} target="_blank" rel="noopener"><Icon name="ext" size={15} />ქვითარი</a>}
                    {hasReceipt && o.email && (
                      <button class="link-btn" type="button" disabled={working} onClick={() => act(o, 'email-receipt', `ქვითარი გაეგზავნა: ${o.email}`)}>
                        <Icon name="mail" size={15} />ქვითრის ხელახლა გაგზავნა
                      </button>
                    )}
                    <a class="link-btn" href={`#/invoices/new?order=${o.id}`}><Icon name="doc" size={15} />ინვოისის შექმნა</a>
                    {canSync && <button class="link-btn" type="button" disabled={working} onClick={() => act(o, 'sync')}><Icon name="refresh" size={15} />სტატუსის განახლება</button>}
                    {o.payment_status === 'captured' && <button class="link-btn" type="button" disabled={working} onClick={() => refund(o)}>თანხის დაბრუნება</button>}
                  </div>
                  <div class="order-main-actions">
                    {canDelete && <button class="icon-btn danger" type="button" onClick={() => remove(o)} aria-label="წაშლა" title="წაშლა"><Icon name="trash" /></button>}
                    <a class="btn primary sm" href={contactHref(o.channel, o.phone, o.email)} target="_blank" rel="noopener">დაკავშირება · {CHANNELS[o.channel]}</a>
                  </div>
                </footer>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
