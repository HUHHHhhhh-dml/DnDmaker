import {
  planCombatVisual,
  type CampaignContent,
  type Character,
} from "@protocol-life/shared";
import { cx } from "./ui";

/**
 * Retrato derivado del personaje visual.
 *
 * Usa la misma composición que la escena de combate (`planCombatVisual`):
 * cuerpo base + equipo por capas. Si la ficha no tiene cuerpo base (o su modo
 * visual es `portrait`), cae a `battleSprite` → `portrait` → inicial.
 *
 * Ocupa todo su contenedor, así que el padre debe ser `relative` y tener
 * tamaño (alto fijo o `min-h`). La imagen de retrato subida se conserva en los
 * datos como respaldo para campañas antiguas y fichas sin capas; no se borra.
 */
export interface CharacterPortraitProps {
  character: Character;
  content: Pick<CampaignContent, "items">;
  className?: string;
  /** Clases extra para la inicial cuando no hay ninguna imagen. */
  placeholderClassName?: string;
}

export function CharacterPortrait({
  character,
  content,
  className,
  placeholderClassName,
}: CharacterPortraitProps) {
  const plan = planCombatVisual(character, content);

  return (
    <span
      className={cx("absolute inset-0 block", className)}
      data-portrait-mode={plan.kind}
    >
      {plan.kind === "layered" ? (
        <>
          <img
            src={plan.baseImage}
            alt={character.name}
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
              data-portrait-layer={layer.slot}
              className="absolute inset-0 h-full w-full object-contain object-bottom"
            />
          ))}
        </>
      ) : plan.kind === "single" ? (
        <img
          src={plan.image}
          alt={character.name}
          draggable={false}
          loading="lazy"
          className="absolute inset-0 h-full w-full object-contain object-bottom"
        />
      ) : (
        <span
          className={cx(
            "flex h-full w-full items-center justify-center font-display text-ui-faint",
            placeholderClassName,
          )}
        >
          {(character.name || "?").slice(0, 1).toUpperCase()}
        </span>
      )}
    </span>
  );
}
