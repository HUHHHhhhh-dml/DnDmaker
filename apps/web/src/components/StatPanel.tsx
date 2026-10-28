import {
  STAT_HINTS,
  STAT_KEYS,
  STAT_LABELS,
  coinChance,
  mitigation,
  type DerivedStats,
  type Ruleset,
  type StatKey,
} from "@protocol-life/shared";
import { Icon } from "./Icons";
import { cx } from "./ui";
import { signed } from "../lib/format";

const STAT_ACCENT: Record<StatKey, string> = {
  hpMax: "bg-rust/15",
  def: "bg-steel/15",
  atk: "bg-amber/20",
  spd: "bg-moss/15",
  luck: "bg-gold/20",
  skillSlots: "bg-ui-surface-2",
};

export function StatPanel({
  derived,
  rules,
  compact = false,
}: {
  derived: DerivedStats;
  rules: Ruleset;
  compact?: boolean;
}) {
  const grouped = new Map<
    string,
    { name: string; kind: "item" | "effect"; entries: { stat: StatKey; amount: number; mode: "flat" | "percent" }[] }
  >();

  for (const contribution of derived.contributions) {
    const key = `${contribution.sourceKind}:${contribution.sourceId}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.entries.push({
        stat: contribution.stat,
        amount: contribution.amount,
        mode: contribution.kind,
      });
    } else {
      grouped.set(key, {
        name: contribution.sourceName,
        kind: contribution.sourceKind,
        entries: [
          {
            stat: contribution.stat,
            amount: contribution.amount,
            mode: contribution.kind,
          },
        ],
      });
    }
  }

  return (
    <div className="space-y-4">
      <div className={cx("grid gap-2", compact ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-3")}>
        {STAT_KEYS.map((stat) => {
          const base = derived.base[stat];
          const value = derived.stats[stat];
          const delta = value - base;
          return (
            <div
              key={stat}
              className={cx("relative border border-ui-line-strong px-3 py-2", STAT_ACCENT[stat])}
              title={STAT_HINTS[stat]}
            >
              <div className="flex items-start justify-between gap-1">
                <span className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-ui-muted">
                  {STAT_LABELS[stat]}
                </span>
                {delta !== 0 ? (
                  <span
                    className={cx(
                      "font-mono text-[9px] font-bold",
                      delta > 0 ? "text-ui-ok" : "text-ui-danger",
                    )}
                  >
                    {signed(delta)}
                  </span>
                ) : null}
              </div>
              <div className="mt-0.5 flex items-baseline gap-1.5">
                <span className="font-display text-2xl leading-none">{value}</span>
                {delta !== 0 ? (
                  <span className="font-mono text-[9px] text-ui-faint">base {base}</span>
                ) : null}
              </div>
              {!compact && stat === "def" ? (
                <div className="mt-1 font-mono text-[8px] uppercase tracking-[0.1em] text-ui-faint">
                  mitiga {Math.round(mitigation(value, rules) * 100)}%
                </div>
              ) : null}
              {!compact && stat === "luck" ? (
                <div className="mt-1 font-mono text-[8px] uppercase tracking-[0.1em] text-ui-faint">
                  cara {Math.round(coinChance(value, rules) * 100)}%
                </div>
              ) : null}
              {!compact && stat === "skillSlots" ? (
                <div className="mt-1 font-mono text-[8px] uppercase tracking-[0.1em] text-ui-faint">
                  tope {rules.maxSkillSlots}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {derived.activeEffects.length > 0 ? (
        <div>
          <div className="mono-label mb-1.5">Efectos pasivos del equipo</div>
          <div className="flex flex-wrap gap-1">
            {derived.activeEffects.map((effect) => (
              <span key={effect.effectId} className="chip chip-rust" title={`Fuente: ${effect.sourceName}`}>
                <Icon name="flame" size={10} />
                {effect.name} ×{effect.stacks}
                {effect.duration?.type === "turns" ? ` · ${effect.duration.default}t` : ""}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {grouped.size > 0 ? (
        <div className="border-t border-ui-line pt-3">
          <div className="mono-label mb-1.5">Desglose de modificadores</div>
          <div className="space-y-1.5">
            {[...grouped.values()].map((group) => (
              <div key={group.name + group.kind} className="flex items-start gap-2 text-[11px]">
                <span
                  className={cx(
                    "mt-0.5 inline-block h-2 w-2 shrink-0",
                    group.kind === "item" ? "bg-steel" : "bg-rust",
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="font-semibold text-ui">{group.name}</span>
                  <span className="ml-1 font-mono text-[9px] uppercase text-ui-faint">
                    {group.kind === "item" ? "objeto" : "efecto"}
                  </span>
                  <span className="mt-0.5 block font-mono text-[10px] text-ui-muted">
                    {group.entries
                      .map(
                        (entry) =>
                          `${STAT_LABELS[entry.stat]} ${
                            entry.mode === "percent"
                              ? `${signed(entry.amount)}%`
                              : signed(entry.amount)
                          }`,
                      )
                      .join(" · ")}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {derived.warnings.length > 0 ? (
        <div className="border border-rust/50 bg-rust/5 p-2.5">
          <div className="mb-1 flex items-center gap-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-ui-danger">
            <Icon name="alert" size={12} /> Avisos de la ficha
          </div>
          <ul className="space-y-1 text-[11px] leading-snug text-ui-muted">
            {derived.warnings.map((warning, index) => (
              <li key={index} className="flex gap-1.5">
                <span className="text-ui-danger">·</span>
                {warning}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
