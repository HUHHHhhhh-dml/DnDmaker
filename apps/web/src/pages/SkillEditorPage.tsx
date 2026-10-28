import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  skillInputSchema,
  type Skill,
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
  TextArea,
  TextInput,
  Toggle,
  cx,
} from "../components/ui";
import { CoinRow } from "../components/cards";
import { normalizedCode, signed } from "../lib/format";

interface SkillDraft {
  name: string;
  code: string;
  description: string;
  image: string | undefined;
  coins: number;
  baseClash: number;
  coinClash: number;
  baseDamage: number;
  coinDamage: number;
  fullHeadsMultiplier: number | undefined;
  unlocked: boolean;
  effects: { effectId: string; chance: number; stacks: number }[];
  tags: string;
}

function emptyDraft(): SkillDraft {
  return {
    name: "",
    code: "",
    description: "",
    image: undefined,
    coins: 2,
    baseClash: 5,
    coinClash: 5,
    baseDamage: 10,
    coinDamage: 5,
    fullHeadsMultiplier: 2,
    unlocked: false,
    effects: [],
    tags: "",
  };
}

function draftFromSkill(skill: Skill): SkillDraft {
  return {
    name: skill.name,
    code: skill.code ?? "",
    description: skill.description ?? "",
    image: skill.image,
    coins: skill.coins,
    baseClash: skill.baseClash,
    coinClash: skill.coinClash,
    baseDamage: skill.baseDamage,
    coinDamage: skill.coinDamage,
    fullHeadsMultiplier: skill.fullHeadsMultiplier,
    unlocked: skill.unlocked === true,
    effects: (skill.effects ?? []).map((ref) => ({
      effectId: ref.effectId,
      chance: ref.chance ?? 1,
      stacks: ref.stacks ?? 1,
    })),
    tags: (skill.tags ?? []).join(", "),
  };
}

export function SkillEditorPage() {
  const { skillId } = useParams();
  const campaign = useAppStore((state) => state.campaign);
  const saveContent = useAppStore((state) => state.saveContent);
  const removeContent = useAppStore((state) => state.removeContent);
  const busy = useAppStore((state) => state.busy);
  const navigate = useNavigate();

  const existing = useMemo(
    () =>
      skillId && campaign
        ? campaign.content.skills.find((skill) => skill.id === skillId)
        : undefined,
    [skillId, campaign],
  );

  const [draft, setDraft] = useState<SkillDraft>(() =>
    existing ? draftFromSkill(existing) : emptyDraft(),
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!campaign) return;
    setDraft(existing ? draftFromSkill(existing) : emptyDraft());
    setErrors([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skillId, campaign?.id]);

  if (!campaign) return null;

  if (skillId && !existing) {
    return (
      <div className="animate-rise">
        <PageHeader eyebrow="Skills" title="Skill no encontrada" back={{ to: "/skills", label: "Volver a skills" }} />
        <div className="panel p-8 text-center">
          <p className="text-sm text-ui-muted">Esa skill no existe en esta campaña.</p>
          <div className="mt-4">
            <LinkButton to="/skills" size="sm">Volver</LinkButton>
          </div>
        </div>
      </div>
    );
  }

  function patch(update: Partial<SkillDraft>) {
    setDraft((current) => ({ ...current, ...update }));
  }

  function toggleEffect(effectId: string) {
    setDraft((current) => {
      const exists = current.effects.some((ref) => ref.effectId === effectId);
      return {
        ...current,
        effects: exists
          ? current.effects.filter((ref) => ref.effectId !== effectId)
          : [...current.effects, { effectId, chance: 1, stacks: 1 }],
      };
    });
  }

  function updateEffectRef(
    effectId: string,
    update: Partial<{ chance: number; stacks: number }>,
  ) {
    setDraft((current) => ({
      ...current,
      effects: current.effects.map((ref) =>
        ref.effectId === effectId ? { ...ref, ...update } : ref,
      ),
    }));
  }

  function buildPayload() {
    return {
      name: draft.name.trim(),
      code: draft.code.trim() || undefined,
      description: draft.description.trim() || undefined,
      image: draft.image,
      coins: draft.coins,
      baseClash: draft.baseClash,
      coinClash: draft.coinClash,
      baseDamage: draft.baseDamage,
      coinDamage: draft.coinDamage,
      fullHeadsMultiplier: draft.fullHeadsMultiplier,
      unlocked: draft.unlocked,
      target: "single" as const,
      effects: draft.effects.length > 0 ? draft.effects : undefined,
      tags: draft.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    };
  }

  async function handleSave() {
    const parsed = skillInputSchema.safeParse(buildPayload());
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((issue) => issue.message));
      return;
    }
    setErrors([]);
    try {
      const saved = await saveContent("skills", parsed.data, skillId);
      if (!skillId) navigate(`/skills/${saved.id}`, { replace: true });
    } catch {
      // store notifica
    }
  }

  async function handleDelete() {
    if (!skillId) return;
    try {
      await removeContent("skills", skillId);
      setConfirmDelete(false);
      navigate("/skills");
    } catch {
      setConfirmDelete(false);
    }
  }

  const multiplier = draft.fullHeadsMultiplier ?? 2;
  const maxClash = draft.baseClash + draft.coins * draft.coinClash;
  const maxDamage = draft.baseDamage + draft.coins * draft.coinDamage;
  const fullHeadsDamage = Math.round(maxDamage * multiplier);

  return (
    <div className="animate-rise">
      <PageHeader
        eyebrow={skillId ? "Editar skill" : "Nueva skill"}
        title={skillId ? draft.name || "Skill" : "Nueva skill"}
        description="Monedas, poder de clash y daño. El ATK del personaje se suma al daño final en combate."
        back={{ to: "/skills", label: "Volver a skills" }}
        actions={
          <>
            {skillId ? (
              <Button variant="ghost" size="sm" icon="trash" onClick={() => setConfirmDelete(true)}>
                Eliminar
              </Button>
            ) : null}
            <Button variant="accent" size="sm" icon="save" loading={busy} onClick={() => void handleSave()}>
              Guardar skill
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
                  placeholder="ODACHI"
                  maxLength={80}
                />
              </Field>
              <Field label="Código visible">
                <TextInput
                  value={draft.code}
                  onValueChange={(value) => patch({ code: value })}
                  placeholder="BETI-928"
                  maxLength={40}
                />
              </Field>
              <Field label="Tags" hint="Separados por comas.">
                <TextInput
                  value={draft.tags}
                  onValueChange={(value) => patch({ tags: value })}
                  placeholder="corte, arma"
                />
              </Field>
              <Field label="Descripción" className="sm:col-span-2">
                <TextArea
                  value={draft.description}
                  onValueChange={(value) => patch({ description: value })}
                  rows={3}
                  maxLength={2000}
                  placeholder="Cómo se siente usar esta skill…"
                />
              </Field>
              <div className="sm:col-span-2 border border-ui-line bg-ui-surface-2 p-3">
                <Toggle
                  checked={draft.unlocked}
                  onCheckedChange={(value) => patch({ unlocked: value })}
                  label="Visible para jugadores"
                  hint="Apagada = solo el DM la ve en la biblioteca. Si un personaje ya la lleva equipada, su ficha la conserva."
                />
              </div>
            </div>
          </section>

          <section className="panel p-4">
            <h2 className="mb-4 border-b border-ui-line pb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
              02 · Imagen
            </h2>
            <ImageField value={draft.image} onChange={(value) => patch({ image: value })} />
          </section>

          <section className="panel p-4">
            <h2 className="mb-4 border-b border-ui-line pb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
              03 · Monedas y poder
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Monedas" hint="De 1 a 20. Cada moneda tira cara/cruz.">
                <NumberInput
                  value={draft.coins}
                  onValueChange={(value) => patch({ coins: value ?? 1 })}
                  min={1}
                  max={20}
                />
              </Field>
              <Field label="Multiplicador full heads" hint="Default 2. Usa 1 para desactivarlo.">
                <NumberInput
                  value={draft.fullHeadsMultiplier}
                  onValueChange={(value) => patch({ fullHeadsMultiplier: value })}
                  min={1}
                  max={10}
                  step={0.5}
                />
              </Field>
              <Field label="Clash base" hint="Poder de clash inicial.">
                <NumberInput
                  value={draft.baseClash}
                  onValueChange={(value) => patch({ baseClash: value ?? 0 })}
                  min={-9999}
                  max={9999}
                />
              </Field>
              <Field label="Clash por cara" hint="Suma por moneda que sale cara.">
                <NumberInput
                  value={draft.coinClash}
                  onValueChange={(value) => patch({ coinClash: value ?? 0 })}
                  min={-9999}
                  max={9999}
                />
              </Field>
              <Field label="Daño base" hint="Antes de sumar ATK.">
                <NumberInput
                  value={draft.baseDamage}
                  onValueChange={(value) => patch({ baseDamage: value ?? 0 })}
                  min={-9999}
                  max={9999}
                />
              </Field>
              <Field label="Daño por cara" hint="Puede ser negativo (skill de riesgo).">
                <NumberInput
                  value={draft.coinDamage}
                  onValueChange={(value) => patch({ coinDamage: value ?? 0 })}
                  min={-9999}
                  max={9999}
                />
              </Field>
            </div>
            <div className="mt-4 border-t border-ui-line pt-3">
              <div className="mono-label mb-1.5">Monedas</div>
              <CoinRow coins={draft.coins} />
            </div>
          </section>

          <section className="panel p-4">
            <h2 className="mb-1 border-b border-ui-line pb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
              04 · Efectos al impactar
            </h2>
            <p className="mb-3 mt-2 text-[11px] text-ui-faint">
              Se aplican si la skill impacta. La probabilidad es 0–100%.
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
                  const ref = draft.effects.find((entry) => entry.effectId === effect.id);
                  return (
                    <div
                      key={effect.id}
                      className={cx(
                        "border px-3 py-2",
                        ref ? "border-ui-line-strong bg-amber/10" : "border-ui-line bg-ui-surface-2",
                      )}
                    >
                      <div className="flex flex-wrap items-center gap-3">
                        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5">
                          <input
                            type="checkbox"
                            checked={Boolean(ref)}
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
                        {ref ? (
                          <div className="flex items-center gap-2">
                            <label className="flex items-center gap-1">
                              <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-ui-faint">
                                Prob.
                              </span>
                              <NumberInput
                                value={Math.round(ref.chance * 100)}
                                onValueChange={(value) =>
                                  updateEffectRef(effect.id, {
                                    chance: Math.max(0, Math.min(100, value ?? 0)) / 100,
                                  })
                                }
                                min={0}
                                max={100}
                                className="w-16 px-1 py-0.5 text-center text-xs"
                              />
                              <span className="font-mono text-[9px]">%</span>
                            </label>
                            <label className="flex items-center gap-1">
                              <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-ui-faint">
                                Stacks
                              </span>
                              <NumberInput
                                value={ref.stacks}
                                onValueChange={(value) =>
                                  updateEffectRef(effect.id, { stacks: value ?? 1 })
                                }
                                min={1}
                                max={99}
                                className="w-14 px-1 py-0.5 text-center text-xs"
                              />
                            </label>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-4">
          <div className="sticky top-6 space-y-4">
            <div className="panel p-4">
              <div className="mb-3 border-b border-ui-line pb-2 font-mono text-[10px] font-bold uppercase tracking-[0.18em]">
                Vista previa
              </div>
              {draft.image ? (
                <img
                  src={draft.image}
                  alt=""
                  className="mb-3 aspect-video w-full border border-ui-line-strong object-cover"
                />
              ) : null}
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="display text-xl">{draft.name || "Sin nombre"}</h3>
                <span className="font-mono text-[9px] text-ui-faint">
                  {draft.code || "SIN-CÓDIGO"}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1">
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
                <CoinRow coins={draft.coins} />
              </div>
              <div className="mt-3 space-y-1.5 font-mono text-[10px]">
                <div className="flex justify-between">
                  <span className="text-ui-faint">Clash máx.</span>
                  <span className="font-bold">{maxClash}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ui-faint">Daño máx. (sin ATK)</span>
                  <span className="font-bold">{maxDamage}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ui-faint">Full heads (×{multiplier})</span>
                  <span className="font-bold text-ui-danger">{fullHeadsDamage}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ui-faint">Daño por cara</span>
                  <span className="font-bold">{signed(draft.coinDamage)}</span>
                </div>
              </div>
              <div className="mt-3 border-t border-ui-line pt-2 text-[10px] leading-relaxed text-ui-faint">
                El daño final en combate añade el ATK del personaje y aplica la mitigación
                de DEF del objetivo.
              </div>
            </div>

            <div className="panel p-4">
              <div className="mono-label mb-2">Efectos elegidos</div>
              {draft.effects.length === 0 ? (
                <p className="text-[11px] text-ui-faint">Ninguno.</p>
              ) : (
                <div className="space-y-1.5">
                  {draft.effects.map((ref) => {
                    const effect = campaign.content.effects.find(
                      (entry) => entry.id === ref.effectId,
                    );
                    if (!effect) return null;
                    return (
                      <div key={ref.effectId} className="flex items-center justify-between gap-2 text-xs">
                        <span className="flex items-center gap-1.5">
                          <Icon name="flame" size={11} className="text-ui-danger" />
                          {effect.name}
                        </span>
                        <span className="font-mono text-[9px] text-ui-faint">
                          {Math.round(ref.chance * 100)}% · {ref.stacks} stacks
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
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
          </div>
        </aside>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Eliminar skill"
        message={
          <>
            Vas a eliminar <strong>«{draft.name}»</strong>. No puedes borrarla si un
            personaje la tiene equipada o un encuentro la referencia.
          </>
        }
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void handleDelete()}
        busy={busy}
      />
    </div>
  );
}
