<?php

declare(strict_types=1);

namespace App\Access\Presentation;

use App\Access\Application\AccessPersistence;
use App\Access\Domain\TechnicalCredential;
use App\Shared\Application\Actor;
use App\Shared\Application\Store;
use App\Shared\Domain\Problem;
use Symfony\Component\HttpFoundation\Cookie;
use Symfony\Component\HttpFoundation\Request;

final class Access
{
    public const SETTINGS = '00000000-0000-4000-8000-000000000001';
    public ?Cookie $cookie = null;
    private ?array $session = null;

    public function __construct(private readonly Store $store, private readonly AccessPersistence $persistence)
    {
    }

    public function authenticate(Request $request, bool $mcp = false): ?Actor
    {
        $this->session = null;
        $this->cookie = null;
        if ($request->headers->has('Authorization')) {
            $header = $request->headers->get('Authorization', '');
            $hash = TechnicalCredential::digestFromHeader($header);
            if (null !== $hash) {
                $token = $this->persistence->findTechnicalTokenByHash($hash);
                if ($token && TechnicalCredential::active($token, time())) {
                    return new Actor($token['principal_id'], false, $token['project_ids'], $token['capabilities'], $token['label'], $mcp ? 'mcp' : 'http');
                }
            }
            throw new Problem(401, 'unauthenticated', 'Das technische Token ist ungültig oder abgelaufen.');
        }
        if ($mcp) {
            throw new Problem(401, 'unauthenticated', 'Ein technisches Bearer-Token ist erforderlich.');
        }
        $key = $request->cookies->get('falkenwarte_session');
        if (!is_string($key)) {
            return null;
        }
        $session = $this->persistence->findSession(hash('sha256', $key), time());
        if (!$session) {
            return null;
        }
        $this->session = $session;
        $owner = $this->store->get('owners', $session['owner_id']);

        return new Actor($owner['id'], true, [], [], $owner['display_name']);
    }

    public function csrf(Request $request): void
    {
        if (!$this->session || !hash_equals($this->session['csrf'], $request->headers->get('X-CSRF-Token', ''))) {
            throw new Problem(403, 'csrf_invalid', 'Sitzung aktualisieren und erneut versuchen.');
        }
    }

    public function handleSession(string $op, Request $request, array $b, ?Actor $a): array
    {
        $owner = $this->store->all('owners')[0] ?? null;
        if ('bootstrap_get' === $op) {
            return ['setup_required' => null === $owner, 'app_version' => trim(is_file(dirname(__DIR__, 3).'/version.txt') ? file_get_contents(dirname(__DIR__, 3).'/version.txt') : '0.1.0'), 'contract_version' => '0.2.0', 'login_url' => '/api/v1/session'];
        }
        if ('session_get' === $op) {
            return $this->sessionView($a, $a?->owner ? $owner : null);
        }
        if ('session_delete' === $op) {
            $this->csrf($request);
            $this->persistence->removeSession($this->session['hash']);
            $this->cookie = Cookie::create('falkenwarte_session', '', 1, '/', null, $request->isSecure(), true, false, 'strict');

            return [];
        }
        if ('owner_setup' === $op) {
            return $this->store->atomic(function () use ($b, $request) {
                if ($this->store->all('owners')) {
                    throw new Problem(409, 'setup_complete', 'Der Eigentümer wurde bereits eingerichtet.');
                }
                $token = getenv('APP_SETUP_TOKEN') ?: $this->localSetupToken();
                if (!hash_equals($token, $b['setup_token'])) {
                    throw new Problem(403, 'forbidden', 'Der Einrichtungsschlüssel ist ungültig.');
                }
                $this->timezone($b['timezone']);
                $owner = $this->store->save('owners', ['display_name' => $b['display_name'], 'timezone' => $b['timezone'], 'locale' => 'de', '_password' => password_hash($b['password'], PASSWORD_DEFAULT)], 'access.owner_created');
                $this->store->save('settings', ['id' => self::SETTINGS, 'timezone' => $b['timezone'], 'locale' => 'de', 'theme' => 'system', 'maintenance_mode' => false, 'default_parallel_runs' => 1, 'api_idempotency_retention_days' => 30, 'ui_event_retention_hours' => 24], 'access.settings_created');

                return $this->login($request, $owner);
            });
        }
        $ip = hash('sha256', $request->getClientIp() ?? 'local');
        $rate = $this->persistence->loginAttempts($ip);
        if ($rate && $rate['until_ts'] > time() && $rate['attempts'] >= 12) {
            throw new Problem(429, 'rate_limited', 'Zu viele Anmeldeversuche. In fünf Minuten erneut versuchen.');
        }
        if (!$owner || !password_verify($b['password'], $owner['_password'])) {
            $this->persistence->recordLoginFailure($ip, time());
            throw new Problem(401, 'unauthenticated', 'Die Anmeldung ist fehlgeschlagen.');
        }
        $this->persistence->clearLoginFailures($ip);

        return $this->login($request, $owner);
    }

    private function localSetupToken(): string
    {
        $path = dirname(getenv('FALKENWARTE_DB') ?: dirname(__DIR__, 3).'/var/falkenwarte.sqlite').'/setup-token';
        if (!is_file($path)) {
            throw new Problem(503, 'setup_token_missing', 'APP_SETUP_TOKEN setzen oder den Einrichtungsschlüssel im Datenverzeichnis bereitstellen.');
        }

        return trim(file_get_contents($path));
    }

    private function login(Request $request, array $owner): array
    {
        $raw = bin2hex(random_bytes(32));
        $this->session = ['hash' => hash('sha256', $raw), 'owner_id' => $owner['id'], 'csrf' => bin2hex(random_bytes(32)), 'expires' => time() + 43200];
        $this->persistence->saveSession($this->session);
        $this->cookie = Cookie::create('falkenwarte_session', $raw, $this->session['expires'], '/', null, $request->isSecure(), true, false, 'strict');

        return $this->sessionView(new Actor($owner['id'], true, [], [], $owner['display_name']), $owner);
    }

    private function sessionView(?Actor $a, ?array $owner): array
    {
        return ['authenticated' => null !== $a, 'actor' => $a?->ref(), 'owner' => $owner, 'csrf_token' => $this->session['csrf'] ?? null, 'expires_at' => $this->session ? gmdate(DATE_ATOM, $this->session['expires']) : null, 'capabilities' => $a?->owner ? ['*'] : ($a->capabilities ?? [])];
    }

    private function timezone(string $zone): void
    {
        if (!in_array($zone, timezone_identifiers_list(), true)) {
            throw new Problem(422, 'validation_failed', 'Eine gültige IANA-Zeitzone angeben.');
        }
    }

    public function handles(string $op): bool
    {
        return in_array($op, ['owner_get', 'owner_update', 'owner_password_change', 'settings_get', 'settings_update', 'ui_config_get', 'tokens_list', 'tokens_create', 'tokens_revoke', 'secret_references_list', 'secret_references_create', 'secret_references_rotate'], true);
    }

    public function handle(string $op, array $p, array $b, Actor $a): array
    {
        if ('ui_config_get' === $op) {
            return ['icons' => array_map(fn ($k) => ['key' => $k, 'label' => $k], ['bird', 'archive', 'folder', 'book', 'compass', 'code']), 'task_types' => ['task', 'bug', 'feature'], 'priorities' => ['low', 'normal', 'high', 'urgent'], 'capabilities' => $a->capabilities, 'idempotency_retention_seconds' => 2592000, 'timezone' => $this->store->get('settings', self::SETTINGS)['timezone'], 'allowed_actions' => []];
        }
        $a->requireOwner();
        if (isset($b['timezone'])) {
            $this->timezone($b['timezone']);
        }
        if ('settings_get' === $op) {
            return $this->store->get('settings', self::SETTINGS);
        }
        if ('settings_update' === $op) {
            return $this->store->save('settings', array_replace($this->store->get('settings', self::SETTINGS), $b), 'access.settings_updated');
        }
        if ('owner_get' === $op) {
            return $this->store->get('owners', $a->id);
        }
        if ('owner_update' === $op) {
            return $this->store->save('owners', array_replace($this->store->get('owners', $a->id), $b), 'access.owner_updated');
        }
        if ('owner_password_change' === $op) {
            $owner = $this->store->get('owners', $a->id);
            if (!password_verify($b['current_password'], $owner['_password'])) {
                throw new Problem(403, 'forbidden', 'Aktuelles Passwort prüfen.');
            }
            $owner['_password'] = password_hash($b['new_password'], PASSWORD_DEFAULT);
            $this->store->save('owners', $owner, 'access.password_changed');
            $this->persistence->removeOtherSessions($this->session['hash']);

            return array_replace($this->store->accepted(), ['status' => 'succeeded']);
        }
        if ('tokens_list' === $op) {
            return $this->store->page($this->store->all('tokens'), $p);
        }
        if ('tokens_create' === $op) {
            foreach ($b['project_ids'] as $id) {
                $this->store->get('projects', $id);
            }
            $credential = TechnicalCredential::issue($b['expires_at'], time());
            $meta = $this->store->save('tokens', $b + ['principal_id' => $this->store->id(), 'last_used_at' => null, 'revoked' => false, '_hash' => $credential->digest], 'access.token_issued');

            return ['metadata' => $meta, 'token' => $credential->bearer, 'token_disclosed' => true];
        }
        if ('tokens_revoke' === $op) {
            $token = $this->store->get('tokens', $p['token_id']);
            $token['revoked'] = true;

            return $this->store->save('tokens', $token, 'access.token_revoked');
        }
        if ('secret_references_list' === $op) {
            return $this->store->page($this->store->all('secret_references'),$p);
        }
        $meta = 'secret_references_create' === $op ? ['id' => $this->store->id(), 'label' => $b['label']] : $this->store->get('secret_references',$p['secret_id']);
        $this->store->putSecret($meta['id'],$b['value']);

        return $this->store->save('secret_references',array_replace($meta,['configured' => true, 'rotated_at' => $this->store->now()]),'access.secret_configured');
    }
}
