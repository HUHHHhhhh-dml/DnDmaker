import type { DiceSides } from "@protocol-life/shared";
import { cx } from "../ui";

/**
 * Iconos de línea de los dados de la mesa, en el mismo lenguaje que la imagen
 * de referencia (d20, d12, d100, d10, d8, d6, d4).
 */
export function DiceIcon({
  sides,
  size = 24,
  className,
}: {
  sides: DiceSides;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      className={cx("dice-icon", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {sides === 20 ? (
        <>
          <polygon points="24,3 42,13 42,35 24,45 6,35 6,13" />
          <polygon points="24,13 36,20 31,35 17,35 12,20" />
          <path d="M24 3v10M42 13l-6 7M42 35l-11 0M24 45v-10M6 35l11 0M6 13l6 7" />
        </>
      ) : null}
      {sides === 12 ? (
        <>
          <circle cx="24" cy="24" r="20" />
          <polygon points="24,7 39,18 33,36 15,36 9,18" />
          <path d="M24 7v11M39 18l-6 6M33 36l-9-7M15 36l9-7M9 18l6 6" />
        </>
      ) : null}
      {sides === 100 ? (
        <>
          <polygon points="17,5 30,20 17,42 4,20" />
          <polygon points="31,6 44,21 31,43 18,21" />
          <path d="M17 5v37M31 6v37" />
        </>
      ) : null}
      {sides === 10 ? (
        <>
          <polygon points="24,4 41,23 24,44 7,23" />
          <path d="M24 4v40M7 23h34" />
        </>
      ) : null}
      {sides === 8 ? (
        <>
          <polygon points="24,4 41,24 24,44 7,24" />
          <path d="M24 4v40M7 24l17 6 17-6" />
        </>
      ) : null}
      {sides === 6 ? (
        <>
          <polygon points="24,5 41,14 41,34 24,43 7,34 7,14" />
          <path d="M7 14l17 9 17-9M24 23v20" />
        </>
      ) : null}
      {sides === 4 ? (
        <>
          <polygon points="24,5 43,41 5,41" />
          <path d="M24 5v26M5 41l19-10 19 10" />
        </>
      ) : null}
    </svg>
  );
}
