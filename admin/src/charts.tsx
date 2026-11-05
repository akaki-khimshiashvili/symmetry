/**
 * Small, dependency-free charts for the metrics page. One hue (the brand walnut) everywhere:
 * every chart shows a single measure, so colour never has to tell series apart.
 */
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { fmtDay, fmtNum } from './api';

/** Percentage change, or null when there is nothing to compare with. */
export const change = (cur: number, prev: number) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null);

export function Delta({ cur, prev, invert = false }: { cur: number; prev: number; invert?: boolean }) {
  const pct = change(cur, prev);
  // Nothing to compare with (e.g. counting only just started): say nothing rather than repeat a note on every card.
  if (pct === null) return null;
  if (pct === 0) return <span class="delta muted">უცვლელი</span>;
  const good = invert ? pct < 0 : pct > 0;
  return (
    <span class={`delta ${good ? 'up' : 'down'}`} title="წინა იმავე ხანგრძლივობის პერიოდთან შედარებით">
      <span aria-hidden="true">{pct > 0 ? '▲' : '▼'}</span> {Math.abs(pct)}%
      <span class="sr"> {pct > 0 ? 'ზრდა' : 'კლება'}</span>
    </span>
  );
}

/** One headline number with its comparison to the previous period. */
/** Stats are read-only: a card never links anywhere. */
export function Kpi({ label, value, cur, prev, hint, invert }: {
  label: string; value: ComponentChildren; cur?: number; prev?: number; hint?: string; invert?: boolean;
}) {
  const body = (
    <>
      <span class="kpi-label">{label}</span>
      <span class="kpi-n num">{value}</span>
      <span class="kpi-foot">
        {cur !== undefined && prev !== undefined && <Delta cur={cur} prev={prev} invert={invert} />}
        {hint && <span class="muted">{hint}</span>}
      </span>
    </>
  );
  return <div class="kpi">{body}</div>;
}

/** Nice round top for an axis: 0–max rounded up to 1/2/5 × 10ⁿ. */
const niceMax = (v: number) => {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 5, 10].map((m) => m * p).find((m) => m >= v)!;
};

/**
 * Column chart over time: one column per day (or month). Hover or focus a column for its exact value.
 * `points` holds the raw series; `pick` reads the plotted value; `fmt` formats it.
 */
export function Columns<T extends { date: string }>({ title, points, pick, fmt = fmtNum, total }: {
  title: string; points: T[]; pick: (p: T) => number; fmt?: (n: number) => string; total?: ComponentChildren;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const values = points.map(pick);
  const top = niceMax(Math.max(...values, 0));
  const h = hover !== null ? points[hover] : null;
  const labelAt = new Set([0, Math.floor((points.length - 1) / 2), points.length - 1]);
  return (
    <figure class="card chart">
      <figcaption class="chart-head">
        <span class="chart-title">{title}</span>
        <span class="chart-readout num" aria-live="polite">
          {h ? <><b>{fmt(pick(h))}</b> <span class="muted">· {fmtDay(h.date)}</span></> : total}
        </span>
      </figcaption>
      <div class="cols-wrap">
        <div class="cols-axis num" aria-hidden="true"><span>{fmt(top)}</span><span>{fmt(top / 2)}</span><span>0</span></div>
        <div class="cols" style={{ '--n': points.length } as any} onMouseLeave={() => setHover(null)} role="list" aria-label={title}>
          {points.map((p, i) => {
            const v = values[i];
            return (
              <div
                key={p.date} role="listitem" tabIndex={0} class={`col ${hover === i ? 'on' : ''}`}
                aria-label={`${fmtDay(p.date)}: ${fmt(v)}`}
                onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
              >
                <span class="col-bar" style={{ height: v > 0 ? `max(3px, ${(v / top) * 100}%)` : '0' }} />
              </div>
            );
          })}
        </div>
        <div class="cols-x num" aria-hidden="true">
          {points.filter((_, i) => labelAt.has(i)).map((p) => <span key={p.date}>{fmtDay(p.date)}</span>)}
        </div>
      </div>
    </figure>
  );
}

export type BarRow = { key: string; label: ComponentChildren; n: number; note?: ComponentChildren };

/** Labelled horizontal bars for "how is it split" questions. The number is always written out. */
export function BarList({ title, rows, fmt = fmtNum, empty = 'მონაცემი ჯერ არ არის', action }: {
  title: string; rows: BarRow[]; fmt?: (n: number) => string; empty?: string; action?: ComponentChildren;
}) {
  const max = Math.max(...rows.map((r) => r.n), 0);
  const sum = rows.reduce((s, r) => s + r.n, 0);
  return (
    <section class="card blist">
      <header class="blist-head"><h3>{title}</h3>{action}</header>
      {rows.length === 0 || max === 0 ? <p class="muted small blist-empty">{empty}</p> : (
        <ul>
          {rows.map((r) => (
            <li key={r.key}>
              <div class="blist-row">
                <span class="blist-label">{r.label}</span>
                <span class="blist-n num">{fmt(r.n)}{sum > 0 && <span class="muted"> · {Math.round((r.n / sum) * 100)}%</span>}</span>
              </div>
              <span class="blist-track" aria-hidden="true"><span class="blist-bar" style={{ width: `${(r.n / max) * 100}%` }} /></span>
              {r.note && <div class="muted small">{r.note}</div>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Steps from visit to sale; each step shows what share of the step before it went on. */
export function Funnel({ steps }: { steps: { label: string; n: number; hint: string }[] }) {
  const first = steps[0]?.n || 0;
  return (
    <section class="card funnel">
      <header class="blist-head"><h3>გზა ვიზიტიდან გაყიდვამდე</h3></header>
      <ol>
        {steps.map((s, i) => {
          const prev = i > 0 ? steps[i - 1].n : 0;
          return (
            <li key={s.label}>
              <div class="blist-row">
                <span class="blist-label">{s.label}<span class="muted small"> · {s.hint}</span></span>
                <span class="blist-n num">
                  {fmtNum(s.n)}
                  {i > 0 && <span class="muted"> · {prev > 0 ? `${Math.round((s.n / prev) * 100)}%` : '—'}</span>}
                </span>
              </div>
              <span class="blist-track" aria-hidden="true"><span class="blist-bar" style={{ width: first > 0 ? `${Math.min(100, (s.n / first) * 100)}%` : '0' }} /></span>
            </li>
          );
        })}
      </ol>
      <p class="muted small funnel-note">პროცენტი = რამდენი გადავიდა წინა ნაბიჯიდან.</p>
    </section>
  );
}
