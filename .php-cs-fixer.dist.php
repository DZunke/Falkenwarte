<?php

declare(strict_types=1);

use PhpCsFixer\Config;
use PhpCsFixer\Finder;

$finder = Finder::create()
    ->in([__DIR__.'/src', __DIR__.'/packages', __DIR__.'/config', __DIR__.'/migrations', __DIR__.'/scripts', __DIR__.'/tests/BackgroundFunctional'])
    ->notName('reference.php')
    ->append([__FILE__, __DIR__.'/public/index.php', __DIR__.'/bin/console']);

return (new Config())
    ->setRules(['@Symfony' => true, 'array_syntax' => ['syntax' => 'short']])
    ->setCacheFile(__DIR__.'/var/php-cs-fixer.cache')
    ->setFinder($finder);
