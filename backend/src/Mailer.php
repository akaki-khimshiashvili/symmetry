<?php

/**
 * Outgoing email.
 *
 * With SMTP configured (SYMMETRY_SMTP_*) messages are sent through that server (Gmail, Zoho, the host's mail…).
 * Without it — e.g. local development — every message is written to backend/data/outbox/ as .eml + .html,
 * so the flow can be tested and the emails opened in a browser or mail app.
 */
final class Mailer
{
    public function __construct(private array $config)
    {
    }

    public function configured(): bool
    {
        return trim((string) $this->config['smtp_host']) !== '';
    }

    /** Sends one message. $to may be one address or a list; $bcc receives a hidden copy. Throws on failure. */
    public function send(string|array $to, string $subject, string $html, string $text, array $bcc = []): string
    {
        $to = array_values(array_filter((array) $to));
        $bcc = array_values(array_filter($bcc, fn ($a) => !in_array($a, $to, true)));
        $from = (string) $this->config['mail_from'];
        $fromName = (string) $this->config['mail_from_name'];
        $boundary = 'b' . bin2hex(random_bytes(12));
        $domain = substr(strrchr($from, '@') ?: '@symmetry.local', 1);

        $headers = [
            'Date: ' . date(DATE_RFC2822),
            'From: ' . self::encodeName($fromName) . " <$from>",
            'To: ' . implode(', ', $to),
            'Subject: ' . self::encodeHeader($subject),
            'Message-ID: <' . bin2hex(random_bytes(12)) . "@$domain>",
            'MIME-Version: 1.0',
            "Content-Type: multipart/alternative; boundary=\"$boundary\"",
        ];
        if ($this->config['mail_reply_to'] !== '') {
            $headers[] = 'Reply-To: ' . $this->config['mail_reply_to'];
        }
        $body = "--$boundary\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n"
            . chunk_split(base64_encode($text))
            . "--$boundary\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n"
            . chunk_split(base64_encode($html))
            . "--$boundary--\r\n";
        $message = implode("\r\n", $headers) . "\r\n\r\n" . $body;

        if (!$this->configured()) {
            return $this->toOutbox($to, $subject, $message, $html);
        }
        $this->smtp($from, array_merge($to, $bcc), $message);
        return 'smtp';
    }

    private function toOutbox(array $to, string $subject, string $message, string $html): string
    {
        $dir = (string) $this->config['mail_outbox'];
        if (!is_dir($dir)) {
            mkdir($dir, 0775, true);
        }
        $stem = date('Ymd-His') . '-' . preg_replace('/[^a-z0-9]+/i', '_', $to[0] ?? 'mail') . '-' . bin2hex(random_bytes(3));
        file_put_contents("$dir/$stem.eml", $message);
        file_put_contents("$dir/$stem.html", $html);
        return "outbox:$stem";
    }

    /** Minimal SMTP client: implicit TLS (port 465) or STARTTLS (587), AUTH LOGIN. */
    private function smtp(string $from, array $rcpts, string $message): void
    {
        $c = $this->config;
        $secure = strtolower((string) $c['smtp_secure']); // 'ssl' | 'tls' | ''
        $host = ($secure === 'ssl' ? 'ssl://' : 'tcp://') . $c['smtp_host'] . ':' . (int) $c['smtp_port'];
        $fp = @stream_socket_client($host, $errno, $errstr, 20);
        if (!$fp) {
            throw new RuntimeException("SMTP connection failed: $errstr ($errno)");
        }
        stream_set_timeout($fp, 20);
        try {
            $this->expect($fp, 220);
            $ehlo = 'EHLO ' . (gethostname() ?: 'localhost');
            $this->cmd($fp, $ehlo, 250);
            if ($secure === 'tls') {
                $this->cmd($fp, 'STARTTLS', 220);
                if (!stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
                    throw new RuntimeException('SMTP STARTTLS failed');
                }
                $this->cmd($fp, $ehlo, 250);
            }
            if ((string) $c['smtp_user'] !== '') {
                $this->cmd($fp, 'AUTH LOGIN', 334);
                $this->cmd($fp, base64_encode((string) $c['smtp_user']), 334);
                $this->cmd($fp, base64_encode((string) $c['smtp_pass']), 235);
            }
            $this->cmd($fp, "MAIL FROM:<$from>", 250);
            foreach ($rcpts as $r) {
                $this->cmd($fp, "RCPT TO:<$r>", [250, 251]);
            }
            $this->cmd($fp, 'DATA', 354);
            // Dot-stuffing: a line starting with "." gets a second one.
            $data = preg_replace('/^\./m', '..', str_replace(["\r\n", "\n"], ["\n", "\r\n"], $message));
            fwrite($fp, $data . "\r\n.\r\n");
            $this->expect($fp, 250);
            $this->cmd($fp, 'QUIT', 221);
        } finally {
            fclose($fp);
        }
    }

    private function cmd($fp, string $line, int|array $code): void
    {
        fwrite($fp, $line . "\r\n");
        $this->expect($fp, $code);
    }

    private function expect($fp, int|array $codes): void
    {
        $reply = '';
        while (($line = fgets($fp, 1024)) !== false) {
            $reply .= $line;
            if (strlen($line) < 4 || $line[3] !== '-') {
                break; // last line of a (multi-line) reply
            }
        }
        if (!in_array((int) substr($reply, 0, 3), (array) $codes, true)) {
            throw new RuntimeException('SMTP error: ' . trim($reply ?: 'no reply'));
        }
    }

    private static function encodeHeader(string $s): string
    {
        return preg_match('/[^\x20-\x7e]/', $s) ? '=?UTF-8?B?' . base64_encode($s) . '?=' : $s;
    }

    private static function encodeName(string $s): string
    {
        return preg_match('/[^\x20-\x7e]/', $s) ? self::encodeHeader($s) : '"' . addcslashes($s, '"\\') . '"';
    }
}

/**
 * The receipt email: sent to the customer once for every payment status that has a receipt
 * (authorised → accepted / declined → refunded / expired), with a hidden copy to the store if configured.
 */
final class ReceiptMail
{
    private const TEXT = [
        'ka' => [
            'subject' => [
                'held' => 'გადახდა ავტორიზებულია — შეკვეთა {n}',
                'captured' => 'შეკვეთა დადასტურებულია — ქვითარი {n}',
                'released' => 'შეკვეთა უარყოფილია, თანხა გათავისუფლდა — {n}',
                'refunded' => 'თანხა დაბრუნებულია — შეკვეთა {n}',
                'expired' => 'ავტორიზაციის ვადა ამოიწურა — შეკვეთა {n}',
            ],
            'lead' => [
                'held' => 'მადლობა შეკვეთისთვის! თანხა თქვენს ბარათზე დაბლოკილია, მაგრამ ჯერ არ ჩამოჭრილა. შეკვეთას გადავამოწმებთ და დაგიკავშირდებით — თანხა ჩამოიჭრება მხოლოდ დადასტურების შემდეგ.',
                'captured' => 'თქვენი შეკვეთა დადასტურებულია და გადახდა დასრულდა. მალე დაგიკავშირდებით მიწოდებისა და მონტაჟის დეტალების შესათანხმებლად.',
                'released' => 'სამწუხაროდ, ამ შეკვეთას ვერ შევასრულებთ. დაბლოკილი თანხა გათავისუფლდა და ბარათიდან არაფერი ჩამოჭრილა. ბანკის მიხედვით, ბლოკი აპლიკაციიდან შეიძლება რამდენიმე დღეში გაქრეს.',
                'refunded' => 'თანხა დაბრუნდა თქვენს ბარათზე. ასახვას შეიძლება რამდენიმე სამუშაო დღე დასჭირდეს.',
                'expired' => 'გადახდის ავტორიზაციის ვადა ამოიწურა. ბარათიდან არაფერი ჩამოჭრილა.',
            ],
            'hello' => 'გამარჯობა, {name}!',
            'number' => 'ქვითრის №', 'item' => 'პროდუქტი', 'amount' => 'თანხა', 'card' => 'ბარათი', 'sale' => 'ფასდაკლება',
            'code' => 'გადამოწმების კოდი', 'open' => 'ქვითრის ნახვა და ჩამოტვირთვა', 'verify' => 'ქვითრის ნამდვილობის შემოწმება',
            'test' => 'სატესტო გადახდა — რეალური თანხა არ მოძრაობს.',
            'footer' => 'კითხვების შემთხვევაში უბრალოდ უპასუხეთ ამ წერილს.',
            'disclaimer' => 'ეს წერილი ადასტურებს ონლაინ გადახდას და არ წარმოადგენს საგადასახადო ანგარიშ-ფაქტურას.',
        ],
        'en' => [
            'subject' => [
                'held' => 'Payment authorised — order {n}',
                'captured' => 'Order confirmed — receipt {n}',
                'released' => 'Order declined, hold released — {n}',
                'refunded' => 'Refund issued — order {n}',
                'expired' => 'Authorisation expired — order {n}',
            ],
            'lead' => [
                'held' => 'Thank you for your order! The amount is on hold on your card but has not been charged. We’ll review your order and get in touch — you’re only charged once we confirm it.',
                'captured' => 'Your order is confirmed and the payment is complete. We’ll be in touch shortly to arrange delivery and installation.',
                'released' => 'Sorry, we’re unable to take this order. The hold on your card has been released and nothing was charged. Depending on your bank, it may take a few days to disappear from your banking app.',
                'refunded' => 'The amount has been returned to your card. It can take a few business days to show.',
                'expired' => 'The payment authorisation expired. Nothing was charged.',
            ],
            'hello' => 'Hello {name},',
            'number' => 'Receipt no.', 'item' => 'Item', 'amount' => 'Amount', 'card' => 'Card', 'sale' => 'Sale',
            'code' => 'Verification code', 'open' => 'View and download the receipt', 'verify' => 'Check this receipt is genuine',
            'test' => 'Test payment — no real money moves.',
            'footer' => 'Questions? Just reply to this email.',
            'disclaimer' => 'This email confirms an online payment. It is not a tax invoice.',
        ],
    ];

    /**
     * Sends the receipt for the order's current status, unless it was already sent for that status.
     * Never throws: a mail problem must not break a payment step. Returns true when a message went out.
     */
    public static function notify(PDO $pdo, array $config, array $o, bool $force = false): bool
    {
        if (!Receipts::has($o) || trim((string) $o['email']) === '') {
            return false;
        }
        $sent = array_filter(explode(',', (string) $o['receipt_emailed']));
        if (!$force && in_array($o['payment_status'], $sent, true)) {
            return false;
        }
        try {
            [$subject, $html, $text] = self::compose($pdo, $config, $o);
            $bcc = array_filter([trim((string) $config['mail_copy_to'])]);
            $via = (new Mailer($config))->send($o['email'], $subject, $html, $text, $bcc);
            $sent[] = $o['payment_status'];
            $pdo->prepare('UPDATE orders SET receipt_emailed = ?, receipt_emailed_at = CURRENT_TIMESTAMP WHERE id = ?')
                ->execute([implode(',', array_unique($sent)), $o['id']]);
            Payments::log($pdo, (int) $o['id'], 'email', ['status' => $o['payment_status'], 'to' => $o['email'], 'via' => $via]);
            return true;
        } catch (Throwable $e) {
            error_log('[symmetry] receipt email for order ' . $o['id'] . ': ' . $e->getMessage());
            Payments::log($pdo, (int) $o['id'], 'email_error', ['status' => $o['payment_status'], 'error' => $e->getMessage()]);
            return false;
        }
    }

    private static function compose(PDO $pdo, array $config, array $o): array
    {
        $r = Receipts::full($pdo, $config, $o);
        $lang = $o['lang'] === 'en' ? 'en' : 'ka';
        $t = self::TEXT[$lang];
        $st = $r['status'];
        $e = fn ($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
        // "GEL", not "₾": many email fonts have no glyph for the lari sign.
        $money = number_format((float) $r['amount'], 2, '.', ' ') . ' GEL';
        $site = rtrim($config['site_url'], '/') . ($lang === 'en' ? '/en' : '');
        $receiptUrl = $site . '/receipt/?t=' . $o['pay_token'];
        $subject = str_replace('{n}', $r['number'], $t['subject'][$st]);
        $hello = str_replace('{name}', $o['first_name'], $t['hello']);
        $rows = [
            [$t['number'], $r['number']],
            [$t['item'], $r['item']['product'] . ' · ' . $r['item']['size']],
            [$t['amount'], $money],
        ];
        if (!empty($r['list_price'])) {
            $rows[] = [$t['sale'], '−' . $r['sale_percent'] . '% (' . number_format((float) $r['list_price'], 2, '.', ' ') . ' GEL → ' . $money . ')'];
        }
        if ($r['card'] !== '') {
            $rows[] = [$t['card'], $r['card']];
        }
        $rows[] = [$t['code'], $r['code']];
        $accent = ['captured' => '#2f7a44', 'held' => '#8a6a3f'][$st] ?? '#8d8579';

        $rowsHtml = '';
        foreach ($rows as [$k, $v]) {
            $rowsHtml .= '<tr><td style="padding:10px 0;border-bottom:1px solid #eee8df;color:#6f665b;font-size:13px;width:40%">' . $e($k)
                . '</td><td style="padding:10px 0;border-bottom:1px solid #eee8df;font-size:14px;font-weight:600;color:#1b1712">' . $e($v) . '</td></tr>';
        }
        $test = $r['test'] ? '<p style="margin:0 0 16px;padding:8px 12px;border:1px dashed #b9ab97;border-radius:8px;font-size:13px;color:#5c544a">' . $e($t['test']) . '</p>' : '';
        $html = '<!doctype html><html lang="' . $lang . '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>' . $e($subject) . '</title></head>'
            . '<body style="margin:0;padding:24px 12px;background:#f1ebe1;font-family:Arial,Helvetica,sans-serif;color:#1b1712">'
            . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">'
            . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;border:1px solid #ddd5ca">'
            . '<tr><td style="padding:28px 28px 8px"><p style="margin:0;font-weight:700;letter-spacing:.06em;color:#6f665b;font-size:13px">SYMMETRY</p>'
            . '<h1 style="margin:6px 0 0;font-size:22px;line-height:1.3;color:#1b1712">' . $e($subject) . '</h1></td></tr>'
            . '<tr><td style="padding:16px 28px 0"><p style="margin:0 0 8px;font-size:15px">' . $e($hello) . '</p>'
            . '<p style="margin:0 0 18px;font-size:15px;line-height:1.6;padding:12px 14px;background:#f4efe7;border-left:4px solid ' . $accent . ';border-radius:6px">' . $e($t['lead'][$st]) . '</p>'
            . $test
            . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' . $rowsHtml . '</table></td></tr>'
            . '<tr><td style="padding:22px 28px 6px"><a href="' . $e($receiptUrl) . '" style="display:inline-block;background:#2a1a12;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:13px 20px;border-radius:10px">' . $e($t['open']) . '</a></td></tr>'
            . '<tr><td style="padding:8px 28px 0"><a href="' . $e($r['verify_url']) . '" style="color:#6b4a2b;font-size:13px">' . $e($t['verify']) . '</a></td></tr>'
            . '<tr><td style="padding:22px 28px 28px;color:#6f665b;font-size:12px;line-height:1.6">' . $e($t['footer']) . '<br>' . $e($t['disclaimer']) . '</td></tr>'
            . '</table></td></tr></table></body></html>';

        $text = $subject . "\n\n" . $hello . "\n\n" . $t['lead'][$st] . "\n\n"
            . ($r['test'] ? $t['test'] . "\n\n" : '')
            . implode("\n", array_map(fn ($row) => $row[0] . ': ' . $row[1], $rows)) . "\n\n"
            . $t['open'] . ': ' . $receiptUrl . "\n" . $t['verify'] . ': ' . $r['verify_url'] . "\n\n"
            . $t['footer'] . "\n" . $t['disclaimer'] . "\n";
        return [$subject, $html, $text];
    }
}
