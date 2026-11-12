export interface WeeklyUsage {
  usedPercent: number;
  remainingPercent: number;
  resetAt: number;
}

const CLAIM = "https://api.openai.com/auth";
const WEEK_SECONDS = 7 * 24 * 60 * 60;

export function accountIdFromToken(token: string): string | undefined {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return undefined;
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    const id = claims?.[CLAIM]?.chatgpt_account_id;
    return typeof id === "string" && id.length > 0 && id.length <= 128 && /^[\w-]+$/.test(id) ? id : undefined;
  } catch {
    return undefined;
  }
}

export function parseWeeklyUsage(value: unknown, now = Date.now()): WeeklyUsage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const rateLimit = (value as Record<string, unknown>).rate_limit;
  if (!rateLimit || typeof rateLimit !== "object") return undefined;
  const { primary_window, secondary_window } = rateLimit as Record<string, unknown>;
  for (const window of [primary_window, secondary_window]) {
    if (!window || typeof window !== "object") continue;
    const { used_percent, limit_window_seconds, reset_at } = window as Record<string, unknown>;
    if (typeof limit_window_seconds !== "number" || Math.abs(limit_window_seconds - WEEK_SECONDS) > 3600 ||
        typeof used_percent !== "number" || !Number.isFinite(used_percent) || used_percent < 0 || used_percent > 100 ||
        typeof reset_at !== "number" || !Number.isFinite(reset_at) || reset_at * 1000 <= now) continue;
    return { usedPercent: used_percent, remainingPercent: 100 - used_percent, resetAt: reset_at * 1000 };
  }
  return undefined;
}

export function formatWeeklyUsage(usage: WeeklyUsage): string {
  return `W ${Math.round(usage.remainingPercent)}%`;
}
