import { useEffect, useState } from 'preact/hooks';
import { api, type Product, fmtPrice, ORIENTATIONS, SITE_URL } from '../api';
import { Icon, Loading, Empty, toast, confirmAction } from '../ui';
import { Preview } from './Preview';

export function ProductsPage() {
  const [items, setItems] = useState<Product[] | null>(null);
  const load = () => api<Product[]>('/admin/products').then(setItems).catch((e) => toast.err(e.message));
  useEffect(() => { load(); }, []);

  const remove = async (p: Product) => {
    if (!(await confirmAction(`წავშალოთ „${p.name.ka}“? ეს ქმედება შეუქცევადია: წაიშლება ზომები და ფოტოებიც.`))) return;
    try {
      await api(`/admin/products/${p.id}`, { method: 'DELETE' });
      toast.ok('პროდუქტი წაიშალა');
      load();
    } catch (e: any) { toast.err(e.message); }
  };

  const toggle = async (p: Product, field: 'published' | 'featured') => {
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
                <th></th><th>დასახელება</th><th>ტიპი</th><th>ზომები</th><th>ფასი</th><th>სტატუსი</th><th></th>
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
                    <td>{ORIENTATIONS[p.orientation] ?? ''}</td>
                    <td class="num">{p.sizes.length}</td>
                    <td class="num nowrap">{prices.length ? `${fmtPrice(Math.min(...prices))}${prices.length > 1 ? ` – ${fmtPrice(Math.max(...prices))}` : ''}` : 'ფასი არ არის'}</td>
                    <td>
                      <div class="chips">
                        <button type="button" class={`chip ${p.published ? 'on' : ''}`} onClick={() => toggle(p, 'published')} title="გამოქვეყნება / დამალვა">
                          {p.published ? 'გამოქვეყნებული' : 'დამალული'}
                        </button>
                        <button type="button" class={`chip ${p.featured ? 'on' : ''}`} onClick={() => toggle(p, 'featured')} title="მთავარ გვერდზე ჩვენება">
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
    </section>
  );
}
