<?php

/**
 * Payment receipts with a tamper-proof verification code.
 *
 * A receipt exists once Flitt has authorised the payment (held_at is set). Its verification code is an
 * HMAC of the order's payment facts, keyed with a secret that never leaves the server, so nobody can
 * produce a valid code for an order that does not exist or for a different amount. The QR code on the
 * receipt opens the public /verify/ page, which recomputes the code and shows the order's LIVE status:
 * a screenshot of an old "authorised" receipt cannot pass for "paid", "refunded" or "declined".
 */
final class Receipts
{
    /** Payment states that have a receipt (authorised at least once). */
    public const STATES = ['held', 'captured', 'released', 'refunded', 'expired'];

    public static function secret(PDO $pdo, array $config): string
    {
        if (!empty($config['receipt_secret'])) {
            return (string) $config['receipt_secret'];
        }
        // No secret configured: create one and keep it in the database (never exposed by /settings).
        $stmt = $pdo->prepare("SELECT value FROM settings WHERE key = 'receipt_secret'");
        $stmt->execute();
        $secret = (string) $stmt->fetchColumn();
        if ($secret === '') {
            $secret = bin2hex(random_bytes(32));
            $pdo->prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('receipt_secret', ?)")->execute([$secret]);
        }
        return $secret;
    }

    public static function has(array $o): bool
    {
        return !empty($o['held_at']) && in_array($o['payment_status'], self::STATES, true);
    }

    public static function number(array $o): string
    {
        return 'SYM-' . substr((string) $o['held_at'], 0, 4) . '-' . str_pad((string) $o['id'], 5, '0', STR_PAD_LEFT);
    }

    /** Parses "SYM-2026-00012" back to the order id. */
    public static function idFromNumber(string $n): ?int
    {
        return preg_match('/^SYM-(\d{4})-(\d{5,})$/', strtoupper(trim($n)), $m) ? (int) $m[2] : null;
    }

    /** 16 hex characters in groups of four, e.g. 3F9A-C21B-77D0-E4A8. */
    public static function code(PDO $pdo, array $config, array $o): string
    {
        $facts = implode('|', ['v1', $o['id'], $o['flitt_order_id'], $o['amount'], $o['currency'], $o['held_at']]);
        $hex = strtoupper(substr(hash_hmac('sha256', $facts, self::secret($pdo, $config)), 0, 16));
        return implode('-', str_split($hex, 4));
    }

    public static function verifyUrl(array $config, array $o, string $code): string
    {
        $site = rtrim($config['site_url'], '/') . ($o['lang'] === 'en' ? '/en' : '');
        return $site . '/verify/?n=' . rawurlencode(self::number($o)) . '&c=' . rawurlencode($code);
    }

    /** Checks a receipt number + code. Returns the order, or null when the receipt is not genuine. */
    public static function check(PDO $pdo, array $config, string $number, string $code): ?array
    {
        $id = self::idFromNumber($number);
        $o = $id ? Payments::byId($pdo, $id) : null;
        if (!$o || !self::has($o) || self::number($o) !== strtoupper(trim($number))) {
            return null;
        }
        $given = strtoupper(preg_replace('/[^0-9a-f]/i', '', $code));
        $expected = str_replace('-', '', self::code($pdo, $config, $o));
        return hash_equals($expected, $given) ? $o : null;
    }

    /** Orders store the Georgian product name; English receipts use the English one when it exists. */
    private static function productName(PDO $pdo, array $o): string
    {
        if ($o['lang'] === 'en' && $o['product_id']) {
            $stmt = $pdo->prepare('SELECT name_en FROM products WHERE id = ?');
            $stmt->execute([(int) $o['product_id']]);
            $en = (string) $stmt->fetchColumn();
            if ($en !== '') {
                return $en;
            }
        }
        return (string) $o['product_name'];
    }

    private static function seller(PDO $pdo): array
    {
        $rows = $pdo->query("SELECT key, value FROM settings WHERE key IN ('legal_name', 'tax_id', 'address_ka', 'address_en', 'phone', 'email')")->fetchAll(PDO::FETCH_KEY_PAIR);
        return [
            'name' => ($rows['legal_name'] ?? '') ?: 'Symmetry',
            'tax_id' => $rows['tax_id'] ?? '',
            'address' => ['ka' => $rows['address_ka'] ?? '', 'en' => $rows['address_en'] ?? ''],
            'phone' => $rows['phone'] ?? '',
            'email' => $rows['email'] ?? '',
        ];
    }

    /** Full receipt: for the customer (via their private payment link) and for staff. */
    public static function full(PDO $pdo, array $config, array $o): array
    {
        $code = self::code($pdo, $config, $o);
        return [
            'number' => self::number($o),
            'code' => $code,
            'verify_url' => self::verifyUrl($config, $o, $code),
            'status' => $o['payment_status'],
            'issued_at' => $o['held_at'],
            'captured_at' => $o['captured_at'],
            'released_at' => $o['released_at'],
            'order_id' => (int) $o['id'],
            'lang' => $o['lang'],
            'test' => (bool) $o['payment_test'],
            'seller' => self::seller($pdo),
            'customer' => [
                'name' => trim($o['first_name'] . ' ' . $o['last_name']),
                'phone' => $o['phone'],
                'email' => $o['email'],
            ],
            'item' => ['product' => self::productName($pdo, $o), 'size' => $o['size_label'], 'qty' => max(1, (int) ($o['quantity'] ?? 1))],
            'amount' => (int) $o['amount'] / 100,
            'list_price' => $o['list_price'] !== null && (int) $o['sale_percent'] > 0 ? (float) $o['list_price'] : null,
            'sale_percent' => (int) ($o['sale_percent'] ?? 0),
            'currency' => $o['currency'],
            'card' => trim($o['card_type'] . ' ' . $o['card_mask']),
            'flitt_order_id' => $o['flitt_order_id'],
            'flitt_payment_id' => $o['flitt_payment_id'],
        ];
    }

    /** What anyone scanning the QR may see: enough to match the receipt, no contact details. */
    public static function publicCheck(PDO $pdo, array $o): array
    {
        $last = trim((string) $o['last_name']);
        $digits = preg_replace('/\D/', '', (string) $o['phone']);
        return [
            'valid' => true,
            'number' => self::number($o),
            'status' => $o['payment_status'],
            'issued_at' => $o['held_at'],
            'captured_at' => $o['captured_at'],
            'released_at' => $o['released_at'],
            'customer' => trim($o['first_name'] . ($last !== '' ? ' ' . mb_substr($last, 0, 1) . '.' : '')),
            'phone_end' => $digits !== '' ? substr($digits, -2) : '',
            'item' => ['product' => self::productName($pdo, $o), 'size' => $o['size_label'], 'qty' => max(1, (int) ($o['quantity'] ?? 1))],
            'amount' => (int) $o['amount'] / 100,
            'currency' => $o['currency'],
            'card_end' => substr(preg_replace('/\D/', '', (string) $o['card_mask']), -4),
            'test' => (bool) $o['payment_test'],
        ];
    }
}
