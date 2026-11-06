import { useEffect, useState } from 'preact/hooks';
import { api, type Product, type ProductMetric, type Metrics, fmtPrice, fmtNum, typeLabel, SITE_URL, FEATURED_MAX } from '../api';
import { Icon, Loading, Empty, toast, confirmAction } from '../ui';
import { Preview } from './Preview';
import { CollectionCovers } from '../collection';

export function ProductsPage() {
  const [items, setItems] = useState<Product[] | null>(null);
  const [stats, setStats] = useState<Record<number, ProductMetric> | null>(null);
  const load = () => api<Product[]>('/admin/products').then(setItems).catch((e) => toast.err(e.message));
  useEffect(() => {
    load();
    // Views and orders over the last 30 days, shown next to each product.
    api<Metrics>('/admin/metrics?days=30').then((m) => setStats(Object.fromEntries(m.products.map((x) => [x.id, x])))).catch(() => {});
  }, []);

  const remove = async (p: Product) => {
    if (!(await confirmAction(`წავშალოთ „${p.name.ka}“? ეს ქმედება შეუქცევადია: წაიშლება ზომები და ფოტოებიც.`))) return;
    try {
      await api(`/admin/products/${p.id}`, { method: 'DELETE' });
      toast.ok('პროდუქტი წაიშალა');
      load();
    } catch (e: any) { toast.err(e.message); }
  };

  const featuredCount = items?.filter((p) => p.featured).length ?? 0;
  const featuredFull = featuredCount >= FEATURED_MAX;

  const toggle = async (p: Product, field: 'published' | 'featured' | 'in_stock') => {
    try {
      await api(`/admin/products/${p.id}`, { method: 'PUT', body: { ...p, [field]: !p[field] } });
      load();
    } catch (e: any) { toast.err(e.message); }
  };

  return (
    <section class="page">
      <header class="page-head">
        <div>
          <h1>პროდუქცია</h1>
          <p class="muted">დაამატეთ, შეცვალეთ ან წაშალეთ კედლის პანელები.</p>
          {items && items.length > 0 && (
            <p class={`small featured-count ${featuredFull ? 'full' : ''}`}>
              <Icon name="star" size={13} />მთავარ გვერდზე: <b class="num">{featuredCount} / {FEATURED_MAX}</b>
              {featuredFull && ' · ახლის დასამატებლად ჯერ მოხსენით რომელიმე'}
            </p>
          )}
        </div>
        <a class="btn primary" href="#/products/new"><Icon name="plus" />ახალი პროდუქტი</a>
      </header>

      {!items ? <Loading /> : items.length === 0 ? (
        <Empty title="პროდუქცია ჯერ არ დამატებულა">
          <a class="btn primary" href="#/products/new"><Icon name="plus" />პირველი პროდუქტის დამატება</a>
        </Empty>
      ) : (
        <div class="card table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th></th><th>დასახელება</th><th>ტიპი</th><th>ზომები</th><th>ფასი</th><th title="ნახვები და შეკვეთები ბოლო 30 დღეში">30 დღე</th><th>სტატუსი</th><th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => {
                const prices = p.sizes.map((s) => s.price);
                return (
                  <tr key={p.id}>
                    <td class="thumb-cell">
                      {p.images[0] ? <img src={p.images[0].url} alt="" /> : <Preview pattern={p.pattern} small />}
                    </td>
                    <td>
                      <a class="strong" href={`#/products/${p.id}`}>{p.name.ka}</a>
                      <div class="muted small">{p.name.en} · /{p.slug}</div>
                    </td>
                    <td>{typeLabel(p)}</td>
                    <td class="num">{p.sizes.length}</td>
                    <td class="num nowrap">
                      {prices.length ? `${fmtPrice(Math.min(...prices))}${prices.length > 1 ? ` – ${fmtPrice(Math.max(...prices))}` : ''}` : 'ფასი არ არის'}
                      {p.sale?.active && <div class="small sale-text">ფასდაკლებით {p.sizes.filter((x) => (x.sale_percent ?? 0) > 0).length}/{p.sizes.length} ზომაზე</div>}
                    </td>
                    <td class="num nowrap small">
                      {!stats ? <span class="muted">…</span> : stats[p.id!] ? (
                        <div class="pstat" title="ბოლო 30 დღე">
                          <span><b>{fmtNum(stats[p.id!].views)}</b> ნახვა</span>
                          <span><b>{fmtNum(stats[p.id!].orders)}</b> შეკვეთა</span>
                        </div>
                      ) : <span class="muted">—</span>}
                    </td>
                    <td>
                      <div class="chips">
                        <button type="button" class={`chip ${p.published ? 'on' : ''}`} onClick={() => toggle(p, 'published')} title="გამოქვეყნება / დამალვა">
                          {p.published ? 'გამოქვეყნებული' : 'დამალული'}
                        </button>
                        {(p.sale?.percent ?? 0) > 0 && (
                          <a class={`chip sale-chip ${p.sale.active ? '' : 'expired'}`} href={`#/products/${p.id}`} title={p.sale.active ? (p.sale.ends_at ? `მოქმედებს ${p.sale.ends_at}-მდე` : 'ფასდაკლება მოქმედებს') : 'ფასდაკლების ვადა ამოიწურა'}>
                            −{p.sale.min_percent && p.sale.min_percent !== p.sale.percent ? `${p.sale.min_percent}–` : ''}{p.sale.percent}%{!p.sale.active && ' (ვადაგასული)'}
                          </a>
                        )}
                        <button type="button" class={`chip ${p.in_stock !== false ? 'on' : 'off-stock'}`} onClick={() => toggle(p, 'in_stock')} title="მარაგის სტატუსის შეცვლა">
                          {p.in_stock !== false ? 'მარაგშია' : 'არ არის მარაგში'}
                        </button>
                        <button type="button" class={`chip ${p.featured ? 'on' : ''}`} onClick={() => toggle(p, 'featured')}
                          disabled={!p.featured && featuredFull}
                          title={!p.featured && featuredFull ? `მთავარ გვერდზე უკვე ${FEATURED_MAX} პროდუქტია` : 'მთავარ გვერდზე ჩვენება'}>
                          <Icon name="star" size={13} />მთავარზე
                        </button>
                      </div>
                    </td>
                    <td class="actions">
                      <a class="icon-btn" href={`${SITE_URL}/products/${p.slug}/`} target="_blank" rel="noopener" title="საიტზე ნახვა" aria-label="საიტზე ნახვა"><Icon name="eye" /></a>
                      <a class="icon-btn" href={`#/products/${p.id}`} title="რედაქტირება" aria-label="რედაქტირება"><Icon name="edit" /></a>
                      <button class="icon-btn danger" type="button" onClick={() => remove(p)} title="წაშლა" aria-label="წაშლა"><Icon name="trash" /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <CollectionCovers />
    </section>
  );
}
