import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  specialInputSchema,
  type EffectAction,
  type SceneTheme,
  type SpecialAbility,
  type SpecialKind,
} from "@protocol-life/shared";
import { useAppStore } from "../store/useAppStore";
import { EffectActionEditor } from "../components/EffectActionEditor";
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

interface SpecialDraft {
  name: string;
  code: string;
  description: string;
  image: string | undefined;
  kind: SpecialKind;
  duration: number;
  oncePerCombat: boolean;
  cooldown: number;
  sceneEnabled: boolean;
  sceneFloor: string | undefined;
  sceneWall: string | undefined;
  sceneTheme: SceneTheme;
  allyEffects: EffectAction[];
  enemyEffects: EffectAction[];
  /** La ficha venía del formato antiguo (`effects` + `target`). */
  legacy: boolean;
}

function emptyDraft(): SpecialDraft {
  return {
    name: "",
    code: "",
    description: "",
    image: undefined,
    kind: "domain",
    duration: 3,
    oncePerCombat: true,
    cooldown: 0,
    sceneEnabled: false,
    sceneFloor: undefined,
    sceneWall: undefined,
    sceneTheme: "paper",
    allyEffects: [],
    enemyEffects: [],
    legacy: false,
  };
}

function draftFromSpecial(special: SpecialAbility): SpecialDraft {
  const legacy =
    special.allyEffects === undefined && special.enemyEffects === undefined;
  return {
    name: special.name,
    code: special.code ?? "",
    description: special.description ?? "",
    image: special.image,
    kind: special.kind ?? "domain",
    duration: special.duration,
    oncePerCombat: special.oncePerCombat !== false,
    cooldown: special.cooldown ?? 0,
    sceneEnabled: Boolean(special.scene),
    sceneFloor: special.scene?.floor,
    sceneWall: special.scene?.wall,
    sceneTheme: special.scene?.theme ?? "paper",
    // Un special antiguo pasa sus efectos a la lista de aliados al editarse.
    allyEffects: structuredClone(special.allyEffects ?? special.effects),
    enemyEffects: structuredClone(special.enemyEffects ?? []),
    legacy,
  };
}

export function SpecialEditorPage() {
  const { specialId } = useParams();
  const campaign = useAppStore((state) => state.campaign);
  const saveContent = useAppStore((state) => state.saveContent);
  const removeContent = useAppStore((state) => state.removeContent);
  const busy = useAppStore((state) => state.busy);
  const navigate = useNavigate();

  const existing = useMemo(
    () =>
      specialId && campaign
        ? campaign.content.specials.find((special) => special.id === specialId)
        : undefined,
    [specialId, campaign],
  );

  const [draft, setDraft] = useState<SpecialDraft>(() =>
    existing ? draftFromSpecial(existing) : emptyDraft(),
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!campaign) return;
    setDraft(existing ? draftFromSpecial(existing) : emptyDraft());
    setErrors([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specialId, campaign?.id]);

  if (!campaign) return null;

  if (specialId && !existing) {
    return (
      <div className="animate-rise">
        <PageHeader
          eyebrow="Dominios y hábitats"
          title="Habilidad no encontrada"
          back={{ to: "/specials", label: "Volver a dominios" }}
        />
        <div className="panel p-8 text-center">
          <p className="text-sm text-ui-muted">
            Esa habilidad especial no existe en esta campaña.
          </p>
          <div className="mt-4">
            <LinkButton to="/specials" size="sm">
              Volver
            </LinkButton>
          </div>
        </div>
      </div>
    );
  }

  function patch(update: Partial<SpecialDraft>) {
    setDraft((current) => ({ ...current, ...update }));
  }

  function buildPayload() {
    const scene = draft.sceneEnabled
      ? {
          ...(draft.sceneFloor ? { floor: draft.sceneFloor } : {}),
          ...(draft.sceneWall ? { wall: draft.sceneWall } : {}),
          theme: draft.sceneTheme,
        }
      : undefined;
    return {
      name: draft.name.trim(),
      code: draft.code.trim() || undefined,
      description: draft.description.trim() || undefined,
      image: draft.image,
      kind: draft.kind,
      duration: draft.duration,
      cooldown: draft.oncePerCombat ? undefined : draft.cooldown,
      oncePerCombat: draft.oncePerCombat,
      // `effects`/`target` son legado; las listas nuevas activan el modo por bandos.
      effects: [],
      target: "team" as const,
      allyEffects: draft.allyEffects,
      enemyEffects: draft.enemyEffects,
      scene,
    };
  }

  async function handleSave() {
    const parsed = specialInputSchema.safeParse(buildPayload());
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((issue) => issue.message));
      return;
    }
    setErrors([]);
    try {
      const saved = await saveContent("specials", parsed.data, specialId);
      if (!specialId) navigate(`/specials/${saved.id}`, { replace: true });
    } catch {
      // store notifica
    }
  }

  async function handleDelete() {
    if (!specialId) return;
    try {
      await removeContent("specials", specialId);
      setConfirmDelete(false);
      navigate("/specials");
    } catch {
      setConfirmDelete(false);
    }
  }

  const title = draft.name || (draft.kind === "habitat" ? "Hábitat" : "Dominio");

  return (
    <div className="animate-rise">
      <PageHeader
        eyebrow={specialId ? "Editar habilidad especial" : "Nueva habilidad especial"}
        title={title}
        description="No hace clash: se declara, ocupa 1 Skill Slot y se resuelve en la ronda. Aplica efectos a aliados y/o enemigos y puede sustituir la escena mientras dure."
        back={{ to: "/specials", label: "Volver a dominios" }}
        actions={
          <>
            {specialId ? (
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
              Guardar habilidad
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

      {draft.legacy ? (
        <div className="mb-4 border border-amber bg-amber/10 p-3 text-[11px] leading-relaxed text-ui-muted">
          Esta habilidad usa el formato antiguo (<code>effects</code>). Al
          guardar, sus efectos pasan a <strong>Jugadores y aliados</strong>.
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
                  placeholder="Dominio del eco"
                  maxLength={80}
                />
              </Field>
              <Field label="Código visible">
                <TextInput
                  value={draft.code}
                  onValueChange={(value) => patch({ code: value })}
                  placeholder="DOM-001"
                  maxLength={40}
                />
              </Field>
              <Field
                label="Tipo"
                hint="Solo organiza la biblioteca y los selectores de la ficha."
              >
                <Select
                  value={draft.kind}
                  onValueChange={(value) =>
                    patch({ kind: value as SpecialKind })
                  }
                >
                  <option value="domain">Dominio</option>
                  <option value="habitat">Hábitat</option>
                </Select>
              </Field>
              <Field label="Descripción" className="sm:col-span-2">
                <TextArea
                  value={draft.description}
                  onValueChange={(value) => patch({ description: value })}
                  rows={3}
                  maxLength={2000}
                  placeholder="Qué ocurre cuando se activa…"
                />
              </Field>
              <div className="sm:col-span-2">
                <ImageField
                  value={draft.image}
                  onChange={(value) => patch({ image: value })}
                  label="Imagen"
                  hint="Arte para la biblioteca y la ficha. Opcional."
                />
              </div>
            </div>
          </section>

          <section className="panel p-4">
            <h2 className="mb-4 border-b border-ui-line pb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
              02 · Duración y usos
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Duración"
                hint="Rondas que se mantiene el efecto y la escena."
              >
                <NumberInput
                  value={draft.duration}
                  onValueChange={(value) => patch({ duration: value ?? 1 })}
                  min={1}
                  max={99}
                />
              </Field>
              <div className="border border-ui-line bg-ui-surface-2 p-3">
                <Toggle
                  checked={draft.oncePerCombat}
                  onCheckedChange={(value) =>
                    patch({ oncePerCombat: value })
                  }
                  label="Una vez por combate"
                  hint="Desactívalo para permitir cooldown entre usos."
                />
              </div>
              {!draft.oncePerCombat ? (
                <Field label="Cooldown" hint="Rondas de espera tras usarse.">
                  <NumberInput
                    value={draft.cooldown}
                    onValueChange={(value) => patch({ cooldown: value ?? 0 })}
                    min={0}
                    max={99}
                  />
                </Field>
              ) : null}
            </div>
          </section>

          <section className="panel p-4">
            <h2 className="mb-4 border-b border-ui-line pb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
              03 · Escenario
            </h2>
            <Toggle
              checked={draft.sceneEnabled}
              onCheckedChange={(value) => patch({ sceneEnabled: value })}
              label="Cambiar el escenario mientras dure"
              hint="Sustituye piso, pared y tema del encuentro. Al expirar se restaura la escena anterior."
            />
            {draft.sceneEnabled ? (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <ImageField
                  value={draft.sceneFloor}
                  onChange={(value) => patch({ sceneFloor: value })}
                  label="Fondo (piso)"
                />
                <ImageField
                  value={draft.sceneWall}
                  onChange={(value) => patch({ sceneWall: value })}
                  label="Pared"
                />
                <Field label="Tema visual">
                  <Select
                    value={draft.sceneTheme}
                    onValueChange={(value) =>
                      patch({ sceneTheme: value as SceneTheme })
                    }
                  >
                    <option value="paper">Papel</option>
                    <option value="night">Noche</option>
                  </Select>
                </Field>
                <div className="relative min-h-[96px] overflow-hidden border border-ui-line-strong bg-ui-surface-2">
                  {draft.sceneFloor ? (
                    <img
                      src={draft.sceneFloor}
                      alt=""
                      className={cx(
                        "h-full w-full object-cover",
                        draft.sceneTheme === "night" && "brightness-75",
                      )}
                    />
                  ) : (
                    <div className="flex h-full min-h-[96px] items-center justify-center text-[10px] text-ui-faint">
                      Sin fondo
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </section>

          <section className="panel p-4">
            <h2 className="mb-1 border-b border-ui-line pb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
              04 · Efectos para jugadores y aliados
            </h2>
            <p className="mb-3 mt-2 text-[11px] leading-relaxed text-ui-faint">
              Se aplican a todas las unidades vivas del equipo del lanzador,
              incluido él. «Rival» no se usa aquí: los enemigos van en su propio
              apartado.
            </p>
            <EffectActionEditor
              actions={draft.allyEffects}
              onChange={(actions) => patch({ allyEffects: actions })}
              effects={campaign.content.effects}
            />

          </section>

          <section className="panel p-4">
            <h2 className="mb-1 border-b border-ui-line pb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
              05 · Efectos para enemigos
            </h2>
            <p className="mb-3 mt-2 text-[11px] leading-relaxed text-ui-faint">
              Se aplican a todas las unidades vivas del equipo contrario. Un
              daño o un efecto negativo aquí golpea a los enemigos.
            </p>
            <EffectActionEditor
              actions={draft.enemyEffects}
              onChange={(actions) => patch({ enemyEffects: actions })}
              effects={campaign.content.effects}
            />

          </section>
        </div>

        <aside className="space-y-4">
          <div className="sticky top-6 space-y-4">
            <div className="panel p-4">
              <div className="mb-3 border-b border-ui-line pb-2 font-mono text-[10px] font-bold uppercase tracking-[0.18em]">
                Vista previa
              </div>
              <div className="flex items-start gap-3">
                <div className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden border border-ui-line-strong bg-ui-surface-2">
                  {draft.image ? (
                    <img
                      src={draft.image}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <Icon name="spark" size={22} className="text-ui-faint" />
                  )}
                </div>
                <div className="min-w-0">
                  <h3 className="display text-lg">{title}</h3>
                  <p className="font-mono text-[9px] text-ui-faint">
                    {draft.code || "SIN-CÓDIGO"} ·{" "}
                    {draft.kind === "habitat" ? "Hábitat" : "Dominio"}
                  </p>
                </div>
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-ui-muted">
                {draft.description || "Sin descripción."}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2 border-t border-ui-line pt-3 font-mono text-[9px] uppercase tracking-[0.12em] text-ui-faint">
                <span>Duración</span>
                <span className="text-right text-ui">{draft.duration} ronda(s)</span>
                <span>Usos</span>
                <span className="text-right text-ui">
                  {draft.oncePerCombat
                    ? "1 por combate"
                    : `cooldown ${draft.cooldown}`}
                </span>
                <span>Escena</span>
                <span className="text-right text-ui">
                  {draft.sceneEnabled ? "Sí" : "No"}
                </span>
                <span>Aliados</span>
                <span className="text-right text-ui">
                  {draft.allyEffects.length} efectos
                </span>
                <span>Enemigos</span>
                <span className="text-right text-ui">
                  {draft.enemyEffects.length} efectos
                </span>
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
          </div>
        </aside>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Eliminar habilidad especial"
        message={
          <>
            Vas a eliminar <strong>«{draft.name}»</strong>. No puedes borrarla si
            un personaje la tiene asignada como dominio o hábitat.
          </>
        }
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void handleDelete()}
        busy={busy}
      />
    </div>
  );
}
