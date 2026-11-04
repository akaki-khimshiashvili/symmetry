<?php

/**
 * Upload optimisation: every product photo is stored as WebP.
 *
 * - Phone photos are turned upright from their EXIF orientation.
 * - Anything larger than MAX_EDGE on its longest side is scaled down (high-quality resampling);
 *   2560 px still covers a full-width retina display, and it is where most of the bytes go.
 * - Encoded at QUALITY 85: visually indistinguishable from the source for photographs, typically
 *   60–90 % smaller than a camera JPEG. Transparency in PNGs is kept.
 * - If the result would be larger than the upload (an already-small WebP), the original bytes are kept.
 */
final class Images
{
    public const MAX_EDGE = 2560;
    public const QUALITY = 85;

    public static function supported(): bool
    {
        return function_exists('imagewebp') && function_exists('imagecreatefromjpeg');
    }

    /** Convert $src (of the given MIME type) to an optimised WebP at $dest. Throws on unreadable images. */
    public static function toWebp(string $src, string $mime, string $dest): void
    {
        $img = match ($mime) {
            'image/jpeg' => @imagecreatefromjpeg($src),
            'image/png' => @imagecreatefrompng($src),
            'image/webp' => @imagecreatefromwebp($src),
            'image/avif' => function_exists('imagecreatefromavif') ? @imagecreatefromavif($src) : false,
            default => false,
        };
        if (!$img) {
            throw new RuntimeException('სურათის წაკითხვა ვერ მოხერხდა');
        }

        if (!imageistruecolor($img)) {
            imagepalettetotruecolor($img);
        }
        if ($mime === 'image/jpeg') {
            $img = self::orient($img, $src);
        }

        $w = imagesx($img);
        $h = imagesy($img);
        $scaled = false;
        $longest = max($w, $h);
        if ($longest > self::MAX_EDGE) {
            $k = self::MAX_EDGE / $longest;
            $nw = max(1, (int) round($w * $k));
            $nh = max(1, (int) round($h * $k));
            $out = imagecreatetruecolor($nw, $nh);
            imagealphablending($out, false);
            imagesavealpha($out, true);
            imagefill($out, 0, 0, imagecolorallocatealpha($out, 0, 0, 0, 127));
            imagecopyresampled($out, $img, 0, 0, 0, 0, $nw, $nh, $w, $h);
            imagedestroy($img);
            $img = $out;
            $scaled = true;
        }

        imagealphablending($img, false);
        imagesavealpha($img, true);
        $ok = imagewebp($img, $dest, self::QUALITY);
        imagedestroy($img);
        if (!$ok || !is_file($dest)) {
            throw new RuntimeException('WebP-ში გადაყვანა ვერ მოხერხდა');
        }

        // Re-encoding a WebP at full size can only lose: keep the smaller original.
        if ($mime === 'image/webp' && !$scaled && filesize($dest) >= filesize($src)) {
            copy($src, $dest);
        }
    }

    /** Apply the camera's EXIF orientation so the stored image is upright without metadata. */
    private static function orient(GdImage $img, string $src): GdImage
    {
        if (!function_exists('exif_read_data')) {
            return $img;
        }
        $exif = @exif_read_data($src);
        $o = (int) ($exif['Orientation'] ?? 1);
        if ($o === 2 || $o === 4 || $o === 5 || $o === 7) {
            imageflip($img, IMG_FLIP_HORIZONTAL);
        }
        $angle = match ($o) {
            3, 4 => 180,
            5, 6 => 270, // imagerotate turns counter-clockwise
            7, 8 => 90,
            default => 0,
        };
        if ($angle !== 0) {
            $rotated = imagerotate($img, $angle, 0);
            if ($rotated) {
                imagedestroy($img);
                return $rotated;
            }
        }
        return $img;
    }
}
