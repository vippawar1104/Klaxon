/** Whole days remaining until trial_ends_at, rounded up so "expires in a few
 * hours" still reads as "1 day left" rather than "0 days left" while the
 * account can still actually use the dashboard. null input (no trial set —
 * a comped or already-pro account) returns null, meaning "don't show a
 * countdown at all," not zero. */
export function daysLeft(trialEndsAt: string | null): number | null {
  if (!trialEndsAt) return null
  const ms = new Date(trialEndsAt).getTime() - Date.now()
  return Math.max(0, Math.ceil(ms / 86_400_000))
}
