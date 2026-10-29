import {
  planCombatVisual,
  type CampaignContent,
  type CombatUnit,
} from "@protocol-life/shared";
import { cx } from "../ui";

/**
 * Renderer side-view híbrido (DECISION-SIDE-VIEW.md).
 *
 * - `layered` + `bodyImage`: cuerpo + capas leg → armor → horns → hand.
 * - Si falta `bodyImage`, cae a `battleSprite` → `portrait` → placeholder.
 * - `weaponImage` sustituye temporalmente la capa de mano.
 * - `backImage`/`frontImage` de la skill activa se pintan detrás/delante.
 * - La utilidad no se dibuja en el cuerpo.
 *
 * La composición la decide `planCombatVisual`, compartida con la vista previa
 * del editor de ficha (Fase 3F) para que nunca diverjan.
 */

export interface CombatSpriteProps {
  unit: CombatUnit;
  content: Pick<CampaignContent, "items">;
  /** Imagen del arma de la skill activa; reemplaza la capa de mano. */
  weaponImage?: string;
  /** Capa de la skill activa que va detrás del personaje. */
  backImage?: string;
  /** Capa de la skill activa que va delante del personaje. */
  frontImage?: string;
  active?: boolean;
  className?: string;
}

export function CombatSprite({
  unit,
  content,
  weaponImage,
  backImage,
  frontImage,
  active = false,
  className,
}: CombatSpriteProps) {
  const plan = planCombatVisual(unit, content, {
    weaponImage,
    backImage,
    frontImage,
  });

  return (
    <div
      data-combat-sprite
      data-visual-mode={plan.kind === "layered" ? "layered" : "portrait"}
      aria-label={`Sprite de ${unit.name}`}
      className={cx(
        "relative flex h-40 w-full items-end justify-center overflow-hidden border-2 sm:h-52",
        active
          ? "border-amber bg-amber/10"
          : "border-ui-line bg-ui-surface-2 bg-grid",
        unit.defeated && "grayscale",
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-x-6 bottom-3 h-3 rounded-[50%] bg-black/35 blur-sm" />

      {plan.kind === "layered" ? (
        <div className="relative h-[92%] w-full" data-layer-count={plan.layers.length}>
          {plan.backImage ? (
            <img
              src={plan.backImage}
              alt=""
              draggable={false}
              loading="lazy"
              data-skill-layer="back"
              className="absolute inset-0 h-full w-full object-contain object-bottom"
            />
          ) : null}
          <img
            src={plan.baseImage}
            alt=""
            draggable={false}
            loading="lazy"
            className="absolute inset-0 h-full w-full object-contain object-bottom"
          />
          {plan.layers.map((layer) => (
            <img
              key={layer.slot}
              src={layer.image}
              alt=""
              draggable={false}
              loading="lazy"
              data-layer-slot={layer.slot}
              className="absolute inset-0 h-full w-full object-contain object-bottom"
            />
          ))}
          {plan.frontImage ? (
            <img
              src={plan.frontImage}
              alt=""
              draggable={false}
              loading="lazy"
              data-skill-layer="front"
              className="absolute inset-0 h-full w-full object-contain object-bottom"
            />
          ) : null}
        </div>
      ) : plan.kind === "single" ? (
        <div className="relative h-[94%] w-full">
          {plan.backImage ? (
            <img
              src={plan.backImage}
              alt=""
              draggable={false}
              loading="lazy"
              data-skill-layer="back"
              className="absolute inset-0 h-full w-full object-contain object-bottom"
            />
          ) : null}
          <img
            src={plan.image}
            alt={unit.name}
            draggable={false}
            loading="lazy"
            className="absolute inset-0 h-full w-full object-contain object-bottom"
          />
          {plan.frontImage ? (
            <img
              src={plan.frontImage}
              alt=""
              draggable={false}
              loading="lazy"
              data-skill-layer="front"
              className="absolute inset-0 h-full w-full object-contain object-bottom"
            />
          ) : null}
        </div>
      ) : (
        <div className="relative mb-4 flex h-24 w-24 items-center justify-center border border-ui-line-strong bg-ui-surface-2 pentagon sm:h-28 sm:w-28">
          <span className="font-display text-4xl text-ui-faint">
            {unit.name.slice(0, 1).toUpperCase()}
          </span>
        </div>
      )}

      {unit.defeated ? (
        <div className="absolute inset-0 flex items-center justify-center bg-black/55">
          <span className="border border-ui-line-strong bg-ui-surface-3 px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-ui">
            Derrotado
          </span>
        </div>
      ) : null}

      {active && !unit.defeated ? (
        <span className="absolute left-1.5 top-1.5 border border-ui-line-strong bg-amber px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase tracking-[0.14em]">
          Actuando
        </span>
      ) : null}
    </div>
  );
}
