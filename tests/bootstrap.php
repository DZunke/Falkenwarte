<?php

declare(strict_types=1);

use Symfony\Component\Dotenv\Dotenv;

require dirname(__DIR__).'/vendor/autoload.php';

$dotenvFile = dirname(__DIR__).'/.env';
if (is_file($dotenvFile)) {
    (new Dotenv())->bootEnv($dotenvFile);
}
