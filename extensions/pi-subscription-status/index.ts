import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { accountIdFromToken, formatWeeklyUsage, parseWeeklyUsage, type WeeklyUsage } from "./quota.ts";

const STATUS_KEY = "falkenwarte-usage";
const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const REFRESH_MS = 5 * 60 * 1000;

export async function readCodexUsage(ctx: ExtensionContext, fetcher: typeof fetch = fetch): Promise<WeeklyUsage | undefined> {
  const model = ctx.model;
  if (model?.provider !== "openai-codex" || model.baseUrl.replace(/\/$/, "") !== "https://chatgpt.com/backend-api" ||
      !ctx.modelRegistry.isUsingOAuth(model)) return undefined;

  try {
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok || !auth.apiKey) return undefined;
    const accountId = accountIdFromToken(auth.apiKey);
    if (!accountId) return undefined;
    const response = await fetcher(USAGE_URL, {
      headers: { authorization: `Bearer ${auth.apiKey}`, "chatgpt-account-id": accountId, accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok || Number(response.headers.get("content-length") ?? 0) > 32768) return undefined;
    const body = await response.text();
    return body.length <= 32768 ? parseWeeklyUsage(JSON.parse(body)) : undefined;
  } catch {
    // A private provider endpoint can change or be unreachable. Never display a stale or guessed percentage.
    return undefined;
  }
}

export default function (pi: ExtensionAPI) {
  let latest: WeeklyUsage | undefined;
  let checkedAt = 0;
  let sequence = 0;
  let inFlight: Promise<WeeklyUsage | undefined> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;

  async function refresh(ctx: ExtensionContext, force = false): Promise<WeeklyUsage | undefined> {
    const current = ++sequence;
    if (ctx.model?.provider !== "openai-codex" || ctx.model.baseUrl.replace(/\/$/, "") !== "https://chatgpt.com/backend-api" ||
        !ctx.modelRegistry.isUsingOAuth(ctx.model)) {
      latest = undefined;
      checkedAt = 0;
      ctx.ui.setStatus(STATUS_KEY, undefined);
      return undefined;
    }
    if (!force && checkedAt && Date.now() - checkedAt < REFRESH_MS) {
      ctx.ui.setStatus(STATUS_KEY, latest ? formatWeeklyUsage(latest) : undefined);
      return latest;
    }
    ctx.ui.setStatus(STATUS_KEY, undefined);
    const request = !force && inFlight ? inFlight : readCodexUsage(ctx);
    inFlight = request;
    const usage = await request;
    if (inFlight === request) inFlight = undefined;
    if (current !== sequence) return undefined;
    latest = usage;
    checkedAt = Date.now();
    ctx.ui.setStatus(STATUS_KEY, usage ? formatWeeklyUsage(usage) : undefined);
    return usage;
  }

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui" || process.env.PI_OFFLINE === "1") return;
    void refresh(ctx);
    timer = setInterval(() => { void refresh(ctx); }, REFRESH_MS);
    timer.unref?.();
  });

  pi.on("model_select", (_event, ctx) => {
    if (ctx.mode === "tui" && process.env.PI_OFFLINE !== "1") void refresh(ctx);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    sequence++;
    if (timer) clearInterval(timer);
    timer = undefined;
    latest = undefined;
    inFlight = undefined;
    ctx.ui.setStatus(STATUS_KEY, undefined);
  });

  pi.registerCommand("falkenwarte-usage", {
    description: "Check the current provider's weekly subscription quota, when available",
    handler: async (_args, ctx) => {
      const usage = await refresh(ctx, true);
      ctx.ui.notify(usage
        ? `OpenAI Codex weekly window: ${usage.usedPercent}% used, ${usage.remainingPercent}% remaining. Resets ${new Date(usage.resetAt).toISOString().replace("T", " ").slice(0, 16)} UTC. Checked just now.`
        : "No current weekly quota available for this provider/authentication. Nothing is estimated or cached.", "info");
    },
  });
}
