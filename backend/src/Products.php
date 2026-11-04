<?php

final class Products
{
    public const PATTERNS = ['wave', 'dune', 'ripple', 'twist', 'prism', 'mosaic'];
    public const ORIENTATIONS = ['portrait', 'landscape'];
    private const I18N = ['name', 'short', 'description', 'material'];

    /** @return array<int, array> */
    public static function all(PDO $pdo, bool $includeHidden, string $baseUrl): array
    {
        $sql = 'SELECT * FROM products' . ($includeHidden ? '' : ' WHERE published = 1') . ' ORDER BY sort ASC, id ASC';
        $rows = $pdo->query($sql)->fetchAll();
        return array_map(fn ($r) => self::hydrate($pdo, $r, $baseUrl), $rows);
    }

    public static function find(PDO $pdo, string $idOrSlug, bool $includeHidden, string $baseUrl): ?array
    {
        $col = ctype_digit($idOrSlug) ? 'id' : 'slug';
        $stmt = $pdo->prepare("SELECT * FROM products WHERE $col = ?" . ($includeHidden ? '' : ' AND published = 1'));
        $stmt->execute([$idOrSlug]);
        $row = $stmt->fetch();
        return $row ? self::hydrate($pdo, $row, $baseUrl) : null;
    }

    private static function hydrate(PDO $pdo, array $r, string $baseUrl): array
    {
        $sizes = $pdo->prepare('SELECT id, width_cm, height_cm, price FROM product_sizes WHERE product_id = ? ORDER BY sort ASC, id ASC');
        $sizes->execute([$r['id']]);
        $images = $pdo->prepare('SELECT id, path FROM product_images WHERE product_id = ? ORDER BY sort ASC, id ASC');
        $images->execute([$r['id']]);

        $out = [
            'id' => (int) $r['id'],
            'slug' => $r['slug'],
            'pattern' => $r['pattern'],
            'orientation' => $r['orientation'],
            'featured' => (bool) $r['featured'],
            'published' => (bool) $r['published'],
            'sort' => (int) $r['sort'],
            'delivery_days' => ['min' => (int) $r['delivery_days_min'], 'max' => (int) $r['delivery_days_max']],
            'installation_minutes' => (int) $r['installation_minutes'],
            'sizes' => array_map(fn ($s) => [
                'id' => (int) $s['id'],
                'width' => (int) $s['width_cm'],
                'height' => (int) $s['height_cm'],
                'price' => (float) $s['price'],
            ], $sizes->fetchAll()),
            'images' => array_map(fn ($img) => [
                'id' => (int) $img['id'],
                'url' => $baseUrl . $img['path'],
            ], $images->fetchAll()),
            'updated_at' => $r['updated_at'],
        ];
        foreach (self::I18N as $field) {
            $out[$field] = ['ka' => $r[$field . '_ka'], 'en' => $r[$field . '_en']];
        }
        return $out;
    }

    /** Validate an incoming product payload. Returns a list of field errors (empty when valid). */
    public static function validate(array $p): array
    {
        $errors = [];
        if (trim((string) ($p['name']['ka'] ?? '')) === '') {
            $errors['name.ka'] = 'სახელი (ქართულად) სავალდებულოა';
        }
        if (trim((string) ($p['name']['en'] ?? '')) === '') {
            $errors['name.en'] = 'სახელი (ინგლისურად) სავალდებულოა';
        }
        $sizes = $p['sizes'] ?? [];
        if (!is_array($sizes) || count($sizes) === 0) {
            $errors['sizes'] = 'დაამატეთ მინიმუმ ერთი ზომა';
        } else {
            foreach ($sizes as $i => $s) {
                if ((int) ($s['width'] ?? 0) <= 0 || (int) ($s['height'] ?? 0) <= 0) {
                    $errors["sizes.$i"] = 'სიგანე და სიმაღლე უნდა იყოს დადებითი რიცხვი';
                } elseif ((float) ($s['price'] ?? -1) < 0) {
                    $errors["sizes.$i"] = 'ფასი არ შეიძლება იყოს უარყოფითი';
                }
            }
        }
        if (isset($p['orientation']) && !in_array($p['orientation'], self::ORIENTATIONS, true)) {
            $errors['orientation'] = 'აირჩიეთ ტიპი: ვერტიკალური ან ჰორიზონტალური';
        }
        if (isset($p['pattern']) && !in_array($p['pattern'], self::PATTERNS, true)) {
            $errors['pattern'] = 'უცნობი ნიმუში';
        }
        return $errors;
    }

    private static function guessOrientation(array $sizes): string
    {
        $s = $sizes[0] ?? null;
        return $s && (int) $s['height'] > (int) $s['width'] ? 'portrait' : 'landscape';
    }

    public static function slugify(string $text): string
    {
        $slug = strtolower(trim(preg_replace('/[^A-Za-z0-9]+/', '-', $text), '-'));
        return $slug !== '' ? $slug : 'product';
    }

    private static function uniqueSlug(PDO $pdo, string $base, ?int $ignoreId): string
    {
        $slug = $base;
        $n = 2;
        while (true) {
            $stmt = $pdo->prepare('SELECT id FROM products WHERE slug = ?' . ($ignoreId ? ' AND id != ?' : ''));
            $stmt->execute($ignoreId ? [$slug, $ignoreId] : [$slug]);
            if (!$stmt->fetch()) {
                return $slug;
            }
            $slug = $base . '-' . $n++;
        }
    }

    /** Insert or update a product with its sizes. Returns the product id. */
    public static function save(PDO $pdo, array $p, ?int $id = null): int
    {
        $slugSource = trim((string) ($p['slug'] ?? '')) ?: (string) ($p['name']['en'] ?? 'product');
        $slug = self::uniqueSlug($pdo, self::slugify($slugSource), $id);

        $cols = [
            'slug' => $slug,
            'delivery_days_min' => max(0, (int) ($p['delivery_days']['min'] ?? 14)),
            'delivery_days_max' => max(0, (int) ($p['delivery_days']['max'] ?? 21)),
            'installation_minutes' => max(0, min(100000, (int) ($p['installation_minutes']
                ?? (isset($p['installation_days']) ? (int) $p['installation_days'] * 480 : 480)))),
            'pattern' => in_array($p['pattern'] ?? '', self::PATTERNS, true) ? $p['pattern'] : 'wave',
            'orientation' => in_array($p['orientation'] ?? '', self::ORIENTATIONS, true) ? $p['orientation'] : self::guessOrientation($p['sizes'] ?? []),
            'featured' => !empty($p['featured']) ? 1 : 0,
            'published' => array_key_exists('published', $p) ? (!empty($p['published']) ? 1 : 0) : 1,
            'sort' => (int) ($p['sort'] ?? 0),
        ];
        foreach (self::I18N as $field) {
            $cols[$field . '_ka'] = trim((string) ($p[$field]['ka'] ?? ''));
            $cols[$field . '_en'] = trim((string) ($p[$field]['en'] ?? ''));
        }

        if ($id === null) {
            $names = implode(', ', array_keys($cols));
            $marks = implode(', ', array_fill(0, count($cols), '?'));
            $pdo->prepare("INSERT INTO products ($names) VALUES ($marks)")->execute(array_values($cols));
            $id = (int) $pdo->lastInsertId();
        } else {
            $set = implode(', ', array_map(fn ($c) => "$c = ?", array_keys($cols)));
            $pdo->prepare("UPDATE products SET $set, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
                ->execute([...array_values($cols), $id]);
        }

        self::syncSizes($pdo, $id, $p['sizes'] ?? []);
        return $id;
    }

    private static function syncSizes(PDO $pdo, int $productId, array $sizes): void
    {
        $existing = $pdo->prepare('SELECT id FROM product_sizes WHERE product_id = ?');
        $existing->execute([$productId]);
        $keep = [];
        foreach (array_values($sizes) as $i => $s) {
            $sid = isset($s['id']) ? (int) $s['id'] : 0;
            $vals = [(int) $s['width'], (int) $s['height'], round((float) $s['price'], 2), $i];
            if ($sid > 0) {
                $stmt = $pdo->prepare('UPDATE product_sizes SET width_cm = ?, height_cm = ?, price = ?, sort = ? WHERE id = ? AND product_id = ?');
                $stmt->execute([...$vals, $sid, $productId]);
                if ($stmt->rowCount() > 0) {
                    $keep[] = $sid;
                    continue;
                }
            }
            $pdo->prepare('INSERT INTO product_sizes (width_cm, height_cm, price, sort, product_id) VALUES (?, ?, ?, ?, ?)')
                ->execute([...$vals, $productId]);
            $keep[] = (int) $pdo->lastInsertId();
        }
        foreach ($existing->fetchAll(PDO::FETCH_COLUMN) as $oldId) {
            if (!in_array((int) $oldId, $keep, true)) {
                $pdo->prepare('DELETE FROM product_sizes WHERE id = ?')->execute([$oldId]);
            }
        }
    }

    public static function delete(PDO $pdo, int $id, string $uploadDir): bool
    {
        $imgs = $pdo->prepare('SELECT path FROM product_images WHERE product_id = ?');
        $imgs->execute([$id]);
        foreach ($imgs->fetchAll(PDO::FETCH_COLUMN) as $path) {
            self::unlinkUpload($uploadDir, $path);
        }
        $stmt = $pdo->prepare('DELETE FROM products WHERE id = ?');
        $stmt->execute([$id]);
        return $stmt->rowCount() > 0;
    }

    public static function unlinkUpload(string $uploadDir, string $publicPath): void
    {
        $file = $uploadDir . '/' . basename($publicPath);
        if (is_file($file)) {
            @unlink($file);
        }
    }
}
