import { Link } from "react-router-dom";
import {
  CHARACTER_KIND_LABELS,
  CURRENCY_NAME,
  EQUIPMENT_SLOT_LABELS,
  calculateStats,
  type CampaignContent,
  type Character,
  type EffectDefinition,
  type Encounter,
  type Item,
  type Ruleset,
  type Skill,
} from "@protocol-life/shared";
import { Icon } from "./Icons";
import { StatChip, TagList, cx } from "./ui";
import { normalizedCode, signed, statEntries } from "../lib/format";

/* -------------------------------------------------------------------------- */
/* Objetos                                                                    */
/* -------------------------------------------------------------------------- */

export function ItemCard({
  item,
  effects,
}: {
  item: Item;
  effects: EffectDefinition[];
}) {
  const effectNames = (item.effects ?? [])
    .map((ref) => effects.find((effect) => effect.id === ref.effectId))
    .filter((effect): effect is EffectDefinition => Boolean(effect));

  return (
    <Link
      to={`/items/${item.id}`}
      className="panel group flex flex-col transition-transform duration-100 hover:-translate-y-0.5"
    >
      <div className="relative aspect-[4/3] overflow-hidden border-b border-ui-line-strong bg-ui-surface-3 bg-grid">
        {item.image ? (
          <img
            src={item.image}
            alt={item.name}
            className="h-full w-full object-contain p-3 transition-transform duration-300 group-hover:scale-[1.03]"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="flex h-20 w-20 items-center justify-center border border-ui-line-strong bg-ui-surface-2 pentagon transition-transform group-hover:rotate-6">
              <span className="font-display text-lg text-ui-faint">
                {item.name.slice(0, 2).toUpperCase()}
              </span>
            </div>
          </div>
        )}
        <span className="absolute left-2 top-2 border border-ui-line-strong bg-ui-surface-2 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.12em]">
          {EQUIPMENT_SLOT_LABELS[item.slot]}
        </span>
        {item.rarity ? (
          <span className="absolute right-2 top-2 border border-ui-line-strong bg-amber px-1.5 text-ui-on-accent py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.12em]">
            {item.rarity}
          </span>
        ) : null}
        <span
          className={cx(
            "absolute bottom-2 left-2 inline-flex items-center gap-1 border border-ui-line-strong px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.1em]",
            item.unlocked ? "bg-ui-surface-2 text-ui-ok" : "bg-rust text-ui-on-accent",
          )}
        >
          <Icon name={item.unlocked ? "unlock" : "lock"} size={10} />
          {item.unlocked ? "Visible" : "Solo DM"}
        </span>
      </div>
      <div className="flex flex-1 flex-col p-3">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="display truncate text-lg" title={item.name}>
            {item.name}
          </h3>
          <span className="shrink-0 font-mono text-[9px] text-ui-faint">
            {normalizedCode(item.code, item.id)}
          </span>
        </div>
        <p className="mt-1 line-clamp-2 min-h-[2.5em] text-[11px] leading-snug text-ui-muted">
          {item.description || "Sin descripción."}
        </p>
        {statEntries(item.stats).length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {statEntries(item.stats).map((entry) => (
              <StatChip key={entry.key} label={entry.label} value={entry.value} />
            ))}
            {item.soulCost ? (
              <span className="chip chip-rust">
                <span className="text-ui-faint">Soul Points</span>
                <span className="font-bold">{item.soulCost}</span>
              </span>
            ) : null}
          </div>
        ) : item.soulCost ? (
          <div className="mt-2 flex flex-wrap gap-1">
            <span className="chip chip-rust">
              <span className="text-ui-faint">Soul Points</span>
              <span className="font-bold">{item.soulCost}</span>
            </span>
          </div>
        ) : null}
        {effectNames.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {effectNames.map((effect) => (
              <span key={effect.id} className="chip chip-rust">
                <Icon name="flame" size={10} /> {effect.name}
              </span>
            ))}
          </div>
        ) : null}
        <div className="mt-auto pt-3">
          <TagList tags={item.tags} max={3} />
        </div>
      </div>
    </Link>
  );
}

/* -------------------------------------------------------------------------- */
/* Skills                                                                     */
/* -------------------------------------------------------------------------- */

export function CoinRow({ coins }: { coins: number }) {
  const safe = Math.max(0, Math.min(20, coins));
  return (
    <div className="flex flex-wrap items-center gap-1" aria-label={`${coins} monedas`}>
      {Array.from({ length: safe }).map((_, index) => (
        <span
          key={index}
          className="inline-block h-3 w-3 rounded-full border border-ui-line-strong bg-amber"
        />
      ))}
      <span className="ml-1 font-mono text-[9px] text-ui-faint">×{coins}</span>
    </div>
  );
}

export function SkillCard({
  skill,
  effects,
}: {
  skill: Skill;
  effects: EffectDefinition[];
}) {
  const effectNames = (skill.effects ?? [])
    .map((ref) => effects.find((effect) => effect.id === ref.effectId))
    .filter((effect): effect is EffectDefinition => Boolean(effect));

  return (
    <Link
      to={`/skills/${skill.id}`}
      className="panel group flex flex-col transition-transform duration-100 hover:-translate-y-0.5"
    >
      <div className="flex items-start justify-between gap-3 border-b border-ui-line-strong bg-ui-surface-3 p-3">
        <div>
          <div className="mono-label">{normalizedCode(skill.code, skill.id)}</div>
          <h3 className="display mt-0.5 text-xl group-hover:text-rust">{skill.name}</h3>
        </div>
        <div className="mono-label border border-ui-line-strong bg-ui-surface-2 px-1.5 py-0.5">
          {skill.coins} {skill.coins === 1 ? "moneda" : "monedas"}
        </div>
      </div>
      <div className="flex-1 space-y-3 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CoinRow coins={skill.coins} />
          <span
            className={cx(
              "inline-flex items-center gap-1 border px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.1em]",
              skill.unlocked
                ? "border-moss/50 bg-moss/10 text-ui-ok"
                : "border-rust/50 bg-rust/10 text-ui-danger",
            )}
          >
            <Icon name={skill.unlocked ? "unlock" : "lock"} size={10} />
            {skill.unlocked ? "Visible" : "Solo DM"}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 font-mono text-[10px]">
          <div className="border border-ui-line bg-ui-surface-2 px-2 py-1.5">
            <div className="text-ui-faint">CLASH</div>
            <div className="mt-0.5 text-sm font-bold text-ui">
              {skill.baseClash}
              <span className="text-ui-faint"> +{skill.coinClash}/cara</span>
            </div>
          </div>
          <div className="border border-ui-line bg-ui-surface-2 px-2 py-1.5">
            <div className="text-ui-faint">DAÑO</div>
            <div className="mt-0.5 text-sm font-bold text-ui">
              {skill.baseDamage}
              <span className="text-ui-faint"> {signed(skill.coinDamage)}/cara</span>
            </div>
          </div>
        </div>
        <p className="line-clamp-2 min-h-[2.5em] text-[11px] leading-snug text-ui-muted">
          {skill.description || "Sin descripción."}
        </p>
        {effectNames.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {effectNames.map((effect) => (
              <span key={effect.id} className="chip chip-rust">
                <Icon name="flame" size={10} /> {effect.name}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </Link>
  );
}

/* -------------------------------------------------------------------------- */
/* Efectos                                                                    */
/* -------------------------------------------------------------------------- */

export function EffectCard({ effect }: { effect: EffectDefinition }) {
  const triggers = effect.triggers.map((trigger) => trigger.when);
  return (
    <Link
      to={`/effects/${effect.id}`}
      className="panel group flex gap-3 p-3 transition-transform duration-100 hover:-translate-y-0.5"
    >
      <div
        className={cx(
          "flex h-14 w-12 shrink-0 items-center justify-center border border-ui-line-strong bg-amber/30 hexagon",
        )}
      >
        {effect.icon ? (
          <img src={effect.icon} alt="" className="h-full w-full object-cover" />
        ) : (
          <Icon name="flame" size={20} />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="display truncate text-lg group-hover:text-rust">{effect.name}</h3>
          <span className="font-mono text-[9px] text-ui-faint">
            {normalizedCode(effect.code, effect.id)}
          </span>
        </div>
        <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-ui-muted">
          {effect.description || "Sin descripción."}
        </p>
        <div className="mt-2 flex flex-wrap gap-1">
          {effect.duration?.type === "permanent" ? (
            <span className="chip">Permanente</span>
          ) : effect.duration ? (
            <span className="chip">{effect.duration.default} turnos</span>
          ) : null}
          {effect.maxStacks ? (
            <span className="chip">máx. {effect.maxStacks} stacks</span>
          ) : null}
          {triggers.map((trigger) => (
            <span key={trigger} className="chip chip-accent">
              {trigger}
            </span>
          ))}
        </div>
      </div>
    </Link>
  );
}

/* -------------------------------------------------------------------------- */
/* Personajes                                                                 */
/* -------------------------------------------------------------------------- */

export function CharacterCard({
  character,
  content,
  rules,
}: {
  character: Character;
  content: CampaignContent;
  rules: Ruleset;
}) {
  const derived = calculateStats(character, content, rules);
  const skillNames = derived.skills
    .filter((skill): skill is Skill => Boolean(skill))
    .map((skill) => skill.name);
  const equipped = derived.equipment.filter((entry) => entry.item).length;

  const kindTone =
    character.kind === "player"
      ? "bg-steel text-ui-on-accent border-steel"
      : character.kind === "boss"
        ? "bg-amber text-ui-on-accent border-amber"
        : character.kind === "enemy"
          ? "bg-rust text-ui-on-accent border-rust"
          : "bg-moss text-ui-on-accent border-moss";

  return (
    <Link
      to={`/characters/${character.id}`}
      className="panel group flex flex-col transition-transform duration-100 hover:-translate-y-0.5"
    >
      <div className="relative flex items-center gap-3 border-b border-ui-line-strong bg-ui-surface-3 p-3">
        <div className="relative h-16 w-14 shrink-0 overflow-hidden border border-ui-line-strong bg-ui-surface-2">
          {character.portrait ? (
            <img
              src={character.portrait}
              alt={character.name}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <span className="font-display text-xl text-ui-faint">
                {character.name.slice(0, 1).toUpperCase()}
              </span>
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <span
            className={cx(
              "inline-block border px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase tracking-[0.14em]",
              kindTone,
            )}
          >
            {CHARACTER_KIND_LABELS[character.kind]}
          </span>
          <h3 className="display mt-1 truncate text-xl group-hover:text-rust">
            {character.name}
          </h3>
          <p className="truncate font-mono text-[9px] text-ui-faint">
            {equipped} objetos · {skillNames.length}/3 skills · Nv.{" "}
            {character.level ?? 1}
          </p>
        </div>
      </div>
      <div className="grid flex-1 grid-cols-3 gap-px bg-ui-surface-1">
        {[
          ["HP", derived.stats.hpMax],
          ["DEF", derived.stats.def],
          ["ATK", derived.stats.atk],
          ["SPD", derived.stats.spd],
          ["LUCK", derived.stats.luck],
          ["SLOTS", derived.stats.skillSlots],
        ].map(([label, value]) => (
          <div key={label} className="bg-ui-surface-2 px-2 py-2 text-center">
            <div className="font-mono text-[8px] uppercase tracking-[0.16em] text-ui-faint">
              {label}
            </div>
            <div className="font-display text-base">{value}</div>
          </div>
        ))}
      </div>
      <div className="p-3">
        {skillNames.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {skillNames.map((name) => (
              <span key={name} className="chip">
                <Icon name="sword" size={10} /> {name}
              </span>
            ))}
          </div>
        ) : (
          <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-ui-faint">
            Sin skills equipadas
          </span>
        )}
        {derived.warnings.length > 0 ? (
          <p className="mt-2 flex items-center gap-1 text-[10px] font-semibold text-ui-danger">
            <Icon name="alert" size={11} /> {derived.warnings.length} aviso
            {derived.warnings.length === 1 ? "" : "s"}
          </p>
        ) : null}
      </div>
    </Link>
  );
}

/* -------------------------------------------------------------------------- */
/* Encuentros                                                                 */
/* -------------------------------------------------------------------------- */

export function EncounterCard({
  encounter,
  characters,
}: {
  encounter: Encounter;
  characters: Character[];
}) {
  const enemies = encounter.enemies.flatMap((enemy) => {
    const character = characters.find((entry) => entry.id === enemy.characterId);
    if (!character) return [];
    return [{ character, count: enemy.count ?? 1 }];
  });
  const total = enemies.reduce((sum, enemy) => sum + enemy.count, 0);

  return (
    <Link
      to={`/encounters/${encounter.id}`}
      className="panel group flex flex-col transition-transform duration-100 hover:-translate-y-0.5"
    >
      <div className="flex items-start justify-between gap-3 border-b border-ui-line-strong bg-ui-surface-3 p-3">
        <div>
          <div className="mono-label">{total} enemigos</div>
          <h3 className="display mt-0.5 text-xl group-hover:text-rust">{encounter.name}</h3>
        </div>
        <div className="flex h-10 w-10 items-center justify-center border border-ui-line-strong bg-rust/15 hexagon">
          <Icon name="skull" size={18} />
        </div>
      </div>
      <div className="flex-1 space-y-3 p-3">
        <p className="line-clamp-2 text-[11px] leading-snug text-ui-muted">
          {encounter.description || "Sin descripción."}
        </p>
        <div className="space-y-1">
          {enemies.length === 0 ? (
            <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-ui-faint">
              Sin enemigos
            </span>
          ) : (
            enemies.map(({ character, count }) => (
              <div
                key={character.id}
                className="flex items-center justify-between border-b border-ui-line pb-1 text-xs"
              >
                <span className="flex items-center gap-1.5">
                  <Icon name="skull" size={11} className="text-ui-danger" />
                  {character.name}
                </span>
                <span className="font-mono text-[10px] text-ui-faint">×{count}</span>
              </div>
            ))
          )}
        </div>
        {encounter.rewards ? (
          <div className="flex flex-wrap gap-1">
            {encounter.rewards.currency ? (
              <span className="chip">{encounter.rewards.currency} {CURRENCY_NAME}</span>
            ) : null}
            {encounter.rewards.itemIds?.length ? (
              <span className="chip">
                {encounter.rewards.itemIds.length} objeto
                {encounter.rewards.itemIds.length === 1 ? "" : "s"}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </Link>
  );
}
