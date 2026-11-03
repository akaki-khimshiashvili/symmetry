# Symmetry — Parametric Wall Art & 3D Decor

| Part | Stack | Folder | Dev URL |
|---|---|---|---|
| Public site (KA default, EN at `/en/`) | Astro (static) | `frontend/` | http://localhost:4321 |
| Admin panel (Georgian only) | Vite + Preact + TS | `admin/` | http://localhost:5173 |
| API | PHP 8.1+ with SQLite (PDO) | `backend/` | http://localhost:8000/api |

## Run locally

Requires PHP 8.1+ with the `pdo_sqlite` and `fileinfo` extensions, and Node 20+.

```bash
# 1. API (creates and seeds backend/data/symmetry.sqlite on the first request)
php -S localhost:8000 -t backend/public backend/public/index.php

# 2. Public site
cd frontend && npm install && npm run dev

# 3. Admin
cd admin && npm install && npm run dev
```

Default admin password: **`symmetry-admin`**. Change it before going live (see Configuration).

The site builds even when the API is offline. In that case it falls back to `backend/data/seed.json`.

## How content gets to the site

The public site is static, which keeps it fast and SEO-friendly. Products, prices and settings are read **at build time** from the API.

- After editing in the admin, click **„საიტის განახლება“** (Update site) on the dashboard. This runs `SYMMETRY_REBUILD_CMD` on the server.
- Contact and order forms post to the API live from the browser. Order requests and messages appear in the admin immediately.

## Configuration (environment variables)

| Variable | Used by | Purpose |
|---|---|---|
| `SYMMETRY_ADMIN_HASH` | backend | `password_hash()` of the admin password (preferred over `SYMMETRY_ADMIN_PASSWORD`) |
| `SYMMETRY_ADMIN_PASSWORD` | backend | Plain admin password (development only) |
| `SYMMETRY_ORIGINS` | backend | Comma-separated front-end origins allowed by CORS |
| `SYMMETRY_PUBLIC_URL` | backend | Absolute API origin for image URLs (e.g. `https://api.symmetry.ge`) |
| `SYMMETRY_REBUILD_CMD` | backend | Shell command that rebuilds and deploys `frontend/` |
| `PUBLIC_API_URL` | frontend | API URL, e.g. `https://api.symmetry.ge/api` |
| `SITE_URL` | frontend | Canonical site URL |
| `VITE_API_URL`, `VITE_SITE_URL` | admin | API and public-site URLs |

## Deploy (outline)

1. Serve `backend/public` as the API host. Apache uses the included `.htaccess`; for nginx, route `/api/*` to `index.php`. `backend/data/` and `backend/public/uploads/` must be writable and **must not** be web-browsable (keep `data/` outside the web root as it is now).
2. `cd frontend && npm run build` and serve `frontend/dist/`.
3. `cd admin && npm run build` and serve `admin/dist/` on a private path or subdomain.

## Placeholders to replace

All of these are **demo content**. Edit them in the admin, or in `backend/data/seed.json` before the first run:

- Email, Instagram link, exact address and working hours (admin → პარამეტრები). Phone, WhatsApp and Facebook already use the company's real details.
- Every product price, size and delivery time (admin → პროდუქცია).
- Product photos. Until a photo is uploaded, the site draws a parametric wood illustration and labels it as an illustration.
- Founder and team names and photos on the About page (`frontend/src/views/About.astro` and `frontend/src/i18n/ui.ts`).

## Not built yet

- **Flitt payments.** This is the planned final phase. Orders are stored with `payment_status = 'unpaid'`, and the order flow and admin are ready to gain a payment step.

## Wood palettes

The floating **ხის ჯიში / Wood** control (bottom-left) switches between six palettes live: walnut, ebony, white oak, teak, sapele and smoked oak. Once you've picked one, set it as the default in admin → პარამეტრები. To remove the switcher for launch, delete `<PaletteSwitcher />` in `frontend/src/layouts/Base.astro`. See `DESIGN.md` for the full system.
