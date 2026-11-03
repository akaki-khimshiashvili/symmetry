<?php

final class Db
{
    private static ?PDO $pdo = null;

    public static function get(array $config): PDO
    {
        if (self::$pdo) {
            return self::$pdo;
        }
        $dir = dirname($config['db_path']);
        if (!is_dir($dir)) {
            mkdir($dir, 0775, true);
        }
        $fresh = !is_file($config['db_path']);
        $pdo = new PDO('sqlite:' . $config['db_path']);
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
        $pdo->exec('PRAGMA foreign_keys = ON');
        $pdo->exec('PRAGMA journal_mode = WAL');
        self::migrate($pdo);
        if ($fresh) {
            self::seed($pdo, $config['seed_path']);
        }
        return self::$pdo = $pdo;
    }

    private static function migrate(PDO $pdo): void
    {
        $pdo->exec(<<<SQL
CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    name_ka TEXT NOT NULL DEFAULT '',
    name_en TEXT NOT NULL DEFAULT '',
    short_ka TEXT NOT NULL DEFAULT '',
    short_en TEXT NOT NULL DEFAULT '',
    description_ka TEXT NOT NULL DEFAULT '',
    description_en TEXT NOT NULL DEFAULT '',
    material_ka TEXT NOT NULL DEFAULT '',
    material_en TEXT NOT NULL DEFAULT '',
    installation_ka TEXT NOT NULL DEFAULT '',
    installation_en TEXT NOT NULL DEFAULT '',
    delivery_days_min INTEGER NOT NULL DEFAULT 14,
    delivery_days_max INTEGER NOT NULL DEFAULT 21,
    installation_days INTEGER NOT NULL DEFAULT 1,
    pattern TEXT NOT NULL DEFAULT 'wave',
    orientation TEXT NOT NULL DEFAULT 'landscape',
    featured INTEGER NOT NULL DEFAULT 0,
    published INTEGER NOT NULL DEFAULT 1,
    sort INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS product_sizes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    width_mm INTEGER NOT NULL,
    height_mm INTEGER NOT NULL,
    price REAL NOT NULL,
    sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS product_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER,
    size_id INTEGER,
    product_name TEXT NOT NULL DEFAULT '',
    size_label TEXT NOT NULL DEFAULT '',
    price REAL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT NOT NULL DEFAULT '',
    client_type TEXT NOT NULL DEFAULT '',
    channel TEXT NOT NULL DEFAULT 'whatsapp',
    message TEXT NOT NULL DEFAULT '',
    lang TEXT NOT NULL DEFAULT 'ka',
    status TEXT NOT NULL DEFAULT 'new',
    payment_status TEXT NOT NULL DEFAULT 'unpaid',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT NOT NULL DEFAULT '',
    client_type TEXT NOT NULL DEFAULT '',
    channel TEXT NOT NULL DEFAULT 'whatsapp',
    intent TEXT NOT NULL DEFAULT '',
    message TEXT NOT NULL DEFAULT '',
    lang TEXT NOT NULL DEFAULT 'ka',
    status TEXT NOT NULL DEFAULT 'new',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS tokens (
    token TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
);
SQL);
        // Upgrade databases created before product types existed.
        $cols = array_column($pdo->query('PRAGMA table_info(products)')->fetchAll(), 'name');
        if (!in_array('orientation', $cols, true)) {
            $pdo->exec("ALTER TABLE products ADD COLUMN orientation TEXT NOT NULL DEFAULT 'landscape'");
        }
    }

    private static function seed(PDO $pdo, string $seedPath): void
    {
        if (!is_file($seedPath)) {
            return;
        }
        $seed = json_decode((string) file_get_contents($seedPath), true);
        if (!is_array($seed)) {
            return;
        }
        $pdo->beginTransaction();
        foreach ($seed['settings'] ?? [] as $key => $value) {
            $stmt = $pdo->prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
            $stmt->execute([$key, (string) $value]);
        }
        foreach ($seed['products'] ?? [] as $i => $p) {
            Products::save($pdo, $p + ['sort' => $i]);
        }
        $pdo->commit();
    }
}
