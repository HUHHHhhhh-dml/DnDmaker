import type { Campaign, PublicCombatState } from "@protocol-life/shared";
import { Icon } from "../Icons";
import { Button, cx } from "../ui";
import { CombatLog } from "./CombatLog";
import { isAliveUnit } from "../../lib/combat";

/**
 * Resultado + log de un combate terminado (Fase 3F, riesgo 2).
 *
 * Se usa tanto para el combate que acaba de terminar como para el
 * `recentCombat` que el servidor reenvía al reconectar dentro del TTL. El
 * usuario puede descartarlo; el descarte se recuerda en localStorage.
 */

export interface CombatResultPanelProps {
  campaign: Pick<Campaign, "content">;
  combat: PublicCombatState;
  onDismiss: () => void;
  dismissLabel?: string;
  eyebrow?: string;
  /** Si es true, el log oculta el HP exacto de los enemigos. */
  hideEnemyHp?: boolean;
}

export function CombatResultPanel({
  campaign,
  combat,
  onDismiss,
  dismissLabel = "Descartar resultado",
  eyebrow = "Último combate",
  hideEnemyHp = false,
}: CombatResultPanelProps) {
  const party = combat.units.filter((unit) => unit.team === "players");
  const enemies = combat.units.filter((unit) => unit.team === "enemies");
  const partyAlive = party.filter(isAliveUnit).length;
  const enemiesAlive = enemies.filter(isAliveUnit).length;
  const winner =
    combat.winner === "players"
      ? "Victoria de la party"
      : combat.winner === "enemies"
        ? "La party ha caído"
        : "Combate terminado sin ganador";

  return (
    <section
      className="animate-rise space-y-4"
      data-combat-result={combat.id}
      aria-label="Resultado del último combate"
    >
      <div
        className={cx(
          "panel flex flex-wrap items-center gap-4 p-4",
          combat.winner === "players"
            ? "border-moss bg-moss/10"
            : combat.winner === "enemies"
              ? "border-rust bg-rust/10"
              : "border-ui-line-strong bg-ui-surface-3",
        )}
      >
        <div
          className={cx(
            "flex h-14 w-14 shrink-0 items-center justify-center border border-ui-line-strong",
            combat.winner === "players"
              ? "bg-moss/20 hexagon"
              : "bg-rust/15 pentagon",
          )}
        >
          <Icon name={combat.winner === "players" ? "spark" : "skull"} size={24} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="mono-label">{eyebrow}</div>
          <h2 className="display mt-1 text-3xl">{winner}</h2>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="chip">Ronda {combat.round}</span>
            <span className="chip">
              Party {partyAlive}/{party.length}
            </span>
            <span className="chip">
              Enemigos {enemiesAlive}/{enemies.length}
            </span>
            <span className="chip">{combat.log.length} eventos</span>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          icon="close"
          onClick={onDismiss}
        >
          {dismissLabel}
        </Button>
      </div>

      <CombatLog
        events={combat.log}
        units={combat.units}
        content={campaign.content}
        emptyLabel="Ese combate no dejó eventos."
        hideEnemyHp={hideEnemyHp}
      />
    </section>
  );
}
