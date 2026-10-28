import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  EFFECT_TRIGGER_LABELS,
  EFFECT_TRIGGERS,
  STACK_MODE_LABELS,
  effectInputSchema,
  type EffectAction,
  type EffectDefinition,
  type EffectTrigger,
  type EffectTriggerSpec,
} from "@protocol-life/shared";
import { useAppStore } from "../store/useAppStore";
import { EffectActionEditor, defaultAction } from "../components/EffectActionEditor";
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
  Toggle,
  cx,
} from "../components/ui";
import { normalizedCode } from "../lib/format";

interface EffectDraft {
  name: string;
  code: string;
  description: string;
  icon: string | undefined;
  maxStacks: number | undefined;
  stackMode: "add" | "refresh" | "replace";
  durationType: "turns" | "permanent";
  durationDefault: number;
  triggers: EffectTriggerSpec[];
  tags: string;
}

function emptyDraft(): EffectDraft {
  return {
    name: "",
    code: "",
    description: "",
    icon: undefined,
    maxStacks: 3,
    stackMode: "add",
    durationType: "turns",
    durationDefault: 3,
    triggers: [
      {
        when: "roundEnd",
        actions: [{ type: "damage", base: 0, perStack: 2, damageType: "mystic" }],
      },
    ],
    tags: "",
  };
}

function draftFromEffect(effect: EffectDefinition): EffectDraft {
  return {
    name: effect.name,
    code: effect.code ?? "",
    description: effect.description ?? "",
    icon: effect.icon,
    maxStacks: effect.maxStacks,
    stackMode: effect.stackMode ?? "add",
    durationType: effect.duration?.type === "permanent" ? "permanent" : "turns",
    durationDefault:
      effect.duration?.type === "turns" ? effect.duration.default : 3,
    triggers: structuredClone(effect.triggers),
    tags: (effect.tags ?? []).join(", "),
  };
}

export function EffectEditorPage() {
  const { effectId } = useParams();
  const campaign = useAppStore((state) => state.campaign);
  const saveContent = useAppStore((state) => state.saveContent);
  const removeContent = useAppStore((state) => state.removeContent);
  const busy = useAppStore((state) => state.busy);
  const navigate = useNavigate();

  const existing = useMemo(
    () =>
      effectId && campaign
        ? campaign.content.effects.find((effect) => effect.id === effectId)
        : undefined,
    [effectId, campaign],
  );

  const [draft, setDraft] = useState<EffectDraft>(() =>
    existing ? draftFromEffect(existing) : emptyDraft(),
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [addTrigger, setAddTrigger] = useState<EffectTrigger>("roundStart");

  useEffect(() => {
    if (!campaign) return;
    setDraft(existing ? draftFromEffect(existing) : emptyDraft());
    setErrors([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectId, campaign?.id]);

  if (!campaign) return null;

  if (effectId && !existing) {
    return (
      <div className="animate-rise">
        <PageHeader eyebrow="Efectos" title="Efecto no encontrado" back={{ to: "/effects", label: "Volver a efectos" }} />
        <div className="panel p-8 text-center">
          <p className="text-sm text-ui-muted">Ese efecto no existe en esta campaña.</p>
          <div className="mt-4">
            <LinkButton to="/effects" size="sm">Volver</LinkButton>
          </div>
        </div>
      </div>
    );
  }

  const availableEffects = campaign.content.effects;

  function patch(update: Partial<EffectDraft>) {
    setDraft((current) => ({ ...current, ...update }));
  }

  function patchTrigger(index: number, update: Partial<EffectTriggerSpec>) {
    setDraft((current) => ({
      ...current,
      triggers: current.triggers.map((trigger, triggerIndex) =>
        triggerIndex === index ? { ...trigger, ...update } : trigger,
      ),
    }));
  }

  function setActions(index: number, actions: EffectAction[]) {
    patchTrigger(index, { actions });
  }

  function addTriggerSpec() {
    setDraft((current) => ({
      ...current,
      triggers: [
        ...current.triggers,
        { when: addTrigger, actions: [defaultAction("damage", availableEffects)] },
      ],
    }));
  }

  function buildPayload() {
    return {
      name: draft.name.trim(),
      code: draft.code.trim() || undefined,
      description: draft.description.trim() || undefined,
      icon: draft.icon,
      maxStacks: draft.maxStacks,
      stackMode: draft.stackMode,
      duration:
        draft.durationType === "permanent"
          ? { type: "permanent" as const }
          : { type: "turns" as const, default: draft.durationDefault },
      triggers: draft.triggers,
      tags: draft.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    };
  }

  async function handleSave() {
    const parsed = effectInputSchema.safeParse(buildPayload());
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((issue) => issue.message));
      return;
    }
    setErrors([]);
    try {
      const saved = await saveContent("effects", parsed.data, effectId);
      if (!effectId) navigate(`/effects/${saved.id}`, { replace: true });
    } catch {
      // store notifica
    }
  }

  async function handleDelete() {
    if (!effectId) return;
    try {
      await removeContent("effects", effectId);
      setConfirmDelete(false);
      navigate("/effects");
    } catch {
      setConfirmDelete(false);
    }
  }

  return (
    <div className="animate-rise">
      <PageHeader
        eyebrow={effectId ? "Editar efecto" : "Nuevo efecto"}
        title={effectId ? draft.name || "Efecto" : "Nuevo efecto"}
        description="Un efecto es un conjunto de triggers con acciones. En Fase 1 define los stats pasivos; el combate los ejecutará en Fase 3."
        back={{ to: "/effects", label: "Volver a efectos" }}
        actions={
          <>
            {effectId ? (
              <Button variant="ghost" size="sm" icon="trash" onClick={() => setConfirmDelete(true)}>
                Eliminar
              </Button>
            ) : null}
            <Button variant="accent" size="sm" icon="save" loading={busy} onClick={() => void handleSave()}>
              Guardar efecto
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
                  placeholder="Burn"
                  maxLength={80}
                />
              </Field>
              <Field label="Código visible">
                <TextInput
                  value={draft.code}
                  onValueChange={(value) => patch({ code: value })}
                  placeholder="BURN"
                  maxLength={40}
                />
              </Field>
              <Field label="Tags" hint="Separados por comas.">
                <TextInput
                  value={draft.tags}
                  onValueChange={(value) => patch({ tags: value })}
                  placeholder="dot, fuego"
                />
              </Field>
              <Field label="Descripción" className="sm:col-span-2">
                <TextArea
                  value={draft.description}
                  onValueChange={(value) => patch({ description: value })}
                  rows={3}
                  maxLength={2000}
                  placeholder="Qué le pasa a la unidad mientras dura…"
                />
              </Field>
            </div>
          </section>

          <section className="panel p-4">
            <h2 className="mb-4 border-b border-ui-line pb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
              02 · Icono
            </h2>
            <ImageField
              value={draft.icon}
              onChange={(value) => patch({ icon: value })}
              label="Icono del efecto"
              hint="Opcional. Se muestra en la ficha y en las tarjetas."
            />
          </section>

          <section className="panel p-4">
            <h2 className="mb-4 border-b border-ui-line pb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
              03 · Acumulación y duración
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Máximo de stacks" hint="Déjalo vacío para no poner tope.">
                <NumberInput
                  value={draft.maxStacks}
                  onValueChange={(value) => patch({ maxStacks: value })}
                  min={1}
                  max={99}
                />
              </Field>
              <Field label="Modo de stack">
                <Select
                  value={draft.stackMode}
                  onValueChange={(value) =>
                    patch({ stackMode: value as EffectDraft["stackMode"] })
                  }
                >
                  {Object.entries(STACK_MODE_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="sm:col-span-2">
                <Toggle
                  checked={draft.durationType === "permanent"}
                  onCheckedChange={(checked) =>
                    patch({ durationType: checked ? "permanent" : "turns" })
                  }
                  label="Efecto permanente"
                  hint="Si está desactivado, dura un número de turnos y se descuenta al final de cada ronda."
                />
              </div>
              {draft.durationType === "turns" ? (
                <Field label="Turnos por defecto" hint="Duración inicial al aplicarse.">
                  <NumberInput
                    value={draft.durationDefault}
                    onValueChange={(value) => patch({ durationDefault: value ?? 1 })}
                    min={1}
                    max={99}
                  />
                </Field>
              ) : null}
            </div>
          </section>

          <section className="panel p-4">
            <h2 className="mb-1 border-b border-ui-line pb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
              04 · Triggers
            </h2>
            <p className="mb-4 mt-2 text-[11px] text-ui-faint">
              Cada trigger escucha un momento del combate y ejecuta sus acciones. Para la
              ficha, los <code className="font-mono">modifyStat</code> se aplican como
              pasivos mientras el efecto está activo.
            </p>

            <div className="space-y-3">
              {draft.triggers.map((trigger, index) => (
                <div key={index} className="border border-ui-line bg-ui-surface-2">
                  <div className="flex flex-wrap items-center gap-2 border-b border-ui-line bg-ui-surface-3 p-2">
                    <span className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-ui-faint">
                      Trigger {String(index + 1).padStart(2, "0")}
                    </span>
                    <div className="min-w-[160px] flex-1">
                      <Select
                        value={trigger.when}
                        onValueChange={(value) =>
                          patchTrigger(index, { when: value as EffectTrigger })
                        }
                        className="px-0 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.1em]"
                      >
                        {EFFECT_TRIGGERS.map((value) => (
                          <option key={value} value={value}>
                            {EFFECT_TRIGGER_LABELS[value]}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        patch({
                          triggers: draft.triggers.filter((_, triggerIndex) => triggerIndex !== index),
                        })
                      }
                      className="flex h-7 w-7 items-center justify-center text-ui-faint transition-colors hover:bg-rust/10 hover:text-rust"
                      aria-label="Quitar trigger"
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                  <div className="p-3">
                    <EffectActionEditor
                      actions={trigger.actions}
                      onChange={(actions) => setActions(index, actions)}
                      effects={campaign.content.effects.filter(
                        (effect) => effect.id !== effectId,
                      )}
                      compact
                    />
                  </div>
                </div>
              ))}
            </div>

            {draft.triggers.length === 0 ? (
              <p className="border border-dashed border-ui-line p-3 text-xs text-ui-muted">
                Este efecto no tiene triggers. Puede servir solo como icono, pero no hará
                nada en combate.
              </p>
            ) : null}

            <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-dashed border-ui-line pt-3">
              <Field label="Nuevo trigger" className="min-w-[180px] flex-1">
                <Select
                  value={addTrigger}
                  onValueChange={(value) => setAddTrigger(value as EffectTrigger)}
                >
                  {EFFECT_TRIGGERS.map((value) => (
                    <option key={value} value={value}>
                      {EFFECT_TRIGGER_LABELS[value]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button type="button" variant="ghost" size="sm" icon="plus" onClick={addTriggerSpec}>
                Añadir trigger
              </Button>
            </div>
          </section>
        </div>

        <aside className="space-y-4">
          <div className="sticky top-6 space-y-4">
            <div className="panel p-4">
              <div className="mb-3 border-b border-ui-line pb-2 font-mono text-[10px] font-bold uppercase tracking-[0.18em]">
                Vista previa
              </div>
              <div className="flex items-center gap-3">
                <div className="flex h-16 w-14 items-center justify-center border border-ui-line-strong bg-amber/30 hexagon">
                  {draft.icon ? (
                    <img src={draft.icon} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <Icon name="flame" size={24} />
                  )}
                </div>
                <div className="min-w-0">
                  <h3 className="display truncate text-xl">{draft.name || "Sin nombre"}</h3>
                  <span className="font-mono text-[9px] text-ui-faint">
                    {draft.code || "SIN-CÓDIGO"}
                  </span>
                </div>
              </div>
              <p className="mt-3 text-[11px] leading-snug text-ui-muted">
                {draft.description || "Sin descripción."}
              </p>
              <div className="mt-3 flex flex-wrap gap-1">
                <span className="chip">
                  {draft.durationType === "permanent"
                    ? "permanente"
                    : `${draft.durationDefault} turnos`}
                </span>
                {draft.maxStacks ? (
                  <span className="chip">máx. {draft.maxStacks} stacks</span>
                ) : (
                  <span className="chip">sin tope</span>
                )}
                <span className="chip chip-accent">{STACK_MODE_LABELS[draft.stackMode]}</span>
              </div>
              <div className="mt-3 border-t border-ui-line pt-2">
                <div className="mono-label mb-1">Triggers</div>
                {draft.triggers.length === 0 ? (
                  <p className="text-[11px] text-ui-faint">Ninguno.</p>
                ) : (
                  <ul className="space-y-1 text-[11px]">
                    {draft.triggers.map((trigger, index) => (
                      <li key={index} className="flex items-center justify-between gap-2">
                        <span>{EFFECT_TRIGGER_LABELS[trigger.when]}</span>
                        <span className="font-mono text-[9px] text-ui-faint">
                          {trigger.actions.length} acc.
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div
              className={cx(
                "border border-ui-line p-3",
                draft.triggers.length === 0 && "opacity-70",
              )}
            >
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
                Orden de resolución
              </strong>
              <p className="mt-1">
                En combate, los efectos se disparan por trigger y en orden de SPD. Para la
                ficha, los modificadores de stat se suman como pasivos.
              </p>
            </div>
          </div>
        </aside>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Eliminar efecto"
        message={
          <>
            Vas a eliminar <strong>«{draft.name}»</strong>. Si un objeto, skill u otro
            efecto lo referencia, el servidor rechazará el borrado.
          </>
        }
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void handleDelete()}
        busy={busy}
      />
    </div>
  );
}
