const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_PER_IP = 5;

const ipAttempts = new Map<string, number[]>();

/** True (and records the attempt) when `ip` is still under the hourly access-request submission cap. */
export function checkAccessRequestRateLimit(ip: string, now: number = Date.now()): boolean {
  const recent = (ipAttempts.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_IP) {
    ipAttempts.set(ip, recent);
    return false;
  }
  recent.push(now);
  ipAttempts.set(ip, recent);
  return true;
}

/** Test-only: clears rate-limit state between test files. */
export function resetAccessRequestRateLimits(): void {
  ipAttempts.clear();
}
