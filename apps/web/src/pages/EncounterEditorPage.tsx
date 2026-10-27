import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  EQUIPMENT_SLOT_LABELS,
  encounterInputSchema,
  type Encounter,
  type EncounterEnemy,
} from "@protocol-life/shared";
import { useAppStore } from "../store/useAppStore";
import { ImageField } from "../components/ImageField";
import { Icon } from "../components/Icons";
import {
  Button,
  ConfirmDialog,
  Field,
  LinkButton,
  NumberInput,
  PageHeader,
  Select,
  TextArea,
  TextInput,
  cx,
} from "../components/ui";

interface EncounterDraft {
  name: string;
  description: string;
  background: string | undefined;
  enemies: EncounterEnemy[];
  currency: number | undefined;
  rewardItemIds: string[];
  rewardNotes: string;
  victory: string;
  defeat: string;
}

function emptyDraft(): EncounterDraft {
  return {
    name: "",
    description: "",
    background: undefined,
    enemies: [],
    currency: undefined,
    rewardItemIds: [],
    rewardNotes: "",
    victory: "",
    defeat: "",
  };
}

function draftFromEncounter(encounter: Encounter): EncounterDraft {
  return {
    name: encounter.name,
    description: encounter.description ?? "",
    background: encounter.background,
    enemies: structuredClone(encounter.enemies),
    currency: encounter.rewards?.currency,
    rewardItemIds: [...(encounter.rewards?.itemIds ?? [])],
    rewardNotes: encounter.rewards?.notes ?? "",
    victory: encounter.victory ?? "",
    defeat: encounter.defeat ?? "",
  };
}

export function EncounterEditorPage() {
  const { encounterId } = useParams();
  const campaign = useAppStore((state) => state.campaign);
  const saveContent = useAppStore((state) => state.saveContent);
  const removeContent = useAppStore((state) => state.removeContent);
  const busy = useAppStore((state) => state.busy);
  const navigate = useNavigate();

  const existing = useMemo(
    () =>
      encounterId && campaign
        ? campaign.content.encounters.find((encounter) => encounter.id === encounterId)
        : undefined,
    [encounterId, campaign],
  );

  const [draft, setDraft] = useState<EncounterDraft>(() =>
    existing ? draftFromEncounter(existing) : emptyDraft(),
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!campaign) return;
    setDraft(existing ? draftFromEncounter(existing) : emptyDraft());
    setErrors([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encounterId, campaign?.id]);

  if (!campaign) return null;

  if (encounterId && !existing) {
    return (
      <div className="animate-rise">
        <PageHeader eyebrow="Encuentros" title="Encuentro no encontrado" back={{ to: "/encounters", label: "Volver a encuentros" }} />
        <div className="panel p-8 text-center">
          <p className="text-sm text-ink-soft">Ese encuentro no existe en esta campaña.</p>
          <div className="mt-4">
            <LinkButton to="/encounters" size="sm">Volver</LinkButton>
          </div>
        </div>
      </div>
    );
  }

  const enemies = campaign.content.characters.filter(
    (character) => character.kind === "enemy",
  );
  const charactersById = new Map(
    campaign.content.characters.map((character) => [character.id, character]),
  );
  const itemsById = new Map(campaign.content.items.map((item) => [item.id, item]));
  const totalEnemies = draft.enemies.reduce((sum, enemy) => sum + (enemy.count ?? 1), 0);

  const allCharacters = campaign.content.characters;

  function patch(update: Partial<EncounterDraft>) {
    setDraft((current) => ({ ...current, ...update }));
  }

  function addEnemy() {
    const first = enemies[0] ?? allCharacters[0];
    if (!first) return;
    patch({ enemies: [...draft.enemies, { characterId: first.id, count: 1 }] });
  }

  function updateEnemy(index: number, update: Partial<EncounterEnemy>) {
    patch({
      enemies: draft.enemies.map((enemy, enemyIndex) =>
        enemyIndex === index ? { ...enemy, ...update } : enemy,
      ),
    });
  }

  function removeEnemy(index: number) {
    patch({ enemies: draft.enemies.filter((_, enemyIndex) => enemyIndex !== index) });
  }

  function toggleReward(itemId: string) {
    patch({
      rewardItemIds: draft.rewardItemIds.includes(itemId)
        ? draft.rewardItemIds.filter((id) => id !== itemId)
        : [...draft.rewardItemIds, itemId],
    });
  }

  function buildPayload() {
    return {
      name: draft.name.trim(),
      description: draft.description.trim() || undefined,
      background: draft.background,
      enemies: draft.enemies,
      rewards:
        draft.currency !== undefined ||
        draft.rewardItemIds.length > 0 ||
        draft.rewardNotes.trim()
          ? {
              currency: draft.currency,
              itemIds: draft.rewardItemIds.length > 0 ? draft.rewardItemIds : undefined,
              notes: draft.rewardNotes.trim() || undefined,
            }
          : undefined,
      victory: draft.victory.trim() || undefined,
      defeat: draft.defeat.trim() || undefined,
    };
  }

  async function handleSave() {
    const parsed = encounterInputSchema.safeParse(buildPayload());
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((issue) => issue.message));
      return;
    }
    setErrors([]);
    try {
      const saved = await saveContent("encounters", parsed.data, encounterId);
      if (!encounterId) navigate(`/encounters/${saved.id}`, { replace: true });
    } catch {
      // store notifica
    }
  }

  async function handleDelete() {
    if (!encounterId) return;
    try {
      await removeContent("encounters", encounterId);
      setConfirmDelete(false);
      navigate("/encounters");
    } catch {
      setConfirmDelete(false);
    }
  }

  return (
    <div className="animate-rise">
      <PageHeader
        eyebrow={encounterId ? "Editar encuentro" : "Nuevo encuentro"}
        title={encounterId ? draft.name || "Encuentro" : "Nuevo encuentro"}
        description="Define el grupo de enemigos, las recompensas y el texto de victoria/derrota. El motor de combate se conectará en Fase 3."
        back={{ to: "/encounters", label: "Volver a encuentros" }}
        actions={
          <>
            {encounterId ? (
              <Button variant="ghost" size="sm" icon="trash" onClick={() => setConfirmDelete(true)}>
                Eliminar
              </Button>
            ) : null}
            <Button variant="accent" size="sm" icon="save" loading={busy} onClick={() => void handleSave()}>
              Guardar encuentro
            </Button>
          </>
        }
      />

      {errors.length > 0 ? (
        <div className="mb-4 border-2 border-rust bg-rust/10 p-3">
          <div className="mb-1 flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-rust-deep">
            <Icon name="alert" size={14} /> Revisa el formulario
          </div>
          <ul className="list-inside list-disc text-xs text-rust-deep">
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-5">
          <section className="panel p-4">
            <h2 className="mb-4 border-b-2 border-ink pb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
              01 · Identidad
            </h2>
            <div className="space-y-4">
              <Field label="Nombre">
                <TextInput
                  value={draft.name}
                  onValueChange={(value) => patch({ name: value })}
                  placeholder="Protocolo roto"
                  maxLength={80}
                />
              </Field>
              <Field label="Descripción">
                <TextArea
                  value={draft.description}
                  onValueChange={(value) => patch({ description: value })}
                  rows={3}
                  maxLength={2000}
                  placeholder="Qué ve la party al entrar…"
                />
              </Field>
              <ImageField
                value={draft.background}
                onChange={(value) => patch({ background: value })}
                label="Fondo del encuentro"
                hint="Opcional. Se usará en la vista de combate (Fase 3)."
              />
            </div>
          </section>

          <section className="panel p-4">
            <h2 className="mb-1 border-b-2 border-ink pb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
              02 · Enemigos
            </h2>
            <p className="mb-4 mt-2 text-[11px] text-ink-faint">
              Solo se muestran fichas de tipo enemigo. La cantidad crea copias del mismo
              enemigo.
            </p>
            <div className="space-y-2">
              {draft.enemies.map((enemy, index) => {
                const character = charactersById.get(enemy.characterId);
                return (
                  <div
                    key={index}
                    className={cx(
                      "flex flex-wrap items-center gap-2 border-2 p-2",
                      character?.kind === "enemy"
                        ? "border-ink/30 bg-paper/40"
                        : "border-rust/50 bg-rust/5",
                    )}
                  >
                    <Select
                      value={enemy.characterId}
                      onValueChange={(value) => updateEnemy(index, { characterId: value })}
                      className="min-w-[200px] flex-1"
                    >
                      {enemies.length === 0 ? (
                        <option value={enemy.characterId}>
                          {character?.name ?? "Sin personajes"}
                        </option>
                      ) : null}
                      {enemies.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.name}
                        </option>
                      ))}
                    </Select>
                    <label className="flex items-center gap-1.5">
                      <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-ink-faint">
                        Cantidad
                      </span>
                      <NumberInput
                        value={enemy.count ?? 1}
                        onValueChange={(value) => updateEnemy(index, { count: value ?? 1 })}
                        min={1}
                        max={20}
                        className="w-16"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => removeEnemy(index)}
                      className="flex h-8 w-8 items-center justify-center border border-ink/30 text-ink-faint hover:bg-rust/10 hover:text-rust"
                      aria-label="Quitar enemigo"
                    >
                      <Icon name="trash" size={13} />
                    </button>
                    {character && character.kind !== "enemy" ? (
                      <span className="w-full font-mono text-[9px] uppercase tracking-[0.1em] text-rust">
                        Esta ficha no es de tipo enemigo.
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {draft.enemies.length === 0 ? (
              <p className="border-2 border-dashed border-ink/30 p-3 text-xs text-ink-soft">
                El encuentro no tiene enemigos todavía.
              </p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                icon="plus"
                onClick={addEnemy}
                disabled={campaign.content.characters.length === 0}
              >
                Añadir enemigo
              </Button>
              {enemies.length === 0 ? (
                <LinkButton to="/characters/new" variant="ghost" size="sm" icon="skull">
                  Crear ficha de enemigo
                </LinkButton>
              ) : null}
            </div>
          </section>

          <section className="panel p-4">
            <h2 className="mb-4 border-b-2 border-ink pb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
              03 · Recompensas
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Oro del juego" hint="Nunca dinero real.">
                <NumberInput
                  value={draft.currency}
                  onValueChange={(value) => patch({ currency: value })}
                  min={0}
                  max={9_999_999}
                />
              </Field>
              <Field label="Notas de recompensa">
                <TextInput
                  value={draft.rewardNotes}
                  onValueChange={(value) => patch({ rewardNotes: value })}
                  placeholder="Botín especial…"
                  maxLength={2000}
                />
              </Field>
            </div>
            <div className="mt-3">
              <div className="field-label">Objetos recompensa</div>
              {campaign.content.items.length === 0 ? (
                <p className="text-xs text-ink-soft">No hay objetos en la campaña.</p>
              ) : (
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {campaign.content.items.map((item) => {
                    const selected = draft.rewardItemIds.includes(item.id);
                    return (
                      <label
                        key={item.id}
                        className={cx(
                          "flex cursor-pointer items-center gap-2 border px-2 py-1.5",
                          selected ? "border-ink bg-amber/10" : "border-ink/20 bg-paper/40",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleReward(item.id)}
                          className="h-3.5 w-3.5 accent-rust"
                        />
                        <span className="min-w-0 flex-1 truncate text-xs font-semibold">
                          {item.name}
                        </span>
                        <span className="font-mono text-[9px] text-ink-faint">{EQUIPMENT_SLOT_LABELS[item.slot]}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          <section className="panel p-4">
            <h2 className="mb-4 border-b-2 border-ink pb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
              04 · Texto narrativo
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Victoria">
                <TextArea
                  value={draft.victory}
                  onValueChange={(value) => patch({ victory: value })}
                  rows={2}
                  maxLength={2000}
                  placeholder="La patrulla cede el paso…"
                />
              </Field>
              <Field label="Derrota">
                <TextArea
                  value={draft.defeat}
                  onValueChange={(value) => patch({ defeat: value })}
                  rows={2}
                  maxLength={2000}
                  placeholder="El protocolo se reinicia…"
                />
              </Field>
            </div>
          </section>
        </div>

        <aside className="space-y-4">
          <div className="sticky top-6 space-y-4">
            <div className="panel p-4">
              <div className="mb-3 border-b-2 border-ink pb-2 font-mono text-[10px] font-bold uppercase tracking-[0.18em]">
                Resumen
              </div>
              <h3 className="display text-2xl">{draft.name || "Sin nombre"}</h3>
              <p className="mt-1 text-[11px] leading-snug text-ink-soft">
                {draft.description || "Sin descripción."}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="border border-ink/30 bg-paper px-2 py-1.5 text-center">
                  <div className="font-display text-xl">{draft.enemies.length}</div>
                  <div className="font-mono text-[8px] uppercase tracking-[0.12em] text-ink-faint">
                    tipos
                  </div>
                </div>
                <div className="border border-ink/30 bg-paper px-2 py-1.5 text-center">
                  <div className="font-display text-xl">{totalEnemies}</div>
                  <div className="font-mono text-[8px] uppercase tracking-[0.12em] text-ink-faint">
                    unidades
                  </div>
                </div>
              </div>
              <div className="mt-3 space-y-1 text-[11px]">
                {draft.enemies.map((enemy, index) => {
                  const character = charactersById.get(enemy.characterId);
                  return (
                    <div key={index} className="flex items-center justify-between gap-2">
                      <span className="truncate">{character?.name ?? "Desconocido"}</span>
                      <span className="font-mono text-[9px] text-ink-faint">
                        ×{enemy.count ?? 1}
                      </span>
                    </div>
                  );
                })}
                {draft.enemies.length === 0 ? (
                  <p className="text-ink-faint">Sin enemigos.</p>
                ) : null}
              </div>
              {draft.rewardItemIds.length > 0 || draft.currency ? (
                <div className="mt-3 flex flex-wrap gap-1 border-t border-ink/15 pt-2">
                  {draft.currency ? <span className="chip">{draft.currency} oro</span> : null}
                  {draft.rewardItemIds.map((itemId) => {
                    const item = itemsById.get(itemId);
                    return item ? (
                      <span key={itemId} className="chip">
                        {item.name}
                      </span>
                    ) : null;
                  })}
                </div>
              ) : null}
            </div>

            <div className="border-2 border-dashed border-ink/30 p-3 text-[11px] leading-relaxed text-ink-soft">
              <strong className="font-mono text-[9px] uppercase tracking-[0.14em]">
                Fase 3
              </strong>
              <p className="mt-1">
                Cuando el combate exista, el DM podrá iniciar este encuentro desde la mesa.
                Los enemigos se instancian con su HP y stats derivados.
              </p>
            </div>

            {existing ? (
              <div className="border-2 border-ink/20 p-3">
                <div className="mono-label mb-1">ID interno</div>
                <code className="block break-all font-mono text-[10px] text-ink-soft">
                  {existing.id}
                </code>
              </div>
            ) : null}
          </div>
        </aside>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Eliminar encuentro"
        message={
          <>
            Vas a eliminar <strong>«{draft.name}»</strong>. No afecta a las fichas de los
            enemigos.
          </>
        }
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void handleDelete()}
        busy={busy}
      />
    </div>
  );
}
