<?php

/**
 * Flitt payment gateway client (https://docs.flitt.com).
 *
 * Orders are paid with pre-authorization (preauth = Y): the customer's money is only held on the card.
 * Staff then accept the order in the admin panel (capture = the money is charged) or decline it
 * (reverse = the hold is released and nothing is charged).
 */
final class Flitt
{
    private const API = 'https://pay.flitt.com/api';

    /** Flitt's public test merchant. Real card data must never be used with it. */
    public const TEST_MERCHANT_ID = '1549901';
    public const TEST_SECRET = 'test';

    public function __construct(private string $merchantId, private string $secret)
    {
    }

    public static function fromConfig(array $config): self
    {
        return new self((string) $config['flitt_merchant_id'], (string) $config['flitt_secret']);
    }

    public function isTest(): bool
    {
        return $this->merchantId === self::TEST_MERCHANT_ID;
    }

    /**
     * Signature: sha1 of "secret|value1|value2|…" with the non-empty parameters sorted by name.
     */
    public function sign(array $params): string
    {
        unset($params['signature'], $params['response_signature_string']);
        $params = array_filter($params, fn ($v) => $v !== '' && $v !== null && !is_array($v));
        ksort($params, SORT_STRING);
        $values = array_map(fn ($v) => is_bool($v) ? ($v ? 'true' : 'false') : (string) $v, array_values($params));
        return sha1(implode('|', array_merge([$this->secret], $values)));
    }

    public function verify(array $params): bool
    {
        $sig = (string) ($params['signature'] ?? '');
        return $sig !== '' && hash_equals($this->sign($params), strtolower($sig));
    }

    /** Creates a hosted checkout. Returns ['checkout_url' => …, 'payment_id' => …]. */
    public function checkout(array $params): array
    {
        return $this->call('/checkout/url', $params + ['preauth' => 'Y']);
    }

    public function capture(string $orderId, int $amount, string $currency): array
    {
        return $this->call('/capture/order_id', ['order_id' => $orderId, 'amount' => $amount, 'currency' => $currency]);
    }

    public function reverse(string $orderId, int $amount, string $currency): array
    {
        return $this->call('/reverse/order_id', ['order_id' => $orderId, 'amount' => $amount, 'currency' => $currency]);
    }

    public function status(string $orderId): array
    {
        return $this->call('/status/order_id', ['order_id' => $orderId]);
    }

    private function call(string $path, array $params): array
    {
        $params['merchant_id'] = $this->merchantId;
        $params['signature'] = $this->sign($params);
        $body = json_encode(['request' => $params], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        $ctx = stream_context_create([
            'http' => [
                'method' => 'POST',
                'header' => "Content-Type: application/json\r\nAccept: application/json\r\n",
                'content' => $body,
                'timeout' => 25,
                'ignore_errors' => true,
            ],
        ]);
        $raw = @file_get_contents(self::API . $path, false, $ctx);
        if ($raw === false) {
            throw new FlittError('Flitt-თან კავშირი ვერ დამყარდა');
        }
        $data = json_decode($raw, true);
        $res = is_array($data) ? ($data['response'] ?? $data) : null;
        if (!is_array($res)) {
            throw new FlittError('Flitt-მა უცნობი პასუხი დააბრუნა');
        }
        if (($res['response_status'] ?? '') !== 'success') {
            $msg = (string) ($res['error_message'] ?? 'უცნობი შეცდომა');
            throw new FlittError('Flitt: ' . $msg . (isset($res['error_code']) ? ' (' . $res['error_code'] . ')' : ''));
        }
        return $res;
    }

    /** Callback / redirect payloads arrive as JSON (flat or wrapped in "response") or as a form POST. */
    public static function readPayload(): array
    {
        $raw = (string) file_get_contents('php://input');
        $data = json_decode($raw, true);
        if (is_array($data)) {
            return is_array($data['response'] ?? null) ? $data['response'] : $data;
        }
        if ($_POST) {
            return $_POST;
        }
        parse_str($raw, $form);
        return $form;
    }
}

final class FlittError extends RuntimeException
{
}

/**
 * Keeps the order's payment fields in step with Flitt.
 *
 * payment_status:
 *   unpaid   – no online payment (old order requests, or payments switched off)
 *   pending  – customer was sent to the checkout, no result yet
 *   held     – money is held on the card, waiting for staff to accept or decline
 *   captured – accepted: the money is charged
 *   released – declined: the hold was cancelled, nothing was charged
 *   refunded – the charged money was returned
 *   declined – the card payment failed (customer can try again)
 *   expired  – the checkout or the hold expired
 */
final class Payments
{
    public const FINAL = ['captured', 'released', 'refunded'];

    public static function migrate(PDO $pdo): void
    {
        $cols = array_column($pdo->query('PRAGMA table_info(orders)')->fetchAll(), 'name');
        $add = [
            'pay_token' => "TEXT NOT NULL DEFAULT ''",
            'flitt_order_id' => "TEXT NOT NULL DEFAULT ''",
            'flitt_payment_id' => "TEXT NOT NULL DEFAULT ''",
            'amount' => 'INTEGER NOT NULL DEFAULT 0',          // tetri (GEL × 100)
            'currency' => "TEXT NOT NULL DEFAULT 'GEL'",
            'card_mask' => "TEXT NOT NULL DEFAULT ''",
            'card_type' => "TEXT NOT NULL DEFAULT ''",
            'payment_error' => "TEXT NOT NULL DEFAULT ''",
            'payment_test' => 'INTEGER NOT NULL DEFAULT 0',
            'held_at' => 'TEXT',
            'captured_at' => 'TEXT',
            'released_at' => 'TEXT',
            'payment_updated_at' => 'TEXT',
            'list_price' => 'REAL',                              // regular price (all pieces) when ordered on sale
            // Several pieces of one design and size: `price` is the order total, `unit_price` one piece.
            'quantity' => 'INTEGER NOT NULL DEFAULT 1',
            'unit_price' => 'REAL',
            'sale_percent' => 'INTEGER NOT NULL DEFAULT 0',
            'receipt_emailed' => "TEXT NOT NULL DEFAULT ''",   // payment statuses whose receipt was emailed
            'receipt_emailed_at' => 'TEXT',
        ];
        foreach ($add as $name => $def) {
            if (!in_array($name, $cols, true)) {
                $pdo->exec("ALTER TABLE orders ADD COLUMN $name $def");
            }
        }
        $pdo->exec("CREATE INDEX IF NOT EXISTS orders_pay_token ON orders(pay_token)");
        $pdo->exec("CREATE INDEX IF NOT EXISTS orders_flitt_order ON orders(flitt_order_id)");
        $pdo->exec(<<<SQL
CREATE TABLE IF NOT EXISTS payment_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    source TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)
SQL);
    }

    public static function log(PDO $pdo, int $orderId, string $source, array $payload): void
    {
        unset($payload['signature'], $payload['response_signature_string'], $payload['rectoken']);
        $pdo->prepare('INSERT INTO payment_events (order_id, source, payload) VALUES (?, ?, ?)')
            ->execute([$orderId, $source, json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)]);
    }

    public static function byToken(PDO $pdo, string $token): ?array
    {
        if (!preg_match('/^[a-f0-9]{32}$/', $token)) {
            return null;
        }
        $stmt = $pdo->prepare('SELECT * FROM orders WHERE pay_token = ?');
        $stmt->execute([$token]);
        return $stmt->fetch() ?: null;
    }

    public static function byId(PDO $pdo, int $id): ?array
    {
        $stmt = $pdo->prepare('SELECT * FROM orders WHERE id = ?');
        $stmt->execute([$id]);
        return $stmt->fetch() ?: null;
    }

    /** Starts (or restarts) the hosted checkout for an order and returns the URL to send the customer to. */
    public static function start(PDO $pdo, Flitt $flitt, array $config, array $order): string
    {
        $token = $order['pay_token'] ?: bin2hex(random_bytes(16));
        // Every attempt needs a fresh Flitt order id; a declined or expired one cannot be reused.
        $flittOrderId = 'SYM-' . $order['id'] . '-' . bin2hex(random_bytes(4));
        $amount = (int) round(((float) $order['price']) * 100);
        $api = rtrim($config['api_public_url'], '/');
        $lang = $order['lang'] === 'en' ? 'en' : 'ka';

        $params = [
            'order_id' => $flittOrderId,
            'order_desc' => mb_substr('Symmetry #' . $order['id'] . ' · ' . $order['product_name'] . ' · ' . $order['size_label']
                . ((int) ($order['quantity'] ?? 1) > 1 ? ' × ' . (int) $order['quantity'] : ''), 0, 1000),
            'amount' => $amount,
            'currency' => 'GEL',
            'lang' => $lang,
            'response_url' => $api . '/payments/return?t=' . $token,
            'server_callback_url' => $api . '/payments/callback',
            'merchant_data' => (string) $order['id'],
            'lifetime' => 3600,
        ];
        if ($order['email'] !== '') {
            $params['sender_email'] = $order['email'];
        }
        $res = $flitt->checkout($params);

        $pdo->prepare("UPDATE orders SET pay_token = ?, flitt_order_id = ?, flitt_payment_id = ?, amount = ?, currency = 'GEL', payment_status = 'pending', payment_error = '', payment_test = ?, payment_updated_at = CURRENT_TIMESTAMP WHERE id = ?")
            ->execute([$token, $flittOrderId, (string) ($res['payment_id'] ?? ''), $amount, $flitt->isTest() ? 1 : 0, $order['id']]);
        self::log($pdo, (int) $order['id'], 'checkout', $res);
        return (string) $res['checkout_url'];
    }

    /**
     * Applies a Flitt order status (from a callback, the return redirect or a status request).
     * A later state is never overwritten by an older one: callbacks can arrive late or twice.
     */
    public static function apply(PDO $pdo, array $order, array $data, string $source): array
    {
        if (($data['order_id'] ?? '') !== $order['flitt_order_id']) {
            return $order; // response for an older attempt
        }
        $current = $order['payment_status'];
        $flittStatus = (string) ($data['order_status'] ?? '');
        $captured = ($data['capture_status'] ?? '') === 'captured';
        $next = $current;

        switch ($flittStatus) {
            case 'created':
            case 'processing':
                if (in_array($current, ['unpaid', 'declined', 'expired'], true)) {
                    $next = 'pending';
                }
                break;
            case 'approved':
                if ($captured) {
                    $next = in_array($current, ['released', 'refunded'], true) ? $current : 'captured';
                } elseif (in_array($current, ['unpaid', 'pending', 'declined', 'expired'], true)) {
                    $next = 'held';
                }
                break;
            case 'reversed':
                if ($current === 'captured' || $order['captured_at']) {
                    $next = 'refunded';
                } elseif ($current !== 'refunded') {
                    $next = 'released';
                }
                break;
            case 'declined':
                if (in_array($current, ['unpaid', 'pending'], true)) {
                    $next = 'declined';
                }
                break;
            case 'expired':
                if (in_array($current, ['unpaid', 'pending', 'held'], true)) {
                    $next = 'expired';
                }
                break;
        }

        $sets = ['payment_status = ?', 'payment_updated_at = CURRENT_TIMESTAMP'];
        $vals = [$next];
        if (!empty($data['masked_card'])) {
            $sets[] = 'card_mask = ?';
            $vals[] = mb_substr((string) $data['masked_card'], 0, 30);
        }
        if (!empty($data['card_type'])) {
            $sets[] = 'card_type = ?';
            $vals[] = mb_substr((string) $data['card_type'], 0, 30);
        }
        if (!empty($data['payment_id'])) {
            $sets[] = 'flitt_payment_id = ?';
            $vals[] = (string) $data['payment_id'];
        }
        if ($next === 'declined') {
            $sets[] = 'payment_error = ?';
            $vals[] = mb_substr((string) ($data['response_description'] ?? ''), 0, 300);
        }
        if ($next === 'held' && $current !== 'held') {
            $sets[] = 'held_at = CURRENT_TIMESTAMP';
        }
        if ($next === 'captured' && $current !== 'captured') {
            $sets[] = 'captured_at = CURRENT_TIMESTAMP';
        }
        if (in_array($next, ['released', 'refunded'], true) && $current !== $next) {
            $sets[] = 'released_at = CURRENT_TIMESTAMP';
        }
        // Status polls repeat the same answer; only record what changed something.
        if ($source !== 'status' || $next !== $current) {
            self::log($pdo, (int) $order['id'], $source, $data);
        }
        $vals[] = $order['id'];
        $pdo->prepare('UPDATE orders SET ' . implode(', ', $sets) . ' WHERE id = ?')->execute($vals);
        return self::byId($pdo, (int) $order['id']);
    }

    /** Asks Flitt for the current state of the order's latest attempt. */
    public static function sync(PDO $pdo, Flitt $flitt, array $order): array
    {
        if ($order['flitt_order_id'] === '') {
            return $order;
        }
        return self::apply($pdo, $order, $flitt->status($order['flitt_order_id']), 'status');
    }

    /** What the customer's result page may see. */
    public static function publicView(array $o, array $config): array
    {
        return [
            'id' => (int) $o['id'],
            'status' => $o['payment_status'],
            'product' => $o['product_name'],
            'size' => $o['size_label'],
            'quantity' => max(1, (int) ($o['quantity'] ?? 1)),
            'price' => (float) $o['price'],
            'card' => $o['card_mask'],
            'test' => (bool) $o['payment_test'],
            'can_retry' => in_array($o['payment_status'], ['pending', 'declined', 'expired'], true),
            'hold_days' => (int) $config['flitt_hold_days'],
            'has_receipt' => !empty($o['held_at']) && in_array($o['payment_status'], Receipts::STATES, true),
        ];
    }
}
