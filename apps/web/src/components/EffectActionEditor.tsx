import { useState } from "react";
import {
  DAMAGE_TYPE_LABELS,
  STAT_KEYS,
  STAT_LABELS,
  type EffectAction,
  type EffectDefinition,
  type StatKey,
} from "@protocol-life/shared";
import { Icon } from "./Icons";
import { Button, Field, NumberInput, Select } from "./ui";

const ACTION_LABELS: Record<EffectAction["type"], string> = {
  damage: "Daño",
  heal: "Curación",
  modifyStat: "Modificar stat",
  applyEffect: "Aplicar efecto",
  consumeStacks: "Consumir stacks",
  addStacks: "Aumentar stacks",
};

const ACTION_HINTS: Record<EffectAction["type"], string> = {
  damage: "Daño fijo + daño por stack; puede ser al portador, al rival o a todos los demás.",
  heal: "Cura HP fijo + cura por stack.",
  modifyStat: "Modifica un stat mientras el efecto esté activo.",
  applyEffect: "Aplica otro efecto al portador o al rival del trigger.",
  consumeStacks: "Resta stacks al efecto actual.",
  addStacks: "Suma stacks al efecto actual, hasta su máximo.",
};

export function defaultAction(type: EffectAction["type"], effects: EffectDefinition[]): EffectAction {
  switch (type) {
    case "damage":
      return {
        type: "damage",
        base: 1,
        perStack: 0,
        damageType: "physical",
        target: "self",
      };
    case "heal":
      return { type: "heal", base: 1, perStack: 0 };
    case "modifyStat":
      return { type: "modifyStat", stat: "atk", mode: "flat", amount: 1, perStack: 0 };
    case "applyEffect":
      return {
        type: "applyEffect",
        effectId: effects[0]?.id ?? "",
        stacks: 1,
        target: "self",
      };
    case "consumeStacks":
      return { type: "consumeStacks", amount: 1 };
    case "addStacks":
      return { type: "addStacks", amount: 1 };
  }
}

export function EffectActionEditor({
  actions,
  onChange,
  effects,
  compact = false,
}: {
  actions: EffectAction[];
  onChange: (actions: EffectAction[]) => void;
  effects: EffectDefinition[];
  compact?: boolean;
}) {
  const [addType, setAddType] = useState<EffectAction["type"]>("damage");

  function update(index: number, patch: Partial<EffectAction>) {
    onChange(
      actions.map((action, actionIndex) =>
        actionIndex === index ? ({ ...action, ...patch } as EffectAction) : action,
      ),
    );
  }

  function changeType(index: number, type: EffectAction["type"]) {
    onChange(
      actions.map((action, actionIndex) =>
        actionIndex === index ? defaultAction(type, effects) : action,
      ),
    );
  }

  return (
    <div className="space-y-2">
      {actions.map((action, index) => (
        <div key={index} className="border border-ui-line bg-ui-surface-2">
          <div className="flex items-center gap-2 border-b border-ui-line bg-ui-surface-3 px-2 py-1.5">
            <span className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-ui-faint">
              {String(index + 1).padStart(2, "0")}
            </span>
            <div className="min-w-0 flex-1">
              <Select
                value={action.type}
                onValueChange={(value) => changeType(index, value as EffectAction["type"])}
                className="px-0 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.12em]"
              >
                {Object.entries(ACTION_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
            <button
              type="button"
              onClick={() => onChange(actions.filter((_, actionIndex) => actionIndex !== index))}
              className="flex h-6 w-6 items-center justify-center text-ui-faint transition-colors hover:bg-rust/10 hover:text-rust"
              aria-label="Quitar acción"
            >
              <Icon name="trash" size={13} />
            </button>
          </div>

          <div className="p-2">
            {action.type === "damage" ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Field label="Base">
                  <NumberInput
                    value={action.base ?? 0}
                    onValueChange={(value) => update(index, { base: value ?? 0 })}
                    min={-9999}
                    max={9999}
                  />
                </Field>
                <Field label="Por stack">
                  <NumberInput
                    value={action.perStack ?? 0}
                    onValueChange={(value) => update(index, { perStack: value ?? 0 })}
                    min={-9999}
                    max={9999}
                  />
                </Field>
                <Field label="Tipo">
                  <Select
                    value={action.damageType ?? "physical"}
                    onValueChange={(value) =>
                      update(index, { damageType: value as "physical" | "mystic" | "pure" })
                    }
                  >
                    {Object.entries(DAMAGE_TYPE_LABELS).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label="Objetivo"
                  hint="Todos los demás incluye aliados y enemigos."
                >
                  <Select
                    value={action.target ?? "self"}
                    onValueChange={(value) =>
                      update(index, {
                        target: value as
                          | "self"
                          | "opponent"
                          | "allOthers",
                      })
                    }
                  >
                    <option value="self">Portador</option>
                    <option value="opponent">Rival</option>
                    <option value="allOthers">Todos los demás</option>
                  </Select>
                </Field>
              </div>
            ) : null}

            {action.type === "heal" ? (
              <div className="grid grid-cols-2 gap-2">
                <Field label="Base">
                  <NumberInput
                    value={action.base ?? 0}
                    onValueChange={(value) => update(index, { base: value ?? 0 })}
                    min={-9999}
                    max={9999}
                  />
                </Field>
                <Field label="Por stack">
                  <NumberInput
                    value={action.perStack ?? 0}
                    onValueChange={(value) => update(index, { perStack: value ?? 0 })}
                    min={-9999}
                    max={9999}
                  />
                </Field>
              </div>
            ) : null}

            {action.type === "modifyStat" ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Field label="Stat">
                  <Select
                    value={action.stat}
                    onValueChange={(value) => update(index, { stat: value as StatKey })}
                  >
                    {STAT_KEYS.map((key) => (
                      <option key={key} value={key}>
                        {STAT_LABELS[key]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Modo">
                  <Select
                    value={action.mode}
                    onValueChange={(value) => update(index, { mode: value as "flat" | "percent" })}
                  >
                    <option value="flat">Plano</option>
                    <option value="percent">Porcentaje</option>
                  </Select>
                </Field>
                <Field label="Cantidad">
                  <NumberInput
                    value={action.amount}
                    onValueChange={(value) => update(index, { amount: value ?? 0 })}
                    min={-9999}
                    max={9999}
                  />
                </Field>
                <Field label="Por stack">
                  <NumberInput
                    value={action.perStack ?? 0}
                    onValueChange={(value) => update(index, { perStack: value ?? 0 })}
                    min={-9999}
                    max={9999}
                  />
                </Field>
              </div>
            ) : null}

            {action.type === "applyEffect" ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Field
                  label="Efecto"
                  hint={effects.length === 0 ? "Crea primero algún efecto." : undefined}
                >
                  <Select
                    value={action.effectId}
                    onValueChange={(value) => update(index, { effectId: value })}
                    disabled={effects.length === 0}
                  >
                    {effects.length === 0 ? <option value="">Sin efectos</option> : null}
                    {effects.map((effect) => (
                      <option key={effect.id} value={effect.id}>
                        {effect.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Stacks">
                  <NumberInput
                    value={action.stacks ?? 1}
                    onValueChange={(value) => update(index, { stacks: value ?? 1 })}
                    min={1}
                    max={99}
                  />
                </Field>
                <Field
                  label="Objetivo"
                  hint="Rival solo funciona en triggers con un rival."
                >
                  <Select
                    value={action.target ?? "self"}
                    onValueChange={(value) =>
                      update(index, {
                        target: value as "self" | "opponent",
                      })
                    }
                  >
                    <option value="self">Portador</option>
                    <option value="opponent">Rival</option>
                  </Select>
                </Field>
              </div>
            ) : null}

            {action.type === "consumeStacks" || action.type === "addStacks" ? (
              <div className="grid grid-cols-2 gap-2">
                <Field label="Cantidad">
                  <NumberInput
                    value={action.amount}
                    onValueChange={(value) => update(index, { amount: value ?? 1 })}
                    min={1}
                    max={99}
                  />
                </Field>
              </div>
            ) : null}

            {!compact ? (
              <p className="mt-1.5 font-mono text-[9px] leading-snug text-ui-faint">
                {ACTION_HINTS[action.type]}
              </p>
            ) : null}
          </div>
        </div>
      ))}

      <div className="flex flex-wrap items-end gap-2 border-t border-dashed border-ui-line pt-2">
        <Field label="Añadir acción" className="min-w-[150px] flex-1">
          <Select value={addType} onValueChange={(value) => setAddType(value as EffectAction["type"])}>
            {Object.entries(ACTION_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          icon="plus"
          onClick={() => onChange([...actions, defaultAction(addType, effects)])}
        >
          Añadir
        </Button>
      </div>
    </div>
  );
}
