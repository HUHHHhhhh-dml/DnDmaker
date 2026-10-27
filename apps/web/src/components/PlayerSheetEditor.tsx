import { useState } from "react";
import {
  EQUIPMENT_SLOT_HINTS,
  EQUIPMENT_SLOT_LABELS,
  EQUIPMENT_SLOTS,
  STAT_KEYS,
  STAT_LABELS,
  calculateStats,
  characterInputSchema,
  type Campaign,
  type Character,
  type EquipmentSlot,
  type StatKey,
} from "@protocol-life/shared";
import { usePlayerStore } from "../store/usePlayerStore";
import { ImageField } from "./ImageField";
import { Icon } from "./Icons";
import { StatPanel } from "./StatPanel";
import {
  Button,
  Field,
  NumberInput,
  Select,
  TextArea,
  TextInput,
} from "./ui";

/**
 * Editor de la ficha propia del jugador.
 *
 * Solo expone los campos que un jugador puede tocar: identidad, stats base,
 * equipo, skills, especiales e inventario. `kind`, `ownerId` y las notas del DM
 * quedan fuera del formulario y nunca se envían en el patch.
 */
export function PlayerSheetEditor({
  character,
  campaign,
  onCancel,
  onSaved,
}: {
  character: Character;
  campaign: Campaign;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const saveCharacter = usePlayerStore((state) => state.saveCharacter);
  const [draft, setDraft] = useState<Character>(() => structuredClone(character));
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const derived = calculateStats(draft, campaign.content, campaign.rules);
  const itemsById = new Map(campaign.content.items.map((item) => [item.id, item]));
  const skillsById = new Map(
    campaign.content.skills.map((skill) => [skill.id, skill]),
  );

  // El estado del jugador incluye lo bloqueado que lleva la party para que los
  // stats de todos se calculen bien. El editor solo ofrece lo desbloqueado más
  // lo que ya lleva esta ficha (aunque el DM lo haya vuelto a bloquear).
  const ownItemIds = new Set<string>();
  for (const itemId of Object.values(character.equipment ?? {})) {
    if (itemId) ownItemIds.add(itemId);
  }
  for (const entry of character.inventory) ownItemIds.add(entry.itemId);
  const ownSkillIds = new Set(
    character.skills.filter((skillId): skillId is string => Boolean(skillId)),
  );
  const selectableItems = campaign.content.items.filter(
    (item) => item.unlocked === true || ownItemIds.has(item.id),
  );
  const selectableSkills = campaign.content.skills.filter(
    (skill) => skill.unlocked === true || ownSkillIds.has(skill.id),
  );

  function patch(update: Partial<Character>) {
    setDraft((current) => ({ ...current, ...update }));
  }

  function patchBaseStat(key: StatKey, value: number | undefined) {
    setDraft((current) => ({
      ...current,
      baseStats: {
        ...current.baseStats,
        [key]: value ?? (key === "hpMax" ? 1 : key === "skillSlots" ? 1 : 0),
      },
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
    const firstItem = selectableItems[0];
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

  function describeIssues(
    issues: { path: PropertyKey[]; message: string }[],
  ): string[] {
    return issues.map((issue) => {
      const [root, child] = issue.path;
      const rootLabel =
        typeof root === "string"
          ? FIELD_LABELS[root] ?? root
          : "Formulario";
      const childLabel =
        typeof child === "string"
          ? STAT_LABELS[child as StatKey] ?? child
          : null;
      return childLabel
        ? `${rootLabel} · ${childLabel}: ${issue.message}`
        : `${rootLabel}: ${issue.message}`;
    });
  }

  async function handleSave() {
    if (saving) return;
    const candidate = {
      name: draft.name.trim(),
      kind: character.kind,
      portrait: draft.portrait,
      description: draft.description?.trim() || undefined,
      baseStats: draft.baseStats,
      equipment: draft.equipment,
      skills: draft.skills,
      special: draft.special,
      inventory: draft.inventory,
      notes: character.notes,
      tags: draft.tags,
    };

    const parsed = characterInputSchema.safeParse(candidate);
    if (!parsed.success) {
      setErrors(describeIssues(parsed.error.issues));
      return;
    }

    const patchPayload: Partial<Character> = {
      name: parsed.data.name,
      portrait: parsed.data.portrait,
      description: parsed.data.description,
      baseStats: parsed.data.baseStats,
      equipment: parsed.data.equipment,
      skills: parsed.data.skills,
      special: parsed.data.special,
      inventory: parsed.data.inventory,
      tags: parsed.data.tags,
    };

    setErrors([]);
    setSaving(true);
    const ok = await saveCharacter(patchPayload);
    setSaving(false);

    if (ok) {
      onSaved();
      return;
    }
    setErrors([
      usePlayerStore.getState().error ?? "No se pudo guardar la ficha.",
    ]);
  }

  return (
    <div className="space-y-4">
      <div className="panel flex flex-wrap items-center justify-between gap-3 border-rust bg-rust/5 p-3">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center border-2 border-ink bg-rust/15 hexagon">
            <Icon name="edit" size={16} />
          </div>
          <div>
            <div className="mono-label">Editando tu ficha</div>
            <p className="text-xs text-ink-soft">
              Los stats derivados se recalculan mientras cambias el borrador.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCancel}
            disabled={saving}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            variant="accent"
            size="sm"
            icon="save"
            loading={saving}
            onClick={() => void handleSave()}
          >
            Guardar ficha
          </Button>
        </div>
      </div>

      {errors.length > 0 ? (
        <div className="border-2 border-rust bg-rust/10 p-3">
          <div className="mb-1 flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-rust-deep">
            <Icon name="alert" size={14} /> Revisa tu ficha
          </div>
          <ul className="list-inside list-disc text-xs leading-relaxed text-rust-deep">
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      ) : null}

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
          <Field label="Descripción" className="sm:col-span-2">
            <TextArea
              value={draft.description ?? ""}
              onValueChange={(value) => patch({ description: value })}
              rows={2}
              maxLength={2000}
              placeholder="Quién eres, de dónde vienes, qué buscas…"
            />
          </Field>
          <div className="sm:col-span-2">
            <ImageField
              value={draft.portrait}
              onChange={(value) => patch({ portrait: value })}
              label="Retrato"
              hint="Sube un archivo local o pega una URL. Se ve en tu ficha y en la party."
              shape="portrait"
            />
          </div>
        </div>
      </section>

      <section className="panel p-4">
        <div className="mb-1 flex items-baseline justify-between gap-2 border-b-2 border-ink pb-2">
          <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
            02 · Stats base
          </h2>
          <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-faint">
            Vista previa en vivo
          </span>
        </div>
        <p className="mb-4 mt-2 text-[11px] text-ink-faint">
          Valor sin equipo ni efectos. El total derivado aparece justo debajo y se
          actualiza al instante.
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
        <div className="mt-4 border-t-2 border-ink/15 pt-4">
          <StatPanel derived={derived} rules={campaign.rules} />
        </div>
      </section>

      <section className="panel p-4">
        <h2 className="mb-1 border-b-2 border-ink pb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
          03 · Equipo
        </h2>
        <p className="mb-4 mt-2 text-[11px] text-ink-faint">
          Cinco slots. Cada objeto suma sus stats y efectos pasivos al total. Solo
          aparecen los objetos desbloqueados por el DM (y los que ya lleva tu ficha).
        </p>
        <div className="space-y-3">
          {EQUIPMENT_SLOTS.map((slot) => {
            const currentId = draft.equipment[slot];
            const item = currentId ? itemsById.get(currentId) : null;
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
                    value={currentId ?? ""}
                    onValueChange={(value) => patchEquipment(slot, value || null)}
                  >
                    <option value="">— Vacío —</option>
                    {selectableItems
                      .filter((entry) => entry.slot === slot || entry.id === currentId)
                      .map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.name}
                          {entry.slot !== slot ? " (slot distinto)" : ""}
                        </option>
                      ))}
                  </Select>
                </div>
                {item ? (
                  <p className="mt-2 border-t border-ink/15 pt-2 text-[11px] text-ink-soft">
                    <span className="font-semibold text-ink">{item.name}</span>
                    {item.description ? ` · ${item.description}` : ""}
                  </p>
                ) : null}
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
          Tres slots de skill. Dominio y hábitat son habilidades especiales de tu
          ficha. Solo se ofrecen las skills desbloqueadas por el DM (y las que ya
          lleves).
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((index) => {
            const skillId = draft.skills[index] ?? null;
            const skill = skillId ? skillsById.get(skillId) : null;
            return (
              <Field
                key={index}
                label={`Skill ${index + 1}`}
                hint={skill ? `${skill.coins} monedas` : undefined}
              >
                <Select
                  value={skillId ?? ""}
                  onValueChange={(value) => patchSkill(index, value || null)}
                >
                  <option value="">— Vacío —</option>
                  {selectableSkills.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name} ({option.coins} monedas)
                    </option>
                  ))}
                </Select>
              </Field>
            );
          })}
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
          05 · Inventario
        </h2>
        <p className="mb-4 mt-2 text-[11px] text-ink-faint">
          Objetos que llevas contigo, además del equipo puesto.
        </p>
        <div className="space-y-2">
          {selectableItems.length === 0 ? (
            <p className="text-xs text-ink-soft">
              La campaña todavía no tiene objetos desbloqueados.
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
                    {selectableItems.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name} ({EQUIPMENT_SLOT_LABELS[option.slot]})
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
      </section>

      <div className="flex flex-wrap justify-end gap-2 border-t-2 border-ink/15 pt-4">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCancel}
          disabled={saving}
        >
          Cancelar
        </Button>
        <Button
          type="button"
          variant="accent"
          size="sm"
          icon="save"
          loading={saving}
          onClick={() => void handleSave()}
        >
          Guardar ficha
        </Button>
      </div>
    </div>
  );
}

const FIELD_LABELS: Record<string, string> = {
  name: "Nombre",
  portrait: "Retrato",
  description: "Descripción",
  baseStats: "Stats base",
  equipment: "Equipo",
  skills: "Skills",
  special: "Dominio / hábitat",
  inventory: "Inventario",
  tags: "Tags",
};
