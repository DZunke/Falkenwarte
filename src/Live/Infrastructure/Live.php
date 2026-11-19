<?php

declare(strict_types=1);

namespace App\Live\Infrastructure;

use App\Shared\Application\Actor;
use App\Shared\Domain\Problem;
use App\Shared\Infrastructure\DbalStoreAccess;
use Symfony\Component\HttpClient\HttpClient;
use Symfony\Component\HttpFoundation\Cookie;
use Symfony\Component\Mercure\Hub;
use Symfony\Component\Mercure\Jwt\Grant;
use Symfony\Component\Mercure\Jwt\LcobucciFactory;
use Symfony\Component\Mercure\Jwt\StaticTokenProvider;
use Symfony\Component\Mercure\Update;

final class Live
{
    public function __construct(private readonly DbalStoreAccess $store)
    {
    }

    private function publicUrl(): string
    {
        return getenv('MERCURE_PUBLIC_URL') ?: 'https://localhost:8443/.well-known/mercure';
    }

    private function topic(?string $project): string
    {
        return 'urn:falkenwarte:'.($project ? 'project:'.$project : 'owner');
    }

    private function subscriberTtl(): int
    {
        return 'test' === getenv('APP_ENV') ? max(60, min(600, (int) (getenv('MERCURE_SUBSCRIBER_TTL') ?: 600))) : 600;
    }

    public function handles(string $name): bool
    {
        return in_array($name, ['live_config_get', 'live_authorize', 'events_catch_up'], true);
    }

    public function handle(string $name, array $p, array $b, Actor $a): array
    {
        $projects = array_unique($b['project_ids'] ?? $a->projects);
        foreach ($projects as $id) {
            $a->requireProject($id);
        }
        $topics = array_map($this->topic(...), $projects);
        if ($a->owner && !isset($b['project_ids'])) {
            $topics[] = $this->topic(null);
        }
        $topics = array_values($topics);
        if ('live_authorize' === $name) {
            $a->requireOwner();
            foreach ($projects as $id) {
                $this->store->get('projects', $id);
            }

            return ['authorized' => true, 'topics' => $topics, 'expires_at' => gmdate(DATE_ATOM, time() + $this->subscriberTtl())];
        }
        if ('live_config_get' === $name) {
            $cursor = $this->store->db()->fetchOne('SELECT MAX(seq) FROM events');

            return ['public_url' => $this->publicUrl(), 'topics' => $topics, 'ttl' => $this->subscriberTtl(), 'recovery_url' => '/api/v1/events', 'cursor' => null === $cursor ? null : base64_encode((string) $cursor)];
        }
        $cursor = isset($p['cursor']) ? base64_decode($p['cursor'], true) : '0';
        if (false === $cursor || !ctype_digit($cursor)) {
            throw new Problem(422, 'validation_failed', 'Der Ereigniscursor ist ungültig.');
        }
        $floor = (int) $this->store->db()->fetchOne("SELECT value FROM runtime_state WHERE key='event_floor'");
        if (isset($p['cursor']) && (int) $cursor < $floor) {
            throw new Problem(410, 'resync_required', 'Bitte den aktuellen Stand laden.', ['resync_required' => true, 'resync_url' => '/api/v1/dashboard']);
        }
        $items = [];
        $limit = (int) ($p['limit'] ?? 50);
        foreach ($this->store->db()->iterateAssociative('SELECT seq,project_id,change_json FROM events WHERE seq>? AND change_json IS NOT NULL ORDER BY seq', [(int) $cursor]) as $row) {
            $project = $row['project_id'];
            if (!$a->owner && (null === $project || !$a->canProject($project))) {
                continue;
            }
            if (isset($p['project_id']) && $p['project_id'] !== $project) {
                continue;
            }
            $items[] = ['cursor' => base64_encode((string) $row['seq']), 'change' => json_decode($row['change_json'], true, flags: JSON_THROW_ON_ERROR)];
            if (count($items) > $limit) {
                break;
            }
        }
        $more = count($items) > $limit;
        if ($more) {
            array_pop($items);
        }

        return ['items' => $items, 'has_more' => $more, 'next_cursor' => $items ? end($items)['cursor'] : null];
    }

    public function cookie(array $topics, Actor $a): Cookie
    {
        $token = $this->token(false, $topics, $a->id);

        return Cookie::create('__Secure-mercure_access_token', $token, time() + $this->subscriberTtl(), '/.well-known/mercure', null, true, true, false, 'strict');
    }

    private function token(bool $publisher, array $topics, string $sub): string
    {
        $secret = getenv($publisher ? 'MERCURE_PUBLISHER_SECRET' : 'MERCURE_SUBSCRIBER_SECRET');
        if (!$secret) {
            throw new Problem(503, 'live_unavailable', 'Die Mercure-Schlüssel fehlen. Änderungen bleiben gespeichert.');
        }
        $claims = ['iss' => getenv('MERCURE_ISSUER') ?: 'https://localhost:8443', 'aud' => $this->publicUrl(), 'sub' => $sub, 'client_id' => 'falkenwarte'];

        return (new LcobucciFactory($secret, jwtLifetime: $publisher ? 600 : $this->subscriberTtl()))->create([new Grant([$publisher ? 'publish' : 'subscribe'], $topics)], $claims);
    }

    public function publish(int $limit = 100): void
    {
        $rows = $this->store->db()->fetchAllAssociative('SELECT seq,project_id,change_json FROM events WHERE published=0 ORDER BY seq LIMIT '.(int) $limit);
        foreach ($rows as $row) {
            $topics = array_values(array_unique([$this->topic($row['project_id']), $this->topic(null)]));
            $hub = new Hub(getenv('MERCURE_INTERNAL_URL') ?: $this->publicUrl(), new StaticTokenProvider($this->token(true, $topics, 'outbox')), publicUrl: $this->publicUrl(), httpClient: HttpClient::create(['timeout' => 2, 'max_duration' => 3]));
            $hub->publish(new Update($topics, $row['change_json'], true));
            $this->store->db()->update('events', ['published' => 1], ['seq' => $row['seq']]);
        }
    }
}
