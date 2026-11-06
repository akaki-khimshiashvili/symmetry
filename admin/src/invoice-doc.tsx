import type { Invoice, InvoiceItem } from './api';

/**
 * The invoice document itself: one A4 page, black on white in every theme, so it prints and
 * reads as a document. The editor renders it live; "Save as PDF" prints just this sheet.
 */

const L = {
  ka: {
    title: 'ინვოისი', draft: 'პროექტი', issued: 'გაცემის თარიღი', due: 'გადახდის ვადა', order: 'შეკვეთა',
    amountDue: 'გადასახდელი', from: 'გამყიდველი', to: 'მყიდველი', taxId: 'ს/კ',
    n: '№', item: 'დასახელება', qty: 'რაოდ.', unit: 'ერთ.', price: 'ფასი', sum: 'თანხა',
    net: 'ჯამი დღგ-ს გარეშე', vat: 'დღგ 18%', total: 'სულ გადასახდელი', vatIncl: 'ფასები მოიცავს დღგ-ს',
    bankTitle: 'გადახდა საბანკო გადარიცხვით', beneficiary: 'მიმღები', bank: 'ბანკი', iban: 'ანგარიში (IBAN)',
    purpose: 'დანიშნულება', purposeText: (n: string) => `ინვოისი ${n}`, noBank: 'საბანკო რეკვიზიტები შეავსეთ პარამეტრებში.',
    notes: 'შენიშვნა', thanks: 'გმადლობთ თანამშრომლობისთვის.',
    stamp: { paid: 'გადახდილია', cancelled: 'გაუქმებულია' },
    months: ['იანვარი', 'თებერვალი', 'მარტი', 'აპრილი', 'მაისი', 'ივნისი', 'ივლისი', 'აგვისტო', 'სექტემბერი', 'ოქტომბერი', 'ნოემბერი', 'დეკემბერი'],
  },
  en: {
    title: 'Invoice', draft: 'Draft', issued: 'Issue date', due: 'Due date', order: 'Order',
    amountDue: 'Amount due', from: 'From', to: 'Bill to', taxId: 'ID',
    n: '#', item: 'Description', qty: 'Qty', unit: 'Unit', price: 'Price', sum: 'Amount',
    net: 'Total excl. VAT', vat: 'VAT 18%', total: 'Total due', vatIncl: 'Prices include VAT',
    bankTitle: 'Payment by bank transfer', beneficiary: 'Beneficiary', bank: 'Bank', iban: 'Account (IBAN)',
    purpose: 'Reference', purposeText: (n: string) => `Invoice ${n}`, noBank: 'Add bank details in Settings.',
    notes: 'Notes', thanks: 'Thank you for your business.',
    stamp: { paid: 'Paid', cancelled: 'Cancelled' },
    months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  },
};

const num = (v: number | string) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
/** Totals in tetri, the same way the API works them out. */
export function invoiceTotals(items: InvoiceItem[], vat: boolean) {
  const total = items.reduce((s, it) => s + Math.round(num(it.qty) * num(it.price) * 100), 0);
  const v = vat ? Math.round((total * 18) / 118) : 0;
  return { total: total / 100, vat: v / 100, net: (total - v) / 100 };
}
export const money = (n: number) =>
  `₾ ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/,/g, ' ')}`;
const qtyText = (v: number | string) => num(v).toLocaleString('en-US', { maximumFractionDigits: 2 });
/** "2026-11-06" → "6 ნოემბერი 2026" / "6 November 2026". */
const longDate = (s: string, months: string[]) => {
  const [y, m, d] = s.split('-').map(Number);
  return y && m && d ? `${d} ${months[m - 1]} ${y}` : '';
};
/** IBANs read in groups of four. */
const ibanText = (s: string) => s.replace(/\s+/g, '').toUpperCase().replace(/(.{4})(?=.)/g, '$1 ');

/** The round wave mark from the logo (same drawing as the site's wordmark). */
const STRIPES = (() => {
  const out: { pts: string; a: boolean }[] = [];
  for (let k = -9; k <= 9; k++) {
    const pts: string[] = [];
    for (let x = -14; x <= 62; x += 4) pts.push(`${x},${(24 + k * 3.1 + 3.4 * Math.sin(x * 0.12 + k * 0.32)).toFixed(2)}`);
    out.push({ pts: pts.join(' '), a: k % 2 !== 0 });
  }
  return out;
})();
function Wordmark() {
  return (
    <div class="inv-wm">
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <defs><clipPath id="inv-wm-clip"><circle cx="24" cy="24" r="22" /></clipPath></defs>
        <circle cx="24" cy="24" r="22" fill="#5a3d26" />
        <g clip-path="url(#inv-wm-clip)" transform="rotate(-38 24 24)" fill="none" stroke-width="1.9" stroke-linecap="round">
          {STRIPES.map((s, i) => <polyline key={i} points={s.pts} stroke={s.a ? '#d9b98c' : '#a8845c'} />)}
        </g>
      </svg>
      <div><b>SYMMETRY</b><span>3D WALL ART</span></div>
    </div>
  );
}

export type DocData = Pick<Invoice, 'number' | 'status' | 'lang' | 'order_id' | 'issue_date' | 'due_date' | 'client_name' | 'client_tax_id'
  | 'client_address' | 'client_phone' | 'client_email' | 'items' | 'vat' | 'notes' | 'seller'>;

export function InvoiceDoc({ inv }: { inv: DocData }) {
  const t = L[inv.lang] ?? L.ka;
  const s = inv.seller;
  const items = inv.items.filter((it) => it.description.trim() || num(it.price));
  const tot = invoiceTotals(items, inv.vat);
  const address = inv.lang === 'en' ? s.address_en || s.address_ka : s.address_ka;
  const stamp = inv.status === 'paid' || inv.status === 'cancelled' ? t.stamp[inv.status] : '';
  const hasBank = !!(s.iban || s.bank_name);

  return (
    <article class={`inv-paper is-${inv.status}`} lang={inv.lang}>
      {inv.status === 'draft' && <div class="inv-watermark" aria-hidden="true">{t.draft}</div>}

      <header class="inv-head">
        <Wordmark />
        <div class="inv-title">
          <h1>{t.title}</h1>
          <p class="inv-no num">{inv.number || <span class="inv-draft-no">{t.draft}</span>}</p>
        </div>
      </header>

      <dl class="inv-meta">
        <div><dt>{t.issued}</dt><dd>{longDate(inv.issue_date, t.months)}</dd></div>
        <div><dt>{t.due}</dt><dd>{inv.due_date ? longDate(inv.due_date, t.months) : '—'}</dd></div>
        {inv.order_id ? <div><dt>{t.order}</dt><dd class="num">#{inv.order_id}</dd></div> : <div />}
        <div class="inv-due"><dt>{t.amountDue}</dt><dd class="num">{money(tot.total)}</dd></div>
      </dl>

      <div class="inv-parties">
        <section>
          <h2>{t.from}</h2>
          <p class="inv-party-name">{s.legal_name}</p>
          {s.tax_id && <p>{t.taxId} <span class="num">{s.tax_id}</span></p>}
          {address && <p>{address}</p>}
          {(s.phone || s.email) && <p class="num">{[s.phone, s.email].filter(Boolean).join(' · ')}</p>}
        </section>
        <section>
          <h2>{t.to}</h2>
          <p class="inv-party-name">{inv.client_name || '—'}</p>
          {inv.client_tax_id && <p>{t.taxId} <span class="num">{inv.client_tax_id}</span></p>}
          {inv.client_address && <p>{inv.client_address}</p>}
          {(inv.client_phone || inv.client_email) && <p class="num">{[inv.client_phone, inv.client_email].filter(Boolean).join(' · ')}</p>}
        </section>
      </div>

      <table class="inv-items">
        <thead>
          <tr>
            <th class="c-n">{t.n}</th><th>{t.item}</th><th class="r">{t.qty}</th><th>{t.unit}</th><th class="r">{t.price}</th><th class="r">{t.sum}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={i}>
              <td class="c-n num">{i + 1}</td>
              <td class="c-desc">{it.description || '—'}</td>
              <td class="r num">{qtyText(it.qty)}</td>
              <td>{it.unit}</td>
              <td class="r num">{money(num(it.price))}</td>
              <td class="r num">{money(Math.round(num(it.qty) * num(it.price) * 100) / 100)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div class="inv-sumrow">
      {stamp ? <div class={`inv-stamp st-${inv.status}`}>{stamp}</div> : <span />}
      <div class="inv-sum">
        <dl>
          {inv.vat && <div><dt>{t.net}</dt><dd class="num">{money(tot.net)}</dd></div>}
          {inv.vat && <div><dt>{t.vat}</dt><dd class="num">{money(tot.vat)}</dd></div>}
          <div class="inv-total"><dt>{t.total}</dt><dd class="num">{money(tot.total)}</dd></div>
        </dl>
        {inv.vat && <p class="inv-vat-note">{t.vatIncl}</p>}
      </div>
      </div>

      <section class="inv-bank">
        <h2>{t.bankTitle}</h2>
        {hasBank ? (
          <dl>
            <div><dt>{t.beneficiary}</dt><dd>{s.legal_name}{s.tax_id && <span class="num"> · {t.taxId} {s.tax_id}</span>}</dd></div>
            {s.bank_name && <div><dt>{t.bank}</dt><dd>{s.bank_name}{s.bank_swift && <span class="num"> · SWIFT {s.bank_swift.toUpperCase()}</span>}</dd></div>}
            {s.iban && <div class="inv-iban"><dt>{t.iban}</dt><dd class="num">{ibanText(s.iban)}</dd></div>}
            <div><dt>{t.purpose}</dt><dd class="num">{inv.number ? t.purposeText(inv.number) : '—'}</dd></div>
          </dl>
        ) : <p class="inv-missing">{t.noBank}</p>}
      </section>

      {inv.notes.trim() && (
        <section class="inv-notes">
          <h2>{t.notes}</h2>
          <p>{inv.notes}</p>
        </section>
      )}

      <footer class="inv-foot">
        <span>{t.thanks}</span>
        <span class="num">{inv.number || t.draft}</span>
      </footer>
    </article>
  );
}
