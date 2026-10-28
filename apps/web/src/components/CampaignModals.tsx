import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  DEFAULT_BASE_CHARACTER_IMAGE,
  HP_PERSISTENCE_LABELS,
  TIE_RULE_LABELS,
  type Campaign,
  type CampaignSettings,
  type Ruleset,
} from "@protocol-life/shared";
import { useAppStore } from "../store/useAppStore";
import {
  Button,
  ConfirmDialog,
  Field,
  Modal,
  NumberInput,
  Select,
  TextArea,
  TextInput,
  Toggle,
} from "./ui";
import { ImageField } from "./ImageField";
import { Icon } from "./Icons";

/* -------------------------------------------------------------------------- */
/* Nueva campaña                                                              */
/* -------------------------------------------------------------------------- */

export function NewCampaignModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const createCampaign = useAppStore((state) => state.createCampaign);
  const busy = useAppStore((state) => state.busy);
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [seed, setSeed] = useState(true);
  const [baseCharacterImage, setBaseCharacterImage] = useState<string | undefined>(
    DEFAULT_BASE_CHARACTER_IMAGE,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setDescription("");
    setSeed(true);
    setBaseCharacterImage(DEFAULT_BASE_CHARACTER_IMAGE);
    setError(null);
  }, [open]);

  async function handleSubmit() {
    if (!name.trim()) {
      setError("Ponle un nombre a la campaña.");
      return;
    }
    try {
      await createCampaign({
        name: name.trim(),
        description: description.trim() || undefined,
        seed,
        settings: { baseCharacterImage: baseCharacterImage ?? "" },
      });
      onClose();
      navigate("/");
    } catch {
      // El store muestra el error.
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nueva campaña"
      eyebrow="Mesa nueva"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="accent" size="sm" icon="plus" onClick={() => void handleSubmit()} loading={busy}>
            Crear campaña
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Nombre" error={error ?? undefined}>
          <TextInput
            value={name}
            onValueChange={(value) => {
              setName(value);
              setError(null);
            }}
            placeholder="Los Incidentes de la Armada 2"
            maxLength={80}
            autoFocus
          />
        </Field>
        <Field label="Descripción" hint="Opcional. Puedes cambiarla después.">
          <TextArea
            value={description}
            onValueChange={setDescription}
            rows={3}
            maxLength={2000}
            placeholder="Una campaña sobre…"
          />
        </Field>
        <ImageField
          value={baseCharacterImage}
          onChange={setBaseCharacterImage}
          label="Imagen base de los jugadores"
          hint="Se usa en el muñeco de equipo. Ideal PNG 200×300 con transparencia; puedes subir otra o quitarla."
          shape="portrait"
        />
        <div className="border border-ui-line bg-ui-surface-2 p-3">
          <Toggle
            checked={seed}
            onCheckedChange={setSeed}
            label="Incluir contenido inicial"
            hint="7 objetos, 5 skills, 4 efectos, 4 personajes y 1 encuentro de ejemplo, todo editable."
          />
        </div>
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Editar campaña                                                             */
/* -------------------------------------------------------------------------- */

const RULE_FIELDS: Array<{
  key: keyof Ruleset;
  label: string;
  hint: string;
  min: number;
  max: number;
  step?: number;
}> = [
  {
    key: "defenseConstant",
    label: "Constante de DEF",
    hint: "Mitigación = DEF / (DEF + constante).",
    min: 1,
    max: 9999,
  },
  {
    key: "minDamage",
    label: "Daño mínimo",
    hint: "Un golpe siempre hace al menos esto.",
    min: 1,
    max: 9999,
  },
  {
    key: "maxSkillSlots",
    label: "Skill Slots máximos",
    hint: "Tope de acciones por ronda (1–6).",
    min: 1,
    max: 6,
  },
  {
    key: "fullHeadsMultiplier",
    label: "Multiplicador full heads",
    hint: "Daño ×N si todas las monedas salen caras.",
    min: 1,
    max: 20,
    step: 0.5,
  },
  {
    key: "luckCap",
    label: "Techo de suerte",
    hint: "Probabilidad máxima de cara (0–1).",
    min: 0,
    max: 1,
    step: 0.05,
  },
  {
    key: "luckFloor",
    label: "Suelo de suerte",
    hint: "Probabilidad mínima de cara (0–1).",
    min: 0,
    max: 1,
    step: 0.05,
  },
];

export function EditCampaignModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const campaign = useAppStore((state) => state.campaign);
  const updateCampaign = useAppStore((state) => state.updateCampaign);
  const deleteCampaign = useAppStore((state) => state.deleteCampaign);
  const busy = useAppStore((state) => state.busy);
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [rules, setRules] = useState<Ruleset | null>(null);
  const [settings, setSettings] = useState<CampaignSettings | null>(null);
  const [tab, setTab] = useState<"general" | "reglas" | "mesa">("general");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !campaign) return;
    setName(campaign.name);
    setDescription(campaign.description ?? "");
    setRules({ ...campaign.rules });
    setSettings({ ...campaign.settings });
    setTab("general");
    setError(null);
  }, [open, campaign]);

  if (!campaign || !rules || !settings) return null;

  function patchRules(patch: Partial<Ruleset>) {
    setRules((current) => (current ? { ...current, ...patch } : current));
  }

  function patchSettings(patch: Partial<CampaignSettings>) {
    setSettings((current) => (current ? { ...current, ...patch } : current));
  }

  async function handleSave() {
    if (!name.trim()) {
      setError("El nombre no puede estar vacío.");
      return;
    }
    try {
      const updated: Campaign = await updateCampaign({
        name: name.trim(),
        description: description.trim() || undefined,
        rules,
        settings,
      });
      if (updated) onClose();
    } catch {
      // store notifica
    }
  }

  async function handleDelete() {
    try {
      await deleteCampaign(campaignId);
      setConfirmDelete(false);
      onClose();
      navigate("/");
    } catch {
      setConfirmDelete(false);
    }
  }

  const campaignId = campaign.id;

  const tabButton = (key: typeof tab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(key)}
      className={
        tab === key
          ? "border-b border-rust px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-ui"
          : "border-b border-transparent px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-ui-faint hover:text-[color:var(--ui-text)]"
      }
    >
      {label}
    </button>
  );

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="Ajustes de campaña"
        eyebrow={campaign.name}
        width="lg"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
              Eliminar campaña
            </Button>
            <div className="flex-1" />
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancelar
            </Button>
            <Button variant="accent" size="sm" icon="save" onClick={() => void handleSave()} loading={busy}>
              Guardar
            </Button>
          </>
        }
      >
        <div className="mb-5 flex gap-1 border-b border-ui-line">
          {tabButton("general", "General")}
          {tabButton("reglas", "Reglas")}
          {tabButton("mesa", "Mesa")}
        </div>

        {tab === "general" ? (
          <div className="space-y-4">
            <Field label="Nombre" error={error ?? undefined}>
              <TextInput
                value={name}
                onValueChange={(value) => {
                  setName(value);
                  setError(null);
                }}
                maxLength={80}
              />
            </Field>
            <Field label="Descripción" hint="Se muestra en el panel de la campaña.">
              <TextArea
                value={description}
                onValueChange={setDescription}
                rows={4}
                maxLength={2000}
              />
            </Field>
            <ImageField
              value={settings.baseCharacterImage}
              onChange={(value) => patchSettings({ baseCharacterImage: value ?? "" })}
              label="Imagen base de los jugadores"
              hint="Ideal PNG 200×300 con transparencia. Se usa en el muñeco de equipo del jugador."
              shape="portrait"
            />
            <dl className="grid gap-3 border-t border-ui-line pt-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="mono-label">Creada</dt>
                <dd className="mt-1 font-mono text-xs">
                  {new Date(campaign.createdAt).toLocaleString("es-ES")}
                </dd>
              </div>
              <div>
                <dt className="mono-label">Última edición</dt>
                <dd className="mt-1 font-mono text-xs">
                  {new Date(campaign.updatedAt).toLocaleString("es-ES")}
                </dd>
              </div>
            </dl>
          </div>
        ) : null}

        {tab === "reglas" ? (
          <div className="space-y-5">
            <p className="border-l-4 border-amber bg-amber/10 px-3 py-2 text-xs leading-relaxed text-ui-muted">
              Estos parámetros se aplican al motor y a la ficha. Los cambios no se
              aplican a combates en curso (Fase 3).
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              {RULE_FIELDS.map((field) => (
                <Field key={field.key} label={field.label} hint={field.hint}>
                  <NumberInput
                    value={rules[field.key] as number}
                    onValueChange={(value) =>
                      patchRules({ [field.key]: value ?? field.min } as Partial<Ruleset>)
                    }
                    min={field.min}
                    max={field.max}
                    step={field.step ?? 1}
                  />
                </Field>
              ))}
              <Field label="Empate de clash">
                <Select
                  value={rules.tieRule}
                  onValueChange={(value) =>
                    patchRules({ tieRule: value as Ruleset["tieRule"] })
                  }
                >
                  {Object.entries(TIE_RULE_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="HP entre combates">
                <Select
                  value={rules.hpPersistence}
                  onValueChange={(value) =>
                    patchRules({ hpPersistence: value as Ruleset["hpPersistence"] })
                  }
                >
                  {Object.entries(HP_PERSISTENCE_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </div>
        ) : null}

        {tab === "mesa" ? (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Máximo de jugadores" hint="v0.1 admite hasta 6 jugadores + DM.">
                <NumberInput
                  value={settings.maxPlayers}
                  onValueChange={(value) =>
                    patchSettings({ maxPlayers: value ?? 6 })
                  }
                  min={1}
                  max={6}
                />
              </Field>
              <Field label="PIN de sala" hint="Se usará en la Fase 2 (host/join).">
                <TextInput
                  value={settings.pin ?? ""}
                  onValueChange={(value) => patchSettings({ pin: value || undefined })}
                  maxLength={12}
                  placeholder="Opcional"
                />
              </Field>
            </div>
            <div className="space-y-3 border border-ui-line bg-ui-surface-2 p-3">
              <Toggle
                checked={settings.shareLoot !== false}
                onCheckedChange={(value) => patchSettings({ shareLoot: value })}
                label="Mismos objetos para todos los jugadores"
                hint="Activado: cada jugador recibe cada objeto del botín. Desactivado: los objetos se reparten por turnos, en orden de iniciativa (serpiente)."
              />
              <Toggle
                checked={settings.allowPlayerEdit}
                onCheckedChange={(value) => patchSettings({ allowPlayerEdit: value })}
                label="Los jugadores pueden editar su ficha fuera de combate"
              />
              <Toggle
                checked={settings.allowPlayerEditDuringCombat}
                onCheckedChange={(value) =>
                  patchSettings({ allowPlayerEditDuringCombat: value })
                }
                label="Permitir editar la ficha en combate"
                hint="Recomendado: desactivado. En v0.1 nadie edita fichas en combate."
              />
              <Toggle
                checked={Boolean(settings.requirePin)}
                onCheckedChange={(value) => patchSettings({ requirePin: value })}
                label="Exigir PIN para unirse"
              />
            </div>
            <div className="border-2 border-rust/50 bg-rust/5 p-3">
              <div className="mb-1 flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-rust-deep">
                <Icon name="alert" size={14} /> Zona peligrosa
              </div>
              <p className="text-xs leading-relaxed text-ui-muted">
                Eliminar la campaña borra también sus objetos, skills, efectos,
                personajes y encuentros de SQLite. Exporta antes si quieres conservarla.
              </p>
            </div>
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={confirmDelete}
        title="Eliminar campaña"
        message={
          <>
            Vas a eliminar <strong>«{campaign.name}»</strong> y todo su contenido. Esta
            acción no se puede deshacer.
          </>
        }
        confirmLabel="Eliminar definitivamente"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void handleDelete()}
        busy={busy}
      />
    </>
  );
}
