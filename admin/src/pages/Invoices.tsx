import { useEffect, useMemo, useState } from 'preact/hooks';
import { api, ApiError, type Invoice, type InvoiceItem, type InvoiceStatus, INVOICE_STATUS, fmtDate } from '../api';
import { Icon, Loading, Empty, toast, confirmAction, cap } from '../ui';
import { InvoiceDoc, invoiceTotals, money } from '../invoice-doc';

const go = (to: string) => (location.hash = to);

const MONTHS = ['იან', 'თებ', 'მარ', 'აპრ', 'მაი', 'ივნ', 'ივლ', 'აგვ', 'სექ', 'ოქტ', 'ნოე', 'დეკ'];
const shortDate = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return y && m && d ? `${d} ${MONTHS[m - 1]} ${y}` : '—';
};
const today = () => new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10); // Tbilisi is UTC+4
const isOverdue = (i: Invoice) => i.status === 'issued' && !!i.due_date && i.due_date < today();

function StatusPill({ inv }: { inv: Invoice }) {
  const overdue = isOverdue(inv);
  return <span class={`inv-pill ip-${overdue ? 'overdue' : inv.status}`}>{overdue ? 'ვადაგადაცილებული' : INVOICE_STATUS[inv.status]}</span>;
}

/* ---------------- List ---------------- */

export function InvoicesPage() {
  const [items, setItems] = useState<Invoice[] | null>(null);
  const [filter, setFilter] = useState<'all' | InvoiceStatus>('all');
  useEffect(() => { api<Invoice[]>('/admin/invoices').then(setItems).catch((e) => toast.err(e.message)); }, []);

  const tabs: ['all' | InvoiceStatus, string][] = [['all', 'ყველა'], ...(Object.entries(INVOICE_STATUS) as [InvoiceStatus, string][])];
  const shown = items?.filter((i) => filter === 'all' || i.status === filter) ?? [];
  const open = items?.filter((i) => i.status === 'issued') ?? [];
  const overdue = open.filter(isOverdue);
  const sum = (xs: Invoice[]) => xs.reduce((s, i) => s + (i.totals?.total ?? 0), 0);

  return (
    <section class="page">
      <header class="page-head">
        <div>
          <h1>ინვოისები</h1>
          <p class="muted">საბანკო გადარიცხვით გადახდის მოთხოვნა კლიენტისთვის. საგადასახადო ანგარიშ-ფაქტურა rs.ge-ზე გამოიწერება.</p>
        </div>
        <a class="btn primary" href="#/invoices/new"><Icon name="plus" size={16} />ახალი ინვოისი</a>
      </header>

      {items && items.length > 0 && (
        <div class="kpis inv-kpis">
          <div class="kpi"><span class="kpi-label">გადასახდელი (გაცემული)</span><span class="kpi-n num">{money(sum(open))}</span><span class="kpi-foot">{open.length} ინვოისი</span></div>
          <div class="kpi"><span class="kpi-label">ვადაგადაცილებული</span><span class={`kpi-n num ${overdue.length ? 'warn' : ''}`}>{money(sum(overdue))}</span><span class="kpi-foot">{overdue.length} ინვოისი</span></div>
          <div class="kpi"><span class="kpi-label">გადახდილი</span><span class="kpi-n num">{money(sum(items.filter((i) => i.status === 'paid')))}</span><span class="kpi-foot">სულ</span></div>
        </div>
      )}

      <div class="tabs" role="tablist">
        {tabs.map(([k, v]) => (
          <button key={k} type="button" role="tab" aria-selected={filter === k} class={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>
            {v}{items && <span class="count">{cap(items.filter((i) => k === 'all' || i.status === k).length)}</span>}
          </button>
        ))}
      </div>

      {!items ? <Loading /> : shown.length === 0 ? (
        <Empty title={items.length ? 'ამ ფილტრით ინვოისები არ არის' : 'ინვოისები ჯერ არ არის'}>
          {!items.length && <a class="btn ghost sm" href="#/invoices/new">პირველი ინვოისის შექმნა</a>}
        </Empty>
      ) : (
        <div class="card table-wrap">
          <table class="table inv-table">
            <thead>
              <tr><th>ნომერი</th><th>კლიენტი</th><th>გაცემა</th><th>ვადა</th><th class="r">თანხა</th><th>სტატუსი</th></tr>
            </thead>
            <tbody>
              {shown.map((i) => (
                <tr key={i.id} class="inv-row" onClick={() => go(`/invoices/${i.id}`)}>
                  <td><a class="strong num" href={`#/invoices/${i.id}`} onClick={(e) => e.stopPropagation()}>{i.number || 'პროექტი'}</a></td>
                  <td>
                    <div class="inv-client">{i.client_name}</div>
                    {i.client_tax_id && <div class="muted small num">ს/კ {i.client_tax_id}</div>}
                  </td>
                  <td class="nowrap">{shortDate(i.issue_date)}</td>
                  <td class={`nowrap ${isOverdue(i) ? 'warn' : ''}`}>{i.due_date ? shortDate(i.due_date) : '—'}</td>
                  <td class="r num nowrap"><b>{money(i.totals?.total ?? 0)}</b></td>
                  <td><StatusPill inv={i} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ---------------- Editor ---------------- */

type FieldErrors = Record<string, string>;
const UNITS = { ka: ['ც', 'მ²', 'გრძ. მ', 'სთ', 'მომსახურება'], en: ['pc', 'm²', 'm', 'h', 'service'] };

export function InvoiceEdit({ id, orderId }: { id: string; orderId?: string }) {
  const isNew = id === 'new';
  const [inv, setInv] = useState<Invoice | null>(null);
  const [saved, setSaved] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const url = isNew ? `/admin/invoices/blank${orderId ? `?order=${orderId}` : ''}` : `/admin/invoices/${id}`;
    api<Invoice>(url).then((x) => { setInv(x); setSaved(isNew ? '' : JSON.stringify(x)); setErrors({}); })
      .catch((e) => { toast.err(e.message); go('/invoices'); });
  }, [id, orderId]);

  const dirty = !!inv && (isNew || JSON.stringify(inv) !== saved);
  // Ask before leaving the page with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const on = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    addEventListener('beforeunload', on);
    return () => removeEventListener('beforeunload', on);
  }, [dirty]);

  const totals = useMemo(() => (inv ? invoiceTotals(inv.items, inv.vat) : null), [inv]);
  if (!inv || !totals) return <Loading />;

  const locked = inv.status === 'paid' || inv.status === 'cancelled';
  const set = (patch: Partial<Invoice>) => setInv({ ...inv, ...patch });
  const setItem = (i: number, patch: Partial<InvoiceItem>) => set({ items: inv.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) });
  const addItem = () => set({ items: [...inv.items, { description: '', qty: 1, unit: UNITS[inv.lang][0], price: '' }] });
  const removeItem = (i: number) => set({ items: inv.items.filter((_, j) => j !== i) });
  const err = (k: string) => errors[k];

  const payload = () => ({
    ...inv,
    items: inv.items
      .filter((it) => it.description.trim() || String(it.price).trim())
      .map((it) => ({ ...it, qty: parseFloat(String(it.qty).replace(',', '.')) || 0, price: parseFloat(String(it.price).replace(',', '.')) || 0 })),
  });

  /** Saves the invoice; returns the saved copy (or null if it didn't validate). */
  const save = async (quiet = false): Promise<Invoice | null> => {
    setBusy(true);
    try {
      const out = isNew
        ? await api<Invoice>('/admin/invoices', { body: payload() })
        : await api<Invoice>(`/admin/invoices/${id}`, { method: 'PUT', body: payload() });
      setErrors({});
      setInv(out);
      setSaved(JSON.stringify(out));
      if (!quiet) toast.ok('ინვოისი შენახულია');
      if (isNew) location.replace(`#/invoices/${out.id}`);
      return out;
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) setErrors(e.fields);
      toast.err(e instanceof Error ? e.message : 'შენახვა ვერ მოხერხდა');
      return null;
    } finally { setBusy(false); }
  };

  const setStatus = async (status: InvoiceStatus, question: string, action: string, done: string) => {
    if (!(await confirmAction(question, action, status === 'cancelled' ? 'danger' : 'primary'))) return;
    const base = dirty && !locked ? await save(true) : inv;
    if (!base?.id) return;
    setBusy(true);
    try {
      const out = await api<Invoice>(`/admin/invoices/${base.id}/status`, { body: { status } });
      setInv(out);
      setSaved(JSON.stringify(out));
      toast.ok(done);
    } catch (e: any) { toast.err(e.message); } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!(await confirmAction('წავშალოთ ინვოისის პროექტი?'))) return;
    try {
      await api(`/admin/invoices/${id}`, { method: 'DELETE' });
      toast.ok('პროექტი წაიშალა');
      go('/invoices');
    } catch (e: any) { toast.err(e.message); }
  };

  /** Prints only the document; the PDF gets the invoice number as its file name. */
  const print = () => {
    const title = document.title;
    document.title = inv.number || 'ინვოისი (პროექტი)';
    addEventListener('afterprint', () => (document.title = title), { once: true });
    window.print();
  };

  // Drafts print the current settings; issued invoices keep the details they were issued with.
  const missingBank = inv.status === 'draft' && !inv.seller.iban;

  return (
    <section class="page inv-page">
      <header class="page-head sticky no-print">
        <div>
          <a class="crumb" href="#/invoices"><Icon name="left" size={14} />ინვოისები</a>
          <div class="title-row">
            <h1 class="num">{inv.number || (isNew ? 'ახალი ინვოისი' : 'ინვოისის პროექტი')}</h1>
            {!isNew && <StatusPill inv={inv} />}
            {dirty && !isNew && <span class="muted small">შეუნახავი ცვლილებები</span>}
          </div>
        </div>
        <div class="head-actions">
          {!isNew && inv.status === 'draft' && <button class="icon-btn danger" type="button" onClick={remove} title="წაშლა" aria-label="წაშლა"><Icon name="trash" /></button>}
          {inv.status === 'issued' && <button class="btn danger-ghost sm" type="button" disabled={busy} onClick={() => setStatus('cancelled', `გავაუქმოთ ${inv.number}? ნომერი შენარჩუნდება გაუქმებული სტატუსით.`, 'გაუქმება', 'ინვოისი გაუქმდა')}>გაუქმება</button>}
          {inv.status === 'paid' && <button class="btn ghost sm" type="button" disabled={busy} onClick={() => setStatus('issued', 'დავაბრუნოთ ინვოისი „გაცემულ“ სტატუსში?', 'დაბრუნება', 'ინვოისი ისევ გაცემულია')}>გადაუხდელად მონიშვნა</button>}
          <button class="btn ghost" type="button" onClick={print}><Icon name="print" size={16} />PDF / ბეჭდვა</button>
          {!locked && <button class="btn ghost" type="button" disabled={busy || !dirty} onClick={() => save()}>{busy ? 'ინახება…' : 'შენახვა'}</button>}
          {inv.status === 'draft' && <button class="btn primary" type="button" disabled={busy} onClick={() => setStatus('issued', 'გავცეთ ინვოისი? მიიღებს მომდევნო ნომერს და გამყიდველის რეკვიზიტები დაფიქსირდება.', 'გაცემა', 'ინვოისი გაიცა')}><Icon name="check" size={16} />გაცემა</button>}
          {inv.status === 'issued' && <button class="btn primary" type="button" disabled={busy} onClick={() => setStatus('paid', `მოვნიშნოთ ${inv.number} გადახდილად? (${money(totals.total)})`, 'გადახდილია', 'ინვოისი მოინიშნა გადახდილად')}><Icon name="check" size={16} />გადახდილად მონიშვნა</button>}
        </div>
      </header>

      <div class="inv-grid">
        <form class="inv-form no-print" onSubmit={(e) => { e.preventDefault(); if (!locked) save(); }}>
          {locked && <p class="note">{inv.status === 'paid' ? 'გადახდილი ინვოისი არ რედაქტირდება.' : 'გაუქმებული ინვოისი არ რედაქტირდება.'}</p>}
          {missingBank && (
            <p class="note"><span>საბანკო რეკვიზიტები (IBAN) არ არის შევსებული. <a href="#/settings">პარამეტრები →</a></span></p>
          )}

          <fieldset class="card pad-lg inv-fs" disabled={locked}>
            <h2>დოკუმენტი</h2>
            <div class="seg-field">
              <span class="small muted">დოკუმენტის ენა</span>
              <div class="seg inv-lang">
                {(['ka', 'en'] as const).map((l) => (
                  <button key={l} type="button" class={`chip ${inv.lang === l ? 'on' : ''}`} aria-pressed={inv.lang === l}
                    onClick={() => set({ lang: l, items: inv.items.map((it) => ({ ...it, unit: UNITS[inv.lang].includes(it.unit) ? UNITS[l][UNITS[inv.lang].indexOf(it.unit)] : it.unit })) })}>
                    {l === 'ka' ? 'ქართული' : 'English'}
                  </button>
                ))}
              </div>
            </div>
            <div class="bi-row">
              <label class="fld"><span>გაცემის თარიღი</span><input type="date" value={inv.issue_date} aria-invalid={!!err('issue_date')} onInput={(e) => set({ issue_date: e.currentTarget.value })} />{err('issue_date') && <span class="err">{err('issue_date')}</span>}</label>
              <label class="fld"><span>გადახდის ვადა</span><input type="date" value={inv.due_date} aria-invalid={!!err('due_date')} onInput={(e) => set({ due_date: e.currentTarget.value })} />{err('due_date') && <span class="err">{err('due_date')}</span>}</label>
            </div>
            {inv.order_id && <p class="small muted">დაკავშირებულია შეკვეთასთან <a href="#/orders">#{inv.order_id}</a></p>}
          </fieldset>

          <fieldset class="card pad-lg inv-fs" disabled={locked}>
            <h2>მყიდველი</h2>
            <label class="fld"><span>დასახელება / სახელი, გვარი <b class="req">*</b></span>
              <input value={inv.client_name} placeholder="შპს „კომპანია“" aria-invalid={!!err('client_name')} onInput={(e) => set({ client_name: e.currentTarget.value })} />
              {err('client_name') && <span class="err">{err('client_name')}</span>}
            </label>
            <div class="bi-row">
              <label class="fld"><span>საიდენტიფიკაციო / პირადი №</span><input class="num" value={inv.client_tax_id} inputMode="numeric" onInput={(e) => set({ client_tax_id: e.currentTarget.value })} /></label>
              <label class="fld"><span>ტელეფონი</span><input type="tel" value={inv.client_phone} onInput={(e) => set({ client_phone: e.currentTarget.value })} /></label>
            </div>
            <label class="fld"><span>მისამართი</span><input value={inv.client_address} onInput={(e) => set({ client_address: e.currentTarget.value })} /></label>
            <label class="fld"><span>ელ-ფოსტა</span>
              <input type="email" value={inv.client_email} aria-invalid={!!err('client_email')} onInput={(e) => set({ client_email: e.currentTarget.value })} />
              {err('client_email') && <span class="err">{err('client_email')}</span>}
            </label>
          </fieldset>

          <fieldset class="card pad-lg inv-fs" disabled={locked}>
            <h2>პოზიციები</h2>
            <div class="inv-lines">
              {inv.items.map((it, i) => (
                <div class="inv-line" key={i}>
                  <span class="inv-line-n num">{i + 1}</span>
                  <label class="fld inv-l-desc"><span class="sr">აღწერა</span>
                    <input value={it.description} placeholder="მაგ. კედლის პანელი „ტალღა“ · 120 × 80 სმ" aria-invalid={!!err(`items.${i}.description`)} onInput={(e) => setItem(i, { description: e.currentTarget.value })} />
                  </label>
                  <label class="fld"><span>რაოდ.</span><input class="num" inputMode="decimal" value={String(it.qty)} aria-invalid={!!err(`items.${i}.qty`)} onInput={(e) => setItem(i, { qty: e.currentTarget.value })} /></label>
                  <label class="fld"><span>ერთ.</span>
                    <input value={it.unit} list={`units-${inv.lang}`} onInput={(e) => setItem(i, { unit: e.currentTarget.value })} />
                  </label>
                  <label class="fld"><span>ფასი, ₾</span><input class="num" inputMode="decimal" value={String(it.price)} placeholder="0.00" aria-invalid={!!err(`items.${i}.price`)} onInput={(e) => setItem(i, { price: e.currentTarget.value })} /></label>
                  <button class="icon-btn danger inv-l-del" type="button" disabled={inv.items.length < 2} onClick={() => removeItem(i)} aria-label={`პოზიცია ${i + 1}-ის წაშლა`} title="წაშლა"><Icon name="trash" size={16} /></button>
                </div>
              ))}
              <datalist id={`units-${inv.lang}`}>{UNITS[inv.lang].map((u) => <option key={u} value={u} />)}</datalist>
            </div>
            {err('items') && <p class="err">{err('items')}</p>}
            <div class="inv-lines-foot">
              <button class="btn ghost sm" type="button" onClick={addItem}><Icon name="plus" size={15} />პოზიციის დამატება</button>
              <span class="inv-lines-total">სულ <b class="num">{money(totals.total)}</b></span>
            </div>
            <label class="switch">
              <input type="checkbox" checked={inv.vat} onChange={(e) => set({ vat: e.currentTarget.checked })} />
              <span class="track" aria-hidden="true" />
              <span>ფასები მოიცავს დღგ-ს (18%){inv.vat && <span class="muted small num"> · დღგ {money(totals.vat)}</span>}</span>
            </label>
            <p class="small muted">ჩართეთ მხოლოდ თუ კომპანია დღგ-ის გადამხდელია.</p>
          </fieldset>

          <fieldset class="card pad-lg inv-fs" disabled={locked}>
            <h2>შენიშვნა</h2>
            <label class="fld"><span class="sr">შენიშვნა</span>
              <textarea rows={3} value={inv.notes} placeholder="მაგ. მონტაჟი შედის ფასში. მიწოდება 14–21 სამუშაო დღე." onInput={(e) => set({ notes: e.currentTarget.value })} />
            </label>
          </fieldset>

          {!isNew && inv.issued_at && <p class="small muted">გაცემულია: {fmtDate(inv.issued_at)}{inv.paid_at && ` · გადახდილია: ${fmtDate(inv.paid_at)}`}</p>}
        </form>

        <div class="inv-preview">
          <p class="inv-preview-label no-print">გადახედვა · A4</p>
          <InvoiceDoc inv={inv} />
        </div>
      </div>
    </section>
  );
}
