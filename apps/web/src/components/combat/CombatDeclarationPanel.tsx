import { useEffect, useMemo, useState } from "react";
import type {
  CampaignContent,
  CombatUnit,
  PublicCombatState,
} from "@protocol-life/shared";
import { Icon } from "../Icons";
import { Button, Field, SectionTitle, Select, cx } from "../ui";
import {
  declaredActionsForUnit,
  draftSignature,
  draftToPayload,
  equippedSkillIds,
  findItem,
  findSkill,
  isAliveUnit,
  newDraftAction,
  payloadToDraft,
  serverActionsSignature,
  specialForUnit,
  specialUsed,
  unitById,
  utilityItemForUnit,
  validateDraft,
  type CombatActionKind,
  type CombatDeclaration,
  type CombatDraftAction,
} from "../../lib/combat";

/**
 * Editor de declaración del jugador: hasta `skillSlots` acciones (skill,
 * utilidad, dominio o hábitat), objetivo y redirección opcional.
 *
 * El borrador es local; «Guardar» manda la intención y «Listo» manda primero
 * el borrador y luego el lock. La validación real sigue en el servidor.
 */

export interface CombatDeclarationPanelProps {
  unit: CombatUnit;
  combat: PublicCombatState;
  content: CampaignContent;
  locked: boolean;
  connected: boolean;
  error: string | null;
  onDeclare: (actions: CombatDeclaration[]) => void;
  onLock: (actions: CombatDeclaration[]) => void;
  onClearError: () => void;
  /** Título del panel; por defecto "Tu declaración". */
  title?: string;
  /** Etiqueta del botón que declara y bloquea. */
  readyLabel?: string;
  /** Sujeto de los textos de estado ("Tu unidad" en jugador). */
  subject?: string;
}

export function CombatDeclarationPanel({
  unit,
  combat,
  content,
  locked,
  connected,
  error,
  onDeclare,
  onLock,
  onClearError,
  title = "Tu declaración",
  readyLabel = "Listo / Bloquear",
  subject = "Tu unidad",
}: CombatDeclarationPanelProps) {
  const serverActions = declaredActionsForUnit(combat.actions, unit.id);
  const [draft, setDraft] = useState<CombatDraftAction[]>(() =>
    payloadToDraft(serverActions),
  );
  const [locking, setLocking] = useState(false);

  // Sincroniza al cambiar de ronda/unidad o al bloquearse. No se resincroniza
  // con cada `combat:state` para no borrar lo que el jugador está editando
  // mientras otro cliente declara.
  useEffect(() => {
    setDraft(payloadToDraft(declaredActionsForUnit(combat.actions, unit.id)));
    setLocking(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combat.id, combat.round, combat.phase, unit.id, locked]);

  useEffect(() => {
    if (error) setLocking(false);
  }, [error]);

  const alive = isAliveUnit(unit);
  const canEdit =
    combat.phase === "declaring" && !locked && alive && connected && !locking;
  const maxSlots = unit.stats.skillSlots;
  const validationError = validateDraft(draft, {
    combat,
    unit,
    content,
  });
  const saved =
    draftSignature(draft) === serverActionsSignature(serverActions);

  const livingUnits = useMemo(
    () => combat.units.filter(isAliveUnit),
    [combat.units],
  );
  const livingEnemies = livingUnits.filter((entry) => entry.team !== unit.team);
  const allies = livingUnits.filter(
    (entry) => entry.team === unit.team && entry.id !== unit.id,
  );

  const skills = [
    ...new Set(equippedSkillIds(unit)),
  ]
    .map((id) => findSkill(content, id))
    .filter((skill): skill is NonNullable<typeof skill> => Boolean(skill));
  const utility = utilityItemForUnit(content, unit);
  const declaredUtilities = draft.filter(
    (action) => action.kind === "utility",
  ).length;
  const domain = specialForUnit(content, unit, "domain");
  const habitat = specialForUnit(content, unit, "habitat");
  const domainUsed = specialUsed(combat, unit, domain);
  const habitatUsed = specialUsed(combat, unit, habitat);
  const domainDeclared = draft.some((action) => action.kind === "domain");
  const habitatDeclared = draft.some((action) => action.kind === "habitat");

  function updateAction(id: string, patch: Partial<CombatDraftAction>) {
    setDraft((current) =>
      current.map((action) =>
        action.id === id ? { ...action, ...patch } : action,
      ),
    );
  }

  function removeAction(id: string) {
    setDraft((current) => current.filter((action) => action.id !== id));
  }

  function addAction(kind: CombatActionKind) {
    if (!canEdit || draft.length >= maxSlots) return;
    if (kind === "skill") {
      const skill = skills[0];
      if (!skill) return;
      const target = livingEnemies[0] ?? livingUnits[0];
      setDraft((current) => [
        ...current,
        newDraftAction("skill", {
          skillId: skill.id,
          targetId: target?.id,
        }),
      ]);
      return;
    }
    if (kind === "utility") {
      if (!utility || unit.utilityUses <= declaredUtilities) return;
      setDraft((current) => [
        ...current,
        newDraftAction("utility", {
          utilityId: utility.id,
          targetId: unit.id,
        }),
      ]);
      return;
    }
    const special = kind === "domain" ? domain : habitat;
    if (!special || (kind === "domain" ? domainUsed : habitatUsed)) return;
    setDraft((current) => [...current, newDraftAction(kind)]);
  }

  function changeTarget(action: CombatDraftAction, targetId: string) {
    const target = unitById(combat, targetId);
    const keepRedirect =
      Boolean(action.redirectFor) &&
      Boolean(target) &&
      target!.team !== unit.team &&
      unit.stats.spd > target!.stats.spd;
    updateAction(action.id, {
      targetId,
      ...(keepRedirect ? {} : { redirectFor: undefined }),
    });
  }

  function handleSave() {
    if (!canEdit || validationError) return;
    onClearError();
    onDeclare(draftToPayload(draft));
  }

  function handleLock() {
    if (!canEdit || validationError || locking) return;
    onClearError();
    setLocking(true);
    onLock(draftToPayload(draft));
  }

  function handleReset() {
    setDraft(payloadToDraft(serverActions));
  }

  const status = locking
    ? "Bloqueando la declaración…"
    : locked
      ? `${subject} está lista. Esperando al resto de la mesa.`
      : !connected
        ? "Reconectando con la mesa…"
        : combat.phase !== "declaring"
          ? combat.phase === "resolving"
            ? "La ronda se está resolviendo. Espera el nuevo estado."
            : "El combate terminó."
          : !alive
            ? `${subject} cayó y no puede declarar.`
            : null;

  return (
    <section className="panel p-4">
      <SectionTitle
        title={title}
        action={
          <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-faint">
            {draft.length}/{maxSlots} slots
          </span>
        }
      />

      {error ? (
        <div className="mb-3 flex items-start gap-2 border-2 border-rust bg-rust/10 p-2.5 text-rust-deep">
          <Icon name="alert" size={14} className="mt-0.5 shrink-0" />
          <p className="min-w-0 flex-1 text-[11px] font-semibold leading-snug">
            {error}
          </p>
          <button
            type="button"
            onClick={onClearError}
            className="shrink-0 font-mono text-[9px] font-bold uppercase tracking-[0.12em] underline"
          >
            Cerrar
          </button>
        </div>
      ) : null}

      {status ? (
        <div className="mb-3 flex items-start gap-2 border-2 border-ink/25 bg-paper p-2.5">
          <Icon
            name={locked ? "lock" : alive ? "broadcast" : "skull"}
            size={14}
            className="mt-0.5 shrink-0 text-ink-faint"
          />
          <p className="text-[11px] leading-snug text-ink-soft">{status}</p>
        </div>
      ) : null}

      <div className="space-y-2">
        {draft.length === 0 ? (
          <p className="border-2 border-dashed border-ink/25 px-3 py-5 text-center text-[11px] text-ink-faint">
            Sin acciones. Puedes declarar hasta {maxSlots} y bloquear cuando
            estés listo.
          </p>
        ) : (
          draft.map((action, index) => {
            const target = unitById(combat, action.targetId);
            const canRedirect =
              action.kind === "skill" &&
              Boolean(target) &&
              target!.team !== unit.team &&
              unit.stats.spd > target!.stats.spd &&
              allies.length > 0;
            return (
              <div
                key={action.id}
                className="border-2 border-ink/35 bg-paper/55 p-2.5"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-ink-faint">
                    <span className="flex h-5 w-5 items-center justify-center border border-ink bg-paper-light text-ink">
                      {index + 1}
                    </span>
                    {action.kind === "skill"
                      ? "Skill"
                      : action.kind === "utility"
                        ? "Utilidad"
                        : action.kind === "domain"
                          ? "Dominio"
                          : "Hábitat"}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    icon="trash"
                    onClick={() => removeAction(action.id)}
                    disabled={!canEdit}
                  >
                    Quitar
                  </Button>
                </div>

                {action.kind === "skill" ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Field label="Skill equipada">
                      <Select
                        aria-label={`Skill de la acción ${index + 1}`}
                        value={action.skillId ?? ""}
                        onValueChange={(value) =>
                          updateAction(action.id, { skillId: value })
                        }
                        disabled={!canEdit}
                      >
                        <option value="" disabled>
                          Elige una skill
                        </option>
                        {skills.map((skill) => (
                          <option key={skill.id} value={skill.id}>
                            {skill.name} · {skill.coins} monedas
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Objetivo">
                      <Select
                        aria-label={`Objetivo de la acción ${index + 1}`}
                        value={action.targetId ?? ""}
                        onValueChange={(value) => changeTarget(action, value)}
                        disabled={!canEdit}
                      >
                        <option value="" disabled>
                          Elige un objetivo
                        </option>
                        {livingUnits.map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.team === unit.team ? "Aliado" : "Enemigo"} ·{" "}
                            {entry.name} ({entry.hpCurrent} HP)
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                ) : action.kind === "utility" ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Field label="Utilidad equipada">
                      <div className="field flex items-center justify-between gap-2">
                        <span className="truncate">
                          {utility?.name ?? "Sin utilidad"}
                        </span>
                        <span className="shrink-0 font-mono text-[9px] text-ink-faint">
                          {unit.utilityUses} usos
                        </span>
                      </div>
                    </Field>
                    <Field label="Objetivo">
                      <Select
                        aria-label={`Objetivo de la acción ${index + 1}`}
                        value={action.targetId ?? ""}
                        onValueChange={(value) => changeTarget(action, value)}
                        disabled={!canEdit}
                      >
                        <option value="" disabled>
                          Elige un objetivo
                        </option>
                        {livingUnits.map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.team === unit.team ? "Aliado" : "Enemigo"} ·{" "}
                            {entry.name} ({entry.hpCurrent} HP)
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                ) : (
                  <div className="border border-ink/25 bg-paper-light p-2">
                    <div className="text-xs font-semibold">
                      {action.kind === "domain"
                        ? domain?.name ?? "Dominio"
                        : habitat?.name ?? "Hábitat"}
                    </div>
                    <p className="mt-0.5 font-mono text-[8px] uppercase tracking-[0.1em] text-ink-faint">
                      {action.kind === "domain"
                        ? domain?.duration
                        : habitat?.duration}{" "}
                      turnos · aplica al equipo · 1 vez por combate
                    </p>
                  </div>
                )}

                {action.kind === "skill" && canRedirect ? (
                  <div className="mt-2">
                    <Field
                      label="Redirección (opcional)"
                      hint="Tu SPD es mayor que la del atacante. La skill se resuelve contra él si ataca al aliado protegido."
                    >
                      <Select
                        aria-label={`Redirección de la acción ${index + 1}`}
                        value={action.redirectFor ?? ""}
                        onValueChange={(value) =>
                          updateAction(action.id, {
                            redirectFor: value || undefined,
                          })
                        }
                        disabled={!canEdit}
                      >
                        <option value="">No redirigir</option>
                        {allies.map((ally) => (
                          <option key={ally.id} value={ally.id}>
                            Proteger a {ally.name} ({ally.hpCurrent} HP)
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      {canEdit ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-ink/15 pt-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            icon="sword"
            onClick={() => addAction("skill")}
            disabled={draft.length >= maxSlots || skills.length === 0}
          >
            Añadir skill
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            icon="cube"
            onClick={() => addAction("utility")}
            disabled={
              draft.length >= maxSlots ||
              !utility ||
              unit.utilityUses <= declaredUtilities
            }
          >
            Añadir utilidad
          </Button>
          {domain ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon="spark"
              onClick={() => addAction("domain")}
              disabled={
                draft.length >= maxSlots ||
                domainUsed ||
                domainDeclared
              }
            >
              {domainUsed ? "Dominio usado" : "Añadir dominio"}
            </Button>
          ) : null}
          {habitat ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon="spark"
              onClick={() => addAction("habitat")}
              disabled={
                draft.length >= maxSlots ||
                habitatUsed ||
                habitatDeclared
              }
            >
              {habitatUsed ? "Hábitat usado" : "Añadir hábitat"}
            </Button>
          ) : null}
        </div>
      ) : null}

      {canEdit && validationError ? (
        <p className="mt-2 flex items-start gap-1.5 border-2 border-rust/40 bg-rust/5 px-2 py-1.5 text-[10px] font-semibold leading-snug text-rust-deep">
          <Icon name="alert" size={12} className="mt-0.5 shrink-0" />
          {validationError}
        </p>
      ) : null}

      {canEdit ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-ink/15 pt-3">
          <Button
            type="button"
            variant="primary"
            size="sm"
            icon="save"
            onClick={handleSave}
            disabled={Boolean(validationError) || saved}
          >
            {saved ? "Guardada" : "Guardar declaración"}
          </Button>
          <Button
            type="button"
            variant="accent"
            size="sm"
            icon="lock"
            onClick={handleLock}
            disabled={Boolean(validationError) || locking}
          >
            {locking ? "Bloqueando…" : readyLabel}
          </Button>
          {!saved ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon="arrow-left"
              onClick={handleReset}
            >
              Descartar cambios
            </Button>
          ) : null}
          <span
            className={cx(
              "ml-auto font-mono text-[9px] uppercase tracking-[0.1em]",
              saved ? "text-moss" : "text-ink-faint",
            )}
          >
            {saved ? "Sincronizada" : "Sin guardar"}
          </span>
        </div>
      ) : null}
    </section>
  );
}
