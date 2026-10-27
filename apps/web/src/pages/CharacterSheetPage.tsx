import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  CHARACTER_KIND_LABELS,
  EQUIPMENT_SLOT_HINTS,
  EQUIPMENT_SLOT_LABELS,
  EQUIPMENT_SLOTS,
  STAT_KEYS,
  STAT_LABELS,
  VISUAL_MODE_LABELS,
  calculateStats,
  characterInputSchema,
  newCharacter,
  resolveVisualMode,
  type Character,
  type CharacterKind,
  type EquipmentSlot,
  type Skill,
  type StatKey,
  type Stats,
  type VisualMode,
} from "@protocol-life/shared";
import { useAppStore } from "../store/useAppStore";
import { useLiveStore } from "../store/useLiveStore";
import { ImageField } from "../components/ImageField";
import { Icon } from "../components/Icons";
import { StatPanel } from "../components/StatPanel";
import { CombatVisualPreview } from "../components/combat/CombatVisualPreview";
import {
  Button,
  ConfirmDialog,
  Field,
  LinkButton,
  NumberInput,
  PageHeader,
  Select,
  StatChip,
  TagList,
  TextArea,
  TextInput,
  cx,
} from "../components/ui";
import { CoinRow } from "../components/cards";
import { signed, statEntries } from "../lib/format";

function cloneCharacter(character: Character): Character {
  return structuredClone(character);
}

function StatStrip({ stats }: { stats: Stats }) {
  return (
    <div className="grid grid-cols-3 gap-px border-2 border-ink bg-ink/25 sm:grid-cols-6">
      {STAT_KEYS.map((key) => (
        <div key={key} className="bg-paper-light px-2 py-2 text-center">
          <div className="font-mono text-[8px] font-bold uppercase tracking-[0.12em] text-ink-faint">
            {key === "hpMax" ? "HP" : STAT_LABELS[key]}
          </div>
          <div className="font-display text-xl leading-tight">{stats[key]}</div>
        </div>
      ))}
    </div>
  );
}

export function CharacterSheetPage() {
  const { characterId } = useParams();
  const campaign = useAppStore((state) => state.campaign);
  const saveContent = useAppStore((state) => state.saveContent);
  const removeContent = useAppStore((state) => state.removeContent);
  const busy = useAppStore((state) => state.busy);
  const notify = useAppStore((state) => state.notify);
  const navigate = useNavigate();
  // Fase 3F: en combate nadie edita fichas/HP. El servidor también lo bloquea;
  // la UI esconde la edición y lo explica.
  const liveCombat = useLiveStore((state) => state.combat);
  const inCombat = Boolean(liveCombat && liveCombat.phase !== "ended");

  const existing = useMemo(
    () =>
      characterId && campaign
        ? campaign.content.characters.find((character) => character.id === characterId)
        : undefined,
    [characterId, campaign],
  );

  const [draft, setDraft] = useState<Character>(() =>
    existing ? cloneCharacter(existing) : newCharacter({ name: "" }),
  );
  const [editing, setEditing] = useState(!characterId);
  const [tagsText, setTagsText] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!campaign) return;
    if (existing) {
      setDraft(cloneCharacter(existing));
      setTagsText((existing.tags ?? []).join(", "));
    } else {
      setDraft(newCharacter({ name: "" }));
      setTagsText("");
    }
    setEditing(!characterId);
    setErrors([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterId, campaign?.id]);

  useEffect(() => {
    if (inCombat) setEditing(false);
  }, [inCombat]);

  if (!campaign) return null;

  if (characterId && !existing) {
    return (
      <div className="animate-rise">
        <PageHeader eyebrow="Personajes" title="Ficha no encontrada" back={{ to: "/characters", label: "Volver a fichas" }} />
        <div className="panel p-8 text-center">
          <p className="text-sm text-ink-soft">Ese personaje no existe en esta campaña.</p>
          <div className="mt-4">
            <LinkButton to="/characters" size="sm">Volver</LinkButton>
          </div>
        </div>
      </div>
    );
  }

  const view = editing || !existing ? draft : existing;
  const content = campaign.content;
  const derived = calculateStats(view, content, campaign.rules);
  const itemsById = new Map(campaign.content.items.map((item) => [item.id, item]));
  const skillsById = new Map(campaign.content.skills.map((skill) => [skill.id, skill]));
  const specialsById = new Map(
    campaign.content.specials.map((special) => [special.id, special]),
  );

  const equippedSkills = draft.skills
    .map((id) => (id ? skillsById.get(id) : null))
    .filter((skill): skill is Skill => Boolean(skill));
  const effectiveVisualMode = resolveVisualMode(view);
  const previewWeapon = view.skills
    .map((id) => (id ? skillsById.get(id) : null))
    .find((skill): skill is Skill => Boolean(skill?.weaponImage));

  function patch(update: Partial<Character>) {
    setDraft((current) => ({ ...current, ...update }));
  }

  function patchBaseStat(key: StatKey, value: number | undefined) {
    setDraft((current) => ({
      ...current,
      baseStats: { ...current.baseStats, [key]: value ?? (key === "hpMax" ? 1 : 0) },
    }));
  }

  function patchEquipment(slot: EquipmentSlot, itemId: string | null) {
    setDraft((current) => ({
      ...current,
      equipment: { ...current.equipment, [slot]: itemId },
    }));
  }

  function patchSkill(index: number, skillId: string | null) {
    setDraft((current) => {
      const next = [...current.skills];
      next[index] = skillId;
      return { ...current, skills: next };
    });
  }

  function patchSpecial(field: "domainId" | "habitatId", value: string | null) {
    setDraft((current) => ({
      ...current,
      special: { ...(current.special ?? {}), [field]: value },
    }));
  }

  function addInventoryEntry() {
    if (content.items.length === 0) return;
    const firstItem = content.items[0];
    if (!firstItem) return;
    setDraft((current) => ({
      ...current,
      inventory: [...current.inventory, { itemId: firstItem.id, qty: 1 }],
    }));
  }

  function updateInventoryEntry(
    index: number,
    update: Partial<{ itemId: string; qty: number }>,
  ) {
    setDraft((current) => ({
      ...current,
      inventory: current.inventory.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, ...update } : entry,
      ),
    }));
  }

  function removeInventoryEntry(index: number) {
    setDraft((current) => ({
      ...current,
      inventory: current.inventory.filter((_, entryIndex) => entryIndex !== index),
    }));
  }

  function resetDraft() {
    if (existing) {
      setDraft(cloneCharacter(existing));
      setTagsText((existing.tags ?? []).join(", "));
      setEditing(false);
      setErrors([]);
    } else {
      navigate("/characters");
    }
  }

  async function handleSave() {
    if (inCombat) {
      notify(
        "error",
        "No se puede editar una ficha durante el combate. Espera a que termine.",
      );
      return;
    }
    const payload = {
      name: draft.name.trim(),
      kind: draft.kind,
      portrait: draft.portrait,
      description: draft.description?.trim() || undefined,
      visualMode: draft.visualMode,
      battleSprite: draft.battleSprite,
      bodyImage: draft.bodyImage,
      baseStats: draft.baseStats,
      equipment: draft.equipment,
      skills: draft.skills,
      special: draft.special,
      inventory: draft.inventory,
      notes: draft.notes?.trim() || undefined,
      tags: tagsText
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    };

    const parsed = characterInputSchema.safeParse(payload);
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`));
      return;
    }
    setErrors([]);
    try {
      const saved = await saveContent("characters", parsed.data, characterId);
      setDraft(cloneCharacter(saved));
      setTagsText((saved.tags ?? []).join(", "));
      if (!characterId) {
        navigate(`/characters/${saved.id}`, { replace: true });
      } else {
        setEditing(false);
      }
    } catch {
      // store notifica
    }
  }

  async function handleDelete() {
    if (!characterId) return;
    try {
      await removeContent("characters", characterId);
      setConfirmDelete(false);
      navigate("/characters");
    } catch {
      setConfirmDelete(false);
    }
  }

  const inCombatSkillLimit =
    equippedSkills.length > derived.stats.skillSlots
      ? `Tienes ${equippedSkills.length} skills equipadas, pero en combate podrás declarar ${derived.stats.skillSlots} por ronda. Las demás quedan en reserva.`
      : null;

  return (
    <div className="animate-rise">
      <PageHeader
        eyebrow={existing ? `Ficha · ${CHARACTER_KIND_LABELS[view.kind]}` : "Nueva ficha"}
        title={isNewSheet(characterId) ? "Nueva ficha" : view.name || "Sin nombre"}
        description={
          view.description ||
          "Elige equipo, skills y especiales. Los stats derivados se recalculan al instante."
        }
        back={{ to: "/characters", label: "Volver a fichas" }}
        actions={
          editing ? (
            <>
              <Button variant="ghost" size="sm" onClick={resetDraft}>
                Cancelar
              </Button>
              <Button
                variant="accent"
                size="sm"
                icon="save"
                loading={busy}
                disabled={inCombat}
                onClick={() => void handleSave()}
              >
                Guardar ficha
              </Button>
            </>
          ) : inCombat ? (
            <span className="chip chip-rust">
              <Icon name="lock" size={11} /> Solo lectura · combate
            </span>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                icon="trash"
                onClick={() => setConfirmDelete(true)}
              >
                Eliminar
              </Button>
              <Button
                variant="accent"
                size="sm"
                icon="edit"
                onClick={() => setEditing(true)}
              >
                Editar ficha
              </Button>
            </>
          )
        }
      />

      {inCombat ? (
        <div className="mb-4 flex items-start gap-2 border-2 border-amber bg-amber/15 p-3">
          <Icon name="lock" size={15} className="mt-0.5 shrink-0 text-rust" />
          <p className="text-xs font-semibold leading-relaxed text-ink-soft">
            La mesa está en combate: las fichas y el HP son de solo lectura hasta
            que termine. El DM solo controla enemigos y nadie ajusta HP en medio
            de la ronda.
          </p>
        </div>
      ) : null}

      {errors.length > 0 ? (
        <div className="mb-4 border-2 border-rust bg-rust/10 p-3">
          <div className="mb-1 flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-rust-deep">
            <Icon name="alert" size={14} /> Revisa la ficha
          </div>
          <ul className="list-inside list-disc text-xs text-rust-deep">
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          <section className="panel overflow-hidden">
            <div className="grid sm:grid-cols-[180px_minmax(0,1fr)]">
              <div className="relative min-h-[180px] border-b-2 border-ink bg-grid bg-paper-deep sm:border-b-0 sm:border-r-2">
                {view.portrait ? (
                  <img
                    src={view.portrait}
                    alt={view.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full min-h-[180px] items-center justify-center">
                    <div className="flex h-24 w-24 items-center justify-center border-2 border-ink bg-paper-light pentagon">
                      <span className="font-display text-3xl text-ink-faint">
                        {(view.name || "?").slice(0, 1).toUpperCase()}
                      </span>
                    </div>
                  </div>
                )}
                <div className="absolute bottom-2 left-2">
                  <span className="border border-ink bg-paper-light px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.12em]">
                    {CHARACTER_KIND_LABELS[view.kind]}
                  </span>
                </div>
              </div>
              <div className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="mono-label">
                      {existing ? existing.id.slice(0, 14) : "sin guardar"}
                    </div>
                    <h2 className="display mt-1 text-3xl">{view.name || "Sin nombre"}</h2>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {view.tags?.slice(0, 4).map((tag) => (
                      <span key={tag} className="chip">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-ink-soft">
                  {view.description || "Sin descripción."}
                </p>
                <div className="mt-3">
                  <StatStrip stats={derived.stats} />
                </div>
                {inCombatSkillLimit ? (
                  <p className="mt-2 flex items-start gap-1.5 text-[10px] leading-snug text-rust-deep">
                    <Icon name="alert" size={12} className="mt-0.5 shrink-0" />
                    {inCombatSkillLimit}
                  </p>
                ) : null}
              </div>
            </div>
          </section>

          {editing ? (
            <>
              <section className="panel p-4">
                <h2 className="mb-4 border-b-2 border-ink pb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
                  01 · Identidad
                </h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Nombre" className="sm:col-span-2">
                    <TextInput
                      value={draft.name}
                      onValueChange={(value) => patch({ name: value })}
                      placeholder="Arzu"
                      maxLength={80}
                    />
                  </Field>
                  <Field label="Tipo de ficha">
                    <Select
                      value={draft.kind}
                      onValueChange={(value) => patch({ kind: value as CharacterKind })}
                    >
                      {Object.entries(CHARACTER_KIND_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Tags" hint="Separados por comas.">
                    <TextInput value={tagsText} onValueChange={setTagsText} placeholder="party, armada-2" />
                  </Field>
                  <Field label="Descripción" className="sm:col-span-2">
                    <TextArea
                      value={draft.description ?? ""}
                      onValueChange={(value) => patch({ description: value })}
                      rows={2}
                      maxLength={2000}
                    />
                  </Field>
                  <div className="sm:col-span-2">
                    <ImageField
                      value={draft.portrait}
                      onChange={(value) => patch({ portrait: value })}
                      label="Retrato"
                      hint="Upload local o URL. Se muestra en la ficha y en las tarjetas."
                      shape="portrait"
                    />
                  </div>
                </div>
              </section>

              <section className="panel p-4">
                <h2 className="mb-1 border-b-2 border-ink pb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
                  02 · Stats base
                </h2>
                <p className="mb-4 mt-2 text-[11px] text-ink-faint">
                  Sin equipo ni efectos. El total derivado aparece a la derecha en tiempo
                  real.
                </p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {STAT_KEYS.map((key) => (
                    <Field
                      key={key}
                      label={key === "hpMax" ? "HP máximo" : STAT_LABELS[key]}
                      hint={key === "spd" ? "Base 10 por defecto." : undefined}
                    >
                      <NumberInput
                        value={draft.baseStats[key]}
                        onValueChange={(value) => patchBaseStat(key, value)}
                        min={key === "hpMax" ? 1 : key === "skillSlots" ? 1 : -999}
                        max={key === "skillSlots" ? 6 : 999}
                      />
                    </Field>
                  ))}
                </div>
              </section>

              <section className="panel p-4">
                <h2 className="mb-1 border-b-2 border-ink pb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
                  03 · Equipo
                </h2>
                <p className="mb-4 mt-2 text-[11px] text-ink-faint">
                  Cinco slots. Cada objeto suma sus stats y efectos pasivos al total.
                </p>
                <div className="space-y-3">
                  {EQUIPMENT_SLOTS.map((slot) => {
                    const itemId = draft.equipment[slot];
                    const item = itemId ? itemsById.get(itemId) : null;
                    return (
                      <div key={slot} className="border-2 border-ink/30 bg-paper/40 p-2.5">
                        <div className="grid gap-2 sm:grid-cols-[130px_minmax(0,1fr)] sm:items-center">
                          <div>
                            <div className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-ink-soft">
                              {EQUIPMENT_SLOT_LABELS[slot]}
                            </div>
                            <div className="text-[10px] text-ink-faint">
                              {EQUIPMENT_SLOT_HINTS[slot]}
                            </div>
                          </div>
                          <Select
                            value={itemId ?? ""}
                            onValueChange={(value) => patchEquipment(slot, value || null)}
                          >
                            <option value="">— Vacío —</option>
                            {campaign.content.items
                              .filter((entry) => entry.slot === slot || entry.id === itemId)
                              .map((entry) => (
                                <option key={entry.id} value={entry.id}>
                                  {entry.name} {entry.slot !== slot ? "(slot distinto)" : ""}
                                </option>
                              ))}
                          </Select>
                        </div>
                        {item ? (
                          <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-ink/15 pt-2">
                            {item.image ? (
                              <img src={item.image} alt="" className="h-8 w-8 border border-ink bg-paper-deep object-contain p-0.5" />
                            ) : null}
                            <span className="text-xs font-semibold">{item.name}</span>
                            <span className="font-mono text-[9px] text-ink-faint">
                              {item.code}
                            </span>
                            {statEntries(item.stats).map((entry) => (
                              <StatChip
                                key={entry.key}
                                label={entry.label}
                                value={entry.value}
                              />
                            ))}
                            {item.effects?.map((ref) => {
                              const effect = campaign.content.effects.find(
                                (entry) => entry.id === ref.effectId,
                              );
                              return effect ? (
                                <span key={ref.effectId} className="chip chip-rust">
                                  <Icon name="flame" size={10} />
                                  {effect.name}
                                </span>
                              ) : null;
                            })}
                          </div>
                        ) : (
                          <p className="mt-2 border-t border-ink/10 pt-2 text-[10px] text-ink-faint">
                            Sin objeto equipado.
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="panel p-4">
                <h2 className="mb-1 border-b-2 border-ink pb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
                  04 · Skills y especiales
                </h2>
                <p className="mb-4 mt-2 text-[11px] text-ink-faint">
                  Tres slots de skill. Los dominios y hábitats gastan 1 Skill Slot y son
                  1 vez por combate.
                </p>
                <div className="grid gap-3 sm:grid-cols-3">
                  {[0, 1, 2].map((index) => (
                    <Field key={index} label={`Skill ${index + 1}`}>
                      <Select
                        value={draft.skills[index] ?? ""}
                        onValueChange={(value) => patchSkill(index, value || null)}
                      >
                        <option value="">— Vacío —</option>
                        {campaign.content.skills.map((skill) => (
                          <option key={skill.id} value={skill.id}>
                            {skill.name} ({skill.coins} monedas)
                          </option>
                        ))}
                      </Select>
                    </Field>
                  ))}
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <Field label="Dominio" hint="Habilidad especial de equipo.">
                    <Select
                      value={draft.special?.domainId ?? ""}
                      onValueChange={(value) => patchSpecial("domainId", value || null)}
                    >
                      <option value="">— Vacío —</option>
                      {campaign.content.specials.map((special) => (
                        <option key={special.id} value={special.id}>
                          {special.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Hábitat">
                    <Select
                      value={draft.special?.habitatId ?? ""}
                      onValueChange={(value) => patchSpecial("habitatId", value || null)}
                    >
                      <option value="">— Vacío —</option>
                      {campaign.content.specials.map((special) => (
                        <option key={special.id} value={special.id}>
                          {special.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
              </section>

              <section className="panel p-4">
                <h2 className="mb-1 border-b-2 border-ink pb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
                  05 · Visual de combate
                </h2>
                <p className="mb-4 mt-2 text-[11px] leading-relaxed text-ink-faint">
                  Decide cómo se dibuja esta ficha en el side-view. La vista previa
                  usa el equipo actual; en modo capas, el <code>Item.image</code>{" "}
                  de cada objeto equipado se apila en orden piernas → armadura →
                  cuernos → mano. La utilidad no se dibuja en el cuerpo.
                </p>

                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
                  <div className="space-y-4">
                    <Field
                      label="Modo de render"
                      hint={`Por defecto, este tipo de ficha usa: ${VISUAL_MODE_LABELS[resolveVisualMode(draft)]}.`}
                    >
                      <Select
                        value={draft.visualMode ?? effectiveVisualMode}
                        onValueChange={(value) =>
                          patch({ visualMode: value as VisualMode })
                        }
                      >
                        <option value="portrait">Sprite único</option>
                        <option value="layered">Capas</option>
                      </Select>
                    </Field>

                    <ImageField
                      value={draft.battleSprite}
                      onChange={(value) => patch({ battleSprite: value })}
                      label="Sprite único de combate"
                      hint="Cuerpo completo, transparente y mirando a la izquierda. Fallback: retrato → placeholder."
                    />

                    <ImageField
                      value={draft.bodyImage}
                      onChange={(value) => patch({ bodyImage: value })}
                      label="Cuerpo base (modo capas)"
                      hint="PNG 1024×1024 transparente, pies al 90%. Sin cuerpo base, el modo capas cae a sprite único."
                    />

                    {previewWeapon ? (
                      <div className="border-2 border-ink/25 bg-paper/60 p-2.5">
                        <div className="mono-label">Capa de arma en preview</div>
                        <p className="mt-1 flex items-center gap-2 text-xs font-semibold">
                          <Icon name="sword" size={13} className="text-rust" />
                          {previewWeapon.name}
                        </p>
                        <p className="mt-1 text-[10px] leading-snug text-ink-faint">
                          Mientras esa skill se resuelve, su{" "}
                          <code>weaponImage</code> sustituye temporalmente la capa
                          de la mano.
                        </p>
                      </div>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="mono-label">Vista previa en vivo</span>
                      <span className="chip">
                        {VISUAL_MODE_LABELS[effectiveVisualMode]}
                      </span>
                    </div>
                    <CombatVisualPreview
                      character={draft}
                      content={content}
                      weaponImage={previewWeapon?.weaponImage}
                    />
                    <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-ink-faint">
                      Cambia el equipo y el modo: el montaje se actualiza al instante.
                    </p>
                  </div>
                </div>
              </section>

              <section className="panel p-4">
                <h2 className="mb-1 border-b-2 border-ink pb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
                  06 · Inventario y notas
                </h2>
                <div className="mt-3 space-y-2">
                  {campaign.content.items.length === 0 ? (
                    <p className="text-xs text-ink-soft">
                      No hay objetos en la campaña todavía.
                    </p>
                  ) : (
                    draft.inventory.map((entry, index) => {
                      const item = itemsById.get(entry.itemId);
                      return (
                        <div key={index} className="flex flex-wrap items-center gap-2">
                          <Select
                            value={entry.itemId}
                            onValueChange={(value) =>
                              updateInventoryEntry(index, { itemId: value })
                            }
                            className="min-w-[180px] flex-1"
                          >
                            {campaign.content.items.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.name} ({option.slot})
                              </option>
                            ))}
                          </Select>
                          {item ? (
                            <span className="font-mono text-[9px] text-ink-faint">
                              {item.code}
                            </span>
                          ) : null}
                          <NumberInput
                            value={entry.qty}
                            onValueChange={(value) =>
                              updateInventoryEntry(index, { qty: value ?? 1 })
                            }
                            min={1}
                            max={9999}
                            className="w-20"
                          />
                          <button
                            type="button"
                            onClick={() => removeInventoryEntry(index)}
                            className="flex h-8 w-8 items-center justify-center border border-ink/30 text-ink-faint hover:bg-rust/10 hover:text-rust"
                            aria-label="Quitar del inventario"
                          >
                            <Icon name="trash" size={13} />
                          </button>
                        </div>
                      );
                    })
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    icon="plus"
                    onClick={addInventoryEntry}
                    disabled={campaign.content.items.length === 0}
                  >
                    Añadir objeto al inventario
                  </Button>
                </div>
                <Field label="Notas del DM" className="mt-4">
                  <TextArea
                    value={draft.notes ?? ""}
                    onValueChange={(value) => patch({ notes: value })}
                    rows={3}
                    maxLength={4000}
                    placeholder="Secretos, pactos, deudas…"
                  />
                </Field>
              </section>
            </>
          ) : (
            <>
              <section className="panel p-4">
                <h2 className="mb-3 border-b-2 border-ink pb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
                  Equipo
                </h2>
                <div className="grid gap-2 sm:grid-cols-2">
                  {EQUIPMENT_SLOTS.map((slot) => {
                    const itemId = view.equipment[slot];
                    const item = itemId ? itemsById.get(itemId) : null;
                    return (
                      <div
                        key={slot}
                        className={cx(
                          "flex items-start gap-2 border-2 p-2",
                          item ? "border-ink/30 bg-paper/50" : "border-dashed border-ink/20",
                        )}
                      >
                        {item?.image ? (
                          <img
                            src={item.image}
                            alt=""
                            className="h-10 w-10 shrink-0 border border-ink bg-paper-deep object-contain p-0.5"
                          />
                        ) : (
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center border border-ink/20 bg-paper-deep">
                            <Icon name="cube" size={15} className="text-ink-faint" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="font-mono text-[8px] uppercase tracking-[0.14em] text-ink-faint">
                            {EQUIPMENT_SLOT_LABELS[slot]}
                          </div>
                          <div className="truncate text-xs font-semibold">
                            {item?.name ?? "Vacío"}
                          </div>
                          {item ? (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {statEntries(item.stats).map((entry) => (
                                <StatChip
                                  key={entry.key}
                                  label={entry.label}
                                  value={entry.value}
                                />
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="panel p-4">
                <h2 className="mb-3 border-b-2 border-ink pb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
                  Visual de combate
                </h2>
                <div className="grid gap-4 sm:grid-cols-[220px_minmax(0,1fr)]">
                  <CombatVisualPreview
                    character={view}
                    content={content}
                    weaponImage={previewWeapon?.weaponImage}
                  />
                  <div className="space-y-2 text-xs">
                    <div className="flex items-center justify-between gap-2 border-b border-ink/10 pb-1.5">
                      <span className="text-ink-soft">Modo</span>
                      <span className="chip">
                        {VISUAL_MODE_LABELS[resolveVisualMode(view)]}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 border-b border-ink/10 pb-1.5">
                      <span className="text-ink-soft">Sprite único</span>
                      <span className="font-mono text-[10px]">
                        {view.battleSprite ? "Definido" : "Fallback"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 border-b border-ink/10 pb-1.5">
                      <span className="text-ink-soft">Cuerpo base</span>
                      <span className="font-mono text-[10px]">
                        {view.bodyImage ? "Definido" : "Sin capas"}
                      </span>
                    </div>
                    <p className="pt-1 text-[10px] leading-snug text-ink-faint">
                      Cambia modo, sprite o cuerpo desde «Editar ficha». El mismo
                      montaje se usa en la mesa de combate.
                    </p>
                  </div>
                </div>
              </section>

              <section className="panel p-4">
                <h2 className="mb-3 border-b-2 border-ink pb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
                  Skills
                </h2>
                {equippedSkills.length === 0 ? (
                  <p className="text-sm text-ink-soft">No hay skills equipadas.</p>
                ) : (
                  <div className="space-y-2">
                    {view.skills.map((skillId, index) => {
                      const skill = skillId ? skillsById.get(skillId) : null;
                      return (
                        <div
                          key={index}
                          className={cx(
                            "flex flex-wrap items-center gap-3 border-2 p-2",
                            skill ? "border-ink/30 bg-paper/50" : "border-dashed border-ink/20",
                          )}
                        >
                          <span className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-ink-faint">
                            SLOT {index + 1}
                          </span>
                          {skill ? (
                            <>
                              <div className="min-w-0 flex-1">
                                <div className="text-sm font-semibold">{skill.name}</div>
                                <CoinRow coins={skill.coins} />
                              </div>
                              <div className="font-mono text-[9px] text-ink-soft">
                                clash {skill.baseClash}+{skill.coinClash}/c · daño{" "}
                                {skill.baseDamage}
                                {signed(skill.coinDamage)}/c
                              </div>
                            </>
                          ) : (
                            <span className="text-xs text-ink-faint">Vacío</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {(["domainId", "habitatId"] as const).map((field) => {
                    const specialId = view.special?.[field];
                    const special = specialId ? specialsById.get(specialId) : null;
                    return (
                      <div key={field} className="border-2 border-ink/30 bg-paper/50 p-2">
                        <div className="font-mono text-[8px] uppercase tracking-[0.14em] text-ink-faint">
                          {field === "domainId" ? "Dominio" : "Hábitat"}
                        </div>
                        <div className="text-xs font-semibold">
                          {special?.name ?? "Vacío"}
                        </div>
                        {special ? (
                          <div className="mt-0.5 font-mono text-[9px] text-ink-faint">
                            {special.duration} turnos · {special.oncePerCombat ? "1/combate" : "reusable"}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="panel p-4">
                <h2 className="mb-3 border-b-2 border-ink pb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
                  Inventario
                </h2>
                {view.inventory.length === 0 ? (
                  <p className="text-sm text-ink-soft">Sin objetos en el inventario.</p>
                ) : (
                  <div className="divide-y divide-ink/10">
                    {view.inventory.map((entry, index) => {
                      const item = itemsById.get(entry.itemId);
                      return (
                        <div key={index} className="flex items-center justify-between gap-2 py-1.5">
                          <div className="flex min-w-0 items-center gap-2">
                            <Icon name="cube" size={13} className="shrink-0 text-ink-faint" />
                            <span className="truncate text-xs font-semibold">
                              {item?.name ?? "Objeto borrado"}
                            </span>
                            {item ? (
                              <span className="font-mono text-[9px] text-ink-faint">
                                {item.code}
                              </span>
                            ) : null}
                          </div>
                          <span className="font-mono text-[10px] text-ink-soft">×{entry.qty}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
                {view.notes ? (
                  <div className="mt-4 border-t border-ink/15 pt-3">
                    <div className="mono-label mb-1">Notas del DM</div>
                    <p className="whitespace-pre-wrap text-xs leading-relaxed text-ink-soft">
                      {view.notes}
                    </p>
                  </div>
                ) : null}
              </section>
            </>
          )}
        </div>

        <aside className="space-y-4">
          <div className="sticky top-6 space-y-4">
            <div className="panel p-4">
              <div className="mb-3 flex items-center justify-between border-b-2 border-ink pb-2">
                <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.18em]">
                  Stats derivados
                </h2>
                <span className="font-mono text-[9px] text-ink-faint">
                  {editing ? "en vivo" : "equipo + efectos"}
                </span>
              </div>
              <StatPanel derived={derived} rules={campaign.rules} />
            </div>

            <div className="border-2 border-dashed border-ink/30 p-3 text-[11px] leading-relaxed text-ink-soft">
              <strong className="font-mono text-[9px] uppercase tracking-[0.14em]">
                Cómo se calcula
              </strong>
              <p className="mt-1">
                (base + planos) × (1 + %). Skill Slots se limita a 1–
                {campaign.rules.maxSkillSlots}. DEF mitiga con{" "}
                <code className="font-mono">DEF / (DEF + {campaign.rules.defenseConstant})</code>.
              </p>
            </div>

            {existing ? (
              <div className="border-2 border-ink/20 p-3">
                <div className="mono-label mb-1">ID interno</div>
                <code className="block break-all font-mono text-[10px] text-ink-soft">
                  {existing.id}
                </code>
                <div className="mono-label mt-3 mb-1">Tags</div>
                <TagList tags={existing.tags} max={12} />
              </div>
            ) : null}
          </div>
        </aside>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Eliminar ficha"
        message={
          <>
            Vas a eliminar a <strong>«{view.name}»</strong>. Si un encuentro lo usa como
            enemigo, el servidor rechazará el borrado.
          </>
        }
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void handleDelete()}
        busy={busy}
      />
    </div>
  );
}

function isNewSheet(characterId: string | undefined): boolean {
  return !characterId;
}
