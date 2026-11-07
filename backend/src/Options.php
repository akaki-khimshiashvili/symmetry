<?php

/**
 * Reusable dropdown options for the product editor (material, size presets) and the catalogue's
 * product types (პროდუქტის ტიპი) and dimensions (პროდუქტის განზომილება).
 * Text options are bilingual (both languages required); sizes are width × height in centimetres.
 * Types and dimensions also carry a stable `key` that products store and the site filters on;
 * the built-in ones can't be deleted, added ones only while no product uses them.
 */
final class Options
{
    public const TEXT_KINDS = ['material'];
    /** Lists whose entries have a key (stored on products). */
    public const KEYED_KINDS = ['type', 'dimension'];
    public const KINDS = ['material', 'size', 'type', 'dimension'];
    private const MAX_CM = 2000;
    /** Keys a new type may not take: "panel" is the stored category of the two panel types. */
    private const RESERVED = ['panel', 'new', 'all'];

    /** Built-in entries, created once so every list comes from the database. */
    private const BUILTIN = [
        'type' => [
            ['portrait', 'ვერტიკალური დიზაინი', 'Portrait design'],
            ['landscape', 'ჰორიზონტალური დიზაინი', 'Landscape design'],
            ['shelf', 'თარო', 'Shelf'],
            ['wall', 'მთლიანი კედელი', 'Whole wall'],
            ['mirror', 'სარკე', 'Mirror'],
        ],
        'dimension' => [
            ['portrait', 'პორტრეტი', 'Portrait'],
            ['landscape', 'ჰორიზონტალური დიზაინი', 'Landscape'],
            ['wall', 'მთლიანი კედელი', 'Whole wall'],
        ],
    ];

    /** Adds the key columns and the built-in types / dimensions (idempotent). */
    public static function migrate(PDO $pdo): void
    {
        $cols = array_column($pdo->query('PRAGMA table_info(options)')->fetchAll(), 'name');
        if (!in_array('key', $cols, true)) {
            $pdo->exec("ALTER TABLE options ADD COLUMN key TEXT NOT NULL DEFAULT ''");
        }
        if (!in_array('builtin', $cols, true)) {
            $pdo->exec('ALTER TABLE options ADD COLUMN builtin INTEGER NOT NULL DEFAULT 0');
        }
        $has = $pdo->prepare('SELECT 1 FROM options WHERE kind = ? AND key = ?');
        $add = $pdo->prepare('INSERT INTO options (kind, key, ka, en, sort, builtin) VALUES (?, ?, ?, ?, ?, 1)');
        foreach (self::BUILTIN as $kind => $rows) {
            foreach ($rows as $i => [$key, $ka, $en]) {
                $has->execute([$kind, $key]);
                if (!$has->fetchColumn()) {
                    $add->execute([$kind, $key, $ka, $en, $i]);
                }
            }
        }
    }

    /** @return string[] the keys of a type / dimension list, in display order */
    public static function keys(PDO $pdo, string $kind): array
    {
        $stmt = $pdo->prepare('SELECT key FROM options WHERE kind = ? ORDER BY sort ASC, id ASC');
        $stmt->execute([$kind]);
        return $stmt->fetchAll(PDO::FETCH_COLUMN);
    }

    /** Public lists for the site's filters and labels: [{key, ka, en, builtin}] per kind, in display order. */
    public static function taxonomy(PDO $pdo): array
    {
        $out = ['types' => [], 'dimensions' => []];
        $rows = $pdo->query("SELECT * FROM options WHERE kind IN ('type', 'dimension') ORDER BY sort ASC, id ASC")->fetchAll();
        foreach ($rows as $r) {
            $out[$r['kind'] === 'type' ? 'types' : 'dimensions'][] = [
                'key' => $r['key'], 'ka' => $r['ka'], 'en' => $r['en'], 'builtin' => (bool) $r['builtin'],
            ];
        }
        return $out;
    }

    /** @return array<string, array<int, array>> grouped by kind */
    public static function all(PDO $pdo): array
    {
        $out = array_fill_keys(self::KINDS, []);
        $rows = $pdo->query('SELECT * FROM options ORDER BY kind, sort ASC, id ASC')->fetchAll();
        foreach ($rows as $r) {
            if (isset($out[$r['kind']])) {
                $out[$r['kind']][] = self::shape($r);
            }
        }
        // Sizes read best smallest first.
        usort($out['size'], fn ($a, $b) => [$a['width'], $a['height']] <=> [$b['width'], $b['height']]);
        return $out;
    }

    private static function shape(array $r): array
    {
        if ($r['kind'] === 'size') {
            return ['id' => (int) $r['id'], 'width' => (int) $r['width'], 'height' => (int) $r['height']];
        }
        $out = ['id' => (int) $r['id'], 'ka' => $r['ka'], 'en' => $r['en']];
        if (in_array($r['kind'], self::KEYED_KINDS, true)) {
            $out += ['key' => $r['key'], 'builtin' => (bool) $r['builtin']];
        }
        return $out;
    }

    public static function validate(array $b): array
    {
        $kind = (string) ($b['kind'] ?? '');
        if (!in_array($kind, self::KINDS, true)) {
            return ['kind' => 'უცნობი ჩამონათვალი'];
        }
        $errors = [];
        if ($kind === 'size') {
            foreach (['width' => 'სიგანე', 'height' => 'სიმაღლე'] as $k => $label) {
                $v = (int) ($b[$k] ?? 0);
                if ($v <= 0 || $v > self::MAX_CM) {
                    $errors[$k] = "$label უნდა იყოს 1-დან " . self::MAX_CM . " სმ-მდე";
                }
            }
        } else {
            if (trim((string) ($b['ka'] ?? '')) === '') {
                $errors['ka'] = 'ქართული ვერსია სავალდებულოა';
            }
            if (trim((string) ($b['en'] ?? '')) === '') {
                $errors['en'] = 'ინგლისური ვერსია სავალდებულოა';
            }
        }
        return $errors;
    }

    /** Insert an option, or return the existing identical one (no duplicates in the lists). */
    public static function create(PDO $pdo, array $b): array
    {
        $kind = (string) $b['kind'];
        if (in_array($kind, self::KEYED_KINDS, true)) {
            $ka = mb_substr(trim((string) $b['ka']), 0, 80);
            $en = mb_substr(trim((string) $b['en']), 0, 80);
            $stmt = $pdo->prepare('SELECT * FROM options WHERE kind = ? AND (lower(ka) = lower(?) OR lower(en) = lower(?))');
            $stmt->execute([$kind, $ka, $en]);
            if ($row = $stmt->fetch()) {
                return self::shape($row);
            }
            $key = self::uniqueKey($pdo, $kind, $en);
            $sort = (int) $pdo->query('SELECT COALESCE(MAX(sort), -1) + 1 FROM options WHERE kind = ' . $pdo->quote($kind))->fetchColumn();
            $pdo->prepare('INSERT INTO options (kind, key, ka, en, sort) VALUES (?, ?, ?, ?, ?)')->execute([$kind, $key, $ka, $en, $sort]);
        } elseif ($kind === 'size') {
            $w = (int) $b['width'];
            $h = (int) $b['height'];
            $stmt = $pdo->prepare("SELECT * FROM options WHERE kind = 'size' AND width = ? AND height = ?");
            $stmt->execute([$w, $h]);
            if ($row = $stmt->fetch()) {
                return self::shape($row);
            }
            $pdo->prepare("INSERT INTO options (kind, width, height) VALUES ('size', ?, ?)")->execute([$w, $h]);
        } else {
            $ka = mb_substr(trim((string) $b['ka']), 0, 200);
            $en = mb_substr(trim((string) $b['en']), 0, 200);
            $stmt = $pdo->prepare('SELECT * FROM options WHERE kind = ? AND lower(ka) = lower(?)');
            $stmt->execute([$kind, $ka]);
            if ($row = $stmt->fetch()) {
                return self::shape($row);
            }
            $sort = (int) $pdo->query('SELECT COALESCE(MAX(sort), -1) + 1 FROM options WHERE kind = ' . $pdo->quote($kind))->fetchColumn();
            $pdo->prepare('INSERT INTO options (kind, ka, en, sort) VALUES (?, ?, ?, ?)')->execute([$kind, $ka, $en, $sort]);
        }
        $stmt = $pdo->prepare('SELECT * FROM options WHERE id = ?');
        $stmt->execute([(int) $pdo->lastInsertId()]);
        return self::shape($stmt->fetch());
    }

    /** A key from the English name (latin letters, digits, dashes), unique within its list. */
    private static function uniqueKey(PDO $pdo, string $kind, string $en): string
    {
        $base = substr(Products::slugify($en), 0, 40);
        if ($base === 'product') {
            $base = $kind; // nothing latin to build a key from
        }
        $taken = self::keys($pdo, $kind);
        $key = $base;
        for ($n = 2; in_array($key, $taken, true) || in_array($key, self::RESERVED, true); $n++) {
            $key = "$base-$n";
        }
        return $key;
    }

    /** Why an option can't be deleted (built-in, or still used by products), or null when it can. */
    public static function deleteBlocker(PDO $pdo, int $id): ?string
    {
        $stmt = $pdo->prepare('SELECT * FROM options WHERE id = ?');
        $stmt->execute([$id]);
        $r = $stmt->fetch();
        if (!$r || !in_array($r['kind'], self::KEYED_KINDS, true)) {
            return null;
        }
        if ((int) $r['builtin'] === 1) {
            return 'ძირითადი ვარიანტის წაშლა შეუძლებელია.';
        }
        $col = $r['kind'] === 'type' ? 'category' : 'dimension';
        $used = $pdo->prepare("SELECT COUNT(*) FROM products WHERE $col = ?");
        $used->execute([$r['key']]);
        $n = (int) $used->fetchColumn();
        return $n > 0 ? "„{$r['ka']}“ მითითებულია $n პროდუქტზე. ჯერ მათ შეუცვალეთ." : null;
    }

    public static function delete(PDO $pdo, int $id): bool
    {
        $stmt = $pdo->prepare('DELETE FROM options WHERE id = ?');
        $stmt->execute([$id]);
        return $stmt->rowCount() > 0;
    }

    /** One-time fill from the products already in the database, so nothing has to be re-entered. */
    public static function backfill(PDO $pdo): void
    {
        $done = $pdo->query("SELECT value FROM settings WHERE key = 'options_backfilled'")->fetchColumn();
        if ($done) {
            return;
        }
        foreach (self::TEXT_KINDS as $kind) {
            $rows = $pdo->query("SELECT DISTINCT {$kind}_ka AS ka, {$kind}_en AS en FROM products WHERE {$kind}_ka != '' ORDER BY id")->fetchAll();
            foreach ($rows as $r) {
                self::create($pdo, ['kind' => $kind, 'ka' => $r['ka'], 'en' => $r['en'] !== '' ? $r['en'] : $r['ka']]);
            }
        }
        foreach ($pdo->query('SELECT DISTINCT width_cm, height_cm FROM product_sizes')->fetchAll() as $r) {
            self::create($pdo, ['kind' => 'size', 'width' => (int) $r['width_cm'], 'height' => (int) $r['height_cm']]);
        }
        $pdo->exec("INSERT OR REPLACE INTO settings (key, value) VALUES ('options_backfilled', '1')");
    }
}
