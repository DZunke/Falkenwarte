# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e

ARG SOURCE_DATE_EPOCH=0

ARG NODE_IMAGE=node:24.15.0-bookworm-slim@sha256:4e6b70dd6cbfc88c8157ba19aa3d9f9cce6ba4703576d55459e45efcbc9c5f5d
ARG FRANKENPHP_IMAGE=dunglas/frankenphp@sha256:681db339fc7751be886ac69b6daab1ac32c0a78ed8fa255abdacc75391a00480
ARG COMPOSER_IMAGE=composer:2.9.8@sha256:b09bccd91a78fe8a9ab4b33d707b862e8fe54fec17782e32683ad2a69c46867d
ARG PLAYWRIGHT_IMAGE=mcr.microsoft.com/playwright:v1.65.1-noble@sha256:1507cbfc550a63a6b7396791ca4f00df17beb56342d2447b3f106c306f525579

FROM ${NODE_IMAGE} AS frontend
WORKDIR /workspace
COPY frontend/package.json frontend/package-lock.json frontend/
RUN npm --prefix frontend ci --no-audit --no-fund
COPY frontend/ frontend/
COPY contracts/ contracts/
RUN npm --prefix frontend run generate:api && npm --prefix frontend run build
RUN npm --prefix frontend sbom --sbom-format=cyclonedx --sbom-type=application --omit=dev --package-lock-only > /tmp/falkenwarte-frontend-sbom.cdx.json
RUN node --input-type=commonjs -e 'const fs = require("node:fs"); const path = "/tmp/falkenwarte-frontend-sbom.cdx.json"; const bom = JSON.parse(fs.readFileSync(path, "utf8")); if (bom.bomFormat !== "CycloneDX" || !Array.isArray(bom.components)) process.exit(1); fs.writeFileSync(path, JSON.stringify({bomFormat: bom.bomFormat, components: bom.components}) + "\n");'

FROM ${COMPOSER_IMAGE} AS composer

FROM ${FRANKENPHP_IMAGE} AS app
ARG FRANKENPHP_IMAGE
ARG SOURCE_DATE_EPOCH
ARG SQLITE_VERSION=3510300
ARG SQLITE_SHA256=81f5be397049b0cae1b167f2225af7646fc0f82e4a9b3c48c9ea3a533e21d77a

USER root
ARG DEBIAN_SNAPSHOT=20261104T212339Z
RUN set -eux; \
    source_file=/etc/apt/sources.list.d/debian.sources; \
    test -f "$source_file"; \
    grep -Fq "snapshot.debian.org/archive/debian/${DEBIAN_SNAPSHOT}" "$source_file"; \
    grep -Fq "snapshot.debian.org/archive/debian-security/${DEBIAN_SNAPSHOT}" "$source_file"; \
    sed -i \
        -e "s#^URIs: http://deb.debian.org/debian\$#URIs: https://snapshot.debian.org/archive/debian/${DEBIAN_SNAPSHOT}#" \
        -e "s#^URIs: http://deb.debian.org/debian-security\$#URIs: https://snapshot.debian.org/archive/debian-security/${DEBIAN_SNAPSHOT}#" \
        -e '/^Components:/a Check-Valid-Until: no' \
        "$source_file"; \
    grep -Fq "URIs: https://snapshot.debian.org/archive/debian/${DEBIAN_SNAPSHOT}" "$source_file"; \
    grep -Fq "URIs: https://snapshot.debian.org/archive/debian-security/${DEBIAN_SNAPSHOT}" "$source_file"; \
    install-php-extensions intl pcntl zip; \
    rm -rf /var/lib/apt/lists/* /var/log/apt; \
    rm -f /var/log/dpkg.log /var/log/alternatives.log /var/cache/ldconfig/aux-cache
RUN setcap -r /usr/local/bin/frankenphp \
    && test -z "$(getcap /usr/local/bin/frankenphp)"

RUN set -eux; \
    archive="/tmp/sqlite-autoconf-${SQLITE_VERSION}.tar.gz"; \
    curl -fsSL "https://sqlite.org/2026/sqlite-autoconf-${SQLITE_VERSION}.tar.gz" -o "$archive"; \
    echo "${SQLITE_SHA256}  ${archive}" | sha256sum -c -; \
    mkdir -p /tmp/sqlite-source; \
    tar -xzf "$archive" --strip-components=1 -C /tmp/sqlite-source; \
    cd /tmp/sqlite-source; \
    CFLAGS="-O2 -DSQLITE_ENABLE_FTS5 -DSQLITE_ENABLE_RTREE" ./configure --prefix=/usr/local --disable-static --enable-shared; \
    make -j2; \
    make install; \
    ldconfig; \
    rm -f /var/cache/ldconfig/aux-cache; \
    rm -rf /tmp/sqlite-source "$archive"; \
    php -r '$version = SQLite3::version(); if ($version["versionNumber"] < 3051003) { fwrite(STDERR, "SQLite 3.51.3 or newer is required.\n"); exit(1); } $pdo = new PDO("sqlite::memory:"); if (version_compare($pdo->query("SELECT sqlite_version()")->fetchColumn(), "3.51.3", "<")) { exit(1); } echo "SQLite3 and PDO SQLite ".$version["versionString"]."\n";'

ENV APP_ENV=prod \
    APP_DEBUG=0 \
    SERVER_NAME=localhost:8443 \
    XDG_DATA_HOME=/data \
    FALKENWARTE_DATA_DIR=/data \
    FALKENWARTE_DB=/data/falkenwarte.sqlite \
    FALKENWARTE_BACKUP_DIR=/data/backups \
    FALKENWARTE_PUBLIC_ORIGIN=https://localhost:8443 \
    MERCURE_ISSUER=https://localhost:8443 \
    MERCURE_RESOURCE_IDENTIFIER=https://localhost:8443/.well-known/mercure \
    MERCURE_PUBLIC_URL=https://localhost:8443/.well-known/mercure \
    MERCURE_INTERNAL_URL=http://127.0.0.1:8080/.well-known/mercure

WORKDIR /app
ARG VCS_REF=unknown
# x-release-please-start-version
ARG APP_VERSION=0.2.1
# x-release-please-end
ARG DEBIAN_SNAPSHOT=20261104T212339Z
COPY --from=composer /usr/bin/composer /usr/local/bin/composer
COPY composer.json composer.lock version.txt ./
COPY packages/link-notes/ packages/link-notes/
COPY packages/t3-mcp-bridge/manifest.json packages/t3-mcp-bridge/manifest.json
RUN composer install --no-dev --no-interaction --no-progress --prefer-dist --no-scripts --no-autoloader
COPY bin/ bin/
COPY config/ config/
COPY contracts/ contracts/
COPY docs/ docs/
COPY migrations/ migrations/
COPY public/ public/
COPY scripts/build-docs.php scripts/render-docs.php scripts/handbuch.css scripts/
COPY scripts/build-image-inventory.php scripts/
COPY src/ src/
COPY docker/Caddyfile /etc/frankenphp/Caddyfile
COPY --from=frontend /workspace/public/build/ /app/public/build/
COPY --from=frontend /tmp/falkenwarte-frontend-sbom.cdx.json /tmp/falkenwarte-frontend-sbom.cdx.json
RUN composer dump-autoload --no-dev --classmap-authoritative --no-scripts \
    && php scripts/build-docs.php \
    && APP_ENV=prod APP_SECRET=falkenwarte-image-build-validation-secret-not-used-at-runtime php bin/console lint:container --no-interaction \
    && rm -rf var/cache/* \
    && mkdir -p /usr/share/falkenwarte/image-audit \
    && FALKENWARTE_BUILD_REVISION="$VCS_REF" FALKENWARTE_APP_VERSION="$APP_VERSION" FALKENWARTE_DEBIAN_SNAPSHOT="$DEBIAN_SNAPSHOT" FALKENWARTE_SOURCE_DATE_EPOCH="$SOURCE_DATE_EPOCH" FALKENWARTE_FRANKENPHP_IMAGE="$FRANKENPHP_IMAGE" php scripts/build-image-inventory.php /usr/share/falkenwarte/image-audit \
    && rm -f /tmp/falkenwarte-frontend-sbom.cdx.json \
    && rm -f /usr/local/bin/composer \
    && mkdir -p /data /certs /app/var/cache /app/var/log \
    && chown -R www-data:www-data /app /data /certs

LABEL org.opencontainers.image.title="Falkenwarte" \
      org.opencontainers.image.description="Private single-user control platform for project work and T3 Code." \
      org.opencontainers.image.source="https://github.com/DZunke/Falkenwarte" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.version="${APP_VERSION}"

COPY --chmod=0755 docker/entrypoint.sh /usr/local/bin/falkenwarte-entrypoint
COPY --chmod=0755 docker/healthcheck.php /usr/local/bin/falkenwarte-healthcheck

USER www-data
EXPOSE 8443
HEALTHCHECK --interval=15s --timeout=5s --start-period=90s --retries=4 CMD ["php", "/usr/local/bin/falkenwarte-healthcheck"]
ENTRYPOINT ["/usr/local/bin/falkenwarte-entrypoint"]

FROM app AS qa
COPY --from=composer /usr/bin/composer /usr/local/bin/composer
RUN composer install --no-interaction --no-progress --prefer-dist --no-scripts \
    && composer dump-autoload --classmap-authoritative --no-scripts

FROM ${NODE_IMAGE} AS qa-mocks
WORKDIR /app
COPY qa/mocks/ ./qa/mocks/
COPY qa/fixtures/ ./qa/fixtures/
ENV NODE_ENV=production

FROM ${PLAYWRIGHT_IMAGE} AS e2e-runner
RUN apt-get update \
    && apt-get install -y --no-install-recommends libnss3-tools unzip \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY scripts/run-browser-qa.sh /usr/local/bin/run-browser-qa
COPY tests/e2e/package.json tests/e2e/package-lock.json ./tests/e2e/
RUN npm --prefix tests/e2e ci --no-audit --no-fund
COPY tests/e2e/ ./tests/e2e/
COPY qa/playwright-reporter.mjs qa/scenarios.json ./qa/
COPY qa/fixtures/fixture-seed.json ./qa/fixtures/fixture-seed.json
