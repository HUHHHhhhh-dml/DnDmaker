import { useEffect, useMemo, useState } from "react";
import type {
  DungeonRoomKind,
  PublicDungeonRoom,
  PublicDungeonRun,
} from "@protocol-life/shared";
import { Icon, type IconName } from "../Icons";
import { cx } from "../ui";
import "./DungeonScene.css";

/**
 * Escena de la mazmorra en vivo (Fase 4C).
 *
 * Vista presentacional: el snapshot público (`PublicDungeonRun`) no trae notas
 * privadas ni `encounterId`, así que aquí solo se pinta lo que ve la mesa. Los
 * controles del DM viven en el panel «Mazmorra en la mesa» de la TablePage;
 * esta escena no enseña botones para no duplicar acciones.
 */

export type DungeonSceneViewer = { role: "dm" } | { role: "player" };

export interface DungeonSceneProps {
  run: PublicDungeonRun;
  viewer: DungeonSceneViewer;
}

const VIDEO_SOURCE = /\.(mp4|webm)$/i;

const KIND_META: Record<DungeonRoomKind, { label: string; icon: IconName }> = {
  encounter: { label: "Encuentro", icon: "sword" },
  boss: { label: "Jefe", icon: "skull" },
  rest: { label: "Descanso", icon: "flame" },
  treasure: { label: "Tesoro", icon: "cube" },
};

/** Detecta vídeo por extensión, ignorando query string y hash. */
function isVideoSource(source: string | undefined): boolean {
  if (!source) return false;
  const [path = ""] = source.split(/[?#]/);
  return VIDEO_SOURCE.test(path);
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function DungeonScene({ run, viewer }: DungeonSceneProps) {
  const [backgroundFailed, setBackgroundFailed] = useState(false);
  const isDm = viewer.role === "dm";

  const total = run.rooms.length;
  const currentIndex = Math.max(
    0,
    run.rooms.findIndex((room) => room.id === run.currentRoomId),
  );
  const currentRoom: PublicDungeonRoom | null =
    run.rooms.find((room) => room.id === run.currentRoomId) ??
    run.rooms[0] ??
    null;

  const background = currentRoom?.background?.trim() || undefined;
  const video = isVideoSource(background);

  useEffect(() => {
    setBackgroundFailed(false);
  }, [background]);

  const clearedIds = useMemo(
    () => new Set(run.clearedRoomIds),
    [run.clearedRoomIds],
  );
  const openedIds = useMemo(
    () => new Set(run.openedRoomIds),
    [run.openedRoomIds],
  );
  const restedIds = useMemo(
    () => new Set(run.restedRoomIds),
    [run.restedRoomIds],
  );

  const clearedCount = run.rooms.filter((room) => clearedIds.has(room.id)).length;
  const currentCleared = currentRoom ? clearedIds.has(currentRoom.id) : false;
  const currentOpened = currentRoom ? openedIds.has(currentRoom.id) : false;
  const currentRested = currentRoom ? restedIds.has(currentRoom.id) : false;
  const inCombat = Boolean(run.combatId);
  const kind = currentRoom ? KIND_META[currentRoom.kind] : KIND_META.encounter;
  /** Si la run sigue en la primera sala, la entrada fue esa (dato derivado). */
  const atEntry = currentIndex === 0;

  const stageLead = isDm
    ? "La mesa ve esta misma sala en vivo. Los controles están en el panel «Mazmorra en la mesa»."
    : "La escena cambia cuando el DM resuelve la sala. No hay nada que pulsar aquí.";

  return (
    <div className="dungeon-scene-frame">
      <section
        className="dungeon-scene"
        data-viewer={viewer.role}
        data-kind={currentRoom?.kind ?? "encounter"}
        aria-label={`Mazmorra: ${run.dungeonName}`}
      >
        <div className="dungeon-scene-bg" aria-hidden="true">
          <div className="dungeon-scene-fallback" />
          {background && !backgroundFailed ? (
            video ? (
              <video
                className="dungeon-scene-media"
                src={background}
                autoPlay
                loop
                muted
                playsInline
                preload="auto"
                onError={() => setBackgroundFailed(true)}
              />
            ) : (
              <img
                className="dungeon-scene-media"
                src={background}
                alt=""
                onError={() => setBackgroundFailed(true)}
              />
            )
          ) : null}
        </div>
        <div className="dungeon-scene-vignette" aria-hidden="true" />

        <div className="dungeon-scene-content">
          <header className="dungeon-scene-head">
            <div className="dungeon-scene-id">
              <div className="dungeon-scene-kicker">
                <Icon name={isDm ? "broadcast" : "book"} size={12} />
                {isDm ? "Mazmorra en la mesa" : "Mazmorra"}
              </div>
              <h2 className="dungeon-scene-name">{run.dungeonName}</h2>
              {run.dungeonDescription ? (
                <p className="dungeon-scene-desc">{run.dungeonDescription}</p>
              ) : (
                <p className="dungeon-scene-desc dungeon-scene-desc--empty">
                  Un descenso sin mapa: la ruta se descubre sala a sala.
                </p>
              )}
            </div>

            <div className="dungeon-scene-tools">
              <div
                className="dungeon-progress"
                aria-label={`Sala ${currentIndex + 1} de ${total}`}
              >
                <span className="dungeon-progress-label">Sala</span>
                <span className="dungeon-progress-value">
                  <b>{currentIndex + 1}</b>
                  <span>/ {total}</span>
                </span>
              </div>

              <div className="dungeon-scene-chips">
                <span className="dungeon-chip" data-kind={currentRoom?.kind}>
                  <Icon name={kind.icon} size={11} />
                  {kind.label}
                </span>
                <span className="dungeon-chip dungeon-chip--current">
                  Sala actual
                </span>
                {inCombat ? (
                  <span className="dungeon-chip dungeon-chip--combat">
                    <Icon name="sword" size={11} />
                    Combate en curso
                  </span>
                ) : null}
              </div>
            </div>
          </header>

          <div className="dungeon-scene-body">
            <div
              className="dungeon-scene-stage"
              data-zone={pad(currentIndex + 1)}
            >
              <div className="dungeon-stage-copy">
                <div className="dungeon-stage-kicker">
                  <span className="dungeon-stage-rule" />
                  Zona {pad(currentIndex + 1)}
                  {atEntry ? " · Entrada" : ""}
                </div>

                <h3 className="dungeon-stage-name">
                  {currentRoom?.name ?? "Sala desconocida"}
                </h3>

                {currentRoom?.description ? (
                  <p className="dungeon-stage-lead">{currentRoom.description}</p>
                ) : (
                  <p className="dungeon-stage-lead dungeon-stage-lead--empty">
                    El DM no ha dejado texto público para esta sala.
                  </p>
                )}

                <div className="dungeon-stage-meta">
                  <span className="dungeon-meta-chip">
                    <span>Superadas</span>
                    <b>
                      {clearedCount}/{total}
                    </b>
                  </span>
                  <span className="dungeon-meta-chip">
                    <span>Pendientes</span>
                    <b>{total - clearedCount}</b>
                  </span>
                  {currentOpened ? (
                    <span className="dungeon-meta-chip dungeon-meta-chip--gold">
                      <span>Cofre</span>
                      <b>
                        {currentRoom?.unlockRewards
                          ? "desbloqueado"
                          : "abierto"}
                      </b>
                    </span>
                  ) : currentRoom?.kind === "treasure" &&
                    currentRoom.unlockRewards ? (
                    <span className="dungeon-meta-chip dungeon-meta-chip--gold">
                      <span>Cofre</span>
                      <b>desbloqueo</b>
                    </span>
                  ) : null}
                  {currentRested ? (
                    <span className="dungeon-meta-chip dungeon-meta-chip--ok">
                      <span>Descanso</span>
                      <b>usado</b>
                    </span>
                  ) : null}
                  {currentCleared ? (
                    <span className="dungeon-meta-chip dungeon-meta-chip--ok">
                      <span>Estado</span>
                      <b>superada</b>
                    </span>
                  ) : null}
                </div>

                <p className="dungeon-stage-foot">{stageLead}</p>

                {isDm ? (
                  <div className="dungeon-notice dungeon-notice--dm" role="status">
                    <Icon name="broadcast" size={14} className="dungeon-notice-icon" />
                    <div className="dungeon-notice-body">
                      <p className="dungeon-notice-title">
                        Los controles están en el panel de mazmorra
                      </p>
                      <p className="dungeon-notice-copy">
                        Desde «Mazmorra en la mesa» lanzas el encuentro, descansas,
                        abres el cofre o avanzas de sala.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="dungeon-notice" role="status">
                    <span className="dungeon-notice-dot" aria-hidden="true" />
                    <div className="dungeon-notice-body">
                      <p className="dungeon-notice-title">
                        {inCombat
                          ? "Combate en curso"
                          : "El DM está resolviendo la sala…"}
                      </p>
                      <p className="dungeon-notice-copy">
                        {inCombat
                          ? "La escena de combate tiene prioridad. Al terminarlo, la mazmorra vuelve a esta sala."
                          : "Espera aquí: cuando el DM abra el encuentro, el descanso o el cofre, la sala se actualizará sola."}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <aside
              className="dungeon-route"
              aria-label={`Recorrido de ${run.dungeonName}`}
            >
              <div className="dungeon-route-head">
                <div>
                  <div className="dungeon-route-kicker">Recorrido</div>
                  <h3 className="dungeon-route-title">Ruta</h3>
                </div>
                <span className="dungeon-route-count tnum">{pad(total)}</span>
              </div>

              {total === 0 ? (
                <div className="dungeon-route-empty">
                  <div className="dungeon-route-empty-mark" aria-hidden="true">
                    <Icon name="grid" size={22} />
                  </div>
                  <p className="dungeon-route-empty-title">Mazmorra sin salas</p>
                  <p className="dungeon-route-empty-copy">
                    El DM tiene que añadir salas desde el editor de mazmorras.
                  </p>
                </div>
              ) : (
                <div className="dungeon-route-scroll">
                  <ol className="dungeon-route-list">
                    {run.rooms.map((room, index) => {
                      const meta = KIND_META[room.kind];
                      const cleared = clearedIds.has(room.id);
                      const isCurrent = room.id === run.currentRoomId;
                      const opened = openedIds.has(room.id);
                      const rested = restedIds.has(room.id);
                      const state = isCurrent
                        ? "current"
                        : cleared
                          ? "cleared"
                          : "future";
                      const note = opened
                        ? room.unlockRewards
                          ? "reliquia desbloqueada"
                          : "cofre abierto"
                        : rested
                          ? "descansado"
                          : meta.label;

                      return (
                        <li
                          key={room.id}
                          className={cx("dungeon-room", `is-${state}`)}
                          data-kind={room.kind}
                          aria-current={isCurrent ? "step" : undefined}
                        >
                          <span className="dungeon-room-mark" aria-hidden="true">
                            {cleared ? "✓" : pad(index + 1)}
                          </span>
                          <span className="dungeon-room-icon" aria-hidden="true">
                            <Icon name={meta.icon} size={13} />
                          </span>
                          <span className="dungeon-room-body">
                            <span className="dungeon-room-name">{room.name}</span>
                            <span className="dungeon-room-kind">{note}</span>
                          </span>
                          {isCurrent ? (
                            <span className="dungeon-room-flag">
                              {currentCleared ? "Ahora · superada" : "Ahora"}
                            </span>
                          ) : cleared ? (
                            <span className="dungeon-room-flag dungeon-room-flag--done">
                              Superada
                            </span>
                          ) : null}
                        </li>
                      );
                    })}
                  </ol>
                </div>
              )}

              <p className="dungeon-route-foot">
                {isDm
                  ? "La mesa ve esta misma ruta. Tus notas privadas no salen de tu pantalla."
                  : "Solo el texto público de cada sala; las notas del DM no se comparten."}
              </p>
            </aside>
          </div>
        </div>
      </section>
    </div>
  );
}
