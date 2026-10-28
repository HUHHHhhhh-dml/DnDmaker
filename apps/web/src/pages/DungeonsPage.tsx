import { useMemo, useState } from "react";
import type {
  Dungeon,
  DungeonRoom,
  DungeonRoomKind,
} from "@protocol-life/shared";
import { api } from "../lib/api";
import { describeError, useAppStore } from "../store/useAppStore";
import { Icon } from "../components/Icons";
import {
  Button,
  ConfirmDialog,
  EmptyState,
  LinkButton,
  PageHeader,
  TextInput,
  cx,
} from "../components/ui";

const ROOM_KIND_ORDER: DungeonRoomKind[] = [
  "encounter",
  "boss",
  "rest",
  "treasure",
];

const ROOM_KIND_LABELS: Record<DungeonRoomKind, string> = {
  encounter: "Encuentro",
  boss: "Jefe",
  rest: "Descanso",
  treasure: "Tesoro",
};

const ROOM_KIND_CHIP_TONES: Record<DungeonRoomKind, string> = {
  encounter: "",
  boss: "border-rust/50 bg-rust/10 text-ui-danger",
  rest: "border-moss/50 bg-moss/10 text-ui-ok",
  treasure: "border-amber/50 bg-amber/10 text-ui-gold",
};

function roomKind(room: DungeonRoom): DungeonRoomKind {
  return room.kind ?? "encounter";
}

/** Salas de combate sin encuentro: se juegan como ambientación. */
function isAmbience(room: DungeonRoom): boolean {
  const kind = roomKind(room);
  return (kind === "encounter" || kind === "boss") && !room.encounterId;
}

function kindCounts(rooms: DungeonRoom[]): Record<DungeonRoomKind, number> {
  return rooms.reduce<Record<DungeonRoomKind, number>>(
    (acc, room) => {
      acc[roomKind(room)] += 1;
      return acc;
    },
    { encounter: 0, boss: 0, rest: 0, treasure: 0 },
  );
}

function DungeonCard({ dungeon }: { dungeon: Dungeon }) {
  const campaignId = useAppStore((state) => state.campaign?.id);
  const notify = useAppStore((state) => state.notify);
  const refreshCampaign = useAppStore((state) => state.refreshCampaign);

  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const counts = kindCounts(dungeon.rooms);
  const unlockChests = dungeon.rooms.filter(
    (room) => roomKind(room) === "treasure" && room.unlockRewards === true,
  ).length;
  const linked = dungeon.rooms.filter((room) => room.encounterId).length;
  const ambience = dungeon.rooms.filter(isAmbience).length;
  const explicitEntry = dungeon.rooms.find(
    (room) => room.id === dungeon.entryRoomId,
  );
  const firstRoom = dungeon.rooms[0];

  async function handleDelete() {
    if (!campaignId) return;
    setDeleting(true);
    try {
      await api.deleteDungeon(campaignId, dungeon.id);
      await refreshCampaign();
      notify("ok", `«${dungeon.name}» eliminada.`);
      setConfirmDelete(false);
    } catch (error) {
      notify("error", describeError(error));
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <article className="panel flex flex-col overflow-hidden">
      <div className="border-b border-ui-line-strong bg-ui-surface-3 px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="display min-w-0 truncate text-xl text-ui">
            {dungeon.name}
          </h3>
          <span className="chip shrink-0">
            <Icon name="shield" size={10} />
            Lineal
          </span>
        </div>
        <p className="mt-1 line-clamp-2 min-h-[2rem] text-xs leading-snug text-ui-muted">
          {dungeon.description || "Sin descripción."}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-px border-b border-ui-line bg-ui-surface-1">
        <div className="bg-ui-surface-2 px-3 py-2">
          <div className="mono-label">Salas</div>
          <div className="mt-0.5 font-display text-xl leading-none text-ui">
            {String(dungeon.rooms.length).padStart(2, "0")}
          </div>
        </div>
        <div className="bg-ui-surface-2 px-3 py-2">
          <div className="mono-label">Con encuentro</div>
          <div
            className={cx(
              "tnum mt-0.5 font-display text-xl leading-none",
              linked > 0 ? "text-ui" : "text-ui-faint",
            )}
          >
            {String(linked).padStart(2, "0")}
          </div>
        </div>
      </div>

      <div className="space-y-2 p-3">
        <div className="flex flex-wrap gap-1">
          {ROOM_KIND_ORDER.map((kind) => (
            <span
              key={kind}
              className={cx(
                "chip",
                counts[kind] > 0 ? ROOM_KIND_CHIP_TONES[kind] : "opacity-45",
              )}
              title={`${counts[kind]} sala${counts[kind] === 1 ? "" : "s"} de ${ROOM_KIND_LABELS[kind].toLowerCase()}`}
            >
              {ROOM_KIND_LABELS[kind]}
              <span className="tnum font-bold">{counts[kind]}</span>
            </span>
          ))}
        </div>

        <p className="flex items-start gap-1.5 text-[11px] leading-snug text-ui-muted">
          <Icon
            name="crosshair"
            size={12}
            className="mt-0.5 shrink-0 text-ui-accent"
          />
          <span className="min-w-0">
            <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-ui-faint">
              Entrada
            </span>{" "}
            <span className="font-semibold text-ui">
              {explicitEntry?.name ?? "primera sala"}
            </span>
            {!explicitEntry && firstRoom ? (
              <span className="text-ui-faint"> · {firstRoom.name}</span>
            ) : null}
          </span>
        </p>

        <p className="border-t border-ui-line pt-2 font-mono text-[9px] uppercase tracking-[0.12em] text-ui-faint">
          {String(counts.rest).padStart(2, "0")} descansos ·{" "}
          {String(counts.treasure).padStart(2, "0")} tesoros
          {unlockChests > 0
            ? ` · ${String(unlockChests).padStart(2, "0")} desbloqueo${
                unlockChests === 1 ? "" : "s"
              }`
            : ""}
        </p>

        {ambience > 0 ? (
          <p className="flex items-start gap-1.5 border border-amber/40 bg-amber/10 px-2 py-1.5 text-[10px] leading-snug text-ui-warn">
            <Icon name="alert" size={12} className="mt-0.5 shrink-0" />
            {ambience} sala{ambience === 1 ? "" : "s"} sin encuentro: se jugará
            {ambience === 1 ? "" : "n"} como ambientación.
          </p>
        ) : null}
      </div>

      <div className="mt-auto flex flex-wrap gap-1.5 border-t border-ui-line p-3">
        <LinkButton
          to={`/dungeons/${dungeon.id}`}
          variant="ghost"
          size="sm"
          icon="edit"
        >
          Editar
        </LinkButton>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          icon="trash"
          disabled={deleting}
          onClick={() => setConfirmDelete(true)}
        >
          Eliminar
        </Button>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Eliminar mazmorra"
        message={
          <>
            Vas a eliminar <strong>«{dungeon.name}»</strong> con sus{" "}
            {dungeon.rooms.length} sala{dungeon.rooms.length === 1 ? "" : "s"}.
            Las fichas, encuentros y objetos de la campaña no cambian.
          </>
        }
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void handleDelete()}
        busy={deleting}
      />
    </article>
  );
}

export function DungeonsPage() {
  const campaign = useAppStore((state) => state.campaign);
  const [search, setSearch] = useState("");

  const dungeons = campaign?.content.dungeons ?? [];
  const needle = search.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      dungeons.filter(
        (dungeon) =>
          !needle ||
          dungeon.name.toLowerCase().includes(needle) ||
          (dungeon.description ?? "").toLowerCase().includes(needle),
      ),
    [dungeons, needle],
  );

  if (!campaign) return null;

  const totalRooms = dungeons.reduce(
    (sum, dungeon) => sum + dungeon.rooms.length,
    0,
  );
  const totalLinked = dungeons.reduce(
    (sum, dungeon) =>
      sum + dungeon.rooms.filter((room) => room.encounterId).length,
    0,
  );
  const totalAmbience = dungeons.reduce(
    (sum, dungeon) => sum + dungeon.rooms.filter(isAmbience).length,
    0,
  );

  return (
    <div className="animate-rise">
      <PageHeader
        eyebrow="Aventuras · Mazmorras"
        title="Mazmorras"
        description="Recorridos lineales de salas: encuentros, descansos, cofres y un jefe final. Prepara aquí el orden del recorrido, la entrada y las notas privadas de cada sala."
        actions={
          <LinkButton
            to="/dungeons/new"
            variant="accent"
            size="sm"
            icon="plus"
          >
            Nueva mazmorra
          </LinkButton>
        }
      />

      <div className="mb-4 flex flex-col gap-2 border border-ui-line-strong bg-ui-surface-3 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[9px] uppercase tracking-[0.14em] text-ui-muted">
          <span className="chip">
            <span className="text-ui-faint">Mazmorras</span>
            <span className="tnum font-bold text-ui">{dungeons.length}</span>
          </span>
          <span className="chip">
            <span className="text-ui-faint">Salas</span>
            <span className="tnum font-bold text-ui">{totalRooms}</span>
          </span>
          <span className="chip">
            <span className="text-ui-faint">Con encuentro</span>
            <span className="tnum font-bold text-ui">{totalLinked}</span>
          </span>
          <span className="chip">
            <span className="text-ui-faint">Ambientación</span>
            <span className="tnum font-bold text-ui">{totalAmbience}</span>
          </span>
        </div>
        <p className="max-w-md text-[10px] leading-snug text-ui-muted">
          Una sala sin encuentro sigue siendo válida: se juega como escena de
          ambientación con su fondo y su descripción pública.
        </p>
      </div>

      <div className="mb-5 flex flex-col gap-3 border border-ui-line-strong bg-ui-surface-2 p-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Icon
            name="search"
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ui-faint"
          />
          <TextInput
            value={search}
            onValueChange={setSearch}
            placeholder="Buscar mazmorra por nombre o descripción…"
            className="pl-9"
          />
        </div>
        <span className="mono-label tnum shrink-0">
          {filtered.length} de {dungeons.length} mazmorras
        </span>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon="shield"
          title={
            dungeons.length === 0
              ? "Todavía no hay mazmorras"
              : "Ninguna mazmorra coincide"
          }
          description={
            dungeons.length === 0
              ? "Crea el primer recorrido: añade salas, marca la entrada y enlaza los encuentros que lanzará cada una. También puedes preparar salas de descanso y cofres con recompensa."
              : "Prueba con otro nombre o descripción."
          }
          action={
            dungeons.length === 0 ? (
              <LinkButton to="/dungeons/new" size="sm" icon="plus">
                Crear la primera mazmorra
              </LinkButton>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setSearch("")}>
                Limpiar búsqueda
              </Button>
            )
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((dungeon) => (
            <DungeonCard key={dungeon.id} dungeon={dungeon} />
          ))}
        </div>
      )}

      <p className="mt-5 text-[11px] leading-relaxed text-ui-faint">
        Las mazmorras se preparan aquí; recorrerlas en la mesa en vivo se activa
        en la siguiente subfase. El orden de las salas es el orden de la run.
      </p>
    </div>
  );
}
