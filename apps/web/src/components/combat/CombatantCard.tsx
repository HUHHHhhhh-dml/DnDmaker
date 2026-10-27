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
        "flex flex-col border-2 bg-paper-light/95",
        active
          ? "border-amber shadow-[3px_3px_0_0_var(--color-amber)]"
          : "border-ink",
        unit.defeated && "opacity-75",
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b-2 border-ink bg-paper-deep px-2 py-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          {typeof order === "number" ? (
            <span className="flex h-5 w-5 shrink-0 items-center justify-center border border-ink bg-paper-light font-mono text-[9px] font-bold">
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
            <span className="inline-flex items-center gap-1 border border-ink/50 bg-paper px-1 py-0.5 font-mono text-[8px] font-bold uppercase tracking-[0.1em] text-moss">
              <Icon name="lock" size={9} /> Listo
            </span>
          ) : null}
          <span className="font-mono text-[9px] font-bold text-ink-soft">
            SPD {unit.stats.spd}
          </span>
        </div>
      </div>

      <CombatSprite
        unit={unit}
        content={content}
        weaponImage={weaponImage}
        active={active}
      />

      <div className="space-y-2 p-2">
        <div>
          <div className="flex items-baseline justify-between gap-2 font-mono text-[9px] uppercase tracking-[0.1em]">
            <span className="text-ink-faint">HP</span>
            <span className="font-bold">
              {unit.hpCurrent}
              <span className="text-ink-faint">/{unit.stats.hpMax}</span>
            </span>
          </div>
          <div
            className="mt-1 h-3 overflow-hidden border-2 border-ink bg-paper-deep"
            role="progressbar"
            aria-label={`HP de ${unit.name}`}
            aria-valuemin={0}
            aria-valuemax={unit.stats.hpMax}
            aria-valuenow={unit.hpCurrent}
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

        <div className="grid grid-cols-3 gap-px border border-ink/25 bg-ink/20">
          {[
            ["DEF", unit.stats.def],
            ["SPD", unit.stats.spd],
            ["Slots", unit.stats.skillSlots],
          ].map(([label, value]) => (
            <div key={label} className="bg-paper-light px-1 py-1 text-center">
              <div className="font-mono text-[7px] uppercase tracking-[0.12em] text-ink-faint">
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
          <div className="flex items-center gap-1 font-mono text-[8px] uppercase tracking-[0.1em] text-ink-faint">
            <Icon name="cube" size={10} />
            <span className="truncate">{utility.name}</span>
            <span className="shrink-0 text-ink">×{unit.utilityUses}</span>
          </div>
        ) : null}

        {actions.length > 0 ? (
          <div className="border-t border-ink/15 pt-1.5">
            <div className="font-mono text-[7px] uppercase tracking-[0.14em] text-ink-faint">
              Declarado
            </div>
            <ul className="mt-0.5 space-y-0.5">
              {actions.map((action) => (
                <li
                  key={`${action.slot}:${action.skillId ?? action.utilityId ?? action.special}`}
                  className="flex items-baseline gap-1 font-mono text-[8px] leading-snug"
                >
                  <span className="shrink-0 text-ink-faint">
                    [{action.slot}]
                  </span>
                  <span className="min-w-0 truncate">
                    {serverActionLabel(action, content)}
                  </span>
                  {action.targetId ? (
                    <span className="shrink-0 text-ink-faint">
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
          <p className="border-t border-ink/15 pt-1.5 font-mono text-[8px] uppercase tracking-[0.1em] text-ink-faint">
            Sin acciones · esperando
          </p>
        ) : null}
      </div>
    </article>
  );
}
