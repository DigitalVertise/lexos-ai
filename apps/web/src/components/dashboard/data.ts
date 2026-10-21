import { FIRM_TZ, dubaiDate } from "@/lib/dates";

/** Greeting and long date for "now" in the firm's timezone (Asia/Dubai). */
export function dubaiGreeting(now = new Date()): { greeting: string; dateLabel: string } {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: FIRM_TZ }).format(now));
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const dateLabel = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: FIRM_TZ }).format(now);
  return { greeting, dateLabel };
}

/** ISO timestamp for the start of the window used by the activity sparkline. */
export function sparkWindowStart(days: number, now = new Date()): string {
  return new Date(now.getTime() - (days - 1) * 86_400_000 - 86_400_000).toISOString();
}

/** Count timestamps per Dubai calendar day for the last `days` days (oldest first). */
export function dailyBuckets(timestamps: string[], days: number, now = new Date()): number[] {
  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i--) keys.push(dubaiDate(new Date(now.getTime() - i * 86_400_000).toISOString()));
  const counts = new Map(keys.map((k) => [k, 0]));
  for (const t of timestamps) {
    const k = dubaiDate(t);
    if (counts.has(k)) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return keys.map((k) => counts.get(k) ?? 0);
}

/** Start of the previous month (UTC), matching entitlements.monthStart(). */
export function prevMonthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
}
