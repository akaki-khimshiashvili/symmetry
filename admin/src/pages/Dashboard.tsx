import { useEffect, useRef, useState } from 'preact/hooks';
import { useLive } from '../live';
import {
  api, type Metrics, type Mix, type ProductMetric, PERIODS, PAYMENT, CLIENT_TYPES, CHANNELS, PRODUCT_TYPES,
  fmtDate, fmtPrice, fmtNum,
} from '../api';
import { Icon, Loading, toast } from '../ui';
import { Kpi, Columns, BarList, Funnel, type BarRow } from '../charts';
import { Preview } from './Preview';

const TABS = [
  { key: 'overview', label: 'მთავარი' },
  { key: 'products', label: 'პროდუქცია' },
  { key: 'sales', label: 'გაყიდვები' },
  { key: 'customers', label: 'მომხმარებლები' },
  { key: 'traffic', label: 'ვიზიტები' },
] as const;
type Tab = (typeof TABS)[number]['key'];

const ORDER_STATUS: Record<string, string> = { new: 'ახალი', in_progress: 'მუშავდება', done: 'დასრულებული', cancelled: 'გაუქმებული' };
const INTENT: Record<string, string> = { order: 'შეკვეთა', question: 'კითხვა', other: 'სხვა' };
const MSG_STATUS: Record<string, string> = { new: 'ახალი (უპასუხო)', read: 'წაკითხული', archived: 'არქივი' };
const DEVICES: Record<string, string> = { mobile: 'მობილური', desktop: 'კომპიუტერი', tablet: 'პლანშეტი' };
const LANGS: Record<string, string> = { ka: 'ქართული', en: 'ინგლისური' };
const CONTACTS: Record<string, string> = { ...CHANNELS, instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok' };
const TYPE_LABEL = Object.fromEntries(PRODUCT_TYPES.map((t) => [t.key, t.label]));

const pref = {
  get: <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(`symmetry-admin:${k}`); return v ? (JSON.parse(v) as T) : d; } catch { return d; } },
  set: (k: string, v: unknown) => { try { localStorage.setItem(`symmetry-admin:${k}`, JSON.stringify(v)); } catch { /* private mode */ } },
};
const pct = (n: number) => `${fmtNum(n)}%`;
const rowsOf = (rec: Record<string, number>, labels: Record<string, string>): BarRow[] =>
  Object.entries(rec).sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ key: k, label: labels[k] ?? (k || 'უცნობი'), n }));
const mixRows = (mix: Mix[], labels: Record<string, string>): BarRow[] =>
  mix.map((m) => ({
    key: m.key, label: labels[m.key] ?? (m.key || 'უცნობი'), n: m.orders + m.messages,
    note: `${fmtNum(m.orders)} შეკვეთა · ${fmtNum(m.messages)} შეტყობინება`,
  }));

export function Dashboard() {
  const [tab, setTabState] = useState<Tab>(() => pref.get('metrics-tab', 'overview'));
  const [days, setDaysState] = useState<number>(() => pref.get('metrics-days', 30));
  const [m, setM] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [rebuilding, setRebuilding] = useState(false);

  const setTab = (t: Tab) => { setTabState(t); pref.set('metrics-tab', t); };
  const setDays = (d: number) => { setDaysState(d); pref.set('metrics-days', d); };

  const load = (quiet = false) => {
    if (!quiet) setLoading(true);
    return api<Metrics>(`/admin/metrics?days=${days}`)
      .then(setM)
      .catch((e) => { if (!quiet) toast.err(e.message); })
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [days]);

  // The controls bar floats over the content; its soft edge appears only once something scrolls under it.
  const sentinel = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const check = () => setStuck(el.getBoundingClientRect().top < 0);
    check();
    addEventListener('scroll', check, { passive: true });
    return () => removeEventListener('scroll', check);
  }, []);
  const period = PERIODS.find((p) => p.days === days);
  useLive(['orders', 'messages'], () => load(true));

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

  return (
    <section class="page mt-page">
      <div ref={sentinel} class="mt-sentinel" aria-hidden="true" />
      <div class={`mt-bar ${stuck ? 'is-stuck' : ''}`}>
      <header class="page-head">
        <div>
          <h1>მიმოხილვა</h1>
          <p class="muted">ვიზიტები, პროდუქცია და გაყიდვები არჩეული პერიოდისთვის.</p>
        </div>
        <div class="head-actions">
          <div class="period" role="radiogroup" aria-label="პერიოდი" style={{ '--i': Math.max(0, PERIODS.findIndex((p) => p.days === days)) } as any}>
            {PERIODS.map((p) => (
              <button key={p.days} type="button" role="radio" aria-checked={days === p.days} class={days === p.days ? 'on' : ''} onClick={() => setDays(p.days)}>{p.label}</button>
            ))}
          </div>
          <button class="btn ghost" type="button" onClick={rebuild} disabled={rebuilding} title="ცვლილებების გამოქვეყნება საიტზე">
            <Icon name="refresh" />{rebuilding ? 'იწყება…' : 'საიტის განახლება'}
          </button>
        </div>
      </header>

      <div class="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" id={`mt-${t.key}`} aria-selected={tab === t.key} aria-controls="mt-panel" class={tab === t.key ? 'on' : ''} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>
      </div>

      {!m ? <Loading /> : (
        <div key={tab} id="mt-panel" role="tabpanel" aria-labelledby={`mt-${tab}`} class={`metrics ${loading ? 'is-loading' : ''}`} aria-busy={loading}>
          {!m.traffic.tracking_since && <TrackingNote />}
          {tab !== 'customers' && (
            <p class="mt-compare muted"><span aria-hidden="true">▲▼ </span>წინა {period?.label ?? `${days} დღე`}სთან შედარებით</p>
          )}
          {tab === 'overview' && <Overview m={m} />}
          {tab === 'products' && <ProductsTab m={m} />}
          {tab === 'sales' && <SalesTab m={m} />}
          {tab === 'customers' && <CustomersTab m={m} />}
          {tab === 'traffic' && <TrafficTab m={m} />}
        </div>
      )}
    </section>
  );
}

function TrackingNote() {
  return (
    <p class="note">
      <Icon name="eye" size={16} />
      ვიზიტების აღრიცხვა ჯერ არ დაწყებულა. პირველი ვიზიტი საიტზე გამოჩნდება აქ. შეკვეთებისა და შეტყობინებების ციფრები უკვე ზუსტია.
    </p>
  );
}

function Overview({ m }: { m: Metrics }) {
  const c = m.current, p = m.previous;
  const sum = (k: 'visitors' | 'orders' | 'revenue') => m.series.reduce((s, x) => s + x[k], 0);
  return (
    <>
      <div class="kpis">
        <Kpi icon="users" label="ვიზიტორები" value={fmtNum(c.visitors)} cur={c.visitors} prev={p.visitors} hint={`${fmtNum(c.pageviews)} გვერდის ნახვა`} />
        <Kpi icon="bag" label="შეკვეთები" value={fmtNum(c.orders)} cur={c.orders} prev={p.orders} />
        <Kpi icon="coin" label="შემოსავალი" value={fmtPrice(c.revenue)} cur={c.revenue} prev={p.revenue} hint={`${fmtNum(c.sales)} გაყიდვა`} />
        <Kpi icon="percent" label="კონვერსია" value={pct(c.conversion)} cur={c.conversion} prev={p.conversion} hint="ვიზიტორი → შეკვეთა" />
        <Kpi icon="receipt" label="საშუალო შეკვეთა" value={c.aov ? fmtPrice(c.aov) : '—'} cur={c.aov} prev={p.aov} />
        <Kpi icon="chat" label="შეტყობინებები" value={fmtNum(c.messages)} cur={c.messages} prev={p.messages} />
      </div>
      <div class="two">
        <Columns title="ვიზიტორები" points={m.series} pick={(x) => x.visitors} total={<b>{fmtNum(sum('visitors'))}</b>} />
        <Columns title="შეკვეთები" points={m.series} pick={(x) => x.orders} total={<b>{fmtNum(sum('orders'))}</b>} />
      </div>
      <div class="two">
        <TopProducts m={m} />
        <BarList title="საიდან მოდიან" rows={sources(m)} />
      </div>
    </>
  );
}

function TopProducts({ m }: { m: Metrics }) {
  const top = [...m.products].filter((x) => x.views || x.orders).slice(0, 5);
  return (
    <BarList
      title="ყველაზე ნანახი პროდუქცია"
      rows={top.map((x) => ({ key: String(x.id), label: x.name, n: x.views, note: `${fmtNum(x.orders)} შეკვეთა` }))}
      empty="პროდუქტის ნახვები ჯერ არ არის"
    />
  );
}

const sources = (m: Metrics): BarRow[] => {
  const rows: BarRow[] = m.traffic.referrers.map((r) => ({ key: r.key, label: r.key, n: r.n }));
  if (m.traffic.direct) rows.push({ key: '(direct)', label: 'პირდაპირ / ბმულით', n: m.traffic.direct });
  return rows.sort((a, b) => b.n - a.n);
};

type SortKey = 'views' | 'orders' | 'revenue' | 'conversion';
function ProductsTab({ m }: { m: Metrics }) {
  const [sort, setSort] = useState<SortKey>('views');
  const list = [...m.products].sort((a, b) => b[sort] - a[sort] || b.views - a.views);
  const unseen = m.products.filter((x) => x.published && x.views === 0).length;
  const viewed = m.products.filter((x) => x.views > 0);
  const best = [...viewed].filter((x) => x.orders > 0).sort((a, b) => b.conversion - a.conversion)[0];
  const head = (k: SortKey, label: string) => (
    <th class="num-col" aria-sort={sort === k ? 'descending' : undefined}>
      <button type="button" class={`th-sort ${sort === k ? 'on' : ''}`} onClick={() => setSort(k)}>{label}{sort === k && <span aria-hidden="true"> ↓</span>}</button>
    </th>
  );
  return (
    <>
      <div class="kpis">
        <Kpi icon="eye" label="პროდუქტის ნახვები" value={fmtNum(m.current.product_views)} cur={m.current.product_views} prev={m.previous.product_views} />
        <Kpi icon="grid" label="ნანახი პროდუქტი" value={<>{viewed.length}<small> / {m.products.length}</small></>} hint={unseen ? `${unseen} გამოქვეყნებული არავის უნახავს` : 'ყველა ნანახია'} />
        <Kpi icon="target" label="საუკეთესო კონვერსია" value={best ? pct(best.conversion) : '—'} hint={best ? best.name : 'შეკვეთები ჯერ არ არის'} />
      </div>
      <div class="card table-wrap">
        <table class="table metrics-table">
          <caption class="sr">პროდუქციის მაჩვენებლები, ბოლო {m.days} დღე</caption>
          <thead>
            <tr>
              <th>პროდუქტი</th>
              {head('views', 'ნახვა')}
              <th class="num-col">მნახველი</th>
              {head('orders', 'შეკვეთა')}
              {head('revenue', 'შემოსავალი')}
              {head('conversion', 'კონვერსია')}
            </tr>
          </thead>
          <tbody>
            {list.map((x) => <ProductRow key={x.id} x={x} />)}
          </tbody>
        </table>
      </div>
      <p class="muted small">კონვერსია = შეკვეთები ÷ პროდუქტის მნახველები. დაბალი კონვერსია ბევრი ნახვით ნიშნავს, რომ პროდუქტი იზიდავს, მაგრამ ფასი, ფოტო ან აღწერა შესაძლოა გასაუმჯობესებელია.</p>
      <div class="two">
        <BarList title="პოპულარული ზომები" rows={m.sizes.map((s, i) => ({ key: String(i), label: <>{s.product} <span class="muted num">{s.size}</span></>, n: s.orders }))} empty="შეკვეთები ჯერ არ არის" />
        <BarList title="შეკვეთები ტიპის მიხედვით" rows={m.types.map((t) => ({ key: t.key, label: TYPE_LABEL[t.key] ?? t.key, n: t.orders, note: t.revenue ? `შემოსავალი ${fmtPrice(t.revenue)}` : undefined }))} empty="შეკვეთები ჯერ არ არის" />
      </div>
    </>
  );
}

function ProductRow({ x }: { x: ProductMetric }) {
  return (
    <tr>
      <td>
        <div class="pm-name">
          <span class="thumb-cell">{x.image ? <img src={x.image} alt="" /> : <Preview pattern="wave" small />}</span>
          <div>
            <span class="strong">{x.name}</span>
            <div class="muted small">
              {!x.published ? 'დამალული' : !x.in_stock ? 'არ არის მარაგში' : 'საიტზეა'}
            </div>
          </div>
        </div>
      </td>
      <td class="num num-col">{fmtNum(x.views)}</td>
      <td class="num num-col muted">{fmtNum(x.viewers)}</td>
      <td class="num num-col">{fmtNum(x.orders)}</td>
      <td class="num num-col nowrap">{x.revenue ? fmtPrice(x.revenue) : <span class="muted">—</span>}</td>
      <td class="num num-col">{x.viewers ? pct(x.conversion) : <span class="muted">—</span>}</td>
    </tr>
  );
}

function SalesTab({ m }: { m: Metrics }) {
  const s = m.sales, c = m.current, p = m.previous;
  const steps = [
    { label: 'ვიზიტორი', n: m.funnel[0].n, hint: 'გახსნა საიტი' },
    { label: 'პროდუქტის მნახველი', n: m.funnel[1].n, hint: 'გახსნა პროდუქტის გვერდი' },
    { label: 'შეკვეთა', n: m.funnel[2].n, hint: 'გააგზავნა ფორმა' },
    { label: 'გაყიდვა', n: m.funnel[3].n, hint: 'გადაიხადა / დასრულდა' },
  ];
  return (
    <>
      <div class="kpis">
        <Kpi icon="coin" label="შემოსავალი" value={fmtPrice(c.revenue)} cur={c.revenue} prev={p.revenue} hint={`${fmtNum(c.sales)} გაყიდვა`} />
        <Kpi icon="lock" label="დასადასტურებელი თანხა" value={fmtPrice(s.held_sum)} hint={`${fmtNum(s.held_count)} შეკვეთა ელოდება`} />
        <Kpi icon="clock" label="ღია შეკვეთები" value={fmtNum(s.open)} hint="ახალი + მუშავდება" />
        <Kpi icon="alert" label="დაუსრულებელი გადახდა" value={fmtNum(s.abandoned)} hint="დატოვა ან ბანკმა უარყო" />
        <Kpi icon="tag" label="ფასდაკლებით" value={fmtNum(s.discount_orders)} hint={s.discount_given ? `დათმობილი ${fmtPrice(s.discount_given)}` : 'შეკვეთა'} />
        <Kpi icon="undo" label="დაბრუნებული" value={fmtPrice(s.refunded_sum)} />
      </div>
      <Columns title="შემოსავალი" points={m.series} pick={(x) => x.revenue} fmt={fmtPrice} total={<b>{fmtPrice(c.revenue)}</b>} />
      <div class="two">
        <Funnel steps={steps} />
        <div class="stack">
          <BarList title="შეკვეთის სტატუსი" rows={rowsOf(s.by_status, ORDER_STATUS)} empty="შეკვეთები არ არის" />
          <BarList title="გადახდის სტატუსი" rows={rowsOf(s.by_payment, Object.fromEntries(Object.entries(PAYMENT).map(([k, v]) => [k, v.label])))} empty="შეკვეთები არ არის" />
        </div>
      </div>
    </>
  );
}

function CustomersTab({ m }: { m: Metrics }) {
  const cu = m.customers, ms = m.messages;
  return (
    <>
      <div class="kpis">
        <Kpi icon="users" label="მყიდველები" value={fmtNum(cu.unique)} hint="სხვადასხვა ტელეფონის ნომერი" />
        <Kpi icon="refresh" label="განმეორებითი" value={fmtNum(cu.repeat)} hint="შეუკვეთა ერთზე მეტჯერ" />
        <Kpi icon="mail" label="უპასუხო შეტყობინება" value={fmtNum(ms.waiting)} hint={ms.oldest_waiting ? `უძველესი: ${fmtDate(ms.oldest_waiting)}` : 'ყველას უპასუხეთ'} invert />
      </div>
      <div class="two">
        <BarList title="ვინ არიან" rows={mixRows(cu.client_types, CLIENT_TYPES)} />
        <BarList title="სასურველი კავშირის არხი" rows={mixRows(cu.channels, CHANNELS)} />
      </div>
      <div class="two">
        <BarList title="შეტყობინების მიზანი" rows={rowsOf(ms.by_intent, INTENT)} empty="შეტყობინებები არ არის" />
        <BarList title="ფორმის ენა" rows={mixRows(cu.langs, LANGS)} />
      </div>
    </>
  );
}

function TrafficTab({ m }: { m: Metrics }) {
  const t = m.traffic, c = m.current, p = m.previous;
  return (
    <>
      <div class="kpis">
        <Kpi icon="user" label="ვიზიტორები" value={fmtNum(c.visitors)} cur={c.visitors} prev={p.visitors} />
        <Kpi icon="pages" label="გვერდის ნახვები" value={fmtNum(c.pageviews)} cur={c.pageviews} prev={p.pageviews} hint={c.visitors ? `${fmtNum(Math.round((c.pageviews / c.visitors) * 10) / 10)} ვიზიტორზე` : undefined} />
        <Kpi icon="pointer" label="დაკავშირების კლიკი" value={fmtNum(c.contacts)} cur={c.contacts} prev={p.contacts} hint="WhatsApp, ზარი, ელ-ფოსტა" />
      </div>
      <Columns title="გვერდის ნახვები" points={m.series} pick={(x) => x.views} total={<b>{fmtNum(c.pageviews)}</b>} />
      <div class="two">
        <BarList title="ყველაზე ნანახი გვერდები" rows={t.pages.map((x) => ({ key: x.key, label: <span class="num">{x.key}</span>, n: x.n, note: `${fmtNum(x.u)} ვიზიტორი` }))} />
        <BarList title="საიდან მოდიან" rows={sources(m)} />
      </div>
      <div class="three">
        <BarList title="მოწყობილობა" rows={t.devices.map((x) => ({ key: x.key, label: DEVICES[x.key] ?? x.key, n: x.n }))} />
        <BarList title="საიტის ენა" rows={t.langs.map((x) => ({ key: x.key, label: LANGS[x.key] ?? x.key, n: x.n }))} />
        <BarList title="დაკავშირების კლიკები" rows={t.contacts.map((x) => ({ key: x.key, label: CONTACTS[x.key] ?? x.key, n: x.n }))} empty="კლიკები ჯერ არ არის" />
      </div>
      <p class="muted small">
        ვიზიტორი = ბრაუზერი (ერთი ადამიანი ორი მოწყობილობიდან ორად ითვლება). ბოტები არ ითვლება. ქუქიები და პირადი მონაცემები არ ინახება.
        {t.tracking_since && <> აღრიცხვა დაიწყო: {fmtDate(t.tracking_since)}.</>}
      </p>
    </>
  );
}
