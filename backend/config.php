<?php
/**
 * Symmetry API configuration.
 * Every value can be overridden with an environment variable in production.
 */
return [
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
    'admin_password'      => getenv('SYMMETRY_ADMIN_PASSWORD') ?: 'symmetry-admin',
    'admin_password_hash' => getenv('SYMMETRY_ADMIN_HASH') ?: '',
    'token_ttl' => 60 * 60 * 12,

    // Shell command that rebuilds the static Astro site after content changes (admin "საიტის განახლება").
    // Example (Linux): 'cd /var/www/symmetry/frontend && npm run build && rsync -a --delete dist/ /var/www/html/'
    'rebuild_command' => getenv('SYMMETRY_REBUILD_CMD') ?: '',
    'rebuild_log' => __DIR__ . '/data/rebuild.log',

    // Front-ends allowed to call the API from the browser.
    'allowed_origins' => array_filter(array_map('trim', explode(',', getenv('SYMMETRY_ORIGINS') ?: 'http://localhost:4321,http://localhost:5173,http://127.0.0.1:4321,http://127.0.0.1:5173'))),
];
