import { STAT_KEYS, STAT_LABELS, type Stats } from "@protocol-life/shared";

export function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

export function formatDate(iso: string | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(iso: string | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("es-ES", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function plural(count: number, singular: string, pluralForm?: string): string {
  return count === 1 ? singular : (pluralForm ?? `${singular}s`);
}

export function statEntries(stats: Partial<Stats> | undefined): Array<{
  key: keyof Stats;
  label: string;
  value: number;
}> {
  if (!stats) return [];
  return STAT_KEYS.flatMap((key) => {
    const value = stats[key];
    if (typeof value !== "number" || value === 0) return [];
    return [{ key, label: STAT_LABELS[key], value }];
  });
}

export function normalizedCode(code: string | undefined, fallback: string): string {
  const trimmed = code?.trim();
  if (trimmed) return trimmed;
  return fallback.slice(-6).toUpperCase();
}

export const SLOT_ORDER = ["horns", "hand", "armor", "leg", "utility"] as const;
