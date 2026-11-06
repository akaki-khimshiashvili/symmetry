<?php

/**
 * Invoices (ინვოისი): a request for payment by bank transfer, mostly for company clients.
 *
 * This is NOT a tax invoice (საგადასახადო ანგარიშ-ფაქტურა); those are issued on rs.ge.
 *
 * Lifecycle: draft → issued → paid, or cancelled. A draft has no number. The number (INV-2026-0001,
 * one sequence per calendar year) is given when the invoice is issued, so deleted drafts never leave
 * gaps. The seller's details are copied into the invoice at that moment, so later changes in the
 * settings don't rewrite invoices that were already sent.
 */
final class Invoices
{
    public const STATUSES = ['draft', 'issued', 'paid', 'cancelled'];
    /** Georgian VAT rate, in percent. */
    public const VAT_RATE = 18;
    private const SELLER_KEYS = ['legal_name', 'tax_id', 'address_ka', 'address_en', 'phone', 'email', 'bank_name', 'bank_swift', 'iban'];

    public static function migrate(PDO $pdo): void
    {
        $pdo->exec(<<<SQL
CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number TEXT UNIQUE,
    year INTEGER,
    seq INTEGER,
    status TEXT NOT NULL DEFAULT 'draft',
    lang TEXT NOT NULL DEFAULT 'ka',
    order_id INTEGER,
    issue_date TEXT NOT NULL,
    due_date TEXT NOT NULL DEFAULT '',
    client_name TEXT NOT NULL DEFAULT '',
    client_tax_id TEXT NOT NULL DEFAULT '',
    client_address TEXT NOT NULL DEFAULT '',
    client_phone TEXT NOT NULL DEFAULT '',
    client_email TEXT NOT NULL DEFAULT '',
    items TEXT NOT NULL DEFAULT '[]',
    vat INTEGER NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    total INTEGER NOT NULL DEFAULT 0,
    seller TEXT NOT NULL DEFAULT '',
    issued_at TEXT,
    paid_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS invoices_order ON invoices(order_id);
SQL);
    }

    /** Today in Tbilisi (the business day), as YYYY-MM-DD. */
    public static function today(): string
    {
        return (new DateTimeImmutable('now', new DateTimeZone('Asia/Tbilisi')))->format('Y-m-d');
    }

    public static function seller(PDO $pdo): array
    {
        $in = implode(',', array_fill(0, count(self::SELLER_KEYS), '?'));
        $stmt = $pdo->prepare("SELECT key, value FROM settings WHERE key IN ($in)");
        $stmt->execute(self::SELLER_KEYS);
        $rows = $stmt->fetchAll(PDO::FETCH_KEY_PAIR);
        $out = [];
        foreach (self::SELLER_KEYS as $k) {
            $out[$k] = (string) ($rows[$k] ?? '');
        }
        if ($out['legal_name'] === '') {
            $out['legal_name'] = 'Symmetry';
        }
        return $out;
    }

    /** Line items as stored: description, quantity, unit and unit price (GEL, 2 decimals). */
    private static function cleanItems(array $items): array
    {
        $out = [];
        foreach (array_values($items) as $it) {
            if (!is_array($it)) {
                continue;
            }
            $out[] = [
                'description' => mb_substr(trim((string) ($it['description'] ?? '')), 0, 300),
                'qty' => round((float) ($it['qty'] ?? 0), 2),
                'unit' => mb_substr(trim((string) ($it['unit'] ?? '')), 0, 20),
                'price' => round((float) ($it['price'] ?? 0), 2),
            ];
        }
        return $out;
    }

    /** Totals in tetri, so rounding never drifts: VAT, when on, is already inside the prices (18/118). */
    public static function totals(array $items, bool $vat): array
    {
        $total = 0;
        foreach ($items as $it) {
            $total += (int) round($it['qty'] * $it['price'] * 100);
        }
        $vatAmount = $vat ? (int) round($total * self::VAT_RATE / (100 + self::VAT_RATE)) : 0;
        return ['total' => $total / 100, 'vat' => $vatAmount / 100, 'net' => ($total - $vatAmount) / 100];
    }

    public static function validate(array $b): array
    {
        $e = [];
        if (trim((string) ($b['client_name'] ?? '')) === '') {
            $e['client_name'] = 'შეიყვანეთ კლიენტის დასახელება';
        }
        $date = '/^\d{4}-\d{2}-\d{2}$/';
        $issue = (string) ($b['issue_date'] ?? '');
        $due = (string) ($b['due_date'] ?? '');
        if (!preg_match($date, $issue)) {
            $e['issue_date'] = 'მიუთითეთ თარიღი';
        }
        if ($due !== '' && !preg_match($date, $due)) {
            $e['due_date'] = 'არასწორი თარიღი';
        } elseif ($due !== '' && $due < $issue) {
            $e['due_date'] = 'გადახდის ვადა გაცემის თარიღზე ადრეა';
        }
        $email = trim((string) ($b['client_email'] ?? ''));
        if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $e['client_email'] = 'არასწორი ელ-ფოსტა';
        }
        $items = self::cleanItems((array) ($b['items'] ?? []));
        if (!$items) {
            $e['items'] = 'დაამატეთ მინიმუმ ერთი პოზიცია';
        }
        foreach ($items as $i => $it) {
            if ($it['description'] === '') {
                $e["items.$i.description"] = 'შეიყვანეთ აღწერა';
            }
            if ($it['qty'] <= 0) {
                $e["items.$i.qty"] = '> 0';
            }
            if ($it['price'] < 0) {
                $e["items.$i.price"] = '≥ 0';
            }
        }
        if ($items && !$e && self::totals($items, false)['total'] <= 0) {
            $e['items'] = 'ჯამი 0-ზე მეტი უნდა იყოს';
        }
        return $e;
    }

    /** Creates ($id null) or updates an invoice's editable content. Returns its id. */
    public static function save(PDO $pdo, array $b, ?int $id = null): int
    {
        $items = self::cleanItems((array) ($b['items'] ?? []));
        $vat = !empty($b['vat']);
        $t = self::totals($items, $vat);
        $str = fn (string $k, int $max = 300) => mb_substr(trim((string) ($b[$k] ?? '')), 0, $max);
        $vals = [
            in_array($b['lang'] ?? '', ['ka', 'en'], true) ? $b['lang'] : 'ka',
            !empty($b['order_id']) ? (int) $b['order_id'] : null,
            (string) $b['issue_date'], (string) ($b['due_date'] ?? ''),
            $str('client_name', 200), $str('client_tax_id', 40), $str('client_address', 300),
            $str('client_phone', 40), $str('client_email', 200),
            json_encode($items, JSON_UNESCAPED_UNICODE), $vat ? 1 : 0, $str('notes', 2000),
            (int) round($t['total'] * 100),
        ];
        if ($id === null) {
            $pdo->prepare('INSERT INTO invoices (lang, order_id, issue_date, due_date, client_name, client_tax_id, client_address, client_phone, client_email, items, vat, notes, total) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
                ->execute($vals);
            return (int) $pdo->lastInsertId();
        }
        $pdo->prepare('UPDATE invoices SET lang = ?, order_id = ?, issue_date = ?, due_date = ?, client_name = ?, client_tax_id = ?, client_address = ?, client_phone = ?, client_email = ?, items = ?, vat = ?, notes = ?, total = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            ->execute([...$vals, $id]);
        return $id;
    }

    /**
     * Moves an invoice to a new status. Issuing gives it the next number of its issue year and
     * freezes the seller's details; a number, once given, is never taken back.
     */
    public static function setStatus(PDO $pdo, array $inv, string $status): void
    {
        if ($status === 'draft' && $inv['number']) {
            throw new HttpError(409, 'ნომრიანი ინვოისი პროექტად ვეღარ დაბრუნდება — საჭიროების შემთხვევაში გააუქმეთ');
        }
        if ($status === 'cancelled' && !$inv['number']) {
            throw new HttpError(409, 'პროექტი არ უქმდება — უბრალოდ წაშალეთ');
        }
        $pdo->beginTransaction();
        if ($status !== 'draft' && !$inv['number']) {
            $year = (int) substr($inv['issue_date'], 0, 4);
            $stmt = $pdo->prepare('SELECT COALESCE(MAX(seq), 0) + 1 FROM invoices WHERE year = ?');
            $stmt->execute([$year]);
            $seq = (int) $stmt->fetchColumn();
            $number = sprintf('INV-%d-%04d', $year, $seq);
            $pdo->prepare('UPDATE invoices SET number = ?, year = ?, seq = ?, seller = ?, issued_at = CURRENT_TIMESTAMP WHERE id = ?')
                ->execute([$number, $year, $seq, json_encode(self::seller($pdo), JSON_UNESCAPED_UNICODE), $inv['id']]);
        }
        $pdo->prepare("UPDATE invoices SET status = ?, paid_at = CASE WHEN ? = 'paid' THEN COALESCE(paid_at, CURRENT_TIMESTAMP) ELSE NULL END, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
            ->execute([$status, $status, $inv['id']]);
        $pdo->commit();
    }

    public static function row(PDO $pdo, int $id): ?array
    {
        $stmt = $pdo->prepare('SELECT * FROM invoices WHERE id = ?');
        $stmt->execute([$id]);
        return $stmt->fetch() ?: null;
    }

    /** The invoice as the admin uses it: items decoded, totals worked out, seller filled in. */
    public static function view(PDO $pdo, array $r): array
    {
        $items = json_decode($r['items'], true) ?: [];
        $seller = $r['seller'] !== '' ? (json_decode($r['seller'], true) ?: []) : [];
        return [
            'id' => (int) $r['id'],
            'number' => $r['number'],
            'status' => $r['status'],
            'lang' => $r['lang'],
            'order_id' => $r['order_id'] !== null ? (int) $r['order_id'] : null,
            'issue_date' => $r['issue_date'],
            'due_date' => $r['due_date'],
            'client_name' => $r['client_name'],
            'client_tax_id' => $r['client_tax_id'],
            'client_address' => $r['client_address'],
            'client_phone' => $r['client_phone'],
            'client_email' => $r['client_email'],
            'items' => $items,
            'vat' => (bool) $r['vat'],
            'notes' => $r['notes'],
            'totals' => self::totals($items, (bool) $r['vat']),
            // Drafts show the current settings; issued invoices keep the details they were issued with.
            'seller' => $seller + self::seller($pdo),
            'issued_at' => $r['issued_at'],
            'paid_at' => $r['paid_at'],
            'created_at' => $r['created_at'],
            'updated_at' => $r['updated_at'],
        ];
    }

    public static function all(PDO $pdo): array
    {
        $rows = $pdo->query('SELECT * FROM invoices ORDER BY COALESCE(issued_at, created_at) DESC, id DESC')->fetchAll();
        return array_map(fn ($r) => self::view($pdo, $r), $rows);
    }
}
