import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { Icon } from "./Icons";
import { Button, Field, Spinner, TextInput, cx } from "./ui";

export function ImageField({
  value,
  onChange,
  label = "Imagen",
  hint = "Sube un archivo local (PNG, JPG, WEBP o GIF, máx. 5 MB) o pega una URL.",
  shape = "square",
}: {
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  label?: string;
  hint?: string;
  shape?: "square" | "portrait";
}) {
  const uploadImage = useAppStore((state) => state.uploadImage);
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    setBroken(false);
  }, [value]);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadImage(file);
      onChange(url);
    } catch {
      // El store ya mostró el error.
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <Field label={label} hint={hint}>
      <div className="flex items-start gap-3">
        <div
          className={cx(
            "relative flex shrink-0 items-center justify-center overflow-hidden border-2 border-ink bg-paper-deep",
            shape === "portrait" ? "h-24 w-20" : "h-24 w-24",
          )}
        >
          {value && !broken ? (
            <img
              src={value}
              alt=""
              className="h-full w-full object-contain p-1"
              onError={() => setBroken(true)}
            />
          ) : (
            <Icon name="image" size={26} className="text-ink-faint" />
          )}
          {shape === "portrait" ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2 bg-rust" />
          ) : null}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <TextInput
            value={value ?? ""}
            onValueChange={(next) => onChange(next.trim() === "" ? undefined : next)}
            placeholder="https://… o /uploads/…"
          />
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={(event) => void handleFile(event.target.files?.[0])}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon="upload"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? "Subiendo…" : "Subir archivo"}
            </Button>
            {value ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onChange(undefined)}
              >
                Quitar
              </Button>
            ) : null}
            {uploading ? <Spinner size={14} /> : null}
            {broken ? (
              <span className="text-[11px] font-semibold text-rust">
                La imagen no carga.
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </Field>
  );
}
