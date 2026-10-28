import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  CURRENCY_NAME,
  EQUIPMENT_SLOT_HINTS,
  EQUIPMENT_SLOT_LABELS,
  STAT_HINTS,
  STAT_KEYS,
  STAT_LABELS,
  itemInputSchema,
  type EffectAction,
  type EquipmentSlot,
  type Item,
  type Stats,
} from "@protocol-life/shared";
import { useAppStore } from "../store/useAppStore";
import { EffectActionEditor } from "../components/EffectActionEditor";
import { Icon } from "../components/Icons";
import { ImageField } from "../components/ImageField";
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
import { normalizedCode, statEntries } from "../lib/format";

interface ItemDraft {
  name: string;
  code: string;
  description: string;
  slot: EquipmentSlot;
  rarity: string;
  unlocked: boolean;
  image: string | undefined;
  stats: Partial<Stats>;
  effects: { effectId: string; stacks?: number }[];
  uses: number | undefined;
  useEffect: EffectAction[];
  tags: string;
  price: number | undefined;
}

function emptyDraft(): ItemDraft {
  return {
    name: "",
    code: "",
    description: "",
    slot: "horns",
    rarity: "",
    unlocked: false,
    image: undefined,
    stats: {},
    effects: [],
    uses: undefined,
    useEffect: [],
    tags: "",
    price: undefined,
  };
}

function draftFromItem(item: Item): ItemDraft {
  return {
    name: item.name,
    code: item.code ?? "",
    description: item.description ?? "",
    slot: item.slot,
    rarity: item.rarity ?? "",
    unlocked: item.unlocked === true,
    image: item.image,
    stats: { ...item.stats },
    effects: (item.effects ?? []).map((ref) => ({ ...ref })),
    uses: item.uses,
    useEffect: item.useEffect ? structuredClone(item.useEffect) : [],
    tags: (item.tags ?? []).join(", "),
    price: item.price,
  };
}

export function ItemEditorPage() {
  const { itemId } = useParams();
  const campaign = useAppStore((state) => state.campaign);
  const saveContent = useAppStore((state) => state.saveContent);
  const removeContent = useAppStore((state) => state.removeContent);
  const busy = useAppStore((state) => state.busy);
  const navigate = useNavigate();

  const existing = useMemo(
    () =>
      itemId && campaign
        ? campaign.content.items.find((item) => item.id === itemId)
        : undefined,
    [itemId, campaign],
  );

  const [draft, setDraft] = useState<ItemDraft>(() =>
    existing ? draftFromItem(existing) : emptyDraft(),
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!campaign) return;
    setDraft(existing ? draftFromItem(existing) : emptyDraft());
    setErrors([]);
    // Solo al cambiar de entidad o de campaña; no en cada guardado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, campaign?.id]);

  if (!campaign) return null;

  if (itemId && !existing) {
    return (
      <div className="animate-rise">
        <PageHeader eyebrow="Objetos" title="Objeto no encontrado" back={{ to: "/items", label: "Volver al arsenal" }} />
        <div className="panel p-8 text-center">
          <p className="text-sm text-ui-muted">
            Ese objeto no existe en esta campaña (o se borró en otra pestaña).
          </p>
          <div className="mt-4">
            <LinkButton to="/items" size="sm">Volver a la biblioteca</LinkButton>
          </div>
        </div>
      </div>
    );
  }

  function patch(update: Partial<ItemDraft>) {
    setDraft((current) => ({ ...current, ...update }));
  }

  function patchStats(update: Partial<Stats>) {
    setDraft((current) => ({ ...current, stats: { ...current.stats, ...update } }));
  }

  function buildPayload() {
    const cleanStats = Object.fromEntries(
      Object.entries(draft.stats).filter(([, value]) => typeof value === "number"),
    ) as Partial<Stats>;
    return {
      name: draft.name.trim(),
      code: draft.code.trim() || undefined,
      description: draft.description.trim() || undefined,
      slot: draft.slot,
      rarity: draft.rarity.trim() || undefined,
      unlocked: draft.unlocked,
      image: draft.image,
      stats: Object.keys(cleanStats).length > 0 ? cleanStats : undefined,
      effects: draft.effects.length > 0 ? draft.effects : undefined,
      uses: draft.slot === "utility" ? draft.uses : undefined,
      useEffect:
        draft.slot === "utility" && draft.useEffect.length > 0
          ? draft.useEffect
          : undefined,
      tags: draft.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      price: draft.price,
    };
  }

  async function handleSave() {
    const payload = buildPayload();
    const parsed = itemInputSchema.safeParse(payload);
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((issue) => issue.message));
      return;
    }
    setErrors([]);
    try {
      const saved = await saveContent("items", parsed.data, itemId);
      if (!itemId) {
        navigate(`/items/${saved.id}`, { replace: true });
      }
    } catch {
      // El store muestra el error del servidor.
    }
  }

  async function handleDelete() {
    if (!itemId) return;
    try {
      await removeContent("items", itemId);
      setConfirmDelete(false);
      navigate("/items");
    } catch {
      setConfirmDelete(false);
    }
  }

  const selectedEffectIds = new Set(draft.effects.map((ref) => ref.effectId));

  function toggleEffect(effectId: string) {
    setDraft((current) => {
      const exists = current.effects.some((ref) => ref.effectId === effectId);
      return {
        ...current,
        effects: exists
          ? current.effects.filter((ref) => ref.effectId !== effectId)
          : [...current.effects, { effectId, stacks: 1 }],
      };
    });
  }

  function setEffectStacks(effectId: string, stacks: number | undefined) {
    setDraft((current) => ({
      ...current,
      effects: current.effects.map((ref) =>
        ref.effectId === effectId ? { ...ref, stacks } : ref,
      ),
    }));
  }

  return (
    <div className="animate-rise">
      <PageHeader
        eyebrow={itemId ? "Editar objeto" : "Nuevo objeto"}
        title={itemId ? draft.name || "Objeto" : "Nuevo objeto"}
        description="Stats, slot, imagen y efectos pasivos. El código visible es editable; el ID interno no cambia."
        back={{ to: "/items", label: "Volver al arsenal" }}
        actions={
          <>
            {itemId ? (
              <Button
                variant="ghost"
                size="sm"
                icon="trash"
                onClick={() => setConfirmDelete(true)}
              >
                Eliminar
              </Button>
            ) : null}
            <Button
              variant="accent"
              size="sm"
              icon="save"
              loading={busy}
              onClick={() => void handleSave()}
            >
              Guardar objeto
            </Button>
          </>
        }
      />

      {errors.length > 0 ? (
        <div className="mb-4 border border-rust bg-rust/10 p-3">
          <div className="mb-1 flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-ui-danger">
            <Icon name="alert" size={14} /> Revisa el formulario
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
          <section className="panel p-4">
            <h2 className="mb-4 border-b border-ui-line pb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
              01 · Identidad
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nombre" className="sm:col-span-2">
                <TextInput
                  value={draft.name}
                  onValueChange={(value) => patch({ name: value })}
                  placeholder="CIVIL"
                  maxLength={80}
                />
              </Field>
              <Field label="Código visible" hint="Ej. AASS-164. No es la clave interna.">
                <TextInput
                  value={draft.code}
                  onValueChange={(value) => patch({ code: value })}
                  placeholder="AASS-164"
                  maxLength={40}
                />
              </Field>
              <Field label="Rareza" hint="Texto libre: Common, Rare, Unique…">
                <TextInput
                  value={draft.rarity}
                  onValueChange={(value) => patch({ rarity: value })}
                  placeholder="Common"
                  maxLength={40}
                />
              </Field>
              <Field label="Slot" hint={EQUIPMENT_SLOT_HINTS[draft.slot]}>
                <Select
                  value={draft.slot}
                  onValueChange={(value) => patch({ slot: value as EquipmentSlot })}
                >
                  {Object.entries(EQUIPMENT_SLOT_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Precio" hint={`${CURRENCY_NAME}. Moneda de campaña; las tiendas llegan en Fase 4.`}>
                <NumberInput
                  value={draft.price}
                  onValueChange={(value) => patch({ price: value })}
                  min={0}
                  max={9_999_999}
                />
              </Field>
              <Field label="Descripción" className="sm:col-span-2">
                <TextArea
                  value={draft.description}
                  onValueChange={(value) => patch({ description: value })}
                  rows={3}
                  maxLength={2000}
                  placeholder="Qué es y por qué importa…"
                />
              </Field>
              <Field
                label="Tags"
                hint="Separados por comas. Sirven para filtrar y para sinergias futuras."
                className="sm:col-span-2"
              >
                <TextInput
                  value={draft.tags}
                  onValueChange={(value) => patch({ tags: value })}
                  placeholder="civil, starter"
                />
              </Field>
              <div className="sm:col-span-2 border border-ui-line bg-ui-surface-2 p-3">
                <Toggle
                  checked={draft.unlocked}
                  onCheckedChange={(value) => patch({ unlocked: value })}
                  label="Visible para jugadores"
                  hint="Apagado = solo el DM lo ve en la biblioteca. Si un personaje ya lo lleva equipado, su ficha lo conserva."
                />
              </div>
            </div>
          </section>

          <section className="panel p-4">
            <h2 className="mb-4 border-b border-ui-line pb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
              02 · Imagen
            </h2>
            <ImageField
              value={draft.image}
              onChange={(value) => patch({ image: value })}
              hint="Ideal: PNG 1024×1024 transparente y en el mismo lienzo que el cuerpo base. Se usa en el slot y como capa de combate si la ficha está en modo capas."
            />
          </section>

          <section className="panel p-4">
            <h2 className="mb-1 border-b border-ui-line pb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
              03 · Stats
            </h2>
            <p className="mb-4 mt-2 text-[11px] text-ui-faint">
              Deja un campo vacío para no modificarlo. Los valores se suman a los stats
              base del personaje que equipe el objeto.
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {STAT_KEYS.map((key) => (
                <Field key={key} label={STAT_LABELS[key]} hint={STAT_HINTS[key]}>
                  <NumberInput
                    value={draft.stats[key]}
                    onValueChange={(value) =>
                      patchStats({ [key]: value } as Partial<Stats>)
                    }
                    min={key === "skillSlots" ? -6 : -999}
                    max={key === "skillSlots" ? 6 : 999}
                    placeholder="—"
                  />
                </Field>
              ))}
            </div>
          </section>

          <section className="panel p-4">
            <h2 className="mb-1 border-b border-ui-line pb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
              04 · Efectos pasivos
            </h2>
            <p className="mb-3 mt-2 text-[11px] text-ui-faint">
              Mientras el objeto esté equipado, estos efectos cuentan para los stats
              derivados de la ficha.
            </p>
            {campaign.content.effects.length === 0 ? (
              <p className="border border-dashed border-ui-line p-3 text-xs text-ui-muted">
                No hay efectos en la campaña.{" "}
                <LinkButton to="/effects/new" variant="ghost" size="sm" className="ml-1">
                  Crear uno
                </LinkButton>
              </p>
            ) : (
              <div className="space-y-2">
                {campaign.content.effects.map((effect) => {
                  const selected = selectedEffectIds.has(effect.id);
                  const ref = draft.effects.find((entry) => entry.effectId === effect.id);
                  return (
                    <div
                      key={effect.id}
                      className={cx(
                        "flex flex-wrap items-center gap-3 border px-3 py-2 transition-colors",
                        selected ? "border-ui-line-strong bg-amber/10" : "border-ui-line bg-ui-surface-2",
                      )}
                    >
                      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5">
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleEffect(effect.id)}
                          className="h-4 w-4 accent-rust"
                        />
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold">{effect.name}</span>
                          <span className="block truncate text-[10px] text-ui-faint">
                            {effect.description || "Sin descripción."}
                          </span>
                        </span>
                      </label>
                      {selected ? (
                        <label className="flex items-center gap-2">
                          <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-ui-faint">
                            Stacks
                          </span>
                          <NumberInput
                            value={ref?.stacks ?? 1}
                            onValueChange={(value) => setEffectStacks(effect.id, value)}
                            min={1}
                            max={99}
                            className="w-16 px-1 py-0.5 text-center text-xs"
                          />
                        </label>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {draft.slot === "utility" ? (
            <section className="panel p-4">
              <h2 className="mb-1 border-b border-ui-line pb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
                05 · Utilidad
              </h2>
              <p className="mb-3 mt-2 text-[11px] text-ui-faint">
                Una utilidad consume 1 Skill Slot al usarse y gasta un uso. No hace clash.
              </p>
              <div className="mb-4 max-w-xs">
                <Field label="Usos" hint="Por combate o descanso; 0 la deja inservible.">
                  <NumberInput
                    value={draft.uses}
                    onValueChange={(value) => patch({ uses: value })}
                    min={0}
                    max={99}
                  />
                </Field>
              </div>
              <div className="mono-label mb-2">Efecto al usarse</div>
              <EffectActionEditor
                actions={draft.useEffect}
                onChange={(actions) => patch({ useEffect: actions })}
                effects={campaign.content.effects}
                compact
              />
            </section>
          ) : null}
        </div>

        <aside className="space-y-4">
          <div className="sticky top-6 space-y-4">
            <div className="panel overflow-hidden">
              <div className="border-b border-ui-line bg-ui-surface-3 px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.18em]">
                Vista previa
              </div>
              <div className="relative aspect-[4/3] bg-grid bg-ui-surface-3">
                {draft.image ? (
                  <img src={draft.image} alt="" className="h-full w-full object-contain p-2" />
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <div className="flex h-20 w-20 items-center justify-center border border-ui-line-strong bg-ui-surface-2 pentagon">
                      <span className="font-display text-lg text-ui-faint">
                        {(draft.name || "??").slice(0, 2).toUpperCase()}
                      </span>
                    </div>
                  </div>
                )}
                <span className="absolute left-2 top-2 border border-ui-line-strong bg-ui-surface-2 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em]">
                  {EQUIPMENT_SLOT_LABELS[draft.slot]}
                </span>
              </div>
              <div className="space-y-2 p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="display text-xl">{draft.name || "Sin nombre"}</h3>
                  <span className="font-mono text-[9px] text-ui-faint">
                    {draft.code || "SIN-CÓDIGO"}
                  </span>
                </div>
                <span
                  className={cx(
                    "inline-flex items-center gap-1 border px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.1em]",
                    draft.unlocked
                      ? "border-moss/50 bg-moss/10 text-moss"
                      : "border-rust/50 bg-rust/10 text-ui-danger",
                  )}
                >
                  <Icon name={draft.unlocked ? "unlock" : "lock"} size={10} />
                  {draft.unlocked ? "Visible para jugadores" : "Solo DM"}
                </span>
                <p className="text-[11px] leading-snug text-ui-muted">
                  {draft.description || "Sin descripción."}
                </p>
                <div className="flex flex-wrap gap-1">
                  {statEntries(draft.stats).length === 0 ? (
                    <span className="chip opacity-60">Sin stats</span>
                  ) : (
                    statEntries(draft.stats).map((entry) => (
                      <StatChip key={entry.key} label={entry.label} value={entry.value} />
                    ))
                  )}
                </div>
                <TagList
                  tags={draft.tags
                    .split(",")
                    .map((tag) => tag.trim())
                    .filter(Boolean)}
                />
                {draft.effects.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {draft.effects.map((ref) => {
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
                ) : null}
              </div>
            </div>

            <div className="border border-ui-line p-3">
              <div className="mono-label mb-1">ID interno</div>
              <code className="block break-all font-mono text-[10px] text-ui-muted">
                {existing?.id ?? "Se genera al guardar"}
              </code>
              {existing ? (
                <>
                  <div className="mono-label mt-3 mb-1">Código normalizado</div>
                  <code className="font-mono text-[10px] text-ui-muted">
                    {normalizedCode(existing.code, existing.id)}
                  </code>
                </>
              ) : null}
            </div>

            <div className="border border-dashed border-ui-line p-3 text-[11px] leading-relaxed text-ui-muted">
              <strong className="font-mono text-[9px] uppercase tracking-[0.14em]">
                Recuerda
              </strong>
              <p className="mt-1">
                El objeto no se puede borrar si un personaje lo tiene equipado, en el
                inventario o una tienda lo referencia.
              </p>
            </div>
          </div>
        </aside>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Eliminar objeto"
        message={
          <>
            Vas a eliminar <strong>«{draft.name}»</strong>. Si algún personaje lo usa, el
            servidor rechazará el borrado para no romper la ficha.
          </>
        }
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void handleDelete()}
        busy={busy}
      />
    </div>
  );
}
