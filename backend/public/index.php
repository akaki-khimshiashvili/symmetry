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
require __DIR__ . '/../src/Flitt.php';
require __DIR__ . '/../src/Receipts.php';
require __DIR__ . '/../src/Mailer.php';

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
    // Seller details printed on receipts.
    'legal_name', 'tax_id',
];

try {
    $pdo = Db::get($config);
    $base = Http::baseUrl($config);
    $admin = fn () => Auth::require($pdo);
    $config['api_public_url'] = rtrim($config['api_public_url'] ?: $base . '/api', '/');
    $flitt = Flitt::fromConfig($config);

    $orderOr404 = function (string $id) use ($pdo): array {
        $o = Payments::byId($pdo, (int) $id);
        if (!$o) {
            throw new HttpError(404, 'შეკვეთა ვერ მოიძებნა');
        }
        return $o;
    };
    $tokenOr404 = function (string $token) use ($pdo): array {
        $o = Payments::byToken($pdo, $token);
        if (!$o) {
            throw new HttpError(404, 'Payment not found');
        }
        return $o;
    };
    // After any payment change: email the receipt for the new status (once per status), return the fresh order.
    $notify = function (array $o) use ($pdo, $config): array {
        if (ReceiptMail::notify($pdo, $config, $o)) {
            return Payments::byId($pdo, (int) $o['id']);
        }
        return $o;
    };
    // Flitt problems are shown to staff as a readable error instead of a generic 500.
    $flittCall = function (callable $fn) {
        try {
            return $fn();
        } catch (FlittError $e) {
            throw new HttpError(502, $e->getMessage());
        }
    };
    // Customer's result page on the public site (Georgian at /payment/, English at /en/payment/).
    $resultUrl = fn (array $o) => rtrim($config['site_url'], '/') . ($o['lang'] === 'en' ? '/en' : '') . '/payment/?t=' . $o['pay_token'];
    $paymentReturn = function () use ($pdo, $flitt, $resultUrl, $notify) {
        $o = Payments::byToken($pdo, (string) ($_GET['t'] ?? ''));
        if (!$o) {
            throw new HttpError(404, 'Payment not found');
        }
        $data = Flitt::readPayload();
        try {
            // The redirect carries a signed result; otherwise ask Flitt directly.
            $o = $data && $flitt->verify($data) ? Payments::apply($pdo, $o, $data, 'return') : Payments::sync($pdo, $flitt, $o);
            $o = $notify($o);
        } catch (FlittError $e) {
            error_log('[symmetry] payment return: ' . $e->getMessage());
        }
        header('Location: ' . $resultUrl($o), true, 303);
        exit;
    };

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
        ['GET', '#^/settings$#', fn () => $settings() + ['payments' => (bool) $config['flitt_enabled']]],

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

        ['POST', '#^/orders$#', function () use ($pdo, $base, $config, $flitt) {
            $b = Http::body();
            if (!empty($b['website'])) {
                return ['ok' => true];
            }
            $errors = Leads::validate($b);
            // The receipt is emailed, so orders need an address.
            if (trim((string) ($b['email'] ?? '')) === '') {
                $errors['email'] = 'required';
            }
            $product = Products::find($pdo, (string) (int) ($b['product_id'] ?? 0), false, $base);
            $size = null;
            foreach ($product['sizes'] ?? [] as $s) {
                if ($s['id'] === (int) ($b['size_id'] ?? 0)) {
                    $size = $s;
                }
            }
            if (!$product) {
                $errors['product_id'] = 'invalid';
            } elseif (empty($product['in_stock'])) {
                $errors['product_id'] = 'out_of_stock';
            } elseif (!$size) {
                $errors['size_id'] = 'invalid';
            }
            if ($errors) {
                throw new HttpError(422, 'Validation failed', $errors);
            }
            $c = Leads::clean($b);
            // The price is always worked out here (sale included), never taken from the browser.
            $onSale = $size['sale_price'] < $size['price'];
            $pdo->prepare('INSERT INTO orders (product_id, size_id, product_name, size_label, price, list_price, sale_percent, first_name, last_name, phone, email, client_type, channel, message, lang) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
                ->execute([
                    $product['id'], $size['id'], $product['name']['ka'],
                    $size['width'] . ' × ' . $size['height'] . ' სმ', $size['sale_price'],
                    $onSale ? $size['price'] : null, $onSale ? (int) $size['sale_percent'] : 0,
                    $c['first_name'], $c['last_name'], $c['phone'], $c['email'], $c['client_type'], $c['channel'], $c['message'], $c['lang'],
                ]);
            $id = (int) $pdo->lastInsertId();
            if (!$config['flitt_enabled']) {
                return ['ok' => true, 'id' => $id];
            }
            // The order is saved first, so a Flitt outage never loses the request: staff still see it.
            try {
                return ['ok' => true, 'id' => $id, 'checkout_url' => Payments::start($pdo, $flitt, $config, Payments::byId($pdo, $id))];
            } catch (FlittError $e) {
                error_log('[symmetry] checkout for order ' . $id . ': ' . $e->getMessage());
                $pdo->prepare('UPDATE orders SET payment_error = ? WHERE id = ?')->execute([mb_substr($e->getMessage(), 0, 300), $id]);
                return ['ok' => true, 'id' => $id];
            }
        }],

        // ---------- Payments (Flitt) ----------
        ['POST', '#^/payments/callback$#', function () use ($pdo, $flitt, $notify) {
            $data = Flitt::readPayload();
            if (!$flitt->verify($data)) {
                error_log('[symmetry] Flitt callback with an invalid signature');
                throw new HttpError(400, 'Invalid signature');
            }
            $stmt = $pdo->prepare('SELECT * FROM orders WHERE flitt_order_id = ?');
            $stmt->execute([(string) ($data['order_id'] ?? '')]);
            $o = $stmt->fetch();
            if ($o) {
                $notify(Payments::apply($pdo, $o, $data, 'callback'));
            }
            return ['ok' => true]; // HTTP 200 tells Flitt to stop retrying
        }],
        ['GET', '#^/payments/return$#', $paymentReturn],
        ['POST', '#^/payments/return$#', $paymentReturn],
        ['GET', '#^/payments/([a-f0-9]{32})$#', function ($token) use ($pdo, $flitt, $config, $tokenOr404, $notify) {
            $o = $tokenOr404($token);
            if ($o['payment_status'] === 'pending') {
                try {
                    $o = $notify(Payments::sync($pdo, $flitt, $o));
                } catch (FlittError $e) {
                    error_log('[symmetry] payment status: ' . $e->getMessage());
                }
            }
            return Payments::publicView($o, $config);
        }],
        // ---------- Receipts ----------
        // Anyone holding a receipt (or its QR) can check it is genuine and see the order's live status.
        ['GET', '#^/receipts/verify$#', function () use ($pdo, $config) {
            $o = Receipts::check($pdo, $config, (string) ($_GET['n'] ?? ''), (string) ($_GET['c'] ?? ''));
            if (!$o) {
                usleep(300000); // slow down guessing
                return ['valid' => false];
            }
            return Receipts::publicCheck($pdo, $o);
        }],
        // The full receipt, for the customer's private payment link.
        ['GET', '#^/receipts/([a-f0-9]{32})$#', function ($token) use ($pdo, $config, $tokenOr404) {
            $o = $tokenOr404($token);
            if (!Receipts::has($o)) {
                throw new HttpError(404, 'No receipt for this order yet');
            }
            return Receipts::full($pdo, $config, $o);
        }],
        ['POST', '#^/payments/([a-f0-9]{32})/retry$#', function ($token) use ($pdo, $flitt, $config, $tokenOr404, $flittCall) {
            $o = $tokenOr404($token);
            if (!$config['flitt_enabled'] || !in_array($o['payment_status'], ['pending', 'declined', 'expired'], true)) {
                throw new HttpError(409, 'This order cannot be paid again');
            }
            return ['checkout_url' => $flittCall(fn () => Payments::start($pdo, $flitt, $config, $o))];
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
                'orders_held' => $count("SELECT COUNT(*) FROM orders WHERE payment_status = 'held'"),
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
            if ($msg = Products::featuredError($pdo, $b)) {
                throw new HttpError(422, $msg, ['featured' => $msg]);
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
            if ($msg = Products::featuredError($pdo, $b, (int) $id)) {
                throw new HttpError(422, $msg, ['featured' => $msg]);
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
        ['GET', '#^/admin/payments$#', function () use ($admin, $config, $flitt) {
            $admin();
            return [
                'enabled' => (bool) $config['flitt_enabled'], 'test' => $flitt->isTest(), 'hold_days' => (int) $config['flitt_hold_days'],
                'mail' => (new Mailer($config))->configured() ? 'smtp' : 'outbox',
            ];
        }],
        // Ask Flitt for the latest state (needed locally, where Flitt's callbacks cannot reach the API).
        ['POST', '#^/admin/orders/(\d+)/sync$#', function ($id) use ($pdo, $admin, $flitt, $orderOr404, $flittCall, $notify) {
            $admin();
            return $notify($flittCall(fn () => Payments::sync($pdo, $flitt, $orderOr404($id))));
        }],
        // Accept: charge the held money.
        ['POST', '#^/admin/orders/(\d+)/accept$#', function ($id) use ($pdo, $admin, $flitt, $orderOr404, $flittCall, $notify) {
            $admin();
            $o = $flittCall(fn () => Payments::sync($pdo, $flitt, $orderOr404($id)));
            if ($o['payment_status'] !== 'held') {
                throw new HttpError(409, 'შეკვეთაზე დაბლოკილი თანხა არ არის (სტატუსი: ' . $o['payment_status'] . ')');
            }
            $res = $flittCall(fn () => $flitt->capture($o['flitt_order_id'], (int) $o['amount'], $o['currency']));
            Payments::log($pdo, (int) $o['id'], 'capture', $res);
            if (($res['capture_status'] ?? '') !== 'captured') {
                throw new HttpError(502, 'Flitt-მა თანხის ჩამოჭრა ვერ შეასრულა' . (!empty($res['response_description']) ? ': ' . $res['response_description'] : ''));
            }
            $pdo->prepare("UPDATE orders SET payment_status = 'captured', captured_at = CURRENT_TIMESTAMP, payment_updated_at = CURRENT_TIMESTAMP, status = CASE WHEN status = 'new' THEN 'in_progress' ELSE status END WHERE id = ?")
                ->execute([(int) $id]);
            return $notify(Payments::byId($pdo, (int) $id));
        }],
        // Decline: release the hold (nothing is charged). Orders without a hold are simply cancelled.
        ['POST', '#^/admin/orders/(\d+)/decline$#', function ($id) use ($pdo, $admin, $flitt, $orderOr404, $flittCall, $notify) {
            $admin();
            $o = $orderOr404($id);
            if ($o['flitt_order_id'] !== '') {
                $o = $flittCall(fn () => Payments::sync($pdo, $flitt, $o));
            }
            if ($o['payment_status'] === 'captured') {
                throw new HttpError(409, 'თანხა უკვე ჩამოჭრილია — გამოიყენეთ „თანხის დაბრუნება“');
            }
            if ($o['payment_status'] === 'held') {
                $res = $flittCall(fn () => $flitt->reverse($o['flitt_order_id'], (int) $o['amount'], $o['currency']));
                Payments::log($pdo, (int) $o['id'], 'reverse', $res);
                if (($res['reverse_status'] ?? '') !== 'approved') {
                    throw new HttpError(502, 'Flitt-მა დაბლოკილი თანხის გათავისუფლება ვერ შეასრულა');
                }
                $pdo->prepare("UPDATE orders SET payment_status = 'released', released_at = CURRENT_TIMESTAMP, payment_updated_at = CURRENT_TIMESTAMP WHERE id = ?")->execute([(int) $id]);
            }
            $pdo->prepare("UPDATE orders SET status = 'cancelled' WHERE id = ?")->execute([(int) $id]);
            return $notify(Payments::byId($pdo, (int) $id));
        }],
        // Send the receipt for the current status again (e.g. the customer can't find it).
        ['POST', '#^/admin/orders/(\d+)/email-receipt$#', function ($id) use ($pdo, $admin, $config, $orderOr404) {
            $admin();
            $o = $orderOr404($id);
            if (!Receipts::has($o)) {
                throw new HttpError(409, 'ამ შეკვეთას ჯერ ქვითარი არ აქვს');
            }
            if (trim((string) $o['email']) === '') {
                throw new HttpError(409, 'მომხმარებელს ელ-ფოსტა არ აქვს მითითებული');
            }
            if (!ReceiptMail::notify($pdo, $config, $o, true)) {
                throw new HttpError(502, 'წერილის გაგზავნა ვერ მოხერხდა — შეამოწმეთ ელ-ფოსტის (SMTP) პარამეტრები');
            }
            return Payments::byId($pdo, (int) $id);
        }],
        // Refund: return money that was already charged (Flitt's commission is usually not returned).
        ['POST', '#^/admin/orders/(\d+)/refund$#', function ($id) use ($pdo, $admin, $flitt, $orderOr404, $flittCall, $notify) {
            $admin();
            $o = $orderOr404($id);
            if ($o['payment_status'] !== 'captured') {
                throw new HttpError(409, 'დასაბრუნებელი თანხა არ არის');
            }
            $res = $flittCall(fn () => $flitt->reverse($o['flitt_order_id'], (int) $o['amount'], $o['currency']));
            Payments::log($pdo, (int) $o['id'], 'refund', $res);
            if (($res['reverse_status'] ?? '') !== 'approved') {
                throw new HttpError(502, 'Flitt-მა თანხის დაბრუნება ვერ შეასრულა');
            }
            $pdo->prepare("UPDATE orders SET payment_status = 'refunded', released_at = CURRENT_TIMESTAMP, payment_updated_at = CURRENT_TIMESTAMP, status = 'cancelled' WHERE id = ?")->execute([(int) $id]);
            return $notify(Payments::byId($pdo, (int) $id));
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
            $o = Payments::byId($pdo, (int) $id);
            if ($o && in_array($o['payment_status'], ['held', 'captured'], true)) {
                throw new HttpError(409, 'შეკვეთას აქვს დაბლოკილი ან გადახდილი თანხა — ჯერ უარყავით ან დააბრუნეთ თანხა');
            }
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
