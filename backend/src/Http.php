<?php

final class HttpError extends Exception
{
    public function __construct(public int $status, string $message, public array $fields = [])
    {
        parent::__construct($message);
    }
}

final class Http
{
    public static function cors(array $allowed, bool $allowLocal = false): void
    {
        $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
        $ok = in_array($origin, $allowed, true)
            // Development: any local port (Vite moves to 5174, 5175… when 5173 is taken).
            || ($allowLocal && preg_match('#^http://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$#', $origin));
        if ($origin !== '' && $ok) {
            header('Access-Control-Allow-Origin: ' . $origin);
            header('Vary: Origin');
            header('Access-Control-Allow-Headers: Content-Type, Authorization');
            header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');
            header('Access-Control-Max-Age: 600');
        }
    }

    public static function json(mixed $data, int $status = 200): never
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        // The API only ever answers with JSON: never sniffed as anything else, never framed, never a document
        // that could load or run anything.
        header('X-Content-Type-Options: nosniff');
        header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'");
        header('X-Frame-Options: DENY');
        header('Referrer-Policy: no-referrer');
        echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;
    }

    public static function body(): array
    {
        $raw = file_get_contents('php://input');
        if ($raw === '' || $raw === false) {
            return [];
        }
        $data = json_decode($raw, true);
        if (!is_array($data)) {
            throw new HttpError(400, 'Invalid JSON body');
        }
        return $data;
    }

    public static function baseUrl(array $config): string
    {
        if ($config['public_url'] !== '') {
            return rtrim($config['public_url'], '/');
        }
        $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
            || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
        return ($https ? 'https' : 'http') . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost');
    }

    /**
     * The client's address, for rate limits. REMOTE_ADDR unless the API sits behind a reverse proxy that the
     * operator vouches for (SYMMETRY_TRUST_PROXY=1): then the last X-Forwarded-For entry, the one that proxy added.
     */
    public static function clientIp(array $config): string
    {
        $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? '');
        if (!empty($config['trust_proxy']) && !empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
            $hops = array_values(array_filter(array_map('trim', explode(',', (string) $_SERVER['HTTP_X_FORWARDED_FOR']))));
            $last = end($hops);
            if ($last !== false && filter_var($last, FILTER_VALIDATE_IP)) {
                $ip = $last;
            }
        }
        return $ip;
    }

    public static function bearer(): string
    {
        $h = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
        if ($h === '' && function_exists('getallheaders')) {
            foreach (getallheaders() as $k => $v) {
                if (strcasecmp($k, 'Authorization') === 0) {
                    $h = $v;
                }
            }
        }
        return preg_match('/^Bearer\s+(\S+)$/i', $h, $m) ? $m[1] : '';
    }
}

/**
 * Failed-attempt limits per client address, kept in SQLite (no extra service). Addresses are stored only as
 * a keyed hash and only for the length of the window.
 * Replaces the old sleep-on-failure, which slowed nobody down (requests run in parallel) but held a PHP
 * worker for every bad attempt, so a few requests a second could stall the whole API.
 */
final class RateLimit
{
    public static function migrate(PDO $pdo): void
    {
        $pdo->exec('CREATE TABLE IF NOT EXISTS rate_limits (bucket TEXT NOT NULL, client TEXT NOT NULL, at INTEGER NOT NULL)');
        $pdo->exec('CREATE INDEX IF NOT EXISTS rate_limits_lookup ON rate_limits(bucket, client, at)');
    }

    /** Keyed with this install's server-side secret, so stored values can't be turned back into addresses. */
    private static function client(PDO $pdo, array $config, string $bucket): string
    {
        return hash_hmac('sha256', $bucket . '|' . Http::clientIp($config), Receipts::secret($pdo, $config));
    }

    /** Throws 429 when this client already has $max failures within the last $window seconds. */
    public static function guard(PDO $pdo, array $config, string $bucket, int $max, int $window): void
    {
        $pdo->prepare('DELETE FROM rate_limits WHERE at < ?')->execute([time() - 86400]);
        $stmt = $pdo->prepare('SELECT COUNT(*), MIN(at) FROM rate_limits WHERE bucket = ? AND client = ? AND at >= ?');
        $stmt->execute([$bucket, self::client($pdo, $config, $bucket), time() - $window]);
        [$count, $first] = $stmt->fetch(PDO::FETCH_NUM);
        if ((int) $count >= $max) {
            header('Retry-After: ' . max(1, (int) $first + $window - time()));
            throw new HttpError(429, 'ძალიან ბევრი მცდელობა. სცადეთ მოგვიანებით.');
        }
    }

    public static function fail(PDO $pdo, array $config, string $bucket): void
    {
        $pdo->prepare('INSERT INTO rate_limits (bucket, client, at) VALUES (?, ?, ?)')->execute([$bucket, self::client($pdo, $config, $bucket), time()]);
    }

    public static function clear(PDO $pdo, array $config, string $bucket): void
    {
        $pdo->prepare('DELETE FROM rate_limits WHERE bucket = ? AND client = ?')->execute([$bucket, self::client($pdo, $config, $bucket)]);
    }
}

final class Auth
{
    /** The development password from config.php / README. Public, so never accepted once the API is deployed. */
    public const DEFAULT_PASSWORD = 'symmetry-admin';
    /** Failed logins allowed per client address in LOGIN_WINDOW seconds. */
    private const LOGIN_MAX = 8;
    private const LOGIN_WINDOW = 900;

    public static function login(PDO $pdo, array $config, string $username, string $password): string
    {
        // Deployed (SYMMETRY_ORIGINS set) without a real password: refuse rather than accept the published default.
        if ($config['admin_password_hash'] === '' && (string) $config['admin_password'] === self::DEFAULT_PASSWORD && empty($config['allow_local_origins'])) {
            error_log('[symmetry] admin login refused: set SYMMETRY_ADMIN_HASH (the default password is public)');
            throw new HttpError(503, 'ადმინის პაროლი არ არის დაყენებული (SYMMETRY_ADMIN_HASH). მიმართეთ დეველოპერს.');
        }
        RateLimit::guard($pdo, $config, 'login', self::LOGIN_MAX, self::LOGIN_WINDOW);
        // Check both parts every time so a wrong username and a wrong password take the same path.
        $userOk = hash_equals(mb_strtolower((string) $config['admin_username']), mb_strtolower(trim($username)));
        $passOk = $config['admin_password_hash'] !== ''
            ? password_verify($password, $config['admin_password_hash'])
            : hash_equals((string) $config['admin_password'], $password);
        if (!($userOk && $passOk)) {
            RateLimit::fail($pdo, $config, 'login');
            throw new HttpError(401, 'მომხმარებელი ან პაროლი არასწორია');
        }
        RateLimit::clear($pdo, $config, 'login');
        $pdo->prepare('DELETE FROM tokens WHERE expires_at < ?')->execute([time()]);
        $token = bin2hex(random_bytes(32));
        $pdo->prepare('INSERT INTO tokens (token, expires_at) VALUES (?, ?)')
            ->execute([hash('sha256', $token), time() + $config['token_ttl']]);
        return $token;
    }

    public static function require(PDO $pdo): void
    {
        $token = Http::bearer();
        if ($token === '') {
            throw new HttpError(401, 'ავტორიზაცია საჭიროა');
        }
        $stmt = $pdo->prepare('SELECT expires_at FROM tokens WHERE token = ?');
        $stmt->execute([hash('sha256', $token)]);
        $exp = $stmt->fetchColumn();
        if ($exp === false || (int) $exp < time()) {
            throw new HttpError(401, 'სესია ამოიწურა, გთხოვთ თავიდან შეხვიდეთ');
        }
    }

    public static function logout(PDO $pdo): void
    {
        $pdo->prepare('DELETE FROM tokens WHERE token = ?')->execute([hash('sha256', Http::bearer())]);
    }
}

final class Leads
{
    public const CLIENT_TYPES = ['restaurant', 'office', 'designer', 'hotel', 'individual', 'other'];
    public const CHANNELS = ['whatsapp', 'email', 'phone'];

    /** Shared validation for contact messages and order requests. */
    public static function validate(array $b): array
    {
        $errors = [];
        foreach (['first_name', 'phone'] as $f) {
            if (trim((string) ($b[$f] ?? '')) === '') {
                $errors[$f] = 'required';
            }
        }
        $phone = preg_replace('/[\s\-()]/', '', (string) ($b['phone'] ?? ''));
        if ($phone !== '' && !preg_match('/^\+?\d{7,15}$/', $phone)) {
            $errors['phone'] = 'invalid';
        }
        if (!in_array($b['client_type'] ?? '', self::CLIENT_TYPES, true)) {
            $errors['client_type'] = 'required';
        }
        if (!in_array($b['channel'] ?? '', self::CHANNELS, true)) {
            $errors['channel'] = 'required';
        }
        $email = trim((string) ($b['email'] ?? ''));
        if (($b['channel'] ?? '') === 'email' && $email === '') {
            $errors['email'] = 'required';
        } elseif ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $errors['email'] = 'invalid';
        }
        if (mb_strlen((string) ($b['message'] ?? '')) > 4000) {
            $errors['message'] = 'too_long';
        }
        return $errors;
    }

    public static function clean(array $b): array
    {
        return [
            'first_name' => mb_substr(trim((string) $b['first_name']), 0, 120),
            'last_name' => mb_substr(trim((string) ($b['last_name'] ?? '')), 0, 120), // no longer asked; kept for old rows
            'phone' => mb_substr(trim((string) $b['phone']), 0, 40),
            'email' => mb_substr(trim((string) ($b['email'] ?? '')), 0, 200),
            'client_type' => (string) $b['client_type'],
            'channel' => (string) $b['channel'],
            'message' => mb_substr(trim((string) ($b['message'] ?? '')), 0, 4000),
            'lang' => ($b['lang'] ?? 'ka') === 'en' ? 'en' : 'ka',
        ];
    }
}
