import type { SVGProps } from "react";

export type IconName =
  | "grid"
  | "cube"
  | "sword"
  | "flame"
  | "users"
  | "skull"
  | "plus"
  | "download"
  | "upload"
  | "trash"
  | "edit"
  | "arrow-left"
  | "save"
  | "close"
  | "image"
  | "search"
  | "chevron-down"
  | "spark"
  | "book"
  | "shield"
  | "menu"
  | "alert";

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 18, ...props }: IconProps) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    ...props,
  };

  switch (name) {
    case "grid":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" />
        </svg>
      );
    case "cube":
      return (
        <svg {...common}>
          <path d="M21 7.5 12 2 3 7.5v9L12 22l9-5.5v-9Z" />
          <path d="M3 7.5 12 13l9-5.5" />
          <path d="M12 22v-9" />
        </svg>
      );
    case "sword":
      return (
        <svg {...common}>
          <path d="M14.5 17.5 3 6V3h3l11.5 11.5" />
          <path d="m13 19 6-6" />
          <path d="m16 16 5 5" />
          <path d="m19 21 2-2" />
        </svg>
      );
    case "flame":
      return (
        <svg {...common}>
          <path d="M12 22c4 0 7-2.7 7-6.5 0-3-1.7-5.5-4-8-1.5-1.6-2.5-3.2-3-5.5-1 2.5-2 4-3.5 5.8C6 10 5 12.3 5 15.5 5 19.3 8 22 12 22Z" />
          <path d="M12 18c1.7 0 3-1.1 3-2.8 0-1.2-.7-2.2-1.7-3.2-.6-.7-1-1.4-1.3-2.3-.4 1-.8 1.7-1.4 2.4-.8 1-1.6 1.9-1.6 3.1C9 16.9 10.3 18 12 18Z" />
        </svg>
      );
    case "users":
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="3.5" />
          <path d="M2.5 21c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
          <path d="M16 4.5a3.5 3.5 0 0 1 0 7" />
          <path d="M18 15c2.2.7 3.5 2.7 3.5 6" />
        </svg>
      );
    case "skull":
      return (
        <svg {...common}>
          <path d="M5 10a7 7 0 1 1 14 0v2.5c0 1.4-.8 2.4-2 3v2.5c0 .8-.7 1.5-1.5 1.5h-7c-.8 0-1.5-.7-1.5-1.5v-2.5c-1.2-.6-2-1.6-2-3V10Z" />
          <circle cx="9" cy="10" r="1.4" fill="currentColor" stroke="none" />
          <circle cx="15" cy="10" r="1.4" fill="currentColor" stroke="none" />
          <path d="M10 15.5h4" />
        </svg>
      );
    case "plus":
      return (
        <svg {...common}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case "download":
      return (
        <svg {...common}>
          <path d="M12 3v12" />
          <path d="m7 10 5 5 5-5" />
          <path d="M4 21h16" />
        </svg>
      );
    case "upload":
      return (
        <svg {...common}>
          <path d="M12 15V3" />
          <path d="m7 8 5-5 5 5" />
          <path d="M4 21h16" />
        </svg>
      );
    case "trash":
      return (
        <svg {...common}>
          <path d="M4 7h16" />
          <path d="M9 7V4h6v3" />
          <path d="m6 7 1 14h10l1-14" />
          <path d="M10 11v6M14 11v6" />
        </svg>
      );
    case "edit":
      return (
        <svg {...common}>
          <path d="m14 4 6 6" />
          <path d="M4 20h4L20 8l-4-4L4 16v4Z" />
        </svg>
      );
    case "arrow-left":
      return (
        <svg {...common}>
          <path d="M20 12H4" />
          <path d="m10 6-6 6 6 6" />
        </svg>
      );
    case "save":
      return (
        <svg {...common}>
          <path d="M4 3h13l3 3v15H4V3Z" />
          <path d="M8 3v6h8V3" />
          <path d="M8 21v-7h8v7" />
        </svg>
      );
    case "close":
      return (
        <svg {...common}>
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      );
    case "image":
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="16" />
          <circle cx="9" cy="10" r="2" />
          <path d="m21 16-5-5-9 9" />
        </svg>
      );
    case "search":
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="6" />
          <path d="m20 20-4-4" />
        </svg>
      );
    case "chevron-down":
      return (
        <svg {...common}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      );
    case "spark":
      return (
        <svg {...common}>
          <path d="M12 2v5M12 17v5M2 12h5M17 12h5" />
          <path d="m5 5 3 3M16 16l3 3M19 5l-3 3M8 16l-3 3" />
        </svg>
      );
    case "book":
      return (
        <svg {...common}>
          <path d="M4 4h7a3 3 0 0 1 3 3v14a3 3 0 0 0-3-3H4V4Z" />
          <path d="M20 4h-3a3 3 0 0 0-3 3v14a3 3 0 0 1 3-3h3V4Z" />
        </svg>
      );
    case "shield":
      return (
        <svg {...common}>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      );
    case "menu":
      return (
        <svg {...common}>
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      );
    case "alert":
      return (
        <svg {...common}>
          <path d="M12 3 2 21h20L12 3Z" />
          <path d="M12 9v5M12 18h.01" />
        </svg>
      );
  }
}
