import {
  useEffect,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { Icon, type IconName } from "./Icons";

export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

/* -------------------------------------------------------------------------- */
/* Botones                                                                    */
/* -------------------------------------------------------------------------- */

const BUTTON_VARIANTS = {
  primary: "btn-primary",
  accent: "btn-accent",
  ghost: "btn-ghost",
  "dark-ghost": "btn-dark-ghost",
} as const;

type ButtonVariant = keyof typeof BUTTON_VARIANTS;
type ButtonSize = "md" | "sm";

function buttonClass(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  className?: string,
): string {
  return cx("btn", BUTTON_VARIANTS[variant], size === "sm" && "btn-sm", className);
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: IconName;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  icon,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClass(variant, size, className)}
    >
      {loading ? <Spinner size={14} /> : icon ? <Icon name={icon} size={size === "sm" ? 14 : 16} /> : null}
      {children}
    </button>
  );
}

export function LinkButton({
  to,
  variant = "primary",
  size = "md",
  icon,
  children,
  className,
}: {
  to: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link to={to} className={buttonClass(variant, size, className)}>
      {icon ? <Icon name={icon} size={size === "sm" ? 14 : 16} /> : null}
      {children}
    </Link>
  );
}

export function Spinner({ size = 18 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-block animate-spin rounded-full border-2 border-current border-t-transparent align-middle"
      style={{ width: size, height: size }}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Formularios                                                                */
/* -------------------------------------------------------------------------- */

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  className,
}: {
  label?: string;
  hint?: string;
  error?: string;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      {label ? (
        <label className="field-label" htmlFor={htmlFor}>
          {label}
        </label>
      ) : null}
      {children}
      {error ? (
        <span role="alert" className="mt-1 block text-[11px] font-semibold text-ui-danger">
          {error}
        </span>
      ) : hint ? (
        <span className="field-hint">{hint}</span>
      ) : null}
    </div>
  );
}

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> {
  value: string;
  onValueChange: (value: string) => void;
}

export function TextInput({ value, onValueChange, className, ...props }: InputProps) {
  return (
    <input
      {...props}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
      className={cx("field", className)}
    />
  );
}

export function TextArea({
  value,
  onValueChange,
  rows = 3,
  className,
  ...props
}: {
  value: string;
  onValueChange: (value: string) => void;
  rows?: number;
  className?: string;
  placeholder?: string;
  maxLength?: number;
}) {
  return (
    <textarea
      {...props}
      rows={rows}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
      className={cx("field resize-y", className)}
    />
  );
}

export function NumberInput({
  value,
  onValueChange,
  min,
  max,
  step = 1,
  placeholder = "0",
  className,
  disabled,
  id,
}: {
  value: number | undefined;
  onValueChange: (value: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <input
      id={id}
      type="number"
      inputMode="numeric"
      value={value === undefined || Number.isNaN(value) ? "" : value}
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(event) => {
        const raw = event.target.value;
        if (raw === "") {
          onValueChange(undefined);
          return;
        }
        const parsed = Number(raw);
        onValueChange(Number.isNaN(parsed) ? undefined : parsed);
      }}
      className={cx("field tnum font-mono", className)}
    />
  );
}

export function Select({
  value,
  onValueChange,
  children,
  className,
  ...props
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, "onChange" | "value"> & {
  value: string;
  onValueChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <select
      {...props}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
      className={cx("field cursor-pointer appearance-none pr-8", className)}
    >
      {children}
    </select>
  );
}

export function Toggle({
  checked,
  onCheckedChange,
  label,
  hint,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onCheckedChange(!checked)}
        className={cx(
          "mt-0.5 flex h-6 w-11 shrink-0 items-center border p-0.5 transition-colors",
          checked
            ? "border-ui-accent bg-ui-accent"
            : "border-ui-line-strong bg-ui-surface-3",
        )}
      >
        <span
          className={cx(
            "block h-4 w-4 transition-transform",
            checked ? "bg-ui" : "bg-ui-muted",
            checked && "translate-x-5",
          )}
        />
      </button>
      <span>
        <span className="block text-sm font-semibold text-ui">{label}</span>
        {hint ? <span className="field-hint">{hint}</span> : null}
      </span>
    </label>
  );
}

/* -------------------------------------------------------------------------- */
/* Estructura                                                                 */
/* -------------------------------------------------------------------------- */

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  back,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { to: string; label: string };
}) {
  return (
    <header className="mb-7 animate-rise">
      {back ? (
        <Link
          to={back.to}
          className="mb-4 inline-flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-ui-muted transition-colors hover:text-amber"
        >
          <Icon name="arrow-left" size={14} />
          {back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          {eyebrow ? (
            <div className="mono-label mb-2 flex items-center gap-2">
              <span className="inline-block h-2 w-2 bg-ui-accent" />
              {eyebrow}
            </div>
          ) : null}
          <h1 className="display text-4xl text-ui sm:text-5xl">{title}</h1>
          {description ? (
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ui-muted">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

export function SectionTitle({
  title,
  action,
  count,
}: {
  title: string;
  action?: ReactNode;
  count?: number;
}) {
  return (
    <div className="mb-4 flex items-baseline justify-between gap-3 border-b border-ui-line-strong pb-2">
      <h2 className="flex items-baseline gap-2 font-ui text-[11px] font-bold uppercase tracking-[0.16em] text-ui">
        {title}
        {typeof count === "number" ? (
          <span className="tnum text-ui-faint">/{String(count).padStart(2, "0")}</span>
        ) : null}
      </h2>
      {action}
    </div>
  );
}

export function EmptyState({
  icon = "cube",
  title,
  description,
  action,
}: {
  icon?: IconName;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="panel flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="pentagon mb-4 flex h-16 w-16 items-center justify-center border border-ui-line-strong bg-ui-surface-3 text-ui-accent">
        <Icon name={icon} size={26} />
      </div>
      <h3 className="display text-xl text-ui">{title}</h3>
      {description ? (
        <p className="mt-2 max-w-md text-sm text-ui-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

export function LoadingBlock({ label = "Cargando…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 border border-dashed border-ui-line-strong px-6 py-20 text-ui-muted">
      <Spinner />
      <span className="font-mono text-[11px] uppercase tracking-[0.2em]">{label}</span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Modal / confirmación                                                       */
/* -------------------------------------------------------------------------- */

export function Modal({
  open,
  onClose,
  title,
  eyebrow,
  children,
  footer,
  width = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  eyebrow?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: "sm" | "md" | "lg" | "xl";
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  const maxWidth =
    width === "sm" ? "max-w-md" : width === "lg" ? "max-w-3xl" : width === "xl" ? "max-w-5xl" : "max-w-xl";

  return createPortal(
    <div className="modal-scrim fixed inset-0 z-50 flex items-end justify-center overflow-y-auto p-3 sm:items-center sm:p-6">
      <button
        type="button"
        aria-label="Cerrar"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx("modal-panel relative z-10 w-full animate-rise", maxWidth)}
      >
        <div className="modal-head flex items-start justify-between gap-4 px-5 py-4">
          <div>
            {eyebrow ? <div className="mono-label mb-1">{eyebrow}</div> : null}
            <h2 className="display text-2xl text-ui">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="icon-btn"
            aria-label="Cerrar"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-5">{children}</div>
        {footer ? (
          <div className="modal-foot flex flex-wrap justify-end gap-2 px-5 py-4">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Eliminar",
  cancelLabel = "Cancelar",
  onConfirm,
  onCancel,
  busy,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      eyebrow="Confirmación"
      width="sm"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant="accent" size="sm" onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center border border-ui-line bg-ui-surface-3 text-ui-warn">
          <Icon name="alert" size={20} />
        </div>
        <div className="text-sm leading-relaxed text-ui-muted">{message}</div>
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Piezas de datos                                                            */
/* -------------------------------------------------------------------------- */

export function StatChip({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: number | string;
  muted?: boolean;
}) {
  const numeric = typeof value === "number" ? value : Number.NaN;
  const tone = Number.isNaN(numeric)
    ? ""
    : numeric > 0
      ? "text-ui-ok"
      : numeric < 0
        ? "text-ui-danger"
        : "text-ui-faint";
  return (
    <span className={cx("chip", muted && "opacity-70")}>
      <span className="text-ui-faint">{label}</span>
      <span className={cx("tnum font-bold", tone)}>
        {typeof value === "number" && value > 0 ? `+${value}` : value}
      </span>
    </span>
  );
}

export function TagList({ tags, max = 6 }: { tags?: string[]; max?: number }) {
  if (!tags?.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {tags.slice(0, max).map((tag) => (
        <span key={tag} className="chip">
          {tag}
        </span>
      ))}
      {tags.length > max ? <span className="chip">+{tags.length - max}</span> : null}
    </div>
  );
}

const NOTICE_TONES = {
  error: {
    box: "border-[rgba(226,121,108,0.6)]",
    icon: "text-ui-danger" as const,
    name: "alert" as const,
  },
  ok: {
    box: "border-[rgba(159,188,140,0.6)]",
    icon: "text-ui-ok" as const,
    name: "shield" as const,
  },
  info: {
    box: "border-[rgba(143,182,207,0.6)]",
    icon: "text-ui-info" as const,
    name: "spark" as const,
  },
};

export function NoticeBar({
  notice,
  onClose,
}: {
  notice: { kind: "ok" | "error" | "info"; message: string } | null;
  onClose: () => void;
}) {
  if (!notice) return null;
  const tone = NOTICE_TONES[notice.kind];
  return createPortal(
    <div className="fixed inset-x-3 bottom-3 z-[60] flex justify-center sm:inset-x-auto sm:right-6 sm:bottom-6">
      <div
        role="status"
        className={cx(
          "flex w-full max-w-md items-start gap-3 border bg-ui-surface-2 px-4 py-3 text-ui shadow-[0_18px_44px_rgba(0,0,0,0.5)] animate-rise",
          tone.box,
        )}
      >
        <Icon name={tone.name} size={18} className={cx("mt-0.5 shrink-0", tone.icon)} />
        <p className="flex-1 text-sm font-semibold leading-snug">{notice.message}</p>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 text-ui-muted transition-colors hover:text-[color:var(--ui-text)]"
          aria-label="Cerrar aviso"
        >
          <Icon name="close" size={14} />
        </button>
      </div>
    </div>,
    document.body,
  );
}
