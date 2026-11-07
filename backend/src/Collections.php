<?php

/**
 * Home-page collection cards (the slider under "კოლექცია"). Each card points at a product type:
 * it links to the catalogue filtered by that type and shows how many products it has, or, while
 * the type has none, leads to the contact page as a custom project. Title, text and the cover photo
 * (already cropped to 4:5 in the admin) are the card's own; cards can be hidden and reordered.
 */
final class Collections
{
    /** The three cards the site showed before collections lived in the database. */
    private const STARTERS = [
        ['mirror', 'სარკე', 'Mirrors', 'სარკეები პარამეტრული ხის ჩარჩოთი: ტალღა, რომელიც სივრცეს ირეკლავს.', 'Mirrors in a parametric wooden frame: a wave that reflects the room.'],
        ['shelf', 'თაროები', 'Shelves', 'პარამეტრული კედლის თაროები: სკულპტურა, რომელზეც ნივთებიც დაიდება.', 'Parametric wall shelves: a sculpture you can put things on.'],
        ['wall', 'მთლიანი კედელი', 'Whole walls', 'მთელი კედლის პარამეტრული ინსტალაცია: ერთიანი ტალღა იატაკიდან ჭერამდე.', 'A parametric installation across an entire wall: one continuous wave, floor to ceiling.'],
    ];

    public static function migrate(PDO $pdo): void
    {
        $pdo->exec(<<<SQL
CREATE TABLE IF NOT EXISTS collections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type_key TEXT NOT NULL,
    title_ka TEXT NOT NULL DEFAULT '',
    title_en TEXT NOT NULL DEFAULT '',
    text_ka TEXT NOT NULL DEFAULT '',
    text_en TEXT NOT NULL DEFAULT '',
    image TEXT NOT NULL DEFAULT '',
    published INTEGER NOT NULL DEFAULT 1,
    sort INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
SQL);
        // Once: create the three original cards, carrying over the cover photos saved in settings.
        if ($pdo->query("SELECT 1 FROM settings WHERE key = 'collections_seeded'")->fetchColumn()) {
            return;
        }
        $old = $pdo->query("SELECT key, value FROM settings WHERE key LIKE 'collection\\_%' ESCAPE '\\'")->fetchAll(PDO::FETCH_KEY_PAIR);
        $add = $pdo->prepare('INSERT INTO collections (type_key, title_ka, title_en, text_ka, text_en, image, sort) VALUES (?, ?, ?, ?, ?, ?, ?)');
        foreach (self::STARTERS as $i => [$key, $tka, $ten, $dka, $den]) {
            $add->execute([$key, $tka, $ten, $dka, $den, (string) ($old['collection_' . $key] ?? ''), $i]);
        }
        $pdo->exec("DELETE FROM settings WHERE key IN ('collection_mirror', 'collection_shelf', 'collection_wall')");
        $pdo->exec("INSERT OR REPLACE INTO settings (key, value) VALUES ('collections_seeded', '1')");
    }

    /** @return array<int, array> in display order; the public list leaves out hidden cards. */
    public static function all(PDO $pdo, string $base, bool $hidden): array
    {
        $sql = 'SELECT * FROM collections' . ($hidden ? '' : ' WHERE published = 1') . ' ORDER BY sort ASC, id ASC';
        return array_map(fn ($r) => self::shape($r, $base), $pdo->query($sql)->fetchAll());
    }

    public static function find(PDO $pdo, int $id, string $base): ?array
    {
        $stmt = $pdo->prepare('SELECT * FROM collections WHERE id = ?');
        $stmt->execute([$id]);
        $r = $stmt->fetch();
        return $r ? self::shape($r, $base) : null;
    }

    private static function shape(array $r, string $base): array
    {
        return [
            'id' => (int) $r['id'],
            'type' => $r['type_key'],
            'title' => ['ka' => $r['title_ka'], 'en' => $r['title_en']],
            'text' => ['ka' => $r['text_ka'], 'en' => $r['text_en']],
            'image' => $r['image'] !== '' ? $base . $r['image'] : '',
            'published' => (bool) $r['published'],
            'sort' => (int) $r['sort'],
        ];
    }

    public static function validate(PDO $pdo, array $b): array
    {
        $errors = [];
        if (!in_array((string) ($b['type'] ?? ''), Options::keys($pdo, 'type'), true)) {
            $errors['type'] = 'აირჩიეთ პროდუქტის ტიპი';
        }
        if (trim((string) ($b['title']['ka'] ?? '')) === '') {
            $errors['title_ka'] = 'სათაური სავალდებულოა';
        }
        if (trim((string) ($b['title']['en'] ?? '')) === '') {
            $errors['title_en'] = 'ინგლისური სათაური სავალდებულოა';
        }
        foreach (['ka', 'en'] as $l) {
            if (mb_strlen(trim((string) ($b['title'][$l] ?? ''))) > self::TITLE_MAX) {
                $errors["title_$l"] = 'მაქსიმუმ ' . self::TITLE_MAX . ' სიმბოლო';
            }
            if (mb_strlen(trim((string) ($b['text'][$l] ?? ''))) > self::TEXT_MAX) {
                $errors["text_$l"] = 'მაქსიმუმ ' . self::TEXT_MAX . ' სიმბოლო';
            }
        }
        return $errors;
    }

    /** Card text limits (characters): longer text would break the slider's even rows. Same limits in the admin form. */
    public const TITLE_MAX = 40;
    public const TEXT_MAX = 120;

    /** Insert (new cards go last) or update the text fields; the photo has its own routes. */
    public static function save(PDO $pdo, array $b, ?int $id = null): int
    {
        $t = fn (string $v, int $max) => mb_substr(trim($v), 0, $max);
        $vals = [
            (string) $b['type'],
            $t((string) $b['title']['ka'], self::TITLE_MAX), $t((string) $b['title']['en'], self::TITLE_MAX),
            $t((string) ($b['text']['ka'] ?? ''), self::TEXT_MAX), $t((string) ($b['text']['en'] ?? ''), self::TEXT_MAX),
            !array_key_exists('published', $b) || !empty($b['published']) ? 1 : 0,
        ];
        if ($id) {
            $pdo->prepare('UPDATE collections SET type_key = ?, title_ka = ?, title_en = ?, text_ka = ?, text_en = ?, published = ? WHERE id = ?')
                ->execute([...$vals, $id]);
            return $id;
        }
        $sort = (int) $pdo->query('SELECT COALESCE(MAX(sort), -1) + 1 FROM collections')->fetchColumn();
        $pdo->prepare('INSERT INTO collections (type_key, title_ka, title_en, text_ka, text_en, published, sort) VALUES (?, ?, ?, ?, ?, ?, ?)')
            ->execute([...$vals, $sort]);
        return (int) $pdo->lastInsertId();
    }

    /** @param int[] $ids every card, in the new order */
    public static function reorder(PDO $pdo, array $ids): void
    {
        $stmt = $pdo->prepare('UPDATE collections SET sort = ? WHERE id = ?');
        foreach (array_values($ids) as $i => $id) {
            $stmt->execute([$i, (int) $id]);
        }
    }

    /** The stored (relative) photo path, '' when none; null when the card doesn't exist. */
    public static function imagePath(PDO $pdo, int $id): ?string
    {
        $stmt = $pdo->prepare('SELECT image FROM collections WHERE id = ?');
        $stmt->execute([$id]);
        $v = $stmt->fetchColumn();
        return $v === false ? null : (string) $v;
    }

    public static function setImage(PDO $pdo, int $id, string $path): void
    {
        $pdo->prepare('UPDATE collections SET image = ? WHERE id = ?')->execute([$path, $id]);
    }

    public static function delete(PDO $pdo, int $id): void
    {
        $pdo->prepare('DELETE FROM collections WHERE id = ?')->execute([$id]);
    }
}
