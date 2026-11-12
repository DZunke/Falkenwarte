import assert from "node:assert/strict";
import { test } from "node:test";
import { accountIdFromToken, formatWeeklyUsage, parseWeeklyUsage } from "../quota.ts";
import { readCodexUsage } from "../index.ts";

const now = 1_700_000_000_000;
const future = now / 1000 + 9000;

function token(claims) {
  return `e30.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;
}

test("account ID is read only from a valid Codex token claim", () => {
  assert.equal(accountIdFromToken(token({ "https://api.openai.com/auth": { chatgpt_account_id: "account-123" } })), "account-123");
  for (const input of ["not-a-token", token({}), token({ "https://api.openai.com/auth": { chatgpt_account_id: "a\nsecret" } })]) {
    assert.equal(accountIdFromToken(input), undefined);
  }
});

test("provider request uses only Pi's active Codex OAuth token and refuses redirects", async () => {
  const jwt = token({ "https://api.openai.com/auth": { chatgpt_account_id: "account-123" } });
  const model = { provider: "openai-codex", baseUrl: "https://chatgpt.com/backend-api" };
  const ctx = { model, modelRegistry: {
    isUsingOAuth: () => true,
    getApiKeyAndHeaders: async () => ({ ok: true, apiKey: jwt }),
  } };
  let requests = 0;
  const usage = await readCodexUsage(ctx, async (url, options) => {
    requests++;
    assert.equal(url, "https://chatgpt.com/backend-api/wham/usage");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.authorization, `Bearer ${jwt}`);
    assert.equal(options.headers["chatgpt-account-id"], "account-123");
    return { ok: true, headers: new Headers(), text: async () => JSON.stringify({ rate_limit: {
      primary_window: { used_percent: 2, limit_window_seconds: 604800, reset_at: Date.now() / 1000 + 6000 },
    } }) };
  });
  assert.equal(usage?.remainingPercent, 98);
  ctx.model = { ...model, baseUrl: "https://example.com" };
  assert.equal(await readCodexUsage(ctx, () => { throw new Error("must not fetch"); }), undefined);
  ctx.model = model;
  ctx.modelRegistry.isUsingOAuth = () => false;
  assert.equal(await readCodexUsage(ctx, () => { throw new Error("must not fetch"); }), undefined);
  assert.equal(requests, 1);
});

test("weekly usage requires a live seven-day window with a finite percentage", () => {
  const value = { rate_limit: { primary_window: { used_percent: 30, limit_window_seconds: 18000, reset_at: future },
    secondary_window: { used_percent: 2, limit_window_seconds: 604800, reset_at: future } } };
  assert.deepEqual(parseWeeklyUsage(value, now), { usedPercent: 2, remainingPercent: 98, resetAt: future * 1000 });
  assert.equal(formatWeeklyUsage(parseWeeklyUsage(value, now)), "W 98%");
  assert.equal(parseWeeklyUsage({ rate_limit: { primary_window: value.rate_limit.primary_window } }, now), undefined);
  assert.equal(parseWeeklyUsage({ rate_limit: { primary_window: { used_percent: 101, limit_window_seconds: 604800, reset_at: future } } }, now), undefined);
  assert.equal(parseWeeklyUsage({ rate_limit: { primary_window: { used_percent: 2, limit_window_seconds: 604800, reset_at: now / 1000 - 1 } } }, now), undefined);
  assert.equal(parseWeeklyUsage({}), undefined);
});
