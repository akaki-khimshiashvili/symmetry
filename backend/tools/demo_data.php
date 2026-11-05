<?php
declare(strict_types=1);

/*
 * Demo statistics: fills the database with fake visits, orders and messages so the admin's
 * metrics page can be seen with data. Every demo row is tagged and can be removed again.
 *
 *   php backend/tools/demo_data.php add      # last 30 days (+ a lighter 30 days before, for the ▲▼ comparison)
 *   php backend/tools/demo_data.php remove   # deletes every demo row, nothing else
 *
 * With Docker: docker compose exec api php /app/tools/demo_data.php add
 *
 * Tags: demo visits use visitor ids starting with "de00de00"; demo orders and messages use
 * e-mail addresses ending in "@demo.invalid". Demo orders are never "new" or "held", so they add
 * no sidebar badges and no payment waiting for confirmation (nothing here talks to Flitt).
 */

if (PHP_SAPI !== 'cli') {
    exit("CLI only\n");
}
$config = require __DIR__ . '/../config.php';
foreach (['Http', 'Products', 'Options', 'Db', 'Flitt', 'Receipts', 'Metrics'] as $f) {
    require_once __DIR__ . "/../src/$f.php";
}
$pdo = Db::get($config);

const VISITOR_TAG = 'de00de00';
const EMAIL_TAG = '@demo.invalid';

$remove = function () use ($pdo): array {
    $n = [];
    $n['visits'] = $pdo->exec("DELETE FROM events WHERE visitor LIKE '" . VISITOR_TAG . "%'");
    $n['orders'] = $pdo->exec("DELETE FROM orders WHERE email LIKE '%" . EMAIL_TAG . "'");
    $n['messages'] = $pdo->exec("DELETE FROM messages WHERE email LIKE '%" . EMAIL_TAG . "'");
    return $n;
};

$cmd = $argv[1] ?? '';
if ($cmd === 'remove') {
    $n = $remove();
    echo "Removed demo data: {$n['visits']} visit events, {$n['orders']} orders, {$n['messages']} messages.\n";
    exit(0);
}
if ($cmd !== 'add') {
    exit("Usage: php demo_data.php add|remove\n");
}

$remove(); // running "add" twice never doubles the data

$products = $pdo->query(<<<SQL
SELECT p.id, p.slug, p.name_ka, s.id AS sid, s.width_cm, s.height_cm, s.price, s.sale_percent
FROM products p JOIN product_sizes s ON s.product_id = p.id
WHERE p.published = 1 ORDER BY p.sort, p.id, s.sort, s.id
SQL)->fetchAll();
if (!$products) {
    exit("No published products: add some products first.\n");
}
$byProduct = [];
foreach ($products as $row) {
    $byProduct[$row['id']][] = $row;
}
$ids = array_keys($byProduct);
// A few products are much more popular than the rest, as in real shops.
$weights = array_map(fn ($i) => 1 / (1 + $i * 0.45), array_keys($ids));
$pickProduct = function () use ($ids, $weights): int {
    $r = mt_rand() / mt_getrandmax() * array_sum($weights);
    foreach ($weights as $i => $w) {
        if (($r -= $w) <= 0) {
            return $ids[$i];
        }
    }
    return $ids[0];
};
$any = fn (array $a) => $a[array_rand($a)];
$hex = fn (int $bytes) => bin2hex(random_bytes($bytes));

$referrers = ['', '', '', '', 'https://www.google.com/', 'https://www.google.com/', 'https://www.google.com/',
    'https://l.instagram.com/', 'https://l.instagram.com/', 'https://l.facebook.com/', 'https://www.bing.com/', 'https://www.myhome.ge/'];
$devices = ['mobile', 'mobile', 'mobile', 'mobile', 'desktop', 'desktop', 'desktop', 'tablet'];
$clientTypes = ['individual', 'individual', 'individual', 'designer', 'designer', 'office', 'restaurant', 'hotel', 'other'];
$channels = ['whatsapp', 'whatsapp', 'whatsapp', 'phone', 'phone', 'email'];
$names = ['ნინო', 'გიორგი', 'მარიამ', 'დავით', 'ანა', 'ლუკა', 'თამარ', 'ნიკა', 'სალომე', 'ლევან', 'ელენე', 'ირაკლი', 'Anna', 'Thomas', 'Sophie'];
$lines = [
    'order' => ['მაინტერესებს მიწოდების ვადა თბილისში.', 'შესაძლებელია სხვა ზომით დამზადება?', 'მინდა შევუკვეთო ოფისისთვის.'],
    'question' => ['რა მასალისგანაა დამზადებული?', 'მონტაჟი ფასში შედის?', 'გაქვთ შოურუმი?', 'რამდენ ხანში მზადდება?'],
    'other' => ['თანამშრომლობა გვაინტერესებს.', 'გთხოვთ, დამირეკოთ.'],
];
// A handful of returning customers (same phone, several orders).
$regulars = array_map(fn () => '+9955' . mt_rand(10000000, 99999999), range(1, 4));

$tz = new DateTimeZone('Asia/Tbilisi');
$utc = new DateTimeZone('UTC');
/** A random moment on local day -$d (0 = today, never in the future), as a UTC timestamp string. */
$at = function (int $d) use ($tz, $utc): string {
    $now = new DateTimeImmutable('now', $tz);
    $day = $now->setTime(0, 0)->modify("-$d days");
    // Most visits between 9:00 and 23:00.
    $t = $day->modify('+' . mt_rand(9 * 3600, 23 * 3600) . ' seconds');
    if ($t > $now) {
        $t = $now->modify('-' . mt_rand(60, 3600) . ' seconds');
    }
    return $t->setTimezone($utc)->format('Y-m-d H:i:s');
};

$ev = $pdo->prepare('INSERT INTO events (kind, path, product_id, detail, lang, referrer, device, visitor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
$ord = $pdo->prepare(<<<SQL
INSERT INTO orders (product_id, size_id, product_name, size_label, price, list_price, sale_percent, first_name, last_name, phone, email,
  client_type, channel, message, lang, status, payment_status, amount, card_mask, card_type, payment_test, held_at, captured_at, released_at, payment_updated_at, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
SQL);
$msg = $pdo->prepare("INSERT INTO messages (first_name, last_name, phone, email, client_type, channel, intent, message, lang, status, created_at) VALUES (?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?)");

$counts = ['visits' => 0, 'orders' => 0, 'messages' => 0];
$pdo->beginTransaction();
for ($d = 59; $d >= 0; $d--) {
    $recent = $d < 30;
    $date = (new DateTimeImmutable('now', $tz))->modify("-$d days");
    $weekend = (int) $date->format('N') >= 6;
    // Growing traffic: the latest 30 days are busier than the 30 before (shows ▲ on the cards).
    $visitors = (int) round(($recent ? 34 + (29 - $d) * 0.9 : 26 + (59 - $d) * 0.3) * ($weekend ? 1.25 : 1) * (0.8 + mt_rand(0, 40) / 100));
    for ($v = 0; $v < $visitors; $v++) {
        $vid = VISITOR_TAG . $hex(4);
        $lang = mt_rand(1, 100) <= 72 ? 'ka' : 'en';
        $pre = $lang === 'en' ? '/en' : '';
        $dev = $any($devices);
        $t = $at($d);
        $counts['visits']++;
        $ev->execute(['page', "$pre/", null, '', $lang, $any($referrers), $dev, $vid, $t]);
        if (mt_rand(1, 100) <= 62) {
            $ev->execute(['page', "$pre/products/", null, '', $lang, '', $dev, $vid, $t]);
        }
        if (mt_rand(1, 100) <= 14) {
            $ev->execute(['page', "$pre/about/", null, '', $lang, '', $dev, $vid, $t]);
        }
        $seen = mt_rand(0, 100) <= 70 ? mt_rand(1, 3) : 0;
        for ($k = 0; $k < $seen; $k++) {
            $pid = $pickProduct();
            $slug = $byProduct[$pid][0]['slug'];
            $ev->execute(['page', "$pre/products/$slug/", null, '', $lang, '', $dev, $vid, $t]);
            $ev->execute(['product', "$pre/products/$slug/", $pid, '', $lang, '', $dev, $vid, $t]);
            // ~3.5% of product views turn into an order.
            if (mt_rand(1, 1000) <= 35) {
                $size = $any($byProduct[$pid]);
                $pct = (int) $size['sale_percent'];
                $list = (float) $size['price'];
                $price = $pct > 0 ? round($list * (100 - $pct) / 100) : $list;
                // Older orders are finished; recent ones are still being made.
                $roll = mt_rand(1, 100);
                if ($d > 10) {
                    [$status, $pay] = $roll <= 70 ? ['done', 'captured'] : ($roll <= 80 ? ['done', 'unpaid'] : ($roll <= 88 ? ['cancelled', 'released'] : ($roll <= 95 ? ['cancelled', 'declined'] : ['cancelled', 'expired'])));
                } else {
                    [$status, $pay] = $roll <= 55 ? ['in_progress', 'captured'] : ($roll <= 75 ? ['done', 'captured'] : ($roll <= 87 ? ['in_progress', 'unpaid'] : ($roll <= 94 ? ['cancelled', 'declined'] : ['cancelled', 'released'])));
                }
                $phone = mt_rand(1, 100) <= 12 ? $any($regulars) : '+9955' . mt_rand(10000000, 99999999);
                $paid = in_array($pay, ['captured', 'released'], true);
                $ord->execute([
                    $pid, $size['sid'], $size['name_ka'], "{$size['width_cm']} × {$size['height_cm']} სმ", $price,
                    $pct > 0 ? $list : null, $pct, $any($names), $phone, 'customer' . $hex(3) . EMAIL_TAG,
                    $any($clientTypes), $any($channels), '', $lang, $status, $pay,
                    $pay === 'unpaid' ? 0 : (int) round($price * 100),
                    $paid ? '444455XXXXXX' . mt_rand(1000, 9999) : '', $paid ? $any(['VISA', 'MasterCard']) : '',
                    $paid ? $t : null, $pay === 'captured' ? $t : null, $pay === 'released' ? $t : null, $pay === 'unpaid' ? null : $t, $t,
                ]);
                $counts['orders']++;
            }
        }
        if (mt_rand(1, 100) <= 5) {
            $ev->execute(['contact', "$pre/contact/", null, $any(['whatsapp', 'whatsapp', 'whatsapp', 'phone', 'email', 'instagram']), $lang, '', $dev, $vid, $t]);
        }
        if (mt_rand(1, 100) <= 2) {
            $intent = $any(['order', 'question', 'question', 'other']);
            $msg->execute([$any($names), '+9955' . mt_rand(10000000, 99999999), 'contact' . $hex(3) . EMAIL_TAG, $any($clientTypes), $any($channels),
                $intent, $any($lines[$intent]), $lang, $d > 2 ? $any(['read', 'read', 'archived']) : 'read', $t]);
            $counts['messages']++;
        }
    }
}
$pdo->commit();
echo "Added demo data for 60 days (detail for the last 30): {$counts['visits']} visitors, {$counts['orders']} orders, {$counts['messages']} messages.\n";
echo "Remove it with: php backend/tools/demo_data.php remove\n";
