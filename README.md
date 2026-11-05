# Symmetry — Parametric Wall Art & 3D Decor

| Part | Stack | Folder | Dev URL |
|---|---|---|---|
| Public site (KA default, EN at `/en/`) | Astro (static) | `frontend/` | http://localhost:4321 |
| Admin panel (Georgian only) | Vite + Preact + TS | `admin/` | http://localhost:5173 |
| API | PHP 8.1+ with SQLite (PDO) | `backend/` | http://localhost:8000/api |

## Run locally

Requires PHP 8.1+ with the `pdo_sqlite` and `fileinfo` extensions, and Node 20+.

**API with Docker (easiest):** start Docker Desktop, then from the project root:

```bash
docker compose up -d        # API at http://localhost:8000/api (rebuild after Dockerfile changes: --build)
docker compose logs -f api  # follow the log
docker compose down         # stop
```

`backend/` is mounted into the container, so code changes apply immediately, and the database, uploads and
`backend/config.local.php` stay on your disk. Admin credentials go in `backend/config.local.php` (not committed):

```php
<?php return ['admin_username' => 'admin', 'admin_password_hash' => '<password_hash() output>'];
```

**Without Docker:**

```bash
# 1. API (creates and seeds backend/data/symmetry.sqlite on the first request)
# Bind to 127.0.0.1, not "localhost": PHP picks only one address for "localhost" (often IPv6 ::1),
# and browsers that resolve localhost to IPv4 then can't reach the API.
php -S 127.0.0.1:8000 -t backend/public backend/public/index.php

# 2. Public site
cd frontend && npm install && npm run dev

# 3. Admin
cd admin && npm install && npm run dev
```

Default admin login: **`admin`** / **`symmetry-admin`**, unless `backend/config.local.php` overrides it. Change it before going live (see Configuration).

The site builds even when the API is offline. In that case it falls back to `backend/data/seed.json`.

## How content gets to the site

The public site is static, which keeps it fast and SEO-friendly. Products, prices and settings are read **at build time** from the API.

- After editing in the admin, click **„საიტის განახლება“** (Update site) on the dashboard. This runs `SYMMETRY_REBUILD_CMD` on the server.
- Contact and order forms post to the API live from the browser. Order requests and messages appear in the admin immediately.

## Configuration (environment variables)

| Variable | Used by | Purpose |
|---|---|---|
| `SYMMETRY_ADMIN_USER` | backend | Admin username (default `admin`) |
| `SYMMETRY_ADMIN_HASH` | backend | `password_hash()` of the admin password (preferred over `SYMMETRY_ADMIN_PASSWORD`) |
| `SYMMETRY_ADMIN_PASSWORD` | backend | Plain admin password (development only) |
| `SYMMETRY_ORIGINS` | backend | Comma-separated front-end origins allowed by CORS. When unset (development), any `http://localhost:<port>` is allowed |
| `SYMMETRY_PUBLIC_URL` | backend | Absolute API origin for image URLs (e.g. `https://api.symmetry.ge`) |
| `SYMMETRY_REBUILD_CMD` | backend | Shell command that rebuilds and deploys `frontend/` |
| `SYMMETRY_FLITT_ENABLED` | backend | `1` turns on online payment for orders (default off) |
| `SYMMETRY_FLITT_MERCHANT_ID`, `SYMMETRY_FLITT_SECRET` | backend | Flitt merchant ID and payment key. Defaults are Flitt's public **test** merchant (`1549901` / `test`) |
| `SYMMETRY_FLITT_HOLD_DAYS` | backend | How long a pre-authorization hold lasts (default 7; confirm with Flitt) |
| `SYMMETRY_API_URL` | backend | Public HTTPS URL of the API (`…/api`) that Flitt calls back and returns customers to |
| `SYMMETRY_SITE_URL` | backend | Public site URL; customers land on `/payment/` there after paying, and receipt QR codes point to its `/verify/` |
| `SYMMETRY_RECEIPT_SECRET` | backend | Key for receipt verification codes. Set once and never change it |
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

## Online payments (Flitt)

Orders use **pre-authorization**: when the customer pays, the amount is only *held* on their card. In admin → შეკვეთები, staff then:

- **დადასტურება (Accept)**: captures the hold, so the money is charged and the order moves to "მუშავდება".
- **უარყოფა (Decline)**: reverses the hold, so nothing is charged and the order is cancelled.
- **თანხის დაბრუნება (Refund)**: on an accepted order, returns the charged amount. Flitt's commission is usually not returned.

If nobody acts before the hold expires (`SYMMETRY_FLITT_HOLD_DAYS`), the bank releases it on its own.

**Testing locally.** `backend/config.local.php` sets `flitt_enabled => true` with the test merchant. Place an order on the site, then pay on Flitt's page with a test card from [Flitt's testing docs](https://docs.flitt.com/). Flitt's callbacks can't reach `localhost`. The site checks the status when the customer returns, and the admin has a **სტატუსის განახლება** button to ask Flitt directly. To test the real callbacks, expose the API with a tunnel (e.g. `ngrok http 8000`) and set `SYMMETRY_API_URL` to the tunnel URL plus `/api`.

**Going live.** The merchant account must be the business's own. Set `SYMMETRY_FLITT_ENABLED=1`, the live `SYMMETRY_FLITT_MERCHANT_ID` / `SYMMETRY_FLITT_SECRET`, and the public `SYMMETRY_API_URL` and `SYMMETRY_SITE_URL`. Ask Flitt to turn on pre-authorization and to confirm the hold length. Then rebuild the site so the order button reads "Continue to payment".

Flitt does not issue tax invoices or fiscal receipts. If `sender_email` is given, it emails the customer a payment confirmation.

### Receipts and verification

Once a payment is authorised, the order has a receipt. The customer opens it from the `/payment/` page (**ქვითრის ნახვა**). Staff open it from the order in the admin (**ქვითარი**). It is the same document, and it updates with the order: authorisation → payment → cancelled or refunded. **PDF-ად ჩამოტვირთვა** opens the print dialog ("Save as PDF"). The page also works as a phone screenshot.

Each receipt has a number (`SYM-2026-00012`), a verification code and a QR code. The code is an HMAC of the order's payment facts (order, Flitt order ID, amount, currency, authorisation time), keyed with a server-side secret. Scanning the QR opens `/verify/`, where anyone can check the receipt. Staff can also check one at the top of admin → შეკვეთები. The check shows the order's **live** status, so a forged code, an edited amount, or an old screenshot of a receipt that was later declined or refunded will not pass.

- Set `SYMMETRY_RECEIPT_SECRET` in production (any long random string). Without it, a secret is generated once and stored in the database. **Never change it after receipts are issued**, or the old receipts stop verifying.
- The seller's legal name and ID code on receipts come from admin → პარამეტრები.
- The QR points to `SYMMETRY_SITE_URL`, so locally it encodes `localhost`, which a phone cannot open.

### Receipt emails

Email is required on the order form. The receipt is emailed to the customer automatically, once for each status that has a receipt: authorised, accepted (paid), declined (hold released), refunded and expired. Each order in the admin shows whether the current receipt went out. **ქვითრის ხელახლა გაგზავნა** sends it again.

- **Locally**, with no SMTP set, emails are written to `backend/data/outbox/` (`.html` to open in a browser, `.eml` for a mail app) instead of being sent.
- **In production**, set `SYMMETRY_SMTP_HOST`, `SYMMETRY_SMTP_PORT` (587 or 465), `SYMMETRY_SMTP_SECURE` (`tls` for 587, `ssl` for 465), `SYMMETRY_SMTP_USER`, `SYMMETRY_SMTP_PASS` and `SYMMETRY_MAIL_FROM` (an address the SMTP account may send from, ideally on the shop's own domain with SPF/DKIM set up so receipts don't land in spam). Optional: `SYMMETRY_MAIL_REPLY_TO` (where customer replies go) and `SYMMETRY_MAIL_COPY_TO` (a hidden copy of every receipt for the store).
- A mail failure never blocks a payment step. It is logged, and the admin shows the receipt as not sent.

## Wood palettes

The floating **ხის ჯიში / Wood** control (bottom-left) switches between six palettes live: walnut, ebony, white oak, teak, sapele and smoked oak. Once you've picked one, set it as the default in admin → პარამეტრები. To remove the switcher for launch, delete `<PaletteSwitcher />` in `frontend/src/layouts/Base.astro`. See `DESIGN.md` for the full system.
