<?php

/**
 * Reusable dropdown options for the product editor (material, size presets).
 * Text options are bilingual (both languages required); sizes are width × height in centimetres.
 */
final class Options
{
    public const TEXT_KINDS = ['material'];
    public const KINDS = ['material', 'size'];
    private const MAX_CM = 2000;

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
        return $r['kind'] === 'size'
            ? ['id' => (int) $r['id'], 'width' => (int) $r['width'], 'height' => (int) $r['height']]
            : ['id' => (int) $r['id'], 'ka' => $r['ka'], 'en' => $r['en']];
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
        if ($kind === 'size') {
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
