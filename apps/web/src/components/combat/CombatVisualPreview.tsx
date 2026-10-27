import {
  planCombatVisual,
  type CampaignContent,
  type Character,
} from "@protocol-life/shared";
import { cx } from "../ui";

/**
 * Vista previa del montaje side-view para el editor de ficha (Fase 3F).
 *
 * Usa `planCombatVisual`, exactamente la misma función que `CombatSprite`, así
 * que lo que se ve aquí es lo que se verá en combate con el equipo actual.
 */

export interface CombatVisualPreviewProps {
  character: Pick<
    Character,
    | "name"
    | "kind"
    | "visualMode"
    | "portrait"
    | "battleSprite"
    | "bodyImage"
    | "equipment"
  >;
  content: Pick<CampaignContent, "items">;
  weaponImage?: string;
  className?: string;
}

export function CombatVisualPreview({
  character,
  content,
  weaponImage,
  className,
}: CombatVisualPreviewProps) {
  const plan = planCombatVisual(character, content, { weaponImage });

  return (
    <div
      data-visual-preview
      data-visual-plan={plan.kind}
      className={cx(
        "relative flex h-56 w-full items-end justify-center overflow-hidden border-2 border-ink bg-paper/45 bg-grid",
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-x-8 bottom-3 h-3 rounded-[50%] bg-ink/15 blur-sm" />

      {plan.kind === "layered" ? (
        <div className="relative h-[92%] w-full">
          <img
            src={plan.baseImage}
            alt=""
            draggable={false}
            className="absolute inset-0 h-full w-full object-contain object-bottom"
          />
          {plan.layers.map((layer) => (
            <img
              key={layer.slot}
              src={layer.image}
              alt=""
              draggable={false}
              data-layer-slot={layer.slot}
              className="absolute inset-0 h-full w-full object-contain object-bottom"
            />
          ))}
        </div>
      ) : plan.kind === "single" ? (
        <img
          src={plan.image}
          alt=""
          draggable={false}
          className="relative h-[94%] w-full object-contain object-bottom"
        />
      ) : (
        <div className="relative mb-6 flex h-24 w-24 items-center justify-center border-2 border-ink bg-paper-light pentagon">
          <span className="font-display text-4xl text-ink-faint">
            {(character.name || "?").slice(0, 1).toUpperCase()}
          </span>
        </div>
      )}

      <span className="absolute left-1.5 top-1.5 border border-ink bg-paper-light px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase tracking-[0.12em]">
        {plan.kind === "layered"
          ? `Capas · ${plan.layers.length}`
          : plan.kind === "single"
            ? "Sprite único"
            : "Placeholder"}
      </span>
    </div>
  );
}
