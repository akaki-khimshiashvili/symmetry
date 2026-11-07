<?php
/**
 * Symmetry API configuration.
 * Every value can be overridden with an environment variable in production.
 */
$config = [
    // SQLite database file (created and seeded automatically on first request).
    'db_path'   => getenv('SYMMETRY_DB_PATH') ?: __DIR__ . '/data/symmetry.sqlite',
    'seed_path' => __DIR__ . '/data/seed.json',

    // Uploaded product photos live inside the public web root.
    'upload_dir' => __DIR__ . '/public/uploads',
    'upload_url' => '/uploads',
    'max_upload_bytes' => 8 * 1024 * 1024,

    // Absolute origin used to build image URLs. Leave empty to detect from the request.
    'public_url' => getenv('SYMMETRY_PUBLIC_URL') ?: '',

    // Admin login. Prefer SYMMETRY_ADMIN_HASH (output of password_hash()) in production.
    'admin_username'      => getenv('SYMMETRY_ADMIN_USER') ?: 'admin',
    'admin_password'      => getenv('SYMMETRY_ADMIN_PASSWORD') ?: 'symmetry-admin',
    'admin_password_hash' => getenv('SYMMETRY_ADMIN_HASH') ?: '',
    'token_ttl' => 60 * 60 * 12,
    // Behind a reverse proxy (nginx, a load balancer) every request comes from the proxy's address. Set
    // SYMMETRY_TRUST_PROXY=1 there so the login and receipt-check limits count per visitor (X-Forwarded-For).
    // Never set it when clients can reach PHP directly: they could then pick their own address.
    'trust_proxy' => filter_var(getenv('SYMMETRY_TRUST_PROXY') ?: '0', FILTER_VALIDATE_BOOLEAN),

    // Shell command that rebuilds the static Astro site after content changes (admin "საიტის განახლება").
    // Example (Linux): 'cd /var/www/symmetry/frontend && npm run build && rsync -a --delete dist/ /var/www/html/'
    'rebuild_command' => getenv('SYMMETRY_REBUILD_CMD') ?: '',
    'rebuild_log' => __DIR__ . '/data/rebuild.log',

    // ---------- Online payments (Flitt) ----------
    // Defaults are Flitt's public TEST merchant: no real money moves and real cards must not be used.
    // For live payments set the merchant's own ID and payment key (Merchant Portal → Technical settings).
    'flitt_enabled'     => filter_var(getenv('SYMMETRY_FLITT_ENABLED') ?: '0', FILTER_VALIDATE_BOOLEAN),
    'flitt_merchant_id' => getenv('SYMMETRY_FLITT_MERCHANT_ID') ?: '1549901',
    'flitt_secret'      => getenv('SYMMETRY_FLITT_SECRET') ?: 'test',
    // How long Flitt keeps a pre-authorization hold. Confirm the real value with Flitt for the live account.
    'flitt_hold_days'   => (int) (getenv('SYMMETRY_FLITT_HOLD_DAYS') ?: 7),
    // Public HTTPS address of this API (…/api). Flitt sends payment callbacks here and returns customers here.
    // Leave empty to detect it from the request (fine for local testing).
    'api_public_url'    => getenv('SYMMETRY_API_URL') ?: '',
    // Key for the receipt verification codes (QR). Leave empty to generate one and keep it in the database.
    // Never change it once receipts are issued: old receipts would stop verifying.
    'receipt_secret'    => getenv('SYMMETRY_RECEIPT_SECRET') ?: '',
    // ---------- Email (receipts) ----------
    // SMTP server for outgoing mail. Leave SYMMETRY_SMTP_HOST empty to write emails to data/outbox/ instead.
    'smtp_host'      => getenv('SYMMETRY_SMTP_HOST') ?: '',
    'smtp_port'      => (int) (getenv('SYMMETRY_SMTP_PORT') ?: 587),
    'smtp_secure'    => getenv('SYMMETRY_SMTP_SECURE') ?: 'tls',   // 'tls' (STARTTLS, 587) or 'ssl' (465)
    'smtp_user'      => getenv('SYMMETRY_SMTP_USER') ?: '',
    'smtp_pass'      => getenv('SYMMETRY_SMTP_PASS') ?: '',
    'mail_from'      => getenv('SYMMETRY_MAIL_FROM') ?: 'no-reply@symmetry.ge',
    'mail_from_name' => getenv('SYMMETRY_MAIL_FROM_NAME') ?: 'Symmetry',
    // Where customers' replies go (e.g. the studio inbox).
    'mail_reply_to'  => getenv('SYMMETRY_MAIL_REPLY_TO') ?: '',
    // Hidden copy of every receipt email for the store. Empty = no copy.
    'mail_copy_to'   => getenv('SYMMETRY_MAIL_COPY_TO') ?: '',
    'mail_outbox'    => getenv('SYMMETRY_MAIL_OUTBOX') ?: __DIR__ . '/data/outbox',

    // Public site the customer lands on after paying (the /payment/ result page).
    'site_url'          => getenv('SYMMETRY_SITE_URL') ?: 'http://localhost:4321',

    // Without SYMMETRY_ORIGINS (local development) any http://localhost:<port> may call the API.
    'allow_local_origins' => getenv('SYMMETRY_ORIGINS') === false,
    // Front-ends allowed to call the API from the browser.
    'allowed_origins' => array_filter(array_map('trim', explode(',', getenv('SYMMETRY_ORIGINS') ?: 'http://localhost:4321,http://localhost:5173,http://127.0.0.1:4321,http://127.0.0.1:5173'))),
];

// Machine-specific overrides (credentials etc.) live in config.local.php, which is not committed.
$local = __DIR__ . '/config.local.php';
return is_file($local) ? array_replace($config, require $local) : $config;
