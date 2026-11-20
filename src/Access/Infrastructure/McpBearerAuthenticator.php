<?php

declare(strict_types=1);

namespace App\Access\Infrastructure;

use App\Shared\Domain\Problem;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Security\Core\Authentication\Token\TokenInterface;
use Symfony\Component\Security\Core\Exception\AuthenticationException;
use Symfony\Component\Security\Http\Authenticator\AbstractAuthenticator;
use Symfony\Component\Security\Http\Authenticator\Passport\Badge\UserBadge;
use Symfony\Component\Security\Http\Authenticator\Passport\Passport;
use Symfony\Component\Security\Http\Authenticator\Passport\SelfValidatingPassport;
use Symfony\Component\Security\Http\EntryPoint\AuthenticationEntryPointInterface;

final class McpBearerAuthenticator extends AbstractAuthenticator implements AuthenticationEntryPointInterface
{
    public function __construct(private readonly TechnicalPrincipalAuthenticator $technicalPrincipalAuthenticator)
    {
    }

    public function supports(Request $request): bool
    {
        return '/mcp' === $request->getPathInfo();
    }

    public function authenticate(Request $request): Passport
    {
        $origin = $request->headers->get('Origin');
        if (null !== $origin && $origin !== $request->getSchemeAndHttpHost()) {
            throw new McpProblemAuthenticationException(new Problem(403, 'origin_forbidden', 'Die Anfrage stammt von einem anderen Ursprung.'));
        }

        $header = $request->headers->get('Authorization', '');
        if ('' === $header) {
            throw new McpProblemAuthenticationException(new Problem(401, 'unauthenticated', 'Ein technisches Bearer-Token ist erforderlich.'));
        }

        try {
            $actor = $this->technicalPrincipalAuthenticator->authenticate($header, 'mcp');
        } catch (Problem $problem) {
            throw new McpProblemAuthenticationException($problem);
        }

        return new SelfValidatingPassport(new UserBadge($actor->id, static fn (string $userIdentifier): McpPrincipal => new McpPrincipal($actor)));
    }

    public function onAuthenticationFailure(Request $request, AuthenticationException $exception): Response
    {
        return $this->problemResponse($exception);
    }

    public function onAuthenticationSuccess(Request $request, TokenInterface $token, string $firewallName): ?Response
    {
        return null;
    }

    public function start(Request $request, ?AuthenticationException $authException = null): Response
    {
        if (null === $authException) {
            return $this->problemResponse(new McpProblemAuthenticationException(new Problem(401, 'unauthenticated', 'Ein technisches Bearer-Token ist erforderlich.')));
        }

        return $this->problemResponse($authException);
    }

    private function problemResponse(AuthenticationException $exception): JsonResponse
    {
        $problem = $exception instanceof McpProblemAuthenticationException
            ? $exception->problem
            : new Problem(401, 'unauthenticated', 'Das technische Token ist ungültig oder abgelaufen.');

        return new JsonResponse($problem->details(), $problem->status, [
            'Content-Type' => 'application/problem+json',
            'Cache-Control' => 'no-store',
        ]);
    }
}
