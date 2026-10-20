/**
 * The firm's working timezone. UAE has no daylight saving (UTC+4 all year),
 * so a fixed offset is exact. Other jurisdictions will need a per-firm zone.
 */
export const FIRM_TZ = "Asia/Dubai";
const DUBAI_OFFSET_MINUTES = 4 * 60;

/** "2026-11-03" (end of that day, 17:00) or "2026-11-03T09:30" in Dubai time → UTC ISO. */
export function dubaiDateToUtc(value: string): string {
  const [date, time] = value.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = (time ?? "17:00").split(":").map(Number);
  const local = new Date(Date.UTC(y, m - 1, d, hh, mm));
  // Reject impossible dates such as 2026-02-31 (Date would silently roll over).
  if (Number.isNaN(local.getTime()) || local.getUTCFullYear() !== y || local.getUTCMonth() !== m - 1
      || local.getUTCDate() !== d || hh > 23 || mm > 59) {
    throw new Error("Invalid date");
  }
  return new Date(local.getTime() - DUBAI_OFFSET_MINUTES * 60_000).toISOString();
}

/** Calendar date (YYYY-MM-DD) in Dubai for a UTC timestamp. */
export function dubaiDate(iso: string): string {
  return new Date(new Date(iso).getTime() + DUBAI_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
}

export type DueState = "overdue" | "today" | "soon" | "later" | "none";

export function dueState(dueAt: string | null, now = new Date()): DueState {
  if (!dueAt) return "none";
  const due = new Date(dueAt).getTime();
  const today = dubaiDate(now.toISOString());
  const dueDay = dubaiDate(dueAt);
  if (due < now.getTime() && dueDay !== today) return "overdue";
  if (dueDay === today) return "today";
  if (due - now.getTime() <= 7 * 86_400_000) return "soon";
  return "later";
}

/** Whole days from now until `iso` (never negative). Server-side helper. */
export function daysUntil(iso: string, now = new Date()): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now.getTime()) / 86_400_000));
}

/** ISO timestamp `days` from now. */
export function isoDaysFromNow(days: number, now = new Date()): string {
  return new Date(now.getTime() + days * 86_400_000).toISOString();
}
