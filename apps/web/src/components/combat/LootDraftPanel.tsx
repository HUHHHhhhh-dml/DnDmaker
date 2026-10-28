import { useMemo, useState } from "react";
import {
  lootTotalItems,
  lootTurnCharacter,
  lootTurnNumber,
  type Campaign,
  type LootDraft,
} from "@protocol-life/shared";
import { Icon } from "../Icons";
import { Button, ConfirmDialog, SectionTitle, cx } from "../ui";

/**
 * Reparto de botín por turnos (Fase 4A-2).
 *
 * Solo aparece cuando la campaña tiene `settings.shareLoot === false` y el
 * encuentro ganado dejó objetos. El servidor es la única autoridad: aquí solo
 * se pinta el draft, se agrupa el pool y se ofrecen los botones del turno.
 *
 * El pool se agrupa por `itemId` (los ids repetidos son copias) y el botón
 * «Coger» manda el índice de la **primera** unidad de ese grupo.
 */

export type LootViewer =
  | { role: "dm" }
  | { role: "player"; characterId: string };

export interface LootDraftPanelProps {
  draft: LootDraft;
  campaign: Campaign;
  viewer: LootViewer;
  busy?: boolean;
  error?: string | null;
  onPick?: (itemIndex: number) => void;
  onSkip?: () => void;
  onClose?: () => void;
}

interface PoolGroup {
  itemId: string;
  /** Índice de la primera copia dentro de `draft.pool`. */
  firstIndex: number;
  count: number;
}

const DELETED_CHARACTER = "Personaje eliminado";
const DELETED_ITEM = "Objeto eliminado";

function groupPool(pool: readonly string[]): PoolGroup[] {
  const groups = new Map<string, PoolGroup>();
  pool.forEach((itemId, index) => {
    const current = groups.get(itemId);
    if (current) {
      current.count += 1;
      return;
    }
    groups.set(itemId, { itemId, firstIndex: index, count: 1 });
  });
  return [...groups.values()];
}

export function LootDraftPanel({
  draft,
  campaign,
  viewer,
  busy = false,
  error = null,
  onPick,
  onSkip,
  onClose,
}: LootDraftPanelProps) {
  const [confirmClose, setConfirmClose] = useState(false);

  const charactersById = useMemo(
    () =>
      new Map(
        campaign.content.characters.map((character) => [character.id, character]),
      ),
    [campaign.content.characters],
  );
  const itemsById = useMemo(
    () => new Map(campaign.content.items.map((item) => [item.id, item])),
    [campaign.content.items],
  );
  const groups = useMemo(() => groupPool(draft.pool), [draft.pool]);

  function characterName(characterId: string): string {
    return charactersById.get(characterId)?.name ?? DELETED_CHARACTER;
  }

  function itemName(itemId: string): string {
    return itemsById.get(itemId)?.name ?? DELETED_ITEM;
  }

  const active = draft.status === "active";
  const turnCharacterId = lootTurnCharacter(draft);
  const myTurn =
    active &&
    viewer.role === "player" &&
    turnCharacterId !== null &&
    viewer.characterId === turnCharacterId;
  const showPick = myTurn && Boolean(onPick);
  const isDm = viewer.role === "dm";
  const totalItems = lootTotalItems(draft);

  return (
    <section
      className="panel animate-rise overflow-hidden"
      aria-label="Reparto de botín"
      data-loot-draft={draft.id}
    >
      <div className="border-b border-ui-line-strong bg-ui-surface-3 px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mono-label">Botín del encuentro</div>
            <h2 className="display mt-1 text-2xl text-ui sm:text-3xl">
              Reparto de botín
            </h2>
            <p className="mt-1 max-w-xl text-[11px] leading-snug text-ui-muted">
              Cada objeto lo elige una ficha, por turnos, en orden de iniciativa
              (serpiente). Los objetos se entregan al elegirlos.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="chip">
              <span className="text-ui-faint">Ronda</span>
              <span className="tnum font-bold text-ui">{draft.round}</span>
            </span>
            {draft.order.length > 0 ? (
              <span className="chip">
                <span className="text-ui-faint">Turno</span>
                <span className="tnum font-bold text-ui">
                  {lootTurnNumber(draft)} de {draft.order.length}
                </span>
              </span>
            ) : null}
            <span className="chip">
              <span className="text-ui-faint">Objetos</span>
              <span className="tnum font-bold text-ui">{totalItems}</span>
            </span>
            <span
              className={cx(
                "chip",
                active
                  ? "border-moss/50 bg-moss/10 text-ui-ok"
                  : "text-ui-faint",
              )}
            >
              <Icon name={active ? "unlock" : "lock"} size={10} />
              {active ? "Activo" : "Cerrado"}
            </span>
          </div>
        </div>
      </div>

      <div className="space-y-4 p-4">
        {error ? (
          <div
            role="alert"
            className="flex items-start gap-2 border border-rust bg-rust/10 p-3 text-ui-danger"
          >
            <Icon name="alert" size={15} className="mt-0.5 shrink-0" />
            <p className="min-w-0 flex-1 text-xs font-semibold leading-relaxed">
              {error}
            </p>
          </div>
        ) : null}

        {draft.status === "done" ? (
          <div className="flex items-start gap-2 border border-ui-line-strong bg-ui-surface-2 p-3">
            <Icon name="lock" size={16} className="mt-0.5 shrink-0 text-ui-faint" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-ui">Reparto cerrado</div>
              <p className="mt-0.5 text-[11px] leading-snug text-ui-muted">
                {draft.pool.length === 0
                  ? "Todos los objetos del botín se repartieron entre la party."
                  : "Lo que nadie eligió se queda fuera: los objetos no reclamados se pierden."}
              </p>
            </div>
          </div>
        ) : (
          <div
            className={cx(
              "flex flex-wrap items-center gap-3 border p-3",
              myTurn
                ? "border-ui-accent bg-amber/15"
                : "border-ui-line bg-ui-surface-2",
            )}
          >
            <div
              className={cx(
                "flex h-10 w-10 shrink-0 items-center justify-center border border-ui-line-strong",
                myTurn
                  ? "bg-amber/20 text-ui-accent hexagon"
                  : "bg-ui-surface-3 text-ui-faint pentagon",
              )}
            >
              <Icon name={myTurn ? "spark" : "users"} size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="mono-label">Turno actual</div>
              <div className="mt-0.5 truncate text-sm font-semibold text-ui">
                {turnCharacterId ? characterName(turnCharacterId) : "Sin participantes"}
              </div>
              <div className="mt-0.5 text-[11px] font-semibold leading-snug text-ui-muted">
                {turnCharacterId === null
                  ? "El reparto no tiene fichas participantes; puedes cerrarlo."
                  : myTurn
                    ? "Te toca a ti"
                    : isDm
                      ? `Le toca elegir a ${characterName(turnCharacterId)}`
                      : `Esperando a ${characterName(turnCharacterId)}`}
              </div>
            </div>
            {showPick ? (
              <span className="chip chip-accent shrink-0">
                <Icon name="cube" size={10} />
                Elige un objeto
              </span>
            ) : null}
          </div>
        )}

        <div>
          <SectionTitle
            title={active ? "Botín pendiente" : "Sin asignar"}
            count={draft.pool.length}
            action={
              <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-ui-faint">
                {groups.length} tipo{groups.length === 1 ? "" : "s"}
              </span>
            }
          />
          {groups.length === 0 ? (
            <p className="border border-dashed border-ui-line px-3 py-3 text-xs text-ui-muted">
              {active
                ? "El pool está vacío: no queda nada por repartir."
                : "No quedaron objetos sin asignar."}
            </p>
          ) : (
            <div className="divide-y divide-[color:var(--ui-line)] border border-ui-line bg-ui-surface-2">
              {groups.map((group) => {
                const item = itemsById.get(group.itemId);
                return (
                  <div
                    key={group.itemId}
                    className="flex flex-wrap items-center gap-2 px-3 py-2"
                  >
                    <Icon name="cube" size={13} className="shrink-0 text-ui-faint" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="truncate text-xs font-semibold text-ui">
                          {item?.name ?? DELETED_ITEM}
                        </span>
                        {item?.code ? (
                          <span className="font-mono text-[9px] text-ui-faint">
                            {item.code}
                          </span>
                        ) : null}
                      </div>
                      {item?.description ? (
                        <p className="mt-0.5 line-clamp-1 text-[10px] leading-snug text-ui-muted">
                          {item.description}
                        </p>
                      ) : null}
                    </div>
                    <span className="chip tnum shrink-0">×{group.count}</span>
                    {showPick ? (
                      <Button
                        type="button"
                        variant="accent"
                        size="sm"
                        disabled={busy}
                        onClick={() => onPick?.(group.firstIndex)}
                      >
                        Coger
                      </Button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <SectionTitle title="Historial" count={draft.picks.length} />
          {draft.picks.length === 0 ? (
            <p className="text-xs text-ui-muted">Todavía nadie ha cogido nada.</p>
          ) : (
            <ol className="space-y-1">
              {draft.picks.map((pick, index) => (
                <li
                  key={`${String(index)}:${pick.at}`}
                  className="flex flex-wrap items-center gap-1.5 border border-ui-line bg-ui-surface-2 px-2 py-1.5 text-xs"
                >
                  <Icon name="cube" size={12} className="shrink-0 text-ui-faint" />
                  <span className="font-semibold text-ui">
                    {characterName(pick.characterId)}
                  </span>
                  <span className="text-ui-muted">cogió</span>
                  <span className="font-semibold text-ui">
                    {itemName(pick.itemId)}
                  </span>
                  <span className="ml-auto font-mono text-[9px] uppercase tracking-[0.1em] text-ui-faint">
                    {new Date(pick.at).toLocaleTimeString("es-ES")}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>

        {active && isDm ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-ui-line pt-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon="arrow-left"
              disabled={busy || !onSkip}
              onClick={onSkip}
            >
              Saltar turno
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon="lock"
              disabled={busy || !onClose}
              onClick={() => setConfirmClose(true)}
            >
              Cerrar reparto
            </Button>
            <span className="text-[10px] leading-snug text-ui-faint">
              Saltar turno no entrega objeto. Cerrar descarta lo no elegido.
            </span>
          </div>
        ) : null}

        {active && !isDm ? (
          <p className="border-t border-ui-line pt-3 text-[10px] leading-snug text-ui-faint">
            Solo puedes coger en tu turno. El DM puede saltar turnos y cerrar el
            reparto.
          </p>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmClose}
        title="Cerrar el reparto"
        message={
          <>
            Se cerrará el reparto y{" "}
            <strong>
              {draft.pool.length === 0
                ? "no queda ningún objeto pendiente"
                : `los ${draft.pool.length} objeto${
                    draft.pool.length === 1 ? "" : "s"
                  } sin asignar se perderán`}
            </strong>
            . Los objetos ya elegidos se quedan en el inventario de cada ficha; el
            reparto no se puede reabrir.
          </>
        }
        confirmLabel="Cerrar reparto"
        onCancel={() => setConfirmClose(false)}
        onConfirm={() => {
          setConfirmClose(false);
          onClose?.();
        }}
        busy={busy}
      />
    </section>
  );
}
