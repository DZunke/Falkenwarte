<?php

declare(strict_types=1);

use PhpCsFixer\Config;
use PhpCsFixer\Finder;

$finder = Finder::create()
    ->in([
        __DIR__.'/src',
        __DIR__.'/packages',
        __DIR__.'/config',
        __DIR__.'/migrations',
        __DIR__.'/scripts',
        __DIR__.'/tests/BackgroundFunctional',
        __DIR__.'/tests/Fixtures',
        __DIR__.'/docker',
        __DIR__.'/public',
        __DIR__.'/bin',
    ])
    ->notName('reference.php')
    ->notPath('~^build/~')
    ->notPath('~^docs/~')
    ->append([__FILE__, __DIR__.'/tests/bootstrap.php', __DIR__.'/bin/console']);

return (new Config())
    ->setRules([
        '@Symfony' => true,
        'array_syntax' => ['syntax' => 'short'],
        'class_attributes_separation' => ['elements' => ['const' => 'one', 'property' => 'one', 'method' => 'one']],
        'whitespace_after_comma_in_array' => ['ensure_single_space' => true],
    ])
    ->setCacheFile(__DIR__.'/var/php-cs-fixer.cache')
    ->setFinder($finder);
