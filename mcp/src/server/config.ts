import { homedir } from "os";
import { join } from "path";

/** Directory holding store.db and attachments/. Read per call so a changed HOME applies. */
export function getDataDir(): string {
  return join(homedir(), ".agentation");
}

// Reject partial parses, negative counts and values that overflow Node timers.
export function integerEnv(
  name: string,
  fallback: number,
  min = 1,
  max = Number.MAX_SAFE_INTEGER,
): number {
  const raw = process.env[name]?.trim();
  if (!raw || !/^\d+$/.test(raw)) return fallback;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= min && value <= max
    ? value
    : fallback;
}

export const MAX_TIMER_MS = 2_147_483_647;
