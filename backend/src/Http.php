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
    public static function cors(array $allowed): void
    {
        $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
        if ($origin !== '' && in_array($origin, $allowed, true)) {
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

final class Auth
{
    public static function login(PDO $pdo, array $config, string $password): string
    {
        $ok = $config['admin_password_hash'] !== ''
            ? password_verify($password, $config['admin_password_hash'])
            : hash_equals((string) $config['admin_password'], $password);
        if (!$ok) {
            usleep(400000);
            throw new HttpError(401, 'პაროლი არასწორია');
        }
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
        foreach (['first_name', 'last_name', 'phone'] as $f) {
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
            'last_name' => mb_substr(trim((string) $b['last_name']), 0, 120),
            'phone' => mb_substr(trim((string) $b['phone']), 0, 40),
            'email' => mb_substr(trim((string) ($b['email'] ?? '')), 0, 200),
            'client_type' => (string) $b['client_type'],
            'channel' => (string) $b['channel'],
            'message' => mb_substr(trim((string) ($b['message'] ?? '')), 0, 4000),
            'lang' => ($b['lang'] ?? 'ka') === 'en' ? 'en' : 'ka',
        ];
    }
}
