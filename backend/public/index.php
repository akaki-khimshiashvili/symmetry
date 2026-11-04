<?php
declare(strict_types=1);

/*
 * Symmetry API: single front controller.
 * Dev:  php -S localhost:8000 -t backend/public backend/public/index.php
 * Prod: point the web root at backend/public and rewrite /api/* to index.php (see .htaccess).
 */

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';

// Let the PHP dev server serve uploaded images directly.
if (PHP_SAPI === 'cli-server' && $path !== '/' && is_file(__DIR__ . $path)) {
    return false;
}

$config = require __DIR__ . '/../config.php';
require __DIR__ . '/../src/Http.php';
require __DIR__ . '/../src/Products.php';
require __DIR__ . '/../src/Options.php';
require __DIR__ . '/../src/Images.php';
require __DIR__ . '/../src/Db.php';

Http::cors($config['allowed_origins'], $config['allow_local_origins']);
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$route = preg_match('#/api(/.*)?$#', $path, $m) ? rtrim($m[1] ?? '/', '/') ?: '/' : null;
if ($route === null) {
    Http::json(['error' => 'Not found'], 404);
}

const SETTING_KEYS = [
    'phone', 'whatsapp', 'email', 'instagram', 'facebook', 'tiktok',
    'address_ka', 'address_en', 'hours_ka', 'hours_en', 'default_palette',
];

try {
    $pdo = Db::get($config);
    $base = Http::baseUrl($config);
    $admin = fn () => Auth::require($pdo);

    $settings = function () use ($pdo): array {
        $rows = $pdo->query('SELECT key, value FROM settings')->fetchAll(PDO::FETCH_KEY_PAIR);
        $out = [];
        foreach (SETTING_KEYS as $k) {
            $out[$k] = $rows[$k] ?? '';
        }
        return $out;
    };

    $productOr404 = function (string $id, bool $hidden) use ($pdo, $base): array {
        $p = Products::find($pdo, $id, $hidden, $base);
        if (!$p) {
            throw new HttpError(404, 'პროდუქტი ვერ მოიძებნა');
        }
        return $p;
    };

    $routes = [
        // ---------- Public ----------
        ['GET', '#^/health$#', fn () => ['ok' => true]],
        ['GET', '#^/products$#', fn () => Products::all($pdo, false, $base)],
        ['GET', '#^/products/([\w-]+)$#', fn ($id) => $productOr404($id, false)],
        ['GET', '#^/settings$#', fn () => $settings()],

        ['POST', '#^/contact$#', function () use ($pdo) {
            $b = Http::body();
            if (!empty($b['website'])) {
                return ['ok' => true]; // honeypot
            }
            $errors = Leads::validate($b);
            $intent = (string) ($b['intent'] ?? '');
            if (!in_array($intent, ['order', 'question', 'other'], true)) {
                $errors['intent'] = 'required';
            }
            if ($errors) {
                throw new HttpError(422, 'Validation failed', $errors);
            }
            $c = Leads::clean($b);
            $pdo->prepare('INSERT INTO messages (first_name, last_name, phone, email, client_type, channel, intent, message, lang) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
                ->execute([$c['first_name'], $c['last_name'], $c['phone'], $c['email'], $c['client_type'], $c['channel'], $intent, $c['message'], $c['lang']]);
            return ['ok' => true, 'id' => (int) $pdo->lastInsertId()];
        }],

        ['POST', '#^/orders$#', function () use ($pdo, $base) {
            $b = Http::body();
            if (!empty($b['website'])) {
                return ['ok' => true];
            }
            $errors = Leads::validate($b);
            $product = Products::find($pdo, (string) (int) ($b['product_id'] ?? 0), false, $base);
            $size = null;
            foreach ($product['sizes'] ?? [] as $s) {
                if ($s['id'] === (int) ($b['size_id'] ?? 0)) {
                    $size = $s;
                }
            }
            if (!$product) {
                $errors['product_id'] = 'invalid';
            } elseif (!$size) {
                $errors['size_id'] = 'invalid';
            }
            if ($errors) {
                throw new HttpError(422, 'Validation failed', $errors);
            }
            $c = Leads::clean($b);
            $pdo->prepare('INSERT INTO orders (product_id, size_id, product_name, size_label, price, first_name, last_name, phone, email, client_type, channel, message, lang) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
                ->execute([
                    $product['id'], $size['id'], $product['name']['ka'],
                    $size['width'] . ' × ' . $size['height'] . ' მმ', $size['price'],
                    $c['first_name'], $c['last_name'], $c['phone'], $c['email'], $c['client_type'], $c['channel'], $c['message'], $c['lang'],
                ]);
            // Payment (Flitt) is a later phase: orders are stored with payment_status = 'unpaid'.
            return ['ok' => true, 'id' => (int) $pdo->lastInsertId()];
        }],

        // ---------- Admin ----------
        ['POST', '#^/admin/login$#', function () use ($pdo, $config) {
            $b = Http::body();
            return ['token' => Auth::login($pdo, $config, (string) ($b['username'] ?? ''), (string) ($b['password'] ?? ''))];
        }],
        ['POST', '#^/admin/logout$#', function () use ($pdo, $admin) {
            $admin();
            Auth::logout($pdo);
            return ['ok' => true];
        }],
        ['GET', '#^/admin/me$#', function () use ($admin) {
            $admin();
            return ['ok' => true];
        }],
        ['GET', '#^/admin/stats$#', function () use ($pdo, $admin) {
            $admin();
            $count = fn ($sql) => (int) $pdo->query($sql)->fetchColumn();
            return [
                'products' => $count('SELECT COUNT(*) FROM products'),
                'published' => $count('SELECT COUNT(*) FROM products WHERE published = 1'),
                'orders_new' => $count("SELECT COUNT(*) FROM orders WHERE status = 'new'"),
                'messages_new' => $count("SELECT COUNT(*) FROM messages WHERE status = 'new'"),
            ];
        }],

        // ---------- Dropdown options (material, size presets) ----------
        ['GET', '#^/admin/options$#', function () use ($pdo, $admin) {
            $admin();
            return Options::all($pdo);
        }],
        ['POST', '#^/admin/options$#', function () use ($pdo, $admin) {
            $admin();
            $b = Http::body();
            if ($errors = Options::validate($b)) {
                throw new HttpError(422, 'შეამოწმეთ ველები', $errors);
            }
            return Options::create($pdo, $b);
        }],
        ['DELETE', '#^/admin/options/(\d+)$#', function ($id) use ($pdo, $admin) {
            $admin();
            if (!Options::delete($pdo, (int) $id)) {
                throw new HttpError(404, 'ვარიანტი ვერ მოიძებნა');
            }
            return ['ok' => true];
        }],

        ['GET', '#^/admin/products$#', function () use ($pdo, $admin, $base) {
            $admin();
            return Products::all($pdo, true, $base);
        }],
        ['GET', '#^/admin/products/(\d+)$#', function ($id) use ($admin, $productOr404) {
            $admin();
            return $productOr404($id, true);
        }],
        ['POST', '#^/admin/products$#', function () use ($pdo, $admin, $productOr404) {
            $admin();
            $b = Http::body();
            if ($errors = Products::validate($b)) {
                throw new HttpError(422, 'შეამოწმეთ ველები', $errors);
            }
            $pdo->beginTransaction();
            $id = Products::save($pdo, $b);
            $pdo->commit();
            return $productOr404((string) $id, true);
        }],
        ['PUT', '#^/admin/products/(\d+)$#', function ($id) use ($pdo, $admin, $productOr404) {
            $admin();
            $productOr404($id, true);
            $b = Http::body();
            if ($errors = Products::validate($b)) {
                throw new HttpError(422, 'შეამოწმეთ ველები', $errors);
            }
            $pdo->beginTransaction();
            Products::save($pdo, $b, (int) $id);
            $pdo->commit();
            return $productOr404($id, true);
        }],
        ['DELETE', '#^/admin/products/(\d+)$#', function ($id) use ($pdo, $admin, $config) {
            $admin();
            if (!Products::delete($pdo, (int) $id, $config['upload_dir'])) {
                throw new HttpError(404, 'პროდუქტი ვერ მოიძებნა');
            }
            return ['ok' => true];
        }],

        ['POST', '#^/admin/products/(\d+)/images$#', function ($id) use ($pdo, $admin, $config, $productOr404) {
            $admin();
            $productOr404($id, true);
            $files = $_FILES['images'] ?? null;
            if (!$files) {
                throw new HttpError(400, 'ფაილი არ არის არჩეული');
            }
            if (!is_dir($config['upload_dir'])) {
                mkdir($config['upload_dir'], 0775, true);
            }
            $names = (array) $files['name'];
            $allowed = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp', 'image/avif' => 'avif'];
            $finfo = new finfo(FILEINFO_MIME_TYPE);
            $next = (int) $pdo->query('SELECT COALESCE(MAX(sort), -1) + 1 FROM product_images WHERE product_id = ' . (int) $id)->fetchColumn();
            foreach (array_keys($names) as $i) {
                $tmp = ((array) $files['tmp_name'])[$i];
                $err = ((array) $files['error'])[$i];
                $size = ((array) $files['size'])[$i];
                if ($err !== UPLOAD_ERR_OK) {
                    throw new HttpError(400, 'ატვირთვა ვერ მოხერხდა');
                }
                if ($size > $config['max_upload_bytes']) {
                    throw new HttpError(413, 'ფაილი ძალიან დიდია (მაქს. 8 MB)');
                }
                $mime = $finfo->file($tmp);
                if (!isset($allowed[$mime])) {
                    throw new HttpError(415, 'დაშვებულია მხოლოდ JPG, PNG, WEBP, AVIF');
                }
                // Every photo is stored as an optimised WebP (see Images.php).
                $stem = 'p' . (int) $id . '-' . bin2hex(random_bytes(8));
                if (Images::supported()) {
                    $file = $stem . '.webp';
                    try {
                        Images::toWebp($tmp, $mime, $config['upload_dir'] . '/' . $file);
                    } catch (RuntimeException $e) {
                        throw new HttpError(422, $e->getMessage());
                    }
                } else {
                    // No GD/WebP on this server: keep the original file.
                    $file = $stem . '.' . $allowed[$mime];
                    if (!move_uploaded_file($tmp, $config['upload_dir'] . '/' . $file)) {
                        throw new HttpError(500, 'ფაილის შენახვა ვერ მოხერხდა');
                    }
                }
                $pdo->prepare('INSERT INTO product_images (product_id, path, sort) VALUES (?, ?, ?)')
                    ->execute([(int) $id, $config['upload_url'] . '/' . $file, $next++]);
            }
            return $productOr404($id, true);
        }],
        ['PUT', '#^/admin/products/(\d+)/images/order$#', function ($id) use ($pdo, $admin, $productOr404) {
            $admin();
            $ids = Http::body()['ids'] ?? [];
            $stmt = $pdo->prepare('UPDATE product_images SET sort = ? WHERE id = ? AND product_id = ?');
            foreach (array_values($ids) as $i => $imgId) {
                $stmt->execute([$i, (int) $imgId, (int) $id]);
            }
            return $productOr404($id, true);
        }],
        ['DELETE', '#^/admin/images/(\d+)$#', function ($imgId) use ($pdo, $admin, $config) {
            $admin();
            $stmt = $pdo->prepare('SELECT path FROM product_images WHERE id = ?');
            $stmt->execute([(int) $imgId]);
            $path = $stmt->fetchColumn();
            if ($path === false) {
                throw new HttpError(404, 'სურათი ვერ მოიძებნა');
            }
            Products::unlinkUpload($config['upload_dir'], (string) $path);
            $pdo->prepare('DELETE FROM product_images WHERE id = ?')->execute([(int) $imgId]);
            return ['ok' => true];
        }],

        ['GET', '#^/admin/orders$#', function () use ($pdo, $admin) {
            $admin();
            return $pdo->query('SELECT * FROM orders ORDER BY id DESC')->fetchAll();
        }],
        ['PATCH', '#^/admin/orders/(\d+)$#', function ($id) use ($pdo, $admin) {
            $admin();
            $status = Http::body()['status'] ?? '';
            if (!in_array($status, ['new', 'in_progress', 'done', 'cancelled'], true)) {
                throw new HttpError(422, 'არასწორი სტატუსი');
            }
            $pdo->prepare('UPDATE orders SET status = ? WHERE id = ?')->execute([$status, (int) $id]);
            return ['ok' => true];
        }],
        ['DELETE', '#^/admin/orders/(\d+)$#', function ($id) use ($pdo, $admin) {
            $admin();
            $pdo->prepare('DELETE FROM orders WHERE id = ?')->execute([(int) $id]);
            return ['ok' => true];
        }],

        ['GET', '#^/admin/messages$#', function () use ($pdo, $admin) {
            $admin();
            return $pdo->query('SELECT * FROM messages ORDER BY id DESC')->fetchAll();
        }],
        ['PATCH', '#^/admin/messages/(\d+)$#', function ($id) use ($pdo, $admin) {
            $admin();
            $status = Http::body()['status'] ?? '';
            if (!in_array($status, ['new', 'read', 'archived'], true)) {
                throw new HttpError(422, 'არასწორი სტატუსი');
            }
            $pdo->prepare('UPDATE messages SET status = ? WHERE id = ?')->execute([$status, (int) $id]);
            return ['ok' => true];
        }],
        ['DELETE', '#^/admin/messages/(\d+)$#', function ($id) use ($pdo, $admin) {
            $admin();
            $pdo->prepare('DELETE FROM messages WHERE id = ?')->execute([(int) $id]);
            return ['ok' => true];
        }],

        ['POST', '#^/admin/rebuild$#', function () use ($admin, $config) {
            $admin();
            $cmd = trim((string) $config['rebuild_command']);
            if ($cmd === '') {
                throw new HttpError(501, 'საიტის ავტომატური განახლება არ არის კონფიგურირებული (SYMMETRY_REBUILD_CMD). მიმართეთ დეველოპერს.');
            }
            $log = escapeshellarg($config['rebuild_log']);
            if (PHP_OS_FAMILY === 'Windows') {
                pclose(popen('start /B cmd /C "' . $cmd . ' > ' . $log . ' 2>&1"', 'r'));
            } else {
                exec('(' . $cmd . ') > ' . $log . ' 2>&1 &');
            }
            return ['ok' => true];
        }],
        ['PUT', '#^/admin/settings$#', function () use ($pdo, $admin, $settings) {
            $admin();
            $b = Http::body();
            $stmt = $pdo->prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
            foreach (SETTING_KEYS as $k) {
                if (array_key_exists($k, $b)) {
                    $stmt->execute([$k, mb_substr(trim((string) $b[$k]), 0, 500)]);
                }
            }
            return $settings();
        }],
    ];

    $methodMatched = false;
    foreach ($routes as [$verb, $pattern, $handler]) {
        if (preg_match($pattern, $route, $params)) {
            if ($verb !== $method) {
                $methodMatched = true;
                continue;
            }
            array_shift($params);
            Http::json($handler(...$params));
        }
    }
    Http::json(['error' => $methodMatched ? 'Method not allowed' : 'Not found'], $methodMatched ? 405 : 404);
} catch (HttpError $e) {
    if (isset($pdo) && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    Http::json(['error' => $e->getMessage(), 'fields' => (object) $e->fields], $e->status);
} catch (Throwable $e) {
    if (isset($pdo) && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    error_log('[symmetry] ' . $e);
    Http::json(['error' => 'სერვერის შეცდომა'], 500);
}
