# Symmetry API: PHP 8.3 with SQLite. The official image already ships pdo_sqlite, fileinfo and mbstring;
# GD (JPEG, PNG, WebP, AVIF) and EXIF are added for the upload → WebP optimiser.
FROM php:8.3-cli-alpine

RUN apk add --no-cache libjpeg-turbo libpng libwebp libavif freetype \
 && apk add --no-cache --virtual .build-deps libjpeg-turbo-dev libpng-dev libwebp-dev libavif-dev freetype-dev \
 && docker-php-ext-configure gd --with-jpeg --with-webp --with-avif --with-freetype \
 && docker-php-ext-install -j"$(nproc)" gd exif \
 && apk del .build-deps

# Product photos can be up to 8 MB (see config.php: max_upload_bytes).
COPY docker/php.ini /usr/local/etc/php/conf.d/symmetry.ini

WORKDIR /app
COPY . .
RUN mkdir -p data public/uploads && chown -R www-data:www-data data public/uploads

EXPOSE 8000
# PHP's built-in server with the API router, listening on all interfaces inside the container.
CMD ["php", "-S", "0.0.0.0:8000", "-t", "public", "public/index.php"]
