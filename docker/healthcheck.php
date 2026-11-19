<?php
declare(strict_types=1);

$origin = 'https://localhost:8443';
$caFile = '/certs/root.crt';
if (!is_file($caFile) || !is_readable($caFile)) {
    exit(1);
}

$context = stream_context_create([
    'ssl' => [
        'cafile' => $caFile,
        'verify_peer' => true,
        'verify_peer_name' => true,
    ],
    'http' => [
        'method' => 'GET',
        'timeout' => 3,
        'ignore_errors' => true,
        'header' => "Accept: application/json\r\n",
    ],
]);

$response = @file_get_contents($origin.'/healthz', false, $context);
$statusLine = $http_response_header[0] ?? '';
if ($response === false || preg_match('/\s200\s/', $statusLine) !== 1) {
    exit(1);
}

exit(0);
