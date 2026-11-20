<?php

declare(strict_types=1);

// Serve the generated handbook without running the application's front controller.
$requestPath = rawurldecode(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?? '/');
if ('/' === $requestPath || '/docs' === $requestPath) {
    header('Location: /docs/', true, 302);

    return true;
}

$handbookRoot = dirname(__DIR__).'/public/docs';
if (str_starts_with($requestPath, '/docs/') && !str_contains($requestPath, "\0")) {
    $file = realpath($handbookRoot.'/'.substr($requestPath, 6).(str_ends_with($requestPath, '/') ? 'index.html' : ''));
    if (false !== $file && str_starts_with($file, $handbookRoot.'/') && is_file($file)) {
        return false;
    }
}

http_response_code(404);
header('Content-Type: text/plain; charset=UTF-8');
echo "Diese Seite ist in der lokalen Handbuchvorschau nicht vorhanden.\n";

return true;
