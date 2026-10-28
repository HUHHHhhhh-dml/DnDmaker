import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  CURRENCY_NAME,
  dungeonInputSchema,
  type Dungeon,
  type DungeonInput,
  type DungeonRoomKind,
} from "@protocol-life/shared";
import { api } from "../lib/api";
import { describeError, useAppStore } from "../store/useAppStore";
import { Icon } from "../components/Icons";
import { ImageField } from "../components/ImageField";
import {
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  LinkButton,
  NumberInput,
  PageHeader,
  Select,
  TextArea,
  TextInput,
  Toggle,
  cx,
} from "../components/ui";

const ROOM_KINDS: DungeonRoomKind[] = [
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

const ROOM_KIND_HINTS: Record<DungeonRoomKind, string> = {
  encounter: "Lanza su encuentro al entrar.",
  boss: "Como un encuentro, con acento de jefe final.",
  rest: "Cura a la party una vez; no lanza encuentro.",
  treasure: "El DM abre el cofre una vez y entrega su recompensa.",
};

interface RoomDraft {
  /** Clave local estable para React; no se guarda. */
  key: string;
  /** Id de sala estable en el cliente para poder referenciarlo en la entrada. */
  id: string;
  kind: DungeonRoomKind;
  name: string;
  description: string;
  notes: string;
  encounterId: string;
  background: string | undefined;
  rewardItemIds: string[];
  /** Skills que el cofre desbloquea para toda la campaña al abrirlo. */
  rewardSkillIds: string[];
  rewardCurrency: number | undefined;
  rewardNotes: string;
  /** Cofre A: además de entregar, desbloquea los objetos para la campaña. */
  unlockRewards: boolean;
}

interface DungeonDraft {
  name: string;
  description: string;
  /** Cadena vacía = primera sala. */
  entryRoomId: string;
  rooms: RoomDraft[];
}

let roomSequence = 0;
function newRoomKey(): string {
  roomSequence += 1;
  return `dungeon-room-${roomSequence}`;
}

function newRoomId(): string {
  const uuid =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `drm_${uuid.replace(/-/g, "")}`;
}

function emptyRoom(): RoomDraft {
  return {
    key: newRoomKey(),
    id: newRoomId(),
    kind: "encounter",
    name: "",
    description: "",
    notes: "",
    encounterId: "",
    background: undefined,
    rewardItemIds: [],
    rewardSkillIds: [],
    rewardCurrency: undefined,
    rewardNotes: "",
    unlockRewards: false,
  };
}

function emptyDraft(): DungeonDraft {
  return { name: "", description: "", entryRoomId: "", rooms: [emptyRoom()] };
}

function draftFromDungeon(dungeon: Dungeon): DungeonDraft {
  return {
    name: dungeon.name,
    description: dungeon.description ?? "",
    entryRoomId: dungeon.entryRoomId ?? "",
    rooms: dungeon.rooms.map((room) => ({
      key: newRoomKey(),
      id: room.id,
      kind: room.kind ?? "encounter",
      name: room.name,
      description: room.description ?? "",
      notes: room.notes ?? "",
      encounterId: room.encounterId ?? "",
      background: room.background,
      rewardItemIds: [...(room.rewards?.itemIds ?? [])],
      rewardSkillIds: [...(room.rewards?.skillIds ?? [])],
      rewardCurrency: room.rewards?.currency,
      rewardNotes: room.rewards?.notes ?? "",
      unlockRewards: room.unlockRewards === true,
    })),
  };
}

function isCombatKind(kind: DungeonRoomKind): boolean {
  return kind === "encounter" || kind === "boss";
}

function isVideoSource(url: string | undefined): boolean {
  return Boolean(url && /\.(mp4|webm)(?:[?#].*)?$/i.test(url));
}

export function DungeonEditorPage() {
  const { dungeonId } = useParams();
  const campaign = useAppStore((state) => state.campaign);
  const refreshCampaign = useAppStore((state) => state.refreshCampaign);
  const notify = useAppStore((state) => state.notify);
  const navigate = useNavigate();

  const existing = useMemo(
    () =>
      dungeonId && campaign
        ? (campaign.content.dungeons.find(
            (dungeon) => dungeon.id === dungeonId,
          ) ?? null)
        : null,
    [dungeonId, campaign],
  );

  const [draft, setDraft] = useState<DungeonDraft>(() =>
    existing ? draftFromDungeon(existing) : emptyDraft(),
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [selectedRoomKey, setSelectedRoomKey] = useState<string | null>(null);
  const [rewardPicks, setRewardPicks] = useState<Record<string, string>>({});
  const [rewardSkillPicks, setRewardSkillPicks] = useState<
    Record<string, string>
  >({});

  useEffect(() => {
    if (!campaign) return;
    setDraft(existing ? draftFromDungeon(existing) : emptyDraft());
    setErrors([]);
    setSelectedRoomKey(null);
    setRewardPicks({});
    setRewardSkillPicks({});
    // Solo al cambiar de mazmorra o de campaña; no en cada guardado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dungeonId, campaign?.id]);

  if (!campaign) return null;

  if (dungeonId && !existing) {
    return (
      <div className="animate-rise">
        <PageHeader
          eyebrow="Mazmorras"
          title="Mazmorra no encontrada"
          back={{ to: "/dungeons", label: "Volver a mazmorras" }}
        />
        <EmptyState
          icon="shield"
          title="Esa mazmorra no existe"
          description="Puede que se haya eliminado en otra pestaña o que el enlace esté mal."
          action={
            <LinkButton to="/dungeons" size="sm" icon="arrow-left">
              Volver a mazmorras
            </LinkButton>
          }
        />
      </div>
    );
  }

  const campaignId = campaign.id;
  const catalog = campaign.content.items;
  const skills = campaign.content.skills;
  const encounters = campaign.content.encounters;
  const itemsById = new Map(catalog.map((item) => [item.id, item]));
  const skillsById = new Map(skills.map((skill) => [skill.id, skill]));

  const entryRoom =
    draft.rooms.find((room) => room.id === draft.entryRoomId) ?? draft.rooms[0];
  const activeRoom =
    draft.rooms.find((room) => room.key === selectedRoomKey) ?? entryRoom;
  const entryIsExplicit = draft.rooms.some(
    (room) => room.id === draft.entryRoomId,
  );
  const busy = saving || deleting;

  function patch(update: Partial<DungeonDraft>) {
    setDraft((current) => ({ ...current, ...update }));
  }

  function patchRoom(key: string, update: Partial<RoomDraft>) {
    setDraft((current) => ({
      ...current,
      rooms: current.rooms.map((room) =>
        room.key === key ? { ...room, ...update } : room,
      ),
    }));
    setSelectedRoomKey(key);
  }

  function addRoom() {
    if (draft.rooms.length >= 100) return;
    const room = emptyRoom();
    setDraft((current) => ({ ...current, rooms: [...current.rooms, room] }));
    setSelectedRoomKey(room.key);
  }

  function removeRoom(key: string) {
    setDraft((current) => {
      if (current.rooms.length <= 1) return current;
      const index = current.rooms.findIndex((room) => room.key === key);
      const removed = current.rooms[index];
      if (!removed) return current;
      const rooms = current.rooms.filter((room) => room.key !== key);
      // Si se borra la entrada (explícita o la primera), pasa a la primera restante.
      const effectiveEntryId = current.entryRoomId || current.rooms[0]?.id;
      return {
        ...current,
        rooms,
        entryRoomId:
          effectiveEntryId === removed.id
            ? (rooms[0]?.id ?? "")
            : current.entryRoomId,
      };
    });
    setSelectedRoomKey((current) => (current === key ? null : current));
    setRewardPicks((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
    setRewardSkillPicks((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function moveRoom(key: string, delta: -1 | 1) {
    setDraft((current) => {
      const index = current.rooms.findIndex((room) => room.key === key);
      const target = index + delta;
      if (index === -1 || target < 0 || target >= current.rooms.length) {
        return current;
      }
      const rooms = [...current.rooms];
      const currentRoom = rooms[index];
      const targetRoom = rooms[target];
      if (!currentRoom || !targetRoom) return current;
      rooms[index] = targetRoom;
      rooms[target] = currentRoom;
      return { ...current, rooms };
    });
  }

  function selectRoomKind(key: string, kind: DungeonRoomKind) {
    patchRoom(key, {
      kind,
      // Descanso y tesoro no lanzan encuentro: se desvincula al cambiar.
      ...(isCombatKind(kind) ? {} : { encounterId: "" }),
    });
  }

  function addRewardItem(key: string) {
    const itemId = rewardPicks[key];
    if (!itemId) return;
    setDraft((current) => ({
      ...current,
      rooms: current.rooms.map((room) => {
        if (room.key !== key || room.rewardItemIds.includes(itemId)) {
          return room;
        }
        return { ...room, rewardItemIds: [...room.rewardItemIds, itemId] };
      }),
    }));
    setRewardPicks((current) => ({ ...current, [key]: "" }));
    setSelectedRoomKey(key);
  }

  function removeRewardItem(key: string, itemId: string) {
    setDraft((current) => ({
      ...current,
      rooms: current.rooms.map((room) =>
        room.key === key
          ? {
              ...room,
              rewardItemIds: room.rewardItemIds.filter(
                (entry) => entry !== itemId,
              ),
            }
          : room,
      ),
    }));
  }

  function addRewardSkill(key: string) {
    const skillId = rewardSkillPicks[key];
    if (!skillId) return;
    setDraft((current) => ({
      ...current,
      rooms: current.rooms.map((room) => {
        if (room.key !== key || room.rewardSkillIds.includes(skillId)) {
          return room;
        }
        return { ...room, rewardSkillIds: [...room.rewardSkillIds, skillId] };
      }),
    }));
    setRewardSkillPicks((current) => ({ ...current, [key]: "" }));
    setSelectedRoomKey(key);
  }

  function removeRewardSkill(key: string, skillId: string) {
    setDraft((current) => ({
      ...current,
      rooms: current.rooms.map((room) =>
        room.key === key
          ? {
              ...room,
              rewardSkillIds: room.rewardSkillIds.filter(
                (entry) => entry !== skillId,
              ),
            }
          : room,
      ),
    }));
  }

  function buildPayload(): DungeonInput {
    return {
      name: draft.name.trim(),
      // Se manda siempre (aunque esté vacía) para que un PATCH pueda borrarla;
      // el servidor la guarda como ausente si llega en blanco.
      description: draft.description.trim(),
      // Siempre explícito si hay salas: evita que un PATCH conserve la entrada vieja.
      entryRoomId: draft.entryRoomId || draft.rooms[0]?.id || undefined,
      rooms: draft.rooms.map((room) => {
        const treasure = room.kind === "treasure";
        const itemIds = treasure ? room.rewardItemIds : [];
        const skillIds = treasure ? room.rewardSkillIds : [];
        const currency = treasure ? room.rewardCurrency : undefined;
        const rewardNotes = treasure ? room.rewardNotes.trim() : "";
        const rewards =
          treasure &&
          (itemIds.length > 0 ||
            skillIds.length > 0 ||
            currency !== undefined ||
            rewardNotes)
            ? {
                itemIds: itemIds.length > 0 ? itemIds : undefined,
                // Las skills del cofre se desbloquean siempre; `unlockRewards`
                // solo afecta a los objetos.
                skillIds: skillIds.length > 0 ? skillIds : undefined,
                currency,
                notes: rewardNotes || undefined,
              }
            : undefined;
        return {
          id: room.id,
          name: room.name.trim(),
          description: room.description.trim() || undefined,
          notes: room.notes.trim() || undefined,
          kind: room.kind,
          encounterId: isCombatKind(room.kind)
            ? room.encounterId || undefined
            : undefined,
          background: room.background?.trim() || undefined,
          rewards,
          unlockRewards: treasure ? room.unlockRewards : undefined,
        };
      }),
    };
  }

  function validateAndBuild(): { issues: string[]; payload: DungeonInput } {
    const payload = buildPayload();
    const issues: string[] = [];

    if (!draft.name.trim()) {
      issues.push("La mazmorra necesita un nombre.");
    }
    if (draft.rooms.length === 0) {
      issues.push("Añade al menos una sala.");
    }
    draft.rooms.forEach((room, index) => {
      if (!room.name.trim()) {
        issues.push(`Sala ${index + 1}: el nombre es obligatorio.`);
      }
    });
    if (
      draft.entryRoomId &&
      !draft.rooms.some((room) => room.id === draft.entryRoomId)
    ) {
      issues.push(
        "La sala de entrada seleccionada ya no existe. Elige otra o usa «primera sala».",
      );
    }

    const parsed = dungeonInputSchema.safeParse(payload);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        // Los nombres ya tienen mensajes concretos por sala.
        if (issue.message === "El nombre es obligatorio") continue;
        const path = issue.path.join(".");
        const message = path ? `${path}: ${issue.message}` : issue.message;
        issues.push(message);
      }
    }

    return { issues: Array.from(new Set(issues)), payload };
  }

  async function handleSave() {
    const { issues, payload } = validateAndBuild();
    if (issues.length > 0) {
      setErrors(issues);
      return;
    }
    setErrors([]);
    setSaving(true);
    try {
      if (dungeonId) {
        await api.updateDungeon(campaignId, dungeonId, payload);
        notify("ok", `«${payload.name}» actualizada.`);
      } else {
        await api.createDungeon(campaignId, payload);
        notify("ok", `«${payload.name}» creada.`);
      }
      await refreshCampaign();
      navigate("/dungeons");
    } catch (error) {
      notify("error", describeError(error));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!dungeonId) return;
    setDeleting(true);
    try {
      await api.deleteDungeon(campaignId, dungeonId);
      await refreshCampaign();
      notify("ok", `«${draft.name || existing?.name || "Mazmorra"}» eliminada.`);
      setConfirmDelete(false);
      navigate("/dungeons");
    } catch (error) {
      notify("error", describeError(error));
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  const firstRoom = draft.rooms[0];

  return (
    <div className="animate-rise">
      <PageHeader
        eyebrow={dungeonId ? "Editar mazmorra" : "Nueva mazmorra"}
        title={dungeonId ? draft.name || "Mazmorra" : "Nueva mazmorra"}
        description="Ordena las salas del recorrido, elige la entrada y prepara la escena de cada una. Las salas de encuentro lanzan su combate; las de descanso y tesoro usan su recompensa."
        back={{ to: "/dungeons", label: "Volver a mazmorras" }}
        actions={
          <>
            {dungeonId ? (
              <Button
                variant="ghost"
                size="sm"
                icon="trash"
                disabled={busy}
                onClick={() => setConfirmDelete(true)}
              >
                Eliminar mazmorra
              </Button>
            ) : null}
            <Button
              variant="accent"
              size="sm"
              icon="save"
              loading={saving}
              onClick={() => void handleSave()}
            >
              Guardar mazmorra
            </Button>
          </>
        }
      />

      {errors.length > 0 ? (
        <div className="mb-4 border border-rust bg-rust/10 p-3">
          <div className="mb-1 flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-ui-danger">
            <Icon name="alert" size={14} /> Revisa la mazmorra
          </div>
          <ul className="list-inside list-disc text-xs text-ui-danger">
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <section className="panel p-4">
            <h2 className="mb-4 border-b border-ui-line pb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
              01 · Identidad
            </h2>
            <div className="grid gap-4">
              <Field
                label="Nombre de la mazmorra"
                hint="Es lo que se ve en el listado y en la mesa."
              >
                <TextInput
                  value={draft.name}
                  onValueChange={(value) => patch({ name: value })}
                  placeholder="Cripta de los Protocolos"
                  maxLength={80}
                />
              </Field>
              <Field label="Descripción">
                <TextArea
                  value={draft.description}
                  onValueChange={(value) => patch({ description: value })}
                  rows={3}
                  maxLength={2000}
                  placeholder="Qué hay en la entrada, quién la construyó, qué se rumorea…"
                />
              </Field>
              <Field
                label="Sala de entrada"
                hint="La run empieza aquí. Con «primera sala» se usa la primera del recorrido."
              >
                <Select
                  value={draft.entryRoomId}
                  onValueChange={(value) => patch({ entryRoomId: value })}
                >
                  <option value="">
                    Primera sala
                    {firstRoom
                      ? ` — ${firstRoom.name || "sala sin nombre"}`
                      : ""}
                  </option>
                  {draft.rooms.map((room, index) => (
                    <option key={room.key} value={room.id}>
                      {index + 1}. {room.name || "Sala sin nombre"}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </section>

          <section className="panel p-4">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 border-b border-ui-line pb-2">
              <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
                02 · Salas del recorrido
              </h2>
              <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-ui-faint">
                {draft.rooms.length} sala{draft.rooms.length === 1 ? "" : "s"}
                {entryIsExplicit ? "" : " · entrada: primera"}
              </span>
            </div>

            {draft.rooms.length === 0 ? (
              <p className="border border-dashed border-ui-line p-3 text-xs text-ui-muted">
                Esta mazmorra no tiene salas. Añade al menos una para poder
                guardarla.
              </p>
            ) : (
              <div className="space-y-3">
                {draft.rooms.map((room, index) => {
                  const isEntry = entryRoom?.key === room.key;
                  const encounterMissing =
                    room.encounterId !== "" &&
                    !encounters.some(
                      (encounter) => encounter.id === room.encounterId,
                    );
                  const availableItems = catalog.filter(
                    (item) => !room.rewardItemIds.includes(item.id),
                  );
                  const availableSkills = skills.filter(
                    (skill) => !room.rewardSkillIds.includes(skill.id),
                  );
                  const rewardPick = rewardPicks[room.key] ?? "";
                  const rewardSkillPick = rewardSkillPicks[room.key] ?? "";

                  return (
                    <article
                      key={room.key}
                      className={cx(
                        "border bg-ui-surface-2 p-3",
                        activeRoom?.key === room.key
                          ? "border-ui-accent/60"
                          : "border-ui-line",
                      )}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-ui-line pb-2">
                        <div className="flex min-w-0 items-start gap-2">
                          <span className="tnum shrink-0 font-display text-xl leading-none text-ui-faint">
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="min-w-0 truncate text-sm font-semibold text-ui">
                                {room.name || "Sala sin nombre"}
                              </span>
                              {isEntry ? (
                                <span className="chip border-amber/50 bg-amber/10 text-ui-gold">
                                  <Icon name="crosshair" size={10} />
                                  Entrada
                                </span>
                              ) : null}
                            </div>
                            <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-ui-faint">
                              {ROOM_KIND_LABELS[room.kind]}
                              {room.encounterId
                                ? " · encuentro vinculado"
                                : isCombatKind(room.kind)
                                  ? " · ambientación"
                                  : ""}
                            </div>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            icon="chevron-up"
                            aria-label={`Subir ${room.name || `la sala ${index + 1}`}`}
                            title="Subir sala"
                            disabled={index === 0}
                            onClick={() => moveRoom(room.key, -1)}
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            icon="chevron-down"
                            aria-label={`Bajar ${room.name || `la sala ${index + 1}`}`}
                            title="Bajar sala"
                            disabled={index === draft.rooms.length - 1}
                            onClick={() => moveRoom(room.key, 1)}
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            icon="trash"
                            aria-label={`Eliminar ${room.name || `la sala ${index + 1}`}`}
                            title={
                              draft.rooms.length <= 1
                                ? "La mazmorra necesita al menos una sala"
                                : "Eliminar sala"
                            }
                            disabled={draft.rooms.length <= 1}
                            onClick={() => removeRoom(room.key)}
                          />
                        </div>
                      </div>

                      <div className="mt-3 grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)]">
                        <Field
                          label="Tipo de sala"
                          hint={ROOM_KIND_HINTS[room.kind]}
                        >
                          <Select
                            value={room.kind}
                            onValueChange={(value) =>
                              selectRoomKind(
                                room.key,
                                value as DungeonRoomKind,
                              )
                            }
                          >
                            {ROOM_KINDS.map((kind) => (
                              <option key={kind} value={kind}>
                                {ROOM_KIND_LABELS[kind]}
                              </option>
                            ))}
                          </Select>
                        </Field>
                        <Field label="Nombre de la sala">
                          <TextInput
                            value={room.name}
                            onValueChange={(value) =>
                              patchRoom(room.key, { name: value })
                            }
                            placeholder="Galería de servicio"
                            maxLength={80}
                          />
                        </Field>
                      </div>

                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <Field
                          label="Descripción pública"
                          hint="Lo que ve el jugador al entrar en la sala."
                        >
                          <TextArea
                            value={room.description}
                            onValueChange={(value) =>
                              patchRoom(room.key, { description: value })
                            }
                            rows={3}
                            maxLength={2000}
                            placeholder="El aire huele a aceite y a óxido…"
                          />
                        </Field>
                        <Field
                          label="Notas privadas del DM"
                          hint="El jugador no ve estas notas: nunca salen de la mesa del DM."
                        >
                          <TextArea
                            value={room.notes}
                            onValueChange={(value) =>
                              patchRoom(room.key, { notes: value })
                            }
                            rows={3}
                            maxLength={4000}
                            placeholder="Trampa en la segunda baldosa, el PNJ miente…"
                          />
                        </Field>
                      </div>

                      {isCombatKind(room.kind) ? (
                        <div className="mt-3">
                          <Field
                            label="Encuentro vinculado"
                            hint={
                              room.encounterId
                                ? "Al entrar en la sala se lanza este encuentro."
                                : "Sin encuentro: la sala es de ambientación y no lanza combate."
                            }
                          >
                            <Select
                              value={room.encounterId}
                              onValueChange={(value) =>
                                patchRoom(room.key, { encounterId: value })
                              }
                            >
                              <option value="">
                                — Sala de ambientación, sin encuentro —
                              </option>
                              {encounterMissing ? (
                                <option value={room.encounterId}>
                                  Encuentro no disponible ({room.encounterId})
                                </option>
                              ) : null}
                              {encounters.map((encounter) => (
                                <option key={encounter.id} value={encounter.id}>
                                  {encounter.name}
                                </option>
                              ))}
                            </Select>
                          </Field>
                        </div>
                      ) : (
                        <p className="mt-3 border border-dashed border-ui-line px-3 py-2 text-[11px] leading-snug text-ui-muted">
                          Las salas de{" "}
                          {ROOM_KIND_LABELS[room.kind].toLowerCase()} no lanzan
                          encuentro.{" "}
                          {room.kind === "treasure"
                            ? "Configura abajo la recompensa del cofre."
                            : "Al entrar, el DM puede curar a la party una vez."}
                        </p>
                      )}

                      <div className="mt-3 border border-ui-line bg-ui-surface-1 p-3">
                        <ImageField
                          value={room.background}
                          onChange={(value) =>
                            patchRoom(room.key, { background: value })
                          }
                          label="Fondo de la escena"
                          hint="Sube una imagen o GIF (máx. 5 MB) o pega una URL. Si es un vídeo .mp4/.webm, la escena lo reproduce en bucle."
                        />
                      </div>

                      {room.kind === "treasure" ? (
                        <div className="mt-3 border border-ui-line bg-ui-surface-1 p-3">
                          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 border-b border-ui-line pb-2">
                            <h3 className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-ui">
                              Recompensa del cofre
                            </h3>
                            <span className="chip shrink-0 text-ui-faint">
                              {room.rewardItemIds.length} objeto
                              {room.rewardItemIds.length === 1 ? "" : "s"}
                            </span>
                            {room.rewardSkillIds.length > 0 ? (
                              <span className="chip shrink-0 text-ui-faint">
                                <Icon name="sword" size={10} />
                                {room.rewardSkillIds.length} skill
                                {room.rewardSkillIds.length === 1 ? "" : "s"}
                              </span>
                            ) : null}
                          </div>

                          <div className="mb-3 border border-ui-line bg-ui-surface-2 p-2.5">
                            <Toggle
                              checked={room.unlockRewards}
                              onCheckedChange={(value) =>
                                patchRoom(room.key, { unlockRewards: value })
                              }
                              label="Desbloquear para la campaña"
                              hint="Además de entregarse, los objetos aparecen en la biblioteca de todos los jugadores (como comprar en una tienda). No afecta a las skills: las del cofre se desbloquean siempre."
                            />
                          </div>

                          <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_160px]">
                            <Field label="Añadir objeto">
                              <div className="flex items-end gap-2">
                                <Select
                                  value={rewardPick}
                                  onValueChange={(value) =>
                                    setRewardPicks((current) => ({
                                      ...current,
                                      [room.key]: value,
                                    }))
                                  }
                                  className="min-w-0 flex-1"
                                  aria-label={`Objeto del cofre de ${room.name || "la sala"}`}
                                >
                                  <option value="">— Elige un objeto —</option>
                                  {availableItems.map((item) => (
                                    <option key={item.id} value={item.id}>
                                      {item.name}
                                    </option>
                                  ))}
                                </Select>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  icon="plus"
                                  disabled={!rewardPick}
                                  onClick={() => addRewardItem(room.key)}
                                >
                                  Añadir
                                </Button>
                              </div>
                            </Field>
                            <Field
                              label={`Moneda (${CURRENCY_NAME})`}
                              hint="Opcional."
                            >
                              <NumberInput
                                value={room.rewardCurrency}
                                onValueChange={(value) =>
                                  patchRoom(room.key, {
                                    rewardCurrency: value,
                                  })
                                }
                                min={0}
                                max={9_999_999}
                                placeholder="0"
                              />
                            </Field>
                          </div>

                          {catalog.length === 0 ? (
                            <p className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-ui-muted">
                              La biblioteca de objetos está vacía.
                              <LinkButton
                                to="/items/new"
                                variant="ghost"
                                size="sm"
                                icon="plus"
                              >
                                Crear objeto
                              </LinkButton>
                            </p>
                          ) : null}

                          {room.rewardItemIds.length > 0 ? (
                            <ul className="mt-2 space-y-1">
                              {room.rewardItemIds.map((itemId) => {
                                const item = itemsById.get(itemId);
                                return (
                                  <li
                                    key={itemId}
                                    className="flex items-center justify-between gap-2 border border-ui-line bg-ui-surface-2 px-2 py-1"
                                  >
                                    <span
                                      className={cx(
                                        "min-w-0 truncate text-xs",
                                        item ? "text-ui" : "text-ui-danger",
                                      )}
                                    >
                                      {item?.name ?? "Objeto no disponible"}
                                    </span>
                                    <button
                                      type="button"
                                      className="shrink-0 text-ui-faint transition-colors hover:text-rust"
                                      aria-label={`Quitar ${item?.name ?? "el objeto"} del cofre`}
                                      onClick={() =>
                                        removeRewardItem(room.key, itemId)
                                      }
                                    >
                                      <Icon name="close" size={12} />
                                    </button>
                                  </li>
                                );
                              })}
                            </ul>
                          ) : null}

                          <Field
                            label="Añadir skill"
                            hint="Opcional. Se desbloquea para toda la campaña al abrir el cofre."
                            className="mt-3"
                          >
                            <div className="flex items-end gap-2">
                              <Select
                                value={rewardSkillPick}
                                onValueChange={(value) =>
                                  setRewardSkillPicks((current) => ({
                                    ...current,
                                    [room.key]: value,
                                  }))
                                }
                                className="min-w-0 flex-1"
                                aria-label={`Skill del cofre de ${room.name || "la sala"}`}
                              >
                                <option value="">— Elige una skill —</option>
                                {availableSkills.map((skill) => (
                                  <option key={skill.id} value={skill.id}>
                                    {skill.name}
                                  </option>
                                ))}
                              </Select>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                icon="plus"
                                disabled={!rewardSkillPick}
                                onClick={() => addRewardSkill(room.key)}
                              >
                                Añadir
                              </Button>
                            </div>
                          </Field>

                          {skills.length === 0 ? (
                            <p className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-ui-muted">
                              La biblioteca de skills está vacía.
                              <LinkButton
                                to="/skills/new"
                                variant="ghost"
                                size="sm"
                                icon="plus"
                              >
                                Crear skill
                              </LinkButton>
                            </p>
                          ) : null}

                          {room.rewardSkillIds.length > 0 ? (
                            <ul className="mt-2 space-y-1">
                              {room.rewardSkillIds.map((skillId) => {
                                const skill = skillsById.get(skillId);
                                return (
                                  <li
                                    key={skillId}
                                    className="flex items-center justify-between gap-2 border border-ui-line bg-ui-surface-2 px-2 py-1"
                                  >
                                    <span
                                      className={cx(
                                        "min-w-0 truncate text-xs",
                                        skill ? "text-ui" : "text-ui-danger",
                                      )}
                                    >
                                      {skill?.name ?? "Skill no disponible"}
                                    </span>
                                    <button
                                      type="button"
                                      className="shrink-0 text-ui-faint transition-colors hover:text-rust"
                                      aria-label={`Quitar ${skill?.name ?? "la skill"} del cofre`}
                                      onClick={() =>
                                        removeRewardSkill(room.key, skillId)
                                      }
                                    >
                                      <Icon name="close" size={12} />
                                    </button>
                                  </li>
                                );
                              })}
                            </ul>
                          ) : null}

                          {room.rewardItemIds.length === 0 &&
                          room.rewardSkillIds.length === 0 ? (
                            <p className="mt-2 border border-dashed border-ui-line px-2 py-1.5 text-[11px] text-ui-muted">
                              El cofre está vacío. Puedes dejarlo así o añadir
                              objetos, skills y moneda.
                            </p>
                          ) : null}

                          <p className="mt-2 text-[10px] leading-snug text-ui-faint">
                            Las skills del cofre se desbloquean para toda la
                            campaña al abrirlo; no se añaden al inventario ni se
                            equipan solas.
                          </p>

                          <Field
                            label="Notas de recompensa"
                            hint="Se muestran al abrir el cofre."
                            className="mt-3"
                          >
                            <TextInput
                              value={room.rewardNotes}
                              onValueChange={(value) =>
                                patchRoom(room.key, { rewardNotes: value })
                              }
                              maxLength={2000}
                              placeholder="Además, una nota con un código…"
                            />
                          </Field>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                icon="plus"
                disabled={draft.rooms.length >= 100}
                onClick={addRoom}
              >
                Añadir sala
              </Button>
              <span className="text-[10px] leading-snug text-ui-faint">
                Mínimo una sala. Las flechas mueven la sala completa, con sus
                notas, fondo y recompensa.
              </span>
            </div>
          </section>
        </div>

        <aside className="space-y-4">
          <div className="sticky top-6 space-y-4">
            <div className="panel overflow-hidden">
              <div className="border-b border-ui-line bg-ui-surface-3 px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.18em]">
                Recorrido y escena
              </div>
              <div className="space-y-3 p-3">
                <div>
                  <div className="mono-label mb-1.5">Ruta</div>
                  {draft.rooms.length === 0 ? (
                    <p className="text-[11px] text-ui-muted">
                      Sin salas todavía.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {draft.rooms.map((room, index) => {
                        const isEntry = entryRoom?.key === room.key;
                        const selected = activeRoom?.key === room.key;
                        return (
                          <button
                            key={room.key}
                            type="button"
                            title={`Ver ${room.name || "sala sin nombre"} en la escena`}
                            onClick={() => setSelectedRoomKey(room.key)}
                            className={cx(
                              "chip text-left transition-colors",
                              selected
                                ? "border-ui-accent bg-amber/10 text-ui"
                                : "hover:border-ui-line-strong hover:text-ui",
                            )}
                          >
                            <span className="tnum text-ui-faint">
                              {String(index + 1).padStart(2, "0")}
                            </span>
                            <span className="max-w-[8rem] truncate">
                              {room.name || "Sala sin nombre"}
                            </span>
                            <span className="text-ui-faint">
                              {ROOM_KIND_LABELS[room.kind]}
                            </span>
                            {isEntry ? (
                              <Icon
                                name="crosshair"
                                size={10}
                                className="text-ui-accent"
                              />
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <div className="mt-1.5 flex flex-wrap items-center gap-1 font-mono text-[9px] uppercase tracking-[0.1em] text-ui-faint">
                    <span>
                      {draft.rooms.length} sala
                      {draft.rooms.length === 1 ? "" : "s"}
                    </span>
                    <span>·</span>
                    <span>
                      Entrada: {entryIsExplicit ? entryRoom?.name : "primera sala"}
                    </span>
                  </div>
                </div>

                {activeRoom ? (
                  <>
                    <div className="relative aspect-[16/9] w-full overflow-hidden border border-ui-line-strong bg-black/35">
                      {activeRoom.background ? (
                        isVideoSource(activeRoom.background) ? (
                          <video
                            src={activeRoom.background}
                            className="absolute inset-0 h-full w-full object-cover"
                            autoPlay
                            loop
                            muted
                            playsInline
                          />
                        ) : (
                          <img
                            src={activeRoom.background}
                            alt={`Fondo de ${activeRoom.name || "la sala"}`}
                            className="absolute inset-0 h-full w-full object-cover"
                          />
                        )
                      ) : (
                        <div className="flex h-full items-center justify-center px-4 text-center text-[11px] text-ui-faint">
                          Sin fondo de escena. Súbelo en la sala.
                        </div>
                      )}
                      <span className="absolute left-2 top-2 border border-ui-line-strong bg-ui-surface-1 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.12em] text-ui">
                        {ROOM_KIND_LABELS[activeRoom.kind]}
                      </span>
                      {entryRoom?.key === activeRoom.key ? (
                        <span className="absolute right-2 top-2 border border-amber/50 bg-ui-surface-1 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.12em] text-ui-gold">
                          Entrada
                        </span>
                      ) : null}
                      {isVideoSource(activeRoom.background) ? (
                        <span className="absolute bottom-2 right-2 border border-ui-line-strong bg-ui-surface-1 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.12em] text-ui-muted">
                          Vídeo en bucle
                        </span>
                      ) : null}
                    </div>

                    <div>
                      <h3 className="display min-w-0 truncate text-xl text-ui">
                        {activeRoom.name || "Sala sin nombre"}
                      </h3>
                      <p className="mt-1 text-[11px] leading-snug text-ui-muted">
                        {activeRoom.description || "Sin descripción pública."}
                      </p>
                    </div>

                    {activeRoom.notes.trim() ? (
                      <p className="flex items-start gap-1.5 border-t border-ui-line pt-2 text-[10px] leading-snug text-ui-faint">
                        <Icon name="lock" size={11} className="mt-0.5 shrink-0" />
                        Esta sala tiene notas privadas: no se muestran aquí ni
                        llegan al jugador.
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className="border border-dashed border-ui-line p-3 text-center text-[11px] text-ui-muted">
                    Añade una sala para ver la escena.
                  </p>
                )}
              </div>
            </div>

            <div className="border border-ui-line p-3">
              <div className="mono-label mb-1">Cómo funciona</div>
              <ul className="space-y-1.5 text-[11px] leading-snug text-ui-muted">
                <li className="flex items-start gap-1.5">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 bg-ui-accent" />
                  El recorrido es lineal: el orden de las salas manda.
                </li>
                <li className="flex items-start gap-1.5">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 bg-ui-accent" />
                  La entrada marca dónde empieza la run.
                </li>
                <li className="flex items-start gap-1.5">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 bg-ui-accent" />
                  Las notas privadas nunca llegan al jugador.
                </li>
                <li className="flex items-start gap-1.5">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 bg-ui-accent" />
                  Descanso y tesoro se resuelven una vez por run.
                </li>
              </ul>
            </div>

            <div className="border border-ui-line p-3">
              <div className="mono-label mb-1">ID interno</div>
              <code className="block break-all font-mono text-[10px] text-ui-muted">
                {existing?.id ?? "Se genera al guardar"}
              </code>
              <p className="mt-2 text-[10px] leading-snug text-ui-faint">
                Los ids de sala se generan en el editor para poder marcar la
                entrada antes de guardar.
              </p>
            </div>
          </div>
        </aside>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Eliminar mazmorra"
        message={
          <>
            Vas a eliminar{" "}
            <strong>«{draft.name || existing?.name || "esta mazmorra"}»</strong>{" "}
            con todas sus salas. Las fichas, encuentros y objetos de la campaña
            no cambian.
          </>
        }
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void handleDelete()}
        busy={deleting}
      />
    </div>
  );
}
