import type {
  CampaignContent,
  CombatUnit,
  DeclaredAction,
} from "@protocol-life/shared";
import { CombatSprite } from "./CombatSprite";
import { Icon } from "../Icons";
import { cx } from "../ui";
import {
  effectLabel,
  findItem,
  hpPercent,
  isAliveUnit,
  serverActionLabel,
} from "../../lib/combat";

/** Tarjeta de unidad del side-view: sprite, HP, stats, efectos y acciones. */
export interface CombatantCardProps {
  unit: CombatUnit;
  units: CombatUnit[];
  content: CampaignContent;
  actions: DeclaredAction[];
  locked: boolean;
  isSelf?: boolean;
  active?: boolean;
  order?: number;
  weaponImage?: string;
  backImage?: string;
  frontImage?: string;
  /**
   * Si es false, el HP se muestra como porcentaje (regla 3F.5: los jugadores
   * no ven el HP exacto de los enemigos). El DM y la party ven el exacto.
   */
  showExactHp?: boolean;
}

export function CombatantCard({
  unit,
  units,
  content,
  actions,
  locked,
  isSelf = false,
  active = false,
  order,
  weaponImage,
  backImage,
  frontImage,
  showExactHp = true,
}: CombatantCardProps) {
  const hp = hpPercent(unit);
  const alive = isAliveUnit(unit);
  const utility = findItem(content, unit.equipment.utility ?? undefined);
  const effects = unit.effects.filter((effect) => effect.stacks > 0);
  const targetName = (targetId: string | undefined) =>
    units.find((entry) => entry.id === targetId)?.name ?? "—";

  return (
    <article
      className={cx(
        "flex flex-col border-2 bg-ui-surface-2",
        active
          ? "border-amber shadow-[3px_3px_0_0_var(--color-amber)]"
          : "border-ui-line-strong",
        unit.defeated && "opacity-75",
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-ui-line-strong bg-ui-surface-3 px-2 py-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          {typeof order === "number" ? (
            <span className="flex h-5 w-5 shrink-0 items-center justify-center border border-ui-line-strong bg-ui-surface-3 font-mono text-[9px] font-bold">
              {order}
            </span>
          ) : null}
          <span className="truncate text-xs font-bold uppercase tracking-[0.06em]">
            {unit.name}
          </span>
          {isSelf ? <span className="chip chip-accent shrink-0">Tú</span> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {locked ? (
            <span className="inline-flex items-center gap-1 border border-ui-line bg-ui-surface-2 px-1 py-0.5 font-mono text-[8px] font-bold uppercase tracking-[0.1em] text-ui-ok">
              <Icon name="lock" size={9} /> Listo
            </span>
          ) : null}
          <span className="font-mono text-[9px] font-bold text-ui-muted">
            SPD {unit.stats.spd}
          </span>
        </div>
      </div>

      <CombatSprite
        unit={unit}
        content={content}
        weaponImage={weaponImage}
        backImage={backImage}
        frontImage={frontImage}
        active={active}
      />

      <div className="space-y-2 p-2">
        <div>
          <div className="flex items-baseline justify-between gap-2 font-mono text-[9px] uppercase tracking-[0.1em]">
            <span className="text-ui-faint">HP</span>
            <span className="font-bold">
              {showExactHp ? (
                <>
                  {unit.hpCurrent}
                  <span className="text-ui-faint">/{unit.stats.hpMax}</span>
                </>
              ) : (
                `${hpPercent(unit)}%`
              )}
            </span>
          </div>
          <div
            className="mt-1 h-3 overflow-hidden border border-ui-line-strong bg-ui-surface-3"
            role="progressbar"
            aria-label={`HP de ${unit.name}`}
            aria-valuemin={0}
            aria-valuemax={showExactHp ? unit.stats.hpMax : 100}
            aria-valuenow={showExactHp ? unit.hpCurrent : hpPercent(unit)}
          >
            <div
              className={cx(
                "h-full transition-[width] duration-300",
                unit.team === "players" ? "bg-moss" : "bg-rust",
              )}
              style={{ width: `${hp}%` }}
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-px border border-ui-line bg-ui-surface-3">
          {[
            ["DEF", unit.stats.def],
            ["SPD", unit.stats.spd],
            ["Slots", unit.stats.skillSlots],
          ].map(([label, value]) => (
            <div key={label} className="bg-ui-surface-2 px-1 py-1 text-center">
              <div className="font-mono text-[7px] uppercase tracking-[0.12em] text-ui-faint">
                {label}
              </div>
              <div className="font-display text-sm leading-tight">{value}</div>
            </div>
          ))}
        </div>

        {effects.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {effects.map((effect, index) => (
              <span
                key={`${effect.effectId}:${index}`}
                className={cx(
                  "chip max-w-full truncate",
                  effect.passive ? "opacity-65" : "chip-rust",
                )}
                title={effectLabel(content, effect.effectId)}
              >
                <Icon name="flame" size={9} />
                <span className="truncate">
                  {effectLabel(content, effect.effectId)}
                </span>
                <span className="shrink-0">×{effect.stacks}</span>
              </span>
            ))}
          </div>
        ) : null}

        {utility && unit.utilityUses > 0 ? (
          <div className="flex items-center gap-1 font-mono text-[8px] uppercase tracking-[0.1em] text-ui-faint">
            <Icon name="cube" size={10} />
            <span className="truncate">{utility.name}</span>
            <span className="shrink-0 text-ui">×{unit.utilityUses}</span>
          </div>
        ) : null}

        {actions.length > 0 ? (
          <div className="border-t border-ui-line pt-1.5">
            <div className="font-mono text-[7px] uppercase tracking-[0.14em] text-ui-faint">
              Declarado
            </div>
            <ul className="mt-0.5 space-y-0.5">
              {actions.map((action) => (
                <li
                  key={`${action.slot}:${action.skillId ?? action.utilityId ?? action.special}`}
                  className="flex items-baseline gap-1 font-mono text-[8px] leading-snug"
                >
                  <span className="shrink-0 text-ui-faint">
                    [{action.slot}]
                  </span>
                  <span className="min-w-0 truncate">
                    {serverActionLabel(action, content)}
                  </span>
                  {action.targetId ? (
                    <span className="shrink-0 text-ui-faint">
                      → {targetName(action.targetId)}
                    </span>
                  ) : null}
                  {action.redirectFor ? (
                    <span className="shrink-0 text-steel">
                      protege a {targetName(action.redirectFor)}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : locked && alive ? (
          <p className="border-t border-ui-line pt-1.5 font-mono text-[8px] uppercase tracking-[0.1em] text-ui-faint">
            Sin acciones · esperando
          </p>
        ) : null}
      </div>
    </article>
  );
}
