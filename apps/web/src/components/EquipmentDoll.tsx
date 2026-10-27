import { useState } from "react";
import {
  EQUIPMENT_SLOT_HINTS,
  EQUIPMENT_SLOT_LABELS,
  EQUIPMENT_SLOTS,
  STAT_LABELS,
  type Character,
  type EffectDefinition,
  type EquipmentSlot,
  type Item,
  type Skill,
  type Stats,
} from "@protocol-life/shared";
import { Icon } from "./Icons";
import { CoinRow } from "./cards";
import {
  Button,
  Modal,
  StatChip,
  cx,
} from "./ui";
import { signed, statEntries } from "../lib/format";

/**
 * Muñeco de equipo del jugador al estilo del prototipo: slots alrededor de la
 * imagen base, sin texto dentro de las casillas. Al pulsar un slot se abre un
 * selector con la imagen y los stats de cada objeto.
 *
 * En modo lectura (editable=false) es solo visual; en edición abre overlays.
 */

export interface EquipmentDollProps {
  character: Character;
  items: Item[];
  skills: Skill[];
  effects?: EffectDefinition[];
  baseImage?: string;
  derived: Stats;
  editable?: boolean;
  onEquip?: (slot: EquipmentSlot, itemId: string | null) => void;
  onSkillChange?: (index: number, skillId: string | null) => void;
}

type Picker =
  | { kind: "item"; slot: EquipmentSlot }
  | { kind: "skill"; index: number }
  | null;

export function EquipmentDoll({
  character,
  items,
  skills,
  effects = [],
  baseImage,
  derived,
  editable = false,
  onEquip,
  onSkillChange,
}: EquipmentDollProps) {
  const [picker, setPicker] = useState<Picker>(null);
  const itemById = new Map(items.map((item) => [item.id, item]));
  const skillById = new Map(skills.map((skill) => [skill.id, skill]));
  const equippedItems = EQUIPMENT_SLOTS.filter((slot) => character.equipment[slot]);

  function openSlot(slot: EquipmentSlot) {
    if (editable) setPicker({ kind: "item", slot });
  }

  function openSkill(index: number) {
    if (editable) setPicker({ kind: "skill", index });
  }

  return (
    <>
      <div className="relative border-2 border-ink bg-paper/50 bg-grid p-3 sm:p-5">
        <div className="pointer-events-none absolute inset-x-8 bottom-6 h-3 rounded-[50%] bg-ink/10 blur-sm" />
        <div className="relative grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-[92px_110px_minmax(0,1fr)_110px_92px] lg:items-stretch">
          {/* Utilidad + ATK */}
          <div className="order-2 flex flex-col items-center justify-between gap-5 lg:order-none">
            <EquipmentSlotButton
              slot="utility"
              item={
                character.equipment.utility
                  ? itemById.get(character.equipment.utility) ?? null
                  : null
              }
              editable={editable}
              shape="circle"
              onClick={() => openSlot("utility")}
            />
            <DollStatBadge label="ATK" value={derived.atk} shape="hex" />
          </div>

          {/* Cuernos + mano */}
          <div className="order-3 flex flex-col items-center justify-center gap-5 lg:order-none">
            <EquipmentSlotButton
              slot="horns"
              item={
                character.equipment.horns
                  ? itemById.get(character.equipment.horns) ?? null
                  : null
              }
              editable={editable}
              onClick={() => openSlot("horns")}
            />
            <EquipmentSlotButton
              slot="hand"
              item={
                character.equipment.hand
                  ? itemById.get(character.equipment.hand) ?? null
                  : null
              }
              editable={editable}
              onClick={() => openSlot("hand")}
            />
          </div>

          {/* Personaje + HP + skills */}
          <div className="order-1 col-span-2 flex flex-col items-center justify-between gap-2 lg:order-none lg:col-span-1">
            <div className="relative flex w-full flex-1 flex-col items-center justify-end">
              <div className="mb-2 border border-ink bg-paper-light px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.16em]">
                {character.name}
              </div>
              {baseImage || character.portrait ? (
                <div className="relative h-[250px] w-[167px] shrink-0 drop-shadow-[6px_10px_0_rgba(23,21,15,0.12)] sm:h-[300px] sm:w-[200px]">
                  <img
                    src={baseImage ?? character.portrait}
                    alt={character.name}
                    className="absolute inset-0 h-full w-full object-contain"
                    draggable={false}
                  />
                  {/* Capas de equipo: mismo lienzo 200x300 que la base. */}
                  {(["leg", "armor", "horns", "hand"] as const).map((slot) => {
                    const itemId = character.equipment[slot];
                    const item = itemId ? itemById.get(itemId) : null;
                    if (!item?.image) return null;
                    return (
                      <img
                        key={slot}
                        src={item.image}
                        alt=""
                        className="absolute inset-0 h-full w-full object-contain"
                        draggable={false}
                      />
                    );
                  })}
                </div>
              ) : (
                <div className="flex h-[250px] w-[170px] shrink-0 items-center justify-center border-2 border-dashed border-ink/30 bg-paper-light/50 sm:h-[300px] sm:w-[195px]">
                  <div className="flex h-24 w-24 items-center justify-center border-2 border-ink bg-paper pentagon">
                    <span className="font-display text-3xl text-ink-faint">
                      {character.name.slice(0, 1).toUpperCase()}
                    </span>
                  </div>
                </div>
              )}
              <div className="mt-2 flex w-full max-w-[280px] flex-col items-center">
                <div className="relative h-7 w-full overflow-hidden rounded-b-[999px] border-2 border-ink bg-paper-deep">
                  <div className="absolute inset-0 rounded-b-[999px] bg-rust/85" />
                  <div className="relative z-10 flex h-full items-center justify-center font-mono text-[10px] font-bold text-paper">
                    HP {derived.hpMax}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-end justify-center gap-2 pt-1 sm:gap-3">
              {[0, 1, 2].map((index) => {
                const skillId = character.skills[index];
                const skill = skillId ? skillById.get(skillId) ?? null : null;
                return (
                  <SkillSlotButton
                    key={index}
                    index={index}
                    skill={skill}
                    editable={editable}
                    onClick={() => openSkill(index)}
                  />
                );
              })}
            </div>
          </div>

          {/* Armadura + piernas */}
          <div className="order-4 flex flex-col items-center justify-center gap-5 lg:order-none">
            <EquipmentSlotButton
              slot="armor"
              item={
                character.equipment.armor
                  ? itemById.get(character.equipment.armor) ?? null
                  : null
              }
              editable={editable}
              onClick={() => openSlot("armor")}
            />
            <EquipmentSlotButton
              slot="leg"
              item={
                character.equipment.leg
                  ? itemById.get(character.equipment.leg) ?? null
                  : null
              }
              editable={editable}
              onClick={() => openSlot("leg")}
            />
          </div>

          {/* DEF + resumen */}
          <div className="order-5 flex flex-col items-center justify-between gap-5 lg:order-none">
            <DollStatBadge label="DEF" value={derived.def} shape="shield" />
            <div className="w-full border border-ink/25 bg-paper-light/80 px-2 py-2 text-center">
              <div className="font-mono text-[8px] uppercase tracking-[0.14em] text-ink-faint">
                Equipado
              </div>
              <div className="font-display text-xl">
                {equippedItems.length}
                <span className="text-sm text-ink-faint">/5</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {picker?.kind === "item" ? (
        <ItemPickerModal
          open
          slot={picker.slot}
          items={items.filter((item) => item.slot === picker.slot)}
          effects={effects}
          currentId={character.equipment[picker.slot]}
          onClose={() => setPicker(null)}
          onEquip={(itemId) => {
            onEquip?.(picker.slot, itemId);
            setPicker(null);
          }}
          onClear={() => {
            onEquip?.(picker.slot, null);
            setPicker(null);
          }}
        />
      ) : null}

      {picker?.kind === "skill" ? (
        <SkillPickerModal
          open
          index={picker.index}
          skills={skills}
          currentId={character.skills[picker.index] ?? null}
          onClose={() => setPicker(null)}
          onEquip={(skillId) => {
            onSkillChange?.(picker.index, skillId);
            setPicker(null);
          }}
          onClear={() => {
            onSkillChange?.(picker.index, null);
            setPicker(null);
          }}
        />
      ) : null}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Piezas del muñeco                                                          */
/* -------------------------------------------------------------------------- */

function EquipmentSlotButton({
  slot,
  item,
  editable,
  shape = "square",
  onClick,
}: {
  slot: EquipmentSlot;
  item: Item | null;
  editable: boolean;
  shape?: "square" | "circle";
  onClick: () => void;
}) {
  return (
    <div className="flex w-full max-w-[124px] flex-col items-center">
      <button
        type="button"
        onClick={onClick}
        disabled={!editable}
        className={cx(
          "group relative w-full overflow-hidden border-2 bg-paper-light transition-all",
          shape === "circle" ? "rounded-full" : "rounded-none",
          item ? "border-ink" : "border-dashed border-ink/40",
          editable
            ? "cursor-pointer hover:-translate-y-0.5 hover:shadow-stamp-sm"
            : "cursor-default",
        )}
        aria-label={`${EQUIPMENT_SLOT_LABELS[slot]}${item ? `: ${item.name}` : ": vacío"}`}
      >
        <div className="aspect-square w-full">
          {item?.image ? (
            <img
              src={item.image}
              alt={item.name}
              className="h-full w-full object-contain p-1"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <div className="flex flex-col items-center gap-1 text-ink-faint">
                <Icon name="cube" size={18} />
              </div>
            </div>
          )}
        </div>
        {editable ? (
          <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center border border-ink bg-paper text-ink transition-colors group-hover:bg-amber">
            <Icon name="edit" size={10} />
          </span>
        ) : null}
      </button>
      <div className="mt-1 w-full text-center">
        <div className="font-mono text-[8px] font-bold uppercase tracking-[0.12em] text-ink-faint">
          {EQUIPMENT_SLOT_LABELS[slot]}
        </div>
        <div className="truncate text-[10px] font-semibold text-ink">
          {item?.name ?? "Ninguno"}
        </div>
        <div className="truncate font-mono text-[8px] text-ink-faint">
          {item?.code ?? EQUIPMENT_SLOT_HINTS[slot]}
        </div>
      </div>
    </div>
  );
}

function SkillSlotButton({
  index,
  skill,
  editable,
  onClick,
}: {
  index: number;
  skill: Skill | null;
  editable: boolean;
  onClick: () => void;
}) {
  return (
    <div className="flex w-16 flex-col items-center sm:w-20">
      <button
        type="button"
        onClick={onClick}
        disabled={!editable}
        className={cx(
          "relative flex h-[68px] w-[62px] items-center justify-center overflow-hidden border-2 border-ink bg-paper-light pentagon transition-all sm:h-[74px] sm:w-[68px]",
          skill ? "" : "border-dashed bg-paper-deep",
          editable
            ? "cursor-pointer hover:-translate-y-0.5 hover:bg-amber/20"
            : "cursor-default",
        )}
        aria-label={`Skill ${index + 1}${skill ? `: ${skill.name}` : ": vacía"}`}
      >
        {skill?.image ? (
          <img
            src={skill.image}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <span className="font-display text-lg text-ink-faint">{index + 1}</span>
        )}
      </button>
      <div className="mt-0.5 w-full text-center">
        <div className="truncate text-[9px] font-semibold text-ink">
          {skill?.name ?? "Vacío"}
        </div>
      </div>
    </div>
  );
}

function DollStatBadge({
  label,
  value,
  shape,
}: {
  label: string;
  value: number;
  shape: "hex" | "shield";
}) {
  return (
    <div
      className={cx(
        "flex h-[68px] w-[86px] flex-col items-center justify-center border-2 border-ink",
        shape === "hex" ? "bg-ink text-paper hexagon" : "bg-steel text-paper",
      )}
      style={
        shape === "shield"
          ? { clipPath: "polygon(0 0, 100% 0, 100% 62%, 50% 100%, 0 62%)" }
          : undefined
      }
    >
      <span className="font-mono text-[9px] font-bold uppercase tracking-[0.14em]">
        {label}
      </span>
      <span className="font-display text-lg leading-tight">{value}</span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Overlays                                                                   */
/* -------------------------------------------------------------------------- */

function ItemPickerModal({
  open,
  slot,
  items,
  effects,
  currentId,
  onClose,
  onEquip,
  onClear,
}: {
  open: boolean;
  slot: EquipmentSlot;
  items: Item[];
  effects: EffectDefinition[];
  currentId: string | null;
  onClose: () => void;
  onEquip: (itemId: string) => void;
  onClear: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow={`Equipo · ${EQUIPMENT_SLOT_LABELS[slot]}`}
      title={`Elegir ${EQUIPMENT_SLOT_LABELS[slot].toLowerCase()}`}
      width="xl"
      footer={
        <>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            disabled={!currentId}
          >
            Desequipar slot
          </Button>
          <div className="flex-1" />
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancelar
          </Button>
        </>
      }
    >
      {items.length === 0 ? (
        <div className="border-2 border-dashed border-ink/30 p-8 text-center">
          <Icon name="cube" size={24} className="mx-auto text-ink-faint" />
          <p className="mt-2 text-sm text-ink-soft">
            No hay objetos desbloqueados para este slot.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => {
            const equipped = item.id === currentId;
            return (
              <div
                key={item.id}
                className={cx(
                  "flex flex-col border-2 bg-paper-light",
                  equipped ? "border-rust" : "border-ink",
                )}
              >
                <div className="relative h-44 border-b-2 border-ink bg-grid bg-paper-deep sm:aspect-[4/3] sm:h-auto">
                  {item.image ? (
                    <img
                      src={item.image}
                      alt={item.name}
                      className="h-full w-full object-contain p-2"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <div className="flex h-16 w-16 items-center justify-center border-2 border-ink bg-paper-light pentagon">
                        <span className="font-display text-lg text-ink-faint">
                          {item.name.slice(0, 2).toUpperCase()}
                        </span>
                      </div>
                    </div>
                  )}
                  {item.rarity ? (
                    <span className="absolute right-2 top-2 border border-ink bg-amber px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase tracking-[0.1em]">
                      {item.rarity}
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-1 flex-col p-2.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="display truncate text-lg">{item.name}</h3>
                    <span className="shrink-0 font-mono text-[8px] text-ink-faint">
                      {item.code ?? "—"}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 min-h-[2.2em] text-[10px] leading-snug text-ink-soft">
                    {item.description || "Sin descripción."}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {statEntries(item.stats).length > 0 ? (
                      statEntries(item.stats).map((entry) => (
                        <StatChip
                          key={entry.key}
                          label={STAT_LABELS[entry.key]}
                          value={entry.value}
                        />
                      ))
                    ) : (
                      <span className="chip opacity-60">Sin stats</span>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {item.effects?.map((ref) => {
                      const effect = effects.find(
                        (entry) => entry.id === ref.effectId,
                      );
                      return effect ? (
                        <span key={ref.effectId} className="chip chip-rust">
                          <Icon name="flame" size={9} /> {effect.name}
                        </span>
                      ) : null;
                    })}
                  </div>
                  <Button
                    type="button"
                    variant={equipped ? "ghost" : "primary"}
                    size="sm"
                    className="mt-3 w-full"
                    disabled={equipped}
                    onClick={() => onEquip(item.id)}
                  >
                    {equipped ? "Equipado" : "Equipar"}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

function SkillPickerModal({
  open,
  index,
  skills,
  currentId,
  onClose,
  onEquip,
  onClear,
}: {
  open: boolean;
  index: number;
  skills: Skill[];
  currentId: string | null;
  onClose: () => void;
  onEquip: (skillId: string) => void;
  onClear: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="Skills del jugador"
      title={`Elegir skill ${index + 1}`}
      width="lg"
      footer={
        <>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            disabled={!currentId}
          >
            Vaciar slot
          </Button>
          <div className="flex-1" />
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancelar
          </Button>
        </>
      }
    >
      {skills.length === 0 ? (
        <div className="border-2 border-dashed border-ink/30 p-8 text-center">
          <Icon name="sword" size={24} className="mx-auto text-ink-faint" />
          <p className="mt-2 text-sm text-ink-soft">
            No hay skills desbloqueadas para tu mesa.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {skills.map((skill) => {
            const equipped = skill.id === currentId;
            return (
              <div
                key={skill.id}
                className={cx(
                  "flex flex-col border-2 bg-paper-light p-3",
                  equipped ? "border-rust" : "border-ink",
                )}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="display text-lg">{skill.name}</h3>
                  <span className="font-mono text-[8px] text-ink-faint">
                    {skill.code ?? "—"}
                  </span>
                </div>
                <div className="mt-1">
                  <CoinRow coins={skill.coins} />
                </div>
                <p className="mt-1 line-clamp-2 text-[10px] leading-snug text-ink-soft">
                  {skill.description || "Sin descripción."}
                </p>
                <div className="mt-2 flex flex-wrap gap-1 font-mono text-[9px]">
                  <span className="chip">clash {skill.baseClash}+{skill.coinClash}/c</span>
                  <span className="chip">
                    daño {skill.baseDamage}
                    {signed(skill.coinDamage)}/c
                  </span>
                </div>
                <Button
                  type="button"
                  variant={equipped ? "ghost" : "primary"}
                  size="sm"
                  className="mt-3 w-full"
                  disabled={equipped}
                  onClick={() => onEquip(skill.id)}
                >
                  {equipped ? "Equipada" : "Equipar"}
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
