<?php

/**
 * Site analytics: anonymous visit events from the public site, plus figures worked out from orders and messages.
 *
 * Privacy: no IP address, cookie or personal data is stored. A visitor is a random id the browser keeps
 * in localStorage, so "visitors" means distinct browsers, not people.
 */
final class Metrics
{
    /** page = any page opened, product = a product page opened, contact = a WhatsApp / phone / email link clicked. */
    public const KINDS = ['page', 'product', 'contact'];
    public const PERIODS = [7, 30, 90, 365];
    /** Events are kept a little over a year (the longest period plus its comparison would need two). */
    private const KEEP_DAYS = 800;
    /** Tbilisi is UTC+4 all year; days are counted in local time. */
    private const TZ = '+4 hours';

    public static function migrate(PDO $pdo): void
    {
        $pdo->exec(<<<SQL
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    path TEXT NOT NULL DEFAULT '',
    product_id INTEGER,
    detail TEXT NOT NULL DEFAULT '',
    lang TEXT NOT NULL DEFAULT 'ka',
    referrer TEXT NOT NULL DEFAULT '',
    device TEXT NOT NULL DEFAULT 'desktop',
    visitor TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS events_time ON events(created_at);
CREATE INDEX IF NOT EXISTS events_kind_time ON events(kind, created_at);
SQL);
    }

    /** Stores one event from the public site. Bots and malformed beacons are dropped silently. */
    public static function track(PDO $pdo, array $b, string $userAgent): bool
    {
        $kind = (string) ($b['k'] ?? '');
        $visitor = (string) ($b['v'] ?? '');
        if (!in_array($kind, self::KINDS, true) || !preg_match('/^[a-f0-9]{16,32}$/', $visitor) || self::isBot($userAgent)) {
            return false;
        }
        $path = mb_substr((string) ($b['p'] ?? ''), 0, 200);
        if ($path === '' || $path[0] !== '/') {
            return false;
        }
        $detail = '';
        if ($kind === 'contact') {
            $detail = in_array($b['d'] ?? '', ['whatsapp', 'phone', 'email', 'instagram', 'facebook', 'tiktok'], true) ? $b['d'] : '';
            if ($detail === '') {
                return false;
            }
        }
        $productId = null;
        if ($kind === 'product') {
            $stmt = $pdo->prepare('SELECT id FROM products WHERE id = ?');
            $stmt->execute([(int) ($b['pid'] ?? 0)]);
            $productId = $stmt->fetchColumn() ?: null;
            if (!$productId) {
                return false;
            }
        }
        $pdo->prepare('INSERT INTO events (kind, path, product_id, detail, lang, referrer, device, visitor) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            ->execute([
                $kind, $path, $productId, $detail,
                ($b['l'] ?? '') === 'en' ? 'en' : 'ka',
                self::referrer((string) ($b['r'] ?? '')),
                self::device($userAgent),
                $visitor,
            ]);
        // Housekeeping now and then instead of a cron job.
        if (random_int(1, 200) === 1) {
            $pdo->exec("DELETE FROM events WHERE created_at < datetime('now', '-" . self::KEEP_DAYS . " days')");
        }
        return true;
    }

    public static function isBot(string $ua): bool
    {
        return $ua === '' || (bool) preg_match('/bot|crawl|spider|slurp|preview|headless|lighthouse|facebookexternalhit|curl|wget|python|httpclient|java\//i', $ua);
    }

    public static function device(string $ua): string
    {
        if (preg_match('/iPad|Tablet|(Android(?!.*Mobile))/i', $ua)) {
            return 'tablet';
        }
        return preg_match('/Mobi|iPhone|Android/i', $ua) ? 'mobile' : 'desktop';
    }

    /** Only the referring site's host is kept ("google.com"); visits from the site itself count as direct. */
    public static function referrer(string $ref): string
    {
        $host = strtolower((string) parse_url($ref, PHP_URL_HOST));
        return mb_substr(preg_replace('/^(www\.|m\.|l\.|lm\.)/', '', $host), 0, 100);
    }

    /** Everything the admin's metrics page shows, for the last $days days and the same span before it. */
    public static function report(PDO $pdo, int $days, array $siteHosts = []): array
    {
        $days = in_array($days, self::PERIODS, true) ? $days : 30;
        $tz = self::TZ;
        // Period boundaries in UTC, aligned to local midnights: today counts as day N.
        $from = "datetime(date('now', '$tz', '-" . ($days - 1) . " days'), '-4 hours')";
        $prevFrom = "datetime(date('now', '$tz', '-" . (2 * $days - 1) . " days'), '-4 hours')";
        $one = fn (string $sql, array $p = []) => self::one($pdo, $sql, $p);
        $all = fn (string $sql, array $p = []) => self::all($pdo, $sql, $p);
        // A sale: money charged or held, or (payments off) an order staff marked done.
        $sold = "(payment_status IN ('captured', 'held') OR (payment_status = 'unpaid' AND status = 'done'))";

        $period = function (string $start, string $end) use ($one, $sold) {
            $range = "created_at >= $start AND created_at < $end";
            return [
                'visitors' => (int) $one("SELECT COUNT(DISTINCT visitor) FROM events WHERE $range"),
                'pageviews' => (int) $one("SELECT COUNT(*) FROM events WHERE kind = 'page' AND $range"),
                'product_views' => (int) $one("SELECT COUNT(*) FROM events WHERE kind = 'product' AND $range"),
                'contacts' => (int) $one("SELECT COUNT(*) FROM events WHERE kind = 'contact' AND $range"),
                'orders' => (int) $one("SELECT COUNT(*) FROM orders WHERE $range"),
                'sales' => (int) $one("SELECT COUNT(*) FROM orders WHERE $sold AND $range"),
                'revenue' => (float) $one("SELECT COALESCE(SUM(price), 0) FROM orders WHERE $sold AND $range"),
                'messages' => (int) $one("SELECT COUNT(*) FROM messages WHERE $range"),
            ];
        };
        $now = "datetime('now', '+1 minute')";
        $cur = $period($from, $now);
        $prev = $period($prevFrom, $from);
        $rate = fn ($a, $b) => $b > 0 ? round($a / $b * 100, 1) : 0.0;
        // Conversion only compares orders placed while visits were being counted (orders older than
        // tracking would otherwise inflate it past 100%).
        $since = $one('SELECT MIN(created_at) FROM events');
        $tracked = fn (string $start, string $end) => $since
            ? (int) $one("SELECT COUNT(*) FROM orders WHERE created_at >= MAX($start, ?) AND created_at < $end", [$since])
            : 0;
        $cur['conversion'] = $rate($tracked($from, $now), $cur['visitors']);
        $prev['conversion'] = $rate($tracked($prevFrom, $from), $prev['visitors']);
        $cur['aov'] = $cur['sales'] ? round($cur['revenue'] / $cur['sales']) : 0;
        $prev['aov'] = $prev['sales'] ? round($prev['revenue'] / $prev['sales']) : 0;

        // ---------- Over time (by day, or by month for a year) ----------
        $byMonth = $days > 90;
        $bucket = $byMonth ? "strftime('%Y-%m', created_at, '$tz')" : "date(created_at, '$tz')";
        $series = [];
        $start = new DateTimeImmutable('now', new DateTimeZone('Asia/Tbilisi'));
        if ($byMonth) {
            $first = $start->modify('first day of this month');
            $startDay = $start->modify('-' . ($days - 1) . ' days');
            for ($m = $startDay->modify('first day of this month'); $m <= $first; $m = $m->modify('+1 month')) {
                $series[$m->format('Y-m')] = ['date' => $m->format('Y-m'), 'visitors' => 0, 'views' => 0, 'orders' => 0, 'messages' => 0, 'revenue' => 0];
            }
        } else {
            for ($i = $days - 1; $i >= 0; $i--) {
                $d = $start->modify("-$i days")->format('Y-m-d');
                $series[$d] = ['date' => $d, 'visitors' => 0, 'views' => 0, 'orders' => 0, 'messages' => 0, 'revenue' => 0];
            }
        }
        $fill = function (array $rows, array $map) use (&$series) {
            foreach ($rows as $r) {
                if (isset($series[$r['b']])) {
                    foreach ($map as $col => $key) {
                        $series[$r['b']][$key] = $key === 'revenue' ? (float) $r[$col] : (int) $r[$col];
                    }
                }
            }
        };
        $fill($all("SELECT $bucket AS b, COUNT(DISTINCT visitor) AS u, SUM(kind = 'page') AS v FROM events WHERE created_at >= $from GROUP BY b"), ['u' => 'visitors', 'v' => 'views']);
        $fill($all("SELECT $bucket AS b, COUNT(*) AS n, COALESCE(SUM(CASE WHEN $sold THEN price END), 0) AS r FROM orders WHERE created_at >= $from GROUP BY b"), ['n' => 'orders', 'r' => 'revenue']);
        $fill($all("SELECT $bucket AS b, COUNT(*) AS n FROM messages WHERE created_at >= $from GROUP BY b"), ['n' => 'messages']);

        // ---------- Products ----------
        $sinceSql = $since ? $pdo->quote((string) $since) : "'9999'";
        $products = $all(<<<SQL
SELECT p.id, p.name_ka AS name, p.slug, p.published, p.in_stock, p.category, p.orientation,
  (SELECT path FROM product_images i WHERE i.product_id = p.id ORDER BY sort, id LIMIT 1) AS image,
  (SELECT COUNT(*) FROM events e WHERE e.product_id = p.id AND e.kind = 'product' AND e.created_at >= $from) AS views,
  (SELECT COUNT(DISTINCT visitor) FROM events e WHERE e.product_id = p.id AND e.kind = 'product' AND e.created_at >= $from) AS viewers,
  (SELECT COUNT(*) FROM orders o WHERE o.product_id = p.id AND o.created_at >= $from) AS orders,
  (SELECT COUNT(*) FROM orders o WHERE o.product_id = p.id AND $sold AND o.created_at >= $from) AS sales,
  (SELECT COALESCE(SUM(price), 0) FROM orders o WHERE o.product_id = p.id AND $sold AND o.created_at >= $from) AS revenue,
  (SELECT COUNT(*) FROM orders o WHERE o.product_id = p.id AND o.created_at >= MAX($from, $sinceSql)) AS tracked_orders
FROM products p
ORDER BY views DESC, orders DESC, p.sort, p.id
SQL);
        foreach ($products as &$p) {
            foreach (['id', 'published', 'in_stock', 'views', 'viewers', 'orders', 'sales'] as $k) {
                $p[$k] = (int) $p[$k];
            }
            $p['revenue'] = (float) $p['revenue'];
            $p['conversion'] = $rate((int) $p['tracked_orders'], $p['viewers']);
            unset($p['tracked_orders']);
        }
        unset($p);
        $sizes = $all("SELECT product_name AS product, size_label AS size, SUM(COALESCE(quantity, 1)) AS orders FROM orders WHERE created_at >= $from GROUP BY product_id, size_label ORDER BY orders DESC, product LIMIT 8");
        $byType = $all(<<<SQL
SELECT CASE WHEN p.category IN ('shelf', 'wall', 'mirror') THEN p.category ELSE COALESCE(p.orientation, 'landscape') END AS k,
  COUNT(o.id) AS orders, COALESCE(SUM(CASE WHEN $sold THEN o.price END), 0) AS revenue
FROM orders o LEFT JOIN products p ON p.id = o.product_id
WHERE o.created_at >= $from GROUP BY k ORDER BY orders DESC
SQL);

        // ---------- Sales ----------
        $count = fn (string $table, string $col) => array_map('intval', $pdo->query("SELECT $col, COUNT(*) FROM $table WHERE created_at >= $from GROUP BY $col")->fetchAll(PDO::FETCH_KEY_PAIR));
        $sales = [
            'by_status' => $count('orders', 'status'),
            'by_payment' => $count('orders', 'payment_status'),
            'held_sum' => (float) $one("SELECT COALESCE(SUM(price), 0) FROM orders WHERE payment_status = 'held'"),
            'held_count' => (int) $one("SELECT COUNT(*) FROM orders WHERE payment_status = 'held'"),
            'refunded_sum' => (float) $one("SELECT COALESCE(SUM(price), 0) FROM orders WHERE payment_status = 'refunded' AND created_at >= $from"),
            'abandoned' => (int) $one("SELECT COUNT(*) FROM orders WHERE payment_status IN ('pending', 'declined', 'expired') AND created_at >= $from"),
            'discount_orders' => (int) $one("SELECT COUNT(*) FROM orders WHERE sale_percent > 0 AND created_at >= $from"),
            'discount_given' => (float) $one("SELECT COALESCE(SUM(list_price - price), 0) FROM orders WHERE sale_percent > 0 AND list_price IS NOT NULL AND $sold AND created_at >= $from"),
            'open' => (int) $one("SELECT COUNT(*) FROM orders WHERE status IN ('new', 'in_progress')"),
        ];
        $productViewers = (int) $one("SELECT COUNT(DISTINCT visitor) FROM events WHERE kind = 'product' AND created_at >= $from");
        $funnel = [
            ['key' => 'visitors', 'n' => $cur['visitors']],
            ['key' => 'product_viewers', 'n' => $productViewers],
            ['key' => 'orders', 'n' => $cur['orders']],
            ['key' => 'sales', 'n' => $cur['sales']],
        ];

        // ---------- Customers (orders + messages) ----------
        $mix = function (string $col) use ($pdo, $from) {
            $out = [];
            foreach (['orders', 'messages'] as $t) {
                foreach ($pdo->query("SELECT $col AS k, COUNT(*) AS n FROM $t WHERE created_at >= $from GROUP BY $col")->fetchAll() as $r) {
                    $out[$r['k']] ??= ['key' => $r['k'], 'orders' => 0, 'messages' => 0];
                    $out[$r['k']][$t] = (int) $r['n'];
                }
            }
            $out = array_values($out);
            usort($out, fn ($a, $b) => ($b['orders'] + $b['messages']) <=> ($a['orders'] + $a['messages']));
            return $out;
        };
        $customers = [
            'client_types' => $mix('client_type'),
            'channels' => $mix('channel'),
            'langs' => $mix('lang'),
            // Same phone number ordering more than once (ever), counted when the latest order is in the period.
            'repeat' => (int) $one("SELECT COUNT(*) FROM (SELECT phone FROM orders GROUP BY phone HAVING COUNT(*) > 1 AND MAX(created_at) >= $from)"),
            'unique' => (int) $one("SELECT COUNT(DISTINCT phone) FROM orders WHERE created_at >= $from"),
        ];
        $messages = [
            'by_intent' => $count('messages', 'intent'),
            'by_status' => $count('messages', 'status'),
            'waiting' => (int) $one("SELECT COUNT(*) FROM messages WHERE status = 'new'"),
            'oldest_waiting' => $one("SELECT MIN(created_at) FROM messages WHERE status = 'new'"),
        ];

        // ---------- Traffic ----------
        $hosts = array_values(array_filter(array_map(fn ($u) => self::referrer($u), $siteHosts)));
        $notSelf = $hosts ? 'AND referrer NOT IN (' . implode(',', array_fill(0, count($hosts), '?')) . ')' : '';
        $traffic = [
            'pages' => $all("SELECT path AS key, COUNT(*) AS n, COUNT(DISTINCT visitor) AS u FROM events WHERE kind = 'page' AND created_at >= $from GROUP BY path ORDER BY n DESC LIMIT 10"),
            'referrers' => $all("SELECT referrer AS key, COUNT(DISTINCT visitor) AS n FROM events WHERE kind = 'page' AND referrer != '' $notSelf AND created_at >= $from GROUP BY referrer ORDER BY n DESC LIMIT 8", $hosts),
            'direct' => (int) $one("SELECT COUNT(DISTINCT visitor) FROM events WHERE kind = 'page' AND (referrer = ''" . ($hosts ? ' OR referrer IN (' . implode(',', array_fill(0, count($hosts), '?')) . ')' : '') . ") AND created_at >= $from", $hosts),
            'devices' => $all("SELECT device AS key, COUNT(DISTINCT visitor) AS n FROM events WHERE created_at >= $from GROUP BY device ORDER BY n DESC"),
            'langs' => $all("SELECT lang AS key, COUNT(DISTINCT visitor) AS n FROM events WHERE created_at >= $from GROUP BY lang ORDER BY n DESC"),
            'contacts' => $all("SELECT detail AS key, COUNT(*) AS n FROM events WHERE kind = 'contact' AND created_at >= $from GROUP BY detail ORDER BY n DESC"),
            'tracking_since' => $one('SELECT MIN(created_at) FROM events'),
        ];
        $traffic['pages'] = array_map(fn ($r) => ['key' => $r['key'], 'n' => (int) $r['n'], 'u' => (int) $r['u']], $traffic['pages']);
        foreach (['referrers', 'devices', 'langs', 'contacts'] as $k) {
            $traffic[$k] = array_map(fn ($r) => ['key' => (string) $r['key'], 'n' => (int) $r['n']], $traffic[$k]);
        }

        return [
            'days' => $days,
            'by_month' => $byMonth,
            'current' => $cur,
            'previous' => $prev,
            'series' => array_values($series),
            'funnel' => $funnel,
            'products' => $products,
            'sizes' => array_map(fn ($r) => ['product' => $r['product'], 'size' => $r['size'], 'orders' => (int) $r['orders']], $sizes),
            'types' => array_map(fn ($r) => ['key' => $r['k'], 'orders' => (int) $r['orders'], 'revenue' => (float) $r['revenue']], $byType),
            'sales' => $sales,
            'customers' => $customers,
            'messages' => $messages,
            'traffic' => $traffic,
        ];
    }

    private static function one(PDO $pdo, string $sql, array $params = []): mixed
    {
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchColumn();
    }

    private static function all(PDO $pdo, string $sql, array $params = []): array
    {
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll();
    }
}
