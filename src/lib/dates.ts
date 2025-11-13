// src/lib/dates.ts
export function toDateSafe(input: unknown): Date | null {
  if (!input && input !== 0) return null;
  if (input instanceof Date) return isNaN(input.getTime()) ? null : input;
  const d = new Date(input as any);
  return isNaN(d.getTime()) ? null : d;
}

/** -> "YYYY-MM-DD" (e.g., "2025-10-07") */
export function toISODate(input: unknown): string | null {
  const d = toDateSafe(input);
  if (!d) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** -> "YYYY-MM" (e.g., "2025-10") */
export function toMonthKey(input: unknown): string | null {
  const d = toDateSafe(input);
  if (!d) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}
