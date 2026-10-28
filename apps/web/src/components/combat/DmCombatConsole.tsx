import { useState } from "react";
import { Link } from "react-router-dom";
import type {
  Campaign,
  PublicCombatState,
} from "@protocol-life/shared";
import { Icon } from "../Icons";
import { Button, ConfirmDialog, SectionTitle, Select, cx } from "../ui";
import { CombatDeclarationPanel } from "./CombatDeclarationPanel";
import { CombatLog } from "./CombatLog";
import { CombatResultPanel } from "./CombatResultPanel";
import { CombatScene } from "./CombatScene";
import {
  isAliveUnit,
  isUnitLocked,
  type CombatDeclaration,
} from "../../lib/combat";
import { useLiveStore } from "../../store/useLiveStore";

/**
 * Consola de combate del DM (Fase 3F).
 *
 * Ve el estado read-only de todas las unidades, declara las acciones de los
 * enemigos con el mismo panel que usa el jugador, bloquea a los enemigos y
 * termina el encuentro. No ajusta HP ni efectos: eso está cerrado por diseño.
 */

const PHASE_LABELS: Record<PublicCombatState["phase"], string> = {
  declaring: "Declaración",
  resolving: "Resolviendo",
  ended: "Terminado",
};

export interface DmCombatConsoleProps {
  campaign: Campaign;
}

export function DmCombatConsole({ campaign }: DmCombatConsoleProps) {
  const combat = useLiveStore((state) => state.combat);
  const events = useLiveStore((state) => state.combatEvents);
  const connected = useLiveStore((state) => state.connected);
  const combatError = useLiveStore((state) => state.combatError);
  const declareCombat = useLiveStore((state) => state.declareCombat);
  const lockCombat = useLiveStore((state) => state.lockCombat);
  const endCombat = useLiveStore((state) => state.endCombat);
  const dismissCombat = useLiveStore((state) => state.dismissCombat);
  const clearCombatError = useLiveStore((state) => state.clearCombatError);
  const setCombatScene = useLiveStore((state) => state.setCombatScene);

  const [selectedEnemyId, setSelectedEnemyId] = useState<string | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);

  if (!combat) return null;

  if (combat.phase === "ended") {
    return (
      <CombatResultPanel
        campaign={campaign}
        combat={combat}
        onDismiss={dismissCombat}
        eyebrow="Combate terminado"
        dismissLabel="Cerrar resultado"
      />
    );
  }

  return (
    <DmCombatConsoleBody
      campaign={campaign}
      combat={combat}
      events={events}
      connected={connected}
      combatError={combatError}
      selectedEnemyId={selectedEnemyId}
      onSelectEnemy={setSelectedEnemyId}
      onDeclare={declareCombat}
      onLock={lockCombat}
      onEnd={() => setConfirmEnd(true)}
      onClearError={clearCombatError}
      onSceneChange={(patch) => setCombatScene(patch)}
      confirmEnd={confirmEnd}
      onCancelEnd={() => setConfirmEnd(false)}
      onConfirmEnd={() => {
        setConfirmEnd(false);
        endCombat();
      }}
    />
  );
}

function DmCombatConsoleBody({
  campaign,
  combat,
  events,
  connected,
  combatError,
  selectedEnemyId,
  onSelectEnemy,
  onDeclare,
  onLock,
  onEnd,
  onClearError,
  onSceneChange,
  confirmEnd,
  onCancelEnd,
  onConfirmEnd,
}: {
  campaign: Campaign;
  combat: PublicCombatState;
  events: PublicCombatState["log"];
  connected: boolean;
  combatError: string | null;
  selectedEnemyId: string | null;
  onSelectEnemy: (unitId: string) => void;
  onDeclare: (unitId: string, actions: CombatDeclaration[]) => void;
  onLock: (unitId?: string, actions?: CombatDeclaration[]) => void;
  onEnd: () => void;
  onClearError: () => void;
  onSceneChange: (patch: { theme?: "paper" | "night" }) => void;
  confirmEnd: boolean;
  onCancelEnd: () => void;
  onConfirmEnd: () => void;
}) {
  const content = campaign.content;
  const eventsForLog = events.length > 0 ? events : combat.log;
  const enemies = combat.units
    .filter((unit) => unit.team === "enemies")
    .sort((a, b) => b.stats.spd - a.stats.spd);
  const livingEnemies = enemies.filter(isAliveUnit);
  const selectedEnemy =
    livingEnemies.find((unit) => unit.id === selectedEnemyId) ??
    livingEnemies[0] ??
    null;
  const living = combat.units.filter(isAliveUnit);
  const lockedCount = living.filter((unit) =>
    isUnitLocked(combat, unit.id),
  ).length;
  const enemiesReady = livingEnemies.filter((unit) =>
    isUnitLocked(combat, unit.id),
  ).length;
  const encounter = content.encounters.find(
    (entry) => entry.id === combat.encounterId,
  );

  return (
    <section className="panel p-3 sm:p-4" data-dm-combat-console>
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-ui-line-strong pb-3">
        <div>
          <div className="mono-label flex items-center gap-2">
            <span className="inline-block h-2 w-2 bg-rust" />
            Consola de combate · DM
          </div>
          <h2 className="display mt-1 text-3xl">
            {encounter?.name ?? "Encuentro"} · Ronda {combat.round}
          </h2>
          <p className="mt-1 text-[11px] leading-relaxed text-ui-muted">
            El DM solo controla enemigos. El estado de la party es de solo lectura y
            nadie edita HP ni fichas durante el combate.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="chip chip-accent">{PHASE_LABELS[combat.phase]}</span>
          <span className="chip">
            {lockedCount}/{living.length} listos
          </span>
          <span className="chip">
            Enemigos {enemiesReady}/{livingEnemies.length}
          </span>
          <span
            className={cx("chip", connected ? "text-ui-ok" : "text-ui-danger")}
          >
            <span
              className={cx(
                "inline-block h-1.5 w-1.5 rounded-full",
                connected ? "bg-moss" : "bg-rust",
              )}
            />
            {connected ? "En línea" : "Reconectando"}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            icon="skull"
            onClick={onEnd}
          >
            Terminar combate
          </Button>
        </div>
      </header>

      {combatError ? (
        <div className="mt-3 flex items-start gap-2 border-2 border-rust bg-rust/10 p-2.5 text-ui-danger">
          <Icon name="alert" size={14} className="mt-0.5 shrink-0" />
          <p className="min-w-0 flex-1 text-[11px] font-semibold leading-snug">
            {combatError}
          </p>
          <button
            type="button"
            onClick={onClearError}
            className="shrink-0 font-mono text-[9px] font-bold uppercase tracking-[0.12em] underline"
          >
            Cerrar
          </button>
        </div>
      ) : null}

      <div className="mt-3">
        <CombatScene
          combat={combat}
          campaign={campaign}
          viewer={{ role: "dm" }}
          events={eventsForLog}
          onDeclare={onDeclare}
          onLock={onLock}
          onSceneChange={onSceneChange}
          disabled={!connected}
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <div className="space-y-3">
          <details className="panel group">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5">
              <span>
                <span className="mono-label block">Avanzado</span>
                <span className="mt-0.5 block text-sm font-semibold">
                  Acciones de enemigos
                </span>
              </span>
              <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-ui-faint">
                {livingEnemies.length} vivos · {combat.phase === "declaring" ? "declarando" : "esperando"}
              </span>
            </summary>
            <div className="border-t border-ui-line p-3">
            <SectionTitle
              title="Declaración de enemigos"
              count={livingEnemies.length}
              action={
                <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-ui-faint">
                  {combat.phase === "declaring" ? "declarando" : "esperando"}
                </span>
              }
            />
            {livingEnemies.length === 0 ? (
              <p className="border border-dashed border-ui-line px-3 py-4 text-center text-[11px] text-ui-faint">
                No quedan enemigos vivos.
              </p>
            ) : (
              <>
                <div className="mb-2 flex flex-wrap items-end gap-2">
                  <label className="min-w-0 flex-1">
                    <span className="field-label">Unidad enemiga</span>
                    <Select
                      aria-label="Unidad enemiga a declarar"
                      value={selectedEnemy?.id ?? ""}
                      onValueChange={(value) => onSelectEnemy(value)}
                    >
                      {livingEnemies.map((unit) => (
                        <option key={unit.id} value={unit.id}>
                          {unit.name} · {unit.hpCurrent}/{unit.stats.hpMax} HP ·{" "}
                          {isUnitLocked(combat, unit.id) ? "listo" : "declarando"}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <Button
                    type="button"
                    variant="accent"
                    size="sm"
                    icon="lock"
                    onClick={() => onLock()}
                    disabled={
                      combat.phase !== "declaring" ||
                      enemiesReady >= livingEnemies.length
                    }
                  >
                    Listo (todos)
                  </Button>
                </div>
                <p className="mb-3 text-[10px] leading-relaxed text-ui-faint">
                  «Listo (todos)» bloquea a todos los enemigos vivos. Guarda antes
                  las acciones que quieras usar; los enemigos sin acciones también
                  cuentan como listos.
                </p>
                {selectedEnemy ? (
                  <CombatDeclarationPanel
                    unit={selectedEnemy}
                    combat={combat}
                    content={content}
                    locked={isUnitLocked(combat, selectedEnemy.id)}
                    connected={connected}
                    error={combatError}
                    onDeclare={(actions) =>
                      onDeclare(selectedEnemy.id, actions)
                    }
                    onLock={(actions) =>
                      onLock(selectedEnemy.id, actions)
                    }
                    onClearError={onClearError}
                    title={`Declaración · ${selectedEnemy.name}`}
                    readyLabel="Guardar y bloquear enemigos"
                    subject="La unidad"
                  />
                ) : null}
              </>
            )}
            </div>
          </details>

          <section className="panel p-3">
            <SectionTitle title="Fichas del combate" count={combat.units.length} />
            <div className="grid gap-1.5 sm:grid-cols-2">
              {combat.units.map((unit) => (
                <Link
                  key={unit.id}
                  to={`/characters/${unit.characterId}`}
                  className="flex items-center justify-between gap-2 border border-ui-line bg-ui-surface-2 px-2 py-1.5 text-[11px] font-semibold transition-colors hover:bg-amber/10"
                >
                  <span className="min-w-0 truncate">
                    {unit.name}
                    <span className="ml-1 font-mono text-[8px] font-normal uppercase tracking-[0.1em] text-ui-faint">
                      {unit.team === "players" ? "party" : "enemigo"}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-[8px] text-ui-faint">
                    {unit.hpCurrent}/{unit.stats.hpMax}
                  </span>
                </Link>
              ))}
            </div>
            <p className="mt-2 border-t border-ui-line pt-2 font-mono text-[8px] uppercase tracking-[0.12em] text-ui-faint">
              Solo lectura durante el combate · sin ajustes de HP ni efectos
            </p>
          </section>
        </div>

        <CombatLog
          events={eventsForLog}
          units={combat.units}
          content={content}
          emptyLabel="El combate acaba de empezar; todavía no hay eventos."
        />
      </div>

      <ConfirmDialog
        open={confirmEnd}
        title="Terminar el combate"
        message={
          <>
            Se cerrará el combate en la ronda <strong>{combat.round}</strong> y se
            persistirá el HP actual de la party. Esta acción no se puede deshacer.
          </>
        }
        confirmLabel="Terminar combate"
        onCancel={onCancelEnd}
        onConfirm={onConfirmEnd}
        busy={false}
      />
    </section>
  );
}
