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
  type BossPhase,
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
  Toggle,
  cx,
} from "../components/ui";
import { CoinRow } from "../components/cards";
import { signed, statEntries } from "../lib/format";

function cloneCharacter(character: Character): Character {
  return structuredClone(character);
}

function StatStrip({ stats }: { stats: Stats }) {
  return (
    <div className="grid grid-cols-3 gap-px border border-ui-line-strong bg-ui-surface-1 sm:grid-cols-6">
      {STAT_KEYS.map((key) => (
        <div key={key} className="bg-ui-surface-2 px-2 py-2 text-center">
          <div className="font-mono text-[8px] font-bold uppercase tracking-[0.12em] text-ui-faint">
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
          <p className="text-sm text-ui-muted">Ese personaje no existe en esta campaña.</p>
          <div className="mt-4">
            <LinkButton to="/characters" size="sm">Volver</LinkButton>
          </div>
        </div>
      </div>
    );
  }

  const view = editing || !existing ? draft : existing;
  const content = campaign.content;
  const derived = calculateStats(
    view,
    content,
    campaign.rules,
    campaign.settings,
  );
  const itemsById = new Map(campaign.content.items.map((item) => [item.id, item]));
  const skillsById = new Map(campaign.content.skills.map((skill) => [skill.id, skill]));
  const specialsById = new Map(
    campaign.content.specials.map((special) => [special.id, special]),
  );

  const equippedSkills = draft.skills
    .map((id) => (id ? skillsById.get(id) : null))
    .filter((skill): skill is Skill => Boolean(skill));
  const effectiveVisualMode = resolveVisualMode(view);
  const previewSkill = view.skills
    .map((id) => (id ? skillsById.get(id) : null))
    .find((skill): skill is Skill =>
      Boolean(skill?.weaponImage || skill?.backImage || skill?.frontImage),
    );

  function patch(update: Partial<Character>) {
    setDraft((current) => ({ ...current, ...update }));
  }

  function patchBaseStat(key: StatKey, value: number | undefined) {
    setDraft((current) => ({
      ...current,
      baseStats: { ...current.baseStats, [key]: value ?? (key === "hpMax" ? 1 : 0) },
    }));
  }

  function handleLevelUp() {
    setDraft((current) => ({
      ...current,
      level: Math.min(9999, Math.max(1, Math.trunc(current.level ?? 1)) + 1),
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

  function setBossPhaseEnabled(enabled: boolean) {
    setDraft((current) => ({
      ...current,
      bossPhase: enabled
        ? (current.bossPhase ?? { thresholdPct: 50 })
        : undefined,
    }));
  }

  function patchBossPhase(update: Partial<BossPhase>) {
    setDraft((current) => ({
      ...current,
      bossPhase: {
        thresholdPct: 50,
        ...(current.bossPhase ?? {}),
        ...update,
      },
    }));
  }

  function setBossPhaseSkillsEnabled(enabled: boolean) {
    setDraft((current) => {
      if (!current.bossPhase) return current;
      return {
        ...current,
        bossPhase: {
          ...current.bossPhase,
          skills: enabled ? [...current.skills] : undefined,
        },
      };
    });
  }

  function patchBossPhaseSkill(index: number, skillId: string | null) {
    setDraft((current) => {
      if (!current.bossPhase) return current;
      const skills = [...(current.bossPhase.skills ?? current.skills)];
      skills[index] = skillId;
      return {
        ...current,
        bossPhase: { ...current.bossPhase, skills },
      };
    });
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
    const bossPhase = draft.bossPhase
      ? {
          ...draft.bossPhase,
          label: draft.bossPhase.label?.trim() || undefined,
          name: draft.bossPhase.name?.trim() || undefined,
          description: draft.bossPhase.description?.trim() || undefined,
        }
      : undefined;
    const payload = {
      name: draft.name.trim(),
      kind: draft.kind,
      portrait: draft.portrait,
      description: draft.description?.trim() || undefined,
      visualMode: draft.visualMode,
      battleSprite: draft.battleSprite,
      bodyImage: draft.bodyImage,
      bossPhase,
      level: Math.max(1, Math.min(9999, Math.trunc(draft.level ?? 1))),
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
          <Icon name="lock" size={15} className="mt-0.5 shrink-0 text-ui-danger" />
          <p className="text-xs font-semibold leading-relaxed text-ui-muted">
            La mesa está en combate: las fichas y el HP son de solo lectura hasta
            que termine. El DM solo controla enemigos y nadie ajusta HP en medio
            de la ronda.
          </p>
        </div>
      ) : null}

      {errors.length > 0 ? (
        <div className="mb-4 border-2 border-rust bg-rust/10 p-3">
          <div className="mb-1 flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-ui-danger">
            <Icon name="alert" size={14} /> Revisa la ficha
          </div>
          <ul className="list-inside list-disc text-xs text-ui-danger">
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
              <div className="relative min-h-[180px] border-b border-ui-line-strong bg-grid bg-ui-surface-3 sm:border-b-0 sm:border-r">
                {view.portrait ? (
                  <img
                    src={view.portrait}
                    alt={view.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full min-h-[180px] items-center justify-center">
                    <div className="flex h-24 w-24 items-center justify-center border border-ui-line-strong bg-ui-surface-2 pentagon">
                      <span className="font-display text-3xl text-ui-faint">
                        {(view.name || "?").slice(0, 1).toUpperCase()}
                      </span>
                    </div>
                  </div>
                )}
                <div className="absolute bottom-2 left-2">
                  <span className="border border-ui-line-strong bg-ui-surface-2 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.12em]">
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
                    <span className="chip chip-accent">Nivel {derived.level}</span>
                    {view.tags?.slice(0, 4).map((tag) => (
                      <span key={tag} className="chip">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-ui-muted">
                  {view.description || "Sin descripción."}
                </p>
                <div className="mt-3">
                  <StatStrip stats={derived.stats} />
                </div>
                {inCombatSkillLimit ? (
                  <p className="mt-2 flex items-start gap-1.5 text-[10px] leading-snug text-ui-danger">
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
                <h2 className="mb-4 border-b border-ui-line-strong pb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
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
                <h2 className="mb-1 border-b border-ui-line-strong pb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
                  02 · Stats base
                </h2>
                <p className="mb-4 mt-2 text-[11px] text-ui-faint">
                  Sin equipo ni efectos. El total derivado aparece a la derecha en tiempo
                  real.
                </p>
                <div className="mb-4 grid gap-3 border border-ui-line bg-ui-surface-2 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field
                      label="Nivel"
                      hint="Los aumentos por nivel salen de los ajustes de la campaña."
                    >
                      <NumberInput
                        value={draft.level ?? 1}
                        onValueChange={(value) =>
                          patch({
                            level: Math.max(
                              1,
                              Math.min(9999, Math.trunc(value ?? 1)),
                            ),
                          })
                        }
                        min={1}
                        max={9999}
                      />
                    </Field>
                    <div className="flex flex-col justify-end gap-1 text-[10px] leading-snug text-ui-faint">
                      <span>
                        Soul Points:{" "}
                        <b className="font-mono text-ui">
                          {derived.soulPoints.used}/{derived.soulPoints.max}
                        </b>
                      </span>
                      {derived.soulPoints.overcharged ? (
                        <span className="font-mono font-bold uppercase tracking-[0.1em] text-ui-danger">
                          OVERCHARGED · 1.5× daño
                        </span>
                      ) : (
                        <span>Equipo dentro del límite.</span>
                      )}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    icon="plus"
                    onClick={handleLevelUp}
                  >
                    Subir nivel
                  </Button>
                </div>
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
                <h2 className="mb-1 border-b border-ui-line-strong pb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
                  03 · Equipo
                </h2>
                <p className="mb-4 mt-2 text-[11px] text-ui-faint">
                  Cinco slots. Cada objeto suma sus stats y efectos pasivos al total.
                </p>
                <div className="space-y-3">
                  {EQUIPMENT_SLOTS.map((slot) => {
                    const itemId = draft.equipment[slot];
                    const item = itemId ? itemsById.get(itemId) : null;
                    return (
                      <div key={slot} className="border border-ui-line bg-ui-surface-2 p-2.5">
                        <div className="grid gap-2 sm:grid-cols-[130px_minmax(0,1fr)] sm:items-center">
                          <div>
                            <div className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-ui-muted">
                              {EQUIPMENT_SLOT_LABELS[slot]}
                            </div>
                            <div className="text-[10px] text-ui-faint">
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
                          <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-ui-line pt-2">
                            {item.image ? (
                              <img src={item.image} alt="" className="h-8 w-8 border border-ui-line-strong bg-ui-surface-3 object-contain p-0.5" />
                            ) : null}
                            <span className="text-xs font-semibold">{item.name}</span>
                            <span className="font-mono text-[9px] text-ui-faint">
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
                          <p className="mt-2 border-t border-ui-line pt-2 text-[10px] text-ui-faint">
                            Sin objeto equipado.
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="panel p-4">
                <h2 className="mb-1 border-b border-ui-line-strong pb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
                  04 · Skills y especiales
                </h2>
                <p className="mb-4 mt-2 text-[11px] text-ui-faint">
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

              {draft.kind === "boss" ? (
                <section className="panel p-4">
                  <h2 className="mb-1 border-b border-ui-line-strong pb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
                    05 · Cambio de fase
                  </h2>
                  <p className="mb-4 mt-2 text-[11px] leading-relaxed text-ui-faint">
                    La fase 1 es esta ficha. Al terminar una ronda con la vida en
                    el umbral o por debajo, el jefe entra una sola vez en fase 2 y
                    cambia sprite, nombre y habilidades. Curarse después no revierte
                    el cambio; morir en esa misma ronda lo impide.
                  </p>
                  <Toggle
                    checked={Boolean(draft.bossPhase)}
                    onCheckedChange={setBossPhaseEnabled}
                    label="Activar cambio de fase"
                    hint="Sin fase configurada, el jefe es un enemigo normal sin fase 2."
                  />
                  {draft.bossPhase ? (
                    <div className="mt-4 space-y-4">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field
                          label="Umbral de vida (%)"
                          hint="1–99. Se activa al terminar la ronda con este % de vida o menos."
                        >
                          <NumberInput
                            value={draft.bossPhase?.thresholdPct ?? 50}
                            onValueChange={(value) =>
                              patchBossPhase({ thresholdPct: value ?? 50 })
                            }
                            min={1}
                            max={99}
                          />
                        </Field>
                        <Field
                          label="Etiqueta de fase"
                          hint="Texto para el log de combate, p. ej. «Fase 2: desatado»."
                        >
                          <TextInput
                            value={draft.bossPhase?.label ?? ""}
                            onValueChange={(value) =>
                              patchBossPhase({ label: value })
                            }
                            maxLength={120}
                            placeholder="Fase 2: desatado"
                          />
                        </Field>
                      </div>

                      <Field
                        label="Nombre en fase 2"
                        hint="Vacío = conserva el nombre de la fase 1."
                      >
                        <TextInput
                          value={draft.bossPhase?.name ?? ""}
                          onValueChange={(value) =>
                            patchBossPhase({ name: value })
                          }
                          maxLength={80}
                        />
                      </Field>

                      <Field
                        label="Descripción en fase 2"
                        hint="Vacío = conserva la descripción de la fase 1."
                      >
                        <TextArea
                          value={draft.bossPhase?.description ?? ""}
                          onValueChange={(value) =>
                            patchBossPhase({ description: value })
                          }
                          rows={2}
                          maxLength={2000}
                        />
                      </Field>

                      <ImageField
                        value={draft.bossPhase?.portrait}
                        onChange={(value) => patchBossPhase({ portrait: value })}
                        label="Retrato en fase 2"
                        hint="Vacío = conserva el retrato de la fase 1."
                        shape="portrait"
                      />

                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field
                          label="Modo visual en fase 2"
                          hint="Hereda el modo de la fase 1 si se deja en blanco."
                        >
                          <Select
                            value={draft.bossPhase?.visualMode ?? ""}
                            onValueChange={(value) =>
                              patchBossPhase({
                                visualMode: value
                                  ? (value as VisualMode)
                                  : undefined,
                              })
                            }
                          >
                            <option value="">— Heredar fase 1 —</option>
                            <option value="portrait">Sprite único</option>
                            <option value="layered">Capas</option>
                          </Select>
                        </Field>
                        <p className="self-end text-[10px] leading-snug text-ui-faint">
                          El sprite cambia en cuanto el servidor publica el estado
                          resuelto de la ronda.
                        </p>
                      </div>

                      <ImageField
                        value={draft.bossPhase?.battleSprite}
                        onChange={(value) =>
                          patchBossPhase({ battleSprite: value })
                        }
                        label="Sprite de combate en fase 2"
                        hint="Vacío = conserva el sprite de la fase 1."
                      />

                      <ImageField
                        value={draft.bossPhase?.bodyImage}
                        onChange={(value) => patchBossPhase({ bodyImage: value })}
                        label="Cuerpo base en fase 2 (modo capas)"
                        hint="Vacío = conserva el cuerpo base de la fase 1."
                      />

                      <div className="border border-ui-line bg-ui-surface-2 p-3">
                        <Toggle
                          checked={Boolean(draft.bossPhase?.skills)}
                          onCheckedChange={setBossPhaseSkillsEnabled}
                          label="Cambiar habilidades en fase 2"
                          hint="Si se desactiva, conserva las skills de la fase 1."
                        />
                        {draft.bossPhase?.skills ? (
                          <div className="mt-3 grid gap-3 sm:grid-cols-3">
                            {[0, 1, 2].map((index) => (
                              <Field
                                key={index}
                                label={`Skill ${index + 1} (fase 2)`}
                              >
                                <Select
                                  value={draft.bossPhase?.skills?.[index] ?? ""}
                                  onValueChange={(value) =>
                                    patchBossPhaseSkill(index, value || null)
                                  }
                                >
                                  <option value="">— Vacío —</option>
                                  {campaign.content.skills.map((skill) => (
                                    <option key={skill.id} value={skill.id}>
                                      {skill.name}
                                    </option>
                                  ))}
                                </Select>
                              </Field>
                            ))}
                          </div>
                        ) : null}
                      </div>

                      <p className="text-[10px] leading-snug text-ui-faint">
                        La fase 2 se evalúa al final de la ronda, después de
                        daño/efectos y antes de avanzar el contador. Las acciones
                        declaradas esa ronda usan la fase 1.
                      </p>
                    </div>
                  ) : null}
                </section>
              ) : null}

              <section className="panel p-4">
                <h2 className="mb-1 border-b border-ui-line-strong pb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
                  06 · Visual de combate
                </h2>
                <p className="mb-4 mt-2 text-[11px] leading-relaxed text-ui-faint">
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

                    {previewSkill ? (
                      <div className="border border-ui-line bg-ui-surface-2 p-2.5">
                        <div className="mono-label">Capas de skill en preview</div>
                        <p className="mt-1 flex items-center gap-2 text-xs font-semibold">
                          <Icon name="sword" size={13} className="text-ui-danger" />
                          {previewSkill.name}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {previewSkill.backImage ? (
                            <span className="chip">Trasera</span>
                          ) : null}
                          {previewSkill.weaponImage ? (
                            <span className="chip">Arma / mano</span>
                          ) : null}
                          {previewSkill.frontImage ? (
                            <span className="chip">Delantera</span>
                          ) : null}
                        </div>
                        <p className="mt-2 text-[10px] leading-snug text-ui-faint">
                          Mientras esa skill se usa, sus capas trasera y delantera
                          se dibujan alrededor del personaje. La capa de arma
                          heredada sustituye temporalmente la mano.
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
                      weaponImage={previewSkill?.weaponImage}
                      backImage={previewSkill?.backImage}
                      frontImage={previewSkill?.frontImage}
                    />
                    <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-ui-faint">
                      Cambia el equipo y el modo: el montaje se actualiza al instante.
                    </p>
                  </div>
                </div>
              </section>

              <section className="panel p-4">
                <h2 className="mb-1 border-b border-ui-line-strong pb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
                  07 · Inventario y notas
                </h2>
                <div className="mt-3 space-y-2">
                  {campaign.content.items.length === 0 ? (
                    <p className="text-xs text-ui-muted">
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
                            <span className="font-mono text-[9px] text-ui-faint">
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
                            className="flex h-8 w-8 items-center justify-center border border-ui-line text-ui-faint hover:bg-rust/10 hover:text-rust"
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
                <h2 className="mb-3 border-b border-ui-line-strong pb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
                  Equipo
                </h2>
                <div
                  className={cx(
                    "mb-3 flex flex-wrap items-center justify-between gap-2 border border-ui-line bg-ui-surface-2 px-2.5 py-2",
                    derived.soulPoints.overcharged && "border-rust/60 text-ui-danger",
                  )}
                >
                  <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-ui-faint">
                    Soul Points
                  </span>
                  <span className="font-display text-lg leading-none">
                    {derived.soulPoints.used}
                    <span className="text-xs text-ui-faint">
                      /{derived.soulPoints.max}
                    </span>
                    {derived.soulPoints.overcharged ? (
                      <span className="ml-2 font-mono text-[9px] font-bold uppercase tracking-[0.1em]">
                        OVERCHARGED
                      </span>
                    ) : null}
                  </span>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {EQUIPMENT_SLOTS.map((slot) => {
                    const itemId = view.equipment[slot];
                    const item = itemId ? itemsById.get(itemId) : null;
                    return (
                      <div
                        key={slot}
                        className={cx(
                          "flex items-start gap-2 border-2 p-2",
                          item ? "border-ui-line bg-ui-surface-2" : "border-dashed border-ui-line",
                        )}
                      >
                        {item?.image ? (
                          <img
                            src={item.image}
                            alt=""
                            className="h-10 w-10 shrink-0 border border-ui-line-strong bg-ui-surface-3 object-contain p-0.5"
                          />
                        ) : (
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center border border-ui-line bg-ui-surface-3">
                            <Icon name="cube" size={15} className="text-ui-faint" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="font-mono text-[8px] uppercase tracking-[0.14em] text-ui-faint">
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

              {view.kind === "boss" ? (
                <section className="panel p-4">
                  <h2 className="mb-3 border-b border-ui-line-strong pb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
                    Cambio de fase
                  </h2>
                  {view.bossPhase ? (
                    <>
                      <div className="flex flex-wrap gap-1.5">
                        <span className="chip chip-rust">
                          Umbral {view.bossPhase.thresholdPct}%
                        </span>
                        {view.bossPhase.label ? (
                          <span className="chip">{view.bossPhase.label}</span>
                        ) : null}
                        {view.bossPhase.skills ? (
                          <span className="chip chip-accent">Skills fase 2</span>
                        ) : null}
                        {view.bossPhase.battleSprite ||
                        view.bossPhase.bodyImage ||
                        view.bossPhase.portrait ||
                        view.bossPhase.visualMode ? (
                          <span className="chip chip-accent">Visual fase 2</span>
                        ) : null}
                      </div>
                      <p className="mt-3 text-xs leading-relaxed text-ui-muted">
                        Al terminar una ronda con un{" "}
                        {view.bossPhase.thresholdPct}% de vida o menos, el jefe
                        entra una sola vez en fase 2. Curarse después no revierte el
                        cambio; si cae en esa misma ronda, no se activa.
                      </p>
                      {view.bossPhase.name ||
                      view.bossPhase.description ? (
                        <p className="mt-2 text-xs leading-relaxed text-ui-faint">
                          {view.bossPhase.name ? (
                            <span className="font-semibold text-ui">
                              {view.bossPhase.name}
                            </span>
                          ) : null}
                          {view.bossPhase.name && view.bossPhase.description
                            ? " · "
                            : null}
                          {view.bossPhase.description}
                        </p>
                      ) : null}
                      {view.bossPhase.skills ? (
                        <div className="mt-3 grid gap-2 sm:grid-cols-3">
                          {view.bossPhase.skills.map((skillId, index) => {
                            const skill = skillId
                              ? skillsById.get(skillId)
                              : null;
                            return (
                              <div
                                key={index}
                                className="border border-ui-line bg-ui-surface-2 p-2"
                              >
                                <div className="font-mono text-[8px] uppercase tracking-[0.14em] text-ui-faint">
                                  Slot {index + 1} · fase 2
                                </div>
                                <div className="text-xs font-semibold">
                                  {skill?.name ?? "Vacío"}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="mt-3 border-t border-ui-line pt-2 text-[10px] text-ui-faint">
                          Conserva las skills de la fase 1.
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-ui-muted">
                      Sin cambio de fase: este jefe es un enemigo normal.
                    </p>
                  )}
                </section>
              ) : null}

              <section className="panel p-4">
                <h2 className="mb-3 border-b border-ui-line-strong pb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
                  Visual de combate
                </h2>
                <div className="grid gap-4 sm:grid-cols-[220px_minmax(0,1fr)]">
                  <CombatVisualPreview
                    character={view}
                    content={content}
                    weaponImage={previewSkill?.weaponImage}
                    backImage={previewSkill?.backImage}
                    frontImage={previewSkill?.frontImage}
                  />
                  <div className="space-y-2 text-xs">
                    <div className="flex items-center justify-between gap-2 border-b border-ui-line pb-1.5">
                      <span className="text-ui-muted">Modo</span>
                      <span className="chip">
                        {VISUAL_MODE_LABELS[resolveVisualMode(view)]}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 border-b border-ui-line pb-1.5">
                      <span className="text-ui-muted">Sprite único</span>
                      <span className="font-mono text-[10px]">
                        {view.battleSprite ? "Definido" : "Fallback"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 border-b border-ui-line pb-1.5">
                      <span className="text-ui-muted">Cuerpo base</span>
                      <span className="font-mono text-[10px]">
                        {view.bodyImage ? "Definido" : "Sin capas"}
                      </span>
                    </div>
                    <p className="pt-1 text-[10px] leading-snug text-ui-faint">
                      Cambia modo, sprite o cuerpo desde «Editar ficha». El mismo
                      montaje se usa en la mesa de combate.
                    </p>
                  </div>
                </div>
              </section>

              <section className="panel p-4">
                <h2 className="mb-3 border-b border-ui-line-strong pb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
                  Skills
                </h2>
                {equippedSkills.length === 0 ? (
                  <p className="text-sm text-ui-muted">No hay skills equipadas.</p>
                ) : (
                  <div className="space-y-2">
                    {view.skills.map((skillId, index) => {
                      const skill = skillId ? skillsById.get(skillId) : null;
                      return (
                        <div
                          key={index}
                          className={cx(
                            "flex flex-wrap items-center gap-3 border-2 p-2",
                            skill ? "border-ui-line bg-ui-surface-2" : "border-dashed border-ui-line",
                          )}
                        >
                          <span className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-ui-faint">
                            SLOT {index + 1}
                          </span>
                          {skill ? (
                            <>
                              <div className="min-w-0 flex-1">
                                <div className="text-sm font-semibold">{skill.name}</div>
                                <CoinRow coins={skill.coins} />
                              </div>
                              <div className="font-mono text-[9px] text-ui-muted">
                                clash {skill.baseClash}+{skill.coinClash}/c · daño{" "}
                                {skill.baseDamage}
                                {signed(skill.coinDamage)}/c
                              </div>
                            </>
                          ) : (
                            <span className="text-xs text-ui-faint">Vacío</span>
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
                      <div key={field} className="border border-ui-line bg-ui-surface-2 p-2">
                        <div className="font-mono text-[8px] uppercase tracking-[0.14em] text-ui-faint">
                          {field === "domainId" ? "Dominio" : "Hábitat"}
                        </div>
                        <div className="text-xs font-semibold">
                          {special?.name ?? "Vacío"}
                        </div>
                        {special ? (
                          <div className="mt-0.5 font-mono text-[9px] text-ui-faint">
                            {special.duration} turnos · {special.oncePerCombat ? "1/combate" : "reusable"}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="panel p-4">
                <h2 className="mb-3 border-b border-ui-line-strong pb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
                  Inventario
                </h2>
                {view.inventory.length === 0 ? (
                  <p className="text-sm text-ui-muted">Sin objetos en el inventario.</p>
                ) : (
                  <div className="divide-y divide-[color:var(--ui-line)]">
                    {view.inventory.map((entry, index) => {
                      const item = itemsById.get(entry.itemId);
                      return (
                        <div key={index} className="flex items-center justify-between gap-2 py-1.5">
                          <div className="flex min-w-0 items-center gap-2">
                            <Icon name="cube" size={13} className="shrink-0 text-ui-faint" />
                            <span className="truncate text-xs font-semibold">
                              {item?.name ?? "Objeto borrado"}
                            </span>
                            {item ? (
                              <span className="font-mono text-[9px] text-ui-faint">
                                {item.code}
                              </span>
                            ) : null}
                          </div>
                          <span className="font-mono text-[10px] text-ui-muted">×{entry.qty}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
                {view.notes ? (
                  <div className="mt-4 border-t border-ui-line pt-3">
                    <div className="mono-label mb-1">Notas del DM</div>
                    <p className="whitespace-pre-wrap text-xs leading-relaxed text-ui-muted">
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
              <div className="mb-3 flex items-center justify-between border-b border-ui-line-strong pb-2">
                <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.18em]">
                  Stats derivados
                </h2>
                <span className="font-mono text-[9px] text-ui-faint">
                  {editing ? "en vivo" : "equipo + efectos"}
                </span>
              </div>
              <StatPanel derived={derived} rules={campaign.rules} />
            </div>

            <div className="border border-dashed border-ui-line p-3 text-[11px] leading-relaxed text-ui-muted">
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
              <div className="border border-ui-line p-3">
                <div className="mono-label mb-1">ID interno</div>
                <code className="block break-all font-mono text-[10px] text-ui-muted">
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
