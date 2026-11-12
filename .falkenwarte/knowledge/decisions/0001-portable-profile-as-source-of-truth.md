# 0001 — Portable profile as source of truth

- Status: Accepted (existing setup decision, recorded retrospectively)
- Date: 2026-11-12
- Decision owner: user, through the initial portable-setup request
- Related issue: none

## Context and evidence

Pi is installed separately on different machines. Its agent directory also contains credentials, sessions, integrations and packages installed by other owners. A copy of that entire directory would be neither safe nor reliably portable. [`config/packages.json`](../../../config/packages.json), [`config/personalities.json`](../../../config/personalities.json) and [`scripts/portable-pi.mjs`](../../../scripts/portable-pi.mjs) implement a reviewed subset instead; [`docs/security-and-recovery.md`](../../../docs/security-and-recovery.md) describes the guardrails.

## Options

1. **Copy the whole agent directory:** easy initially, but exports secrets and machine paths and overwrites unrelated customizations. Rejected.
2. **Keep a reviewed checkout with explicit apply/capture:** repeatable across paths and operating systems, with deliberate conflict handling and update pins. Chosen.
3. **Manage everything remotely through a hosted service:** could centralize state, but introduces credentials and another dependency before the local profile is stable. Deferred, not required.

## Decision

The checkout is the source of truth for the values it declares. `plan` inspects drift, `update` applies and verifies exact package pins, and `capture` copies selected local changes back only after review. Pi and Node remain prerequisites; machine credentials and unrelated packages remain local. The initial setup request established this boundary; this record explains the implemented choice rather than claiming a new approval.

## Consequences

Each machine must run `update` after cloning or moving the checkout. Native browser runtimes and optional local skills may need separate installation. An unreviewed capture or changed lockfile still needs human scrutiny. The profile's package paths are computed from the current checkout instead of embedding the author's home path.

## Verification

Run `node --test tests/portable-pi.test.mjs`, `node scripts/portable-pi.mjs plan` and `node scripts/portable-pi.mjs capture --dry-run`. The tests check repeatable apply, unrelated settings, conflict refusal, relocation and path safety. A future change to ownership, synchronization or credentials requires a new ADR, not a silent rewrite of this record.
