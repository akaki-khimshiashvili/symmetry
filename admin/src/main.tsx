import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import '@fontsource-variable/noto-sans-georgian';
import '@fontsource-variable/noto-serif-georgian';
import '@fontsource-variable/manrope';
import '@fontsource/montserrat/latin-800.css';
import './styles.css';
import { api, auth, setUnauthorizedHandler, SITE_URL, ApiError } from './api';
import { Icon, Toaster, ConfirmHost, toast } from './ui';
import { Dashboard } from './pages/Dashboard';
import { ProductsPage } from './pages/Products';
import { ProductEdit } from './pages/ProductEdit';
import { OrdersPage } from './pages/Orders';
import { MessagesPage } from './pages/Messages';
import { SettingsPage } from './pages/Settings';

const useHash = () => {
  const [hash, setHash] = useState(location.hash.slice(1) || '/');
  useEffect(() => {
    const on = () => setHash(location.hash.slice(1) || '/');
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return hash;
};
export const go = (to: string) => (location.hash = to);

function Login({ onDone }: { onDone: () => void }) {
  const [user, setUser] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: Event) => {
    e.preventDefault();
    if (!user.trim()) return setErr('შეიყვანეთ მომხმარებლის სახელი');
    if (!pw) return setErr('შეიყვანეთ პაროლი');
    setBusy(true);
    setErr('');
    try {
      const { token } = await api<{ token: string }>('/admin/login', { body: { username: user.trim(), password: pw } });
      auth.set(token);
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'შესვლა ვერ მოხერხდა');
    } finally {
      setBusy(false);
    }
  };
  return (
    <main class="login">
      <form class="login-card" onSubmit={submit}>
        <div class="brand"><Icon name="panel" size={22} /><span>Symmetry</span></div>
        <h1>ადმინისტრირება</h1>
        <p class="muted">შედით პროდუქციისა და შეკვეთების სამართავად.</p>
        <label class="fld">
          <span>მომხმარებელი</span>
          <input type="text" autoFocus autocomplete="username" autocapitalize="none" spellcheck={false} value={user} onInput={(e) => setUser(e.currentTarget.value)} aria-invalid={!!err} />
        </label>
        <label class="fld">
          <span>პაროლი</span>
          <input type="password" autocomplete="current-password" value={pw} onInput={(e) => setPw(e.currentTarget.value)} aria-invalid={!!err} />
        </label>
        {err && <p class="err">{err}</p>}
        <button class="btn primary wide" disabled={busy}>{busy ? 'მოწმდება…' : 'შესვლა'}</button>
      </form>
    </main>
  );
}

const NAV = [
  { to: '/', label: 'მიმოხილვა', icon: 'grid' },
  { to: '/products', label: 'პროდუქცია', icon: 'panel' },
  { to: '/orders', label: 'შეკვეთები', icon: 'bag' },
  { to: '/messages', label: 'შეტყობინებები', icon: 'mail' },
  { to: '/settings', label: 'პარამეტრები', icon: 'gear' },
];

function Shell() {
  const hash = useHash();
  const [counts, setCounts] = useState<{ orders_new: number; messages_new: number } | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const refreshCounts = () => api<{ orders_new: number; messages_new: number }>('/admin/stats').then(setCounts).catch(() => {});
  useEffect(() => { refreshCounts(); setNavOpen(false); }, [hash]);

  const logout = async () => {
    await api('/admin/logout', { method: 'POST' }).catch(() => {});
    auth.clear();
    location.reload();
  };

  let page;
  const editMatch = hash.match(/^\/products\/(new|\d+)$/);
  if (editMatch) page = <ProductEdit id={editMatch[1]} />;
  else if (hash.startsWith('/products')) page = <ProductsPage />;
  else if (hash.startsWith('/orders')) page = <OrdersPage onChange={refreshCounts} />;
  else if (hash.startsWith('/messages')) page = <MessagesPage onChange={refreshCounts} />;
  else if (hash.startsWith('/settings')) page = <SettingsPage />;
  else page = <Dashboard />;

  const active = (to: string) => (to === '/' ? hash === '/' : hash.startsWith(to));
  const badge = (to: string) => (to === '/orders' ? counts?.orders_new : to === '/messages' ? counts?.messages_new : 0);

  return (
    <div class={`shell ${navOpen ? 'nav-open' : ''}`}>
      <aside class="side">
        <div class="brand"><Icon name="panel" size={22} /><span>Symmetry</span></div>
        <nav>
          {NAV.map((n) => (
            <a key={n.to} href={`#${n.to}`} class={active(n.to) ? 'on' : ''} aria-current={active(n.to) ? 'page' : undefined}>
              <Icon name={n.icon} />
              <span>{n.label}</span>
              {!!badge(n.to) && <b class="badge">{badge(n.to)}</b>}
            </a>
          ))}
        </nav>
        <div class="side-foot">
          <a href={SITE_URL} target="_blank" rel="noopener"><Icon name="ext" />საიტის ნახვა</a>
          <button type="button" onClick={logout}><Icon name="out" />გასვლა</button>
        </div>
      </aside>
      <button class="nav-toggle" type="button" aria-label="მენიუ" onClick={() => setNavOpen(!navOpen)}><Icon name="menu" size={22} /></button>
      <main class="content">{page}</main>
    </div>
  );
}

function App() {
  const [authed, setAuthed] = useState<boolean | null>(auth.get() ? null : false);
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setAuthed(false);
      toast.err('სესია ამოიწურა, გთხოვთ თავიდან შეხვიდეთ');
    });
    if (auth.get()) api('/admin/me').then(() => setAuthed(true)).catch(() => setAuthed(false));
  }, []);
  return (
    <>
      {authed === null ? <div class="boot" /> : authed ? <Shell /> : <Login onDone={() => setAuthed(true)} />}
      <Toaster />
      <ConfirmHost />
    </>
  );
}

render(<App />, document.getElementById('app')!);
