/**
 * Descarte local del último combate (Fase 3F, riesgo 2).
 *
 * El servidor reenvía el combate terminado durante el TTL en `state:full`.
 * Cuando el jugador o el DM lo descartan, recordamos ese `combatId` en
 * localStorage para no volver a mostrarlo al recargar. El TTL del servidor
 * sigue siendo la garantía de que el resultado no se conserva para siempre.
 */

const STORAGE_KEY = "protocol-life:dismissed-recent-combats";
const MAX_ENTRIES = 20;

function keyFor(code: string, combatId: string): string {
  return `${code.trim().toUpperCase()}:${combatId}`;
}

function readEntries(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

function writeEntries(entries: string[]): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(entries.slice(-MAX_ENTRIES)),
    );
  } catch {
    // localStorage puede no estar disponible; el TTL del servidor sigue ahí.
  }
}

export function isRecentCombatDismissed(
  code: string,
  combatId: string,
): boolean {
  return readEntries().includes(keyFor(code, combatId));
}

export function rememberRecentCombatDismissed(
  code: string,
  combatId: string,
): void {
  const key = keyFor(code, combatId);
  const entries = readEntries();
  if (entries.includes(key)) return;
  writeEntries([...entries, key]);
}
