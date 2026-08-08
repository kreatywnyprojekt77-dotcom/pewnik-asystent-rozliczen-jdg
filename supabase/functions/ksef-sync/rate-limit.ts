export const METADATA_MIN_INTERVAL_MS = 4_100;
export const MAX_INLINE_RETRY_AFTER_MS = 60_000;

export function parseRetryAfterMs(value: string | null, nowMs = Date.now()): number | null {
  if (!value) return null;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);

  const retryAt = Date.parse(value);
  if (!Number.isFinite(retryAt)) return null;
  return Math.max(0, retryAt - nowMs);
}

export function fallbackRetryDelayMs(attempt: number): number {
  return Math.min(30_000, 2_000 * (2 ** Math.max(0, attempt)));
}

export class RequestGate {
  private nextStartAt = 0;
  private readonly intervalMs: number;

  constructor(intervalMs: number) {
    this.intervalMs = intervalMs;
  }

  reserve(nowMs = Date.now()): number {
    const scheduledAt = Math.max(nowMs, this.nextStartAt);
    this.nextStartAt = scheduledAt + this.intervalMs;
    return Math.max(0, scheduledAt - nowMs);
  }
}
