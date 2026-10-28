import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  CURRENCY_NAME,
  shopInputSchema,
  type Shop,
} from "@protocol-life/shared";
import { api } from "../lib/api";
import { describeError, useAppStore } from "../store/useAppStore";
import { Icon } from "../components/Icons";
import { ImageField } from "../components/ImageField";
import {
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  LinkButton,
  NumberInput,
  PageHeader,
  Select,
  TextArea,
  TextInput,
} from "../components/ui";

interface ShopItemDraft {
  /** Clave local estable: el `itemId` puede repetirse mientras se edita. */
  key: string;
  itemId: string;
  price: number | undefined;
  stock: number | undefined;
}

interface ShopSkillDraft {
  /** Clave local estable: el `skillId` puede repetirse mientras se edita. */
  key: string;
  skillId: string;
  price: number | undefined;
  stock: number | undefined;
}

interface ShopDraft {
  name: string;
  description: string;
  /** Fondo de la escena: imagen, GIF o URL de vídeo (mp4/webm). */
  background: string;
  items: ShopItemDraft[];
  skills: ShopSkillDraft[];
}

let rowSequence = 0;
function newRowKey(): string {
  rowSequence += 1;
  return `shop-row-${rowSequence}`;
}

function emptyDraft(): ShopDraft {
  return { name: "", description: "", background: "", items: [], skills: [] };
}

function draftFromShop(shop: Shop): ShopDraft {
  return {
    name: shop.name,
    description: shop.description ?? "",
    background: shop.background ?? "",
    items: shop.items.map((entry) => ({
      key: newRowKey(),
      itemId: entry.itemId,
      price: entry.price,
      stock: entry.stock,
    })),
    skills: (shop.skills ?? []).map((entry) => ({
      key: newRowKey(),
      skillId: entry.skillId,
      price: entry.price,
      stock: entry.stock,
    })),
  };
}

function stockLabel(stock: number | undefined): string {
  if (stock === undefined) return "∞";
  if (stock === 0) return "Agotado";
  return `×${stock}`;
}

export function ShopEditorPage() {
  const { shopId } = useParams();
  const campaign = useAppStore((state) => state.campaign);
  const refreshCampaign = useAppStore((state) => state.refreshCampaign);
  const notify = useAppStore((state) => state.notify);
  const navigate = useNavigate();

  const existing = useMemo(
    () =>
      shopId && campaign
        ? (campaign.content.shops.find((shop) => shop.id === shopId) ?? null)
        : null,
    [shopId, campaign],
  );

  const [draft, setDraft] = useState<ShopDraft>(() =>
    existing ? draftFromShop(existing) : emptyDraft(),
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!campaign) return;
    setDraft(existing ? draftFromShop(existing) : emptyDraft());
    setErrors([]);
    // Solo al cambiar de tienda o de campaña; no en cada guardado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId, campaign?.id]);

  if (!campaign) return null;

  if (shopId && !existing) {
    return (
      <div className="animate-rise">
        <PageHeader
          eyebrow="Tiendas"
          title="Tienda no encontrada"
          back={{ to: "/shops", label: "Volver a tiendas" }}
        />
        <EmptyState
          icon="book"
          title="Esa tienda no existe"
          description="Puede que se haya eliminado en otra pestaña o que el enlace esté mal."
          action={
            <LinkButton to="/shops" size="sm" icon="arrow-left">
              Volver a tiendas
            </LinkButton>
          }
        />
      </div>
    );
  }

  const catalog = campaign.content.items;
  const skillCatalog = campaign.content.skills;
  const campaignId = campaign.id;
  const itemName = (itemId: string): string =>
    catalog.find((item) => item.id === itemId)?.name ?? "Objeto no disponible";
  const skillName = (skillId: string): string =>
    skillCatalog.find((skill) => skill.id === skillId)?.name ??
    "Skill no disponible";

  function patch(update: Partial<ShopDraft>) {
    setDraft((current) => ({ ...current, ...update }));
  }

  function patchRow(key: string, update: Partial<ShopItemDraft>) {
    setDraft((current) => ({
      ...current,
      items: current.items.map((row) =>
        row.key === key ? { ...row, ...update } : row,
      ),
    }));
  }

  function patchSkillRow(key: string, update: Partial<ShopSkillDraft>) {
    setDraft((current) => ({
      ...current,
      skills: current.skills.map((row) =>
        row.key === key ? { ...row, ...update } : row,
      ),
    }));
  }

  function addRow() {
    const used = new Set(draft.items.map((row) => row.itemId));
    const next = catalog.find((item) => !used.has(item.id));
    setDraft((current) => ({
      ...current,
      items: [
        ...current.items,
        {
          key: newRowKey(),
          itemId: next?.id ?? "",
          price: undefined,
          stock: undefined,
        },
      ],
    }));
  }

  function addSkillRow() {
    const used = new Set(draft.skills.map((row) => row.skillId));
    const next = skillCatalog.find((skill) => !used.has(skill.id));
    setDraft((current) => ({
      ...current,
      skills: [
        ...current.skills,
        {
          key: newRowKey(),
          skillId: next?.id ?? "",
          price: undefined,
          stock: undefined,
        },
      ],
    }));
  }

  function removeRow(key: string) {
    setDraft((current) => ({
      ...current,
      items: current.items.filter((row) => row.key !== key),
    }));
  }

  function removeSkillRow(key: string) {
    setDraft((current) => ({
      ...current,
      skills: current.skills.filter((row) => row.key !== key),
    }));
  }

  function buildPayload() {
    return {
      name: draft.name.trim(),
      // Cadena vacía explícita: un PATCH sin `description` conservaría la vieja.
      description: draft.description.trim(),
      background: draft.background.trim(),
      items: draft.items.map((row) => ({
        itemId: row.itemId,
        price: row.price ?? 0,
        stock: row.stock,
      })),
      // Siempre presente (aunque sea []): el PATCH borra las skills viejas.
      skills: draft.skills.map((row) => ({
        skillId: row.skillId,
        price: row.price ?? 0,
        stock: row.stock,
      })),
    };
  }

  function validate(): string[] {
    const parsed = shopInputSchema.safeParse(buildPayload());
    const issues: string[] = parsed.success
      ? []
      : parsed.error.issues.map((issue) => issue.message);

    const seen = new Set<string>();
    draft.items.forEach((row, index) => {
      if (!row.itemId) {
        issues.push(`Fila ${index + 1}: elige un objeto.`);
        return;
      }
      if (seen.has(row.itemId)) {
        issues.push(
          `El objeto «${itemName(row.itemId)}» está repetido en la tienda.`,
        );
      }
      seen.add(row.itemId);
    });

    const seenSkills = new Set<string>();
    draft.skills.forEach((row, index) => {
      if (!row.skillId) {
        issues.push(`Skill ${index + 1}: elige una skill.`);
        return;
      }
      if (seenSkills.has(row.skillId)) {
        issues.push(
          `La skill «${skillName(row.skillId)}» está repetida en la tienda.`,
        );
      }
      seenSkills.add(row.skillId);
    });

    return Array.from(new Set(issues));
  }

  async function handleSave() {
    const parsed = shopInputSchema.safeParse(buildPayload());
    const issues = validate();
    if (!parsed.success || issues.length > 0) {
      setErrors(issues.length > 0 ? issues : ["Revisa el formulario."]);
      return;
    }
    setErrors([]);
    setSaving(true);
    try {
      if (shopId) {
        await api.updateShop(campaignId, shopId, parsed.data);
        notify("ok", `«${parsed.data.name}» actualizada.`);
      } else {
        await api.createShop(campaignId, parsed.data);
        notify(
          "ok",
          `«${parsed.data.name}» creada. Ábrela desde Tiendas o desde la mesa.`,
        );
      }
      await refreshCampaign();
      navigate("/shops");
    } catch (error) {
      notify("error", describeError(error));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!shopId) return;
    setDeleting(true);
    try {
      await api.deleteShop(campaignId, shopId);
      await refreshCampaign();
      notify("ok", `«${draft.name || "Tienda"}» eliminada.`);
      setConfirmDelete(false);
      navigate("/shops");
    } catch (error) {
      notify("error", describeError(error));
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  // La vista previa suma objetos y skills: mismo precio/stock en ambos tipos.
  const previewRows = [...draft.items, ...draft.skills];
  const previewTotal = previewRows.reduce(
    (sum, row) => sum + (row.stock ?? 0),
    0,
  );
  const previewUnlimited = previewRows.some((row) => row.stock === undefined);
  const previewStock = previewUnlimited ? "∞" : String(previewTotal);
  const previewCount = draft.items.length + draft.skills.length;
  const busy = saving || deleting;

  return (
    <div className="animate-rise">
      <PageHeader
        eyebrow={shopId ? "Editar tienda" : "Nueva tienda"}
        title={shopId ? draft.name || "Tienda" : "Nueva tienda"}
        description={`Elige qué objetos y skills vende la tienda y a qué precio en ${CURRENCY_NAME}. Después ábrela en la mesa: la sala verá la escena en vivo y comprará con la bolsa común.`}
        back={{ to: "/shops", label: "Volver a tiendas" }}
        actions={
          <>
            {shopId ? (
              <Button
                variant="ghost"
                size="sm"
                icon="trash"
                disabled={busy}
                onClick={() => setConfirmDelete(true)}
              >
                Eliminar tienda
              </Button>
            ) : null}
            <Button
              variant="accent"
              size="sm"
              icon="save"
              loading={saving}
              onClick={() => void handleSave()}
            >
              Guardar tienda
            </Button>
          </>
        }
      />

      {errors.length > 0 ? (
        <div className="mb-4 border border-rust bg-rust/10 p-3">
          <div className="mb-1 flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-ui-danger">
            <Icon name="alert" size={14} /> Revisa la tienda
          </div>
          <ul className="list-inside list-disc text-xs text-ui-danger">
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          <section className="panel p-4">
            <h2 className="mb-4 border-b border-ui-line pb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
              01 · Identidad
            </h2>
            <div className="grid gap-4">
              <Field label="Nombre de la tienda" hint="Es lo que ven los jugadores en su mesa.">
                <TextInput
                  value={draft.name}
                  onValueChange={(value) => patch({ name: value })}
                  placeholder="Mercado de las Cenizas"
                  maxLength={80}
                />
              </Field>
              <Field label="Descripción">
                <TextArea
                  value={draft.description}
                  onValueChange={(value) => patch({ description: value })}
                  rows={3}
                  maxLength={2000}
                  placeholder="Qué vende, quién lo atiende, qué se rumorea…"
                />
              </Field>
              <div className="border border-ui-line bg-ui-surface-2 p-3">
                <ImageField
                  value={draft.background || undefined}
                  onChange={(value) => patch({ background: value ?? "" })}
                  label="Fondo de la escena"
                  hint="Sube una imagen o GIF (máx. 5 MB) o pega una URL. También admite una URL de vídeo .mp4/.webm: la escena lo reproduce en bucle."
                />
              </div>
            </div>
          </section>

          <section className="panel p-4">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 border-b border-ui-line pb-2">
              <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
                02 · Objetos a la venta
              </h2>
              <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-ui-faint">
                {draft.items.length} fila{draft.items.length === 1 ? "" : "s"}
              </span>
            </div>

            {catalog.length === 0 ? (
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border border-dashed border-ui-line p-3">
                <p className="text-xs text-ui-muted">
                  La biblioteca de objetos está vacía. Crea un objeto para poder
                  venderlo.
                </p>
                <LinkButton to="/items/new" variant="ghost" size="sm" icon="plus">
                  Nuevo objeto
                </LinkButton>
              </div>
            ) : null}

            {draft.items.length === 0 ? (
              <p className="mb-3 border border-dashed border-ui-line p-3 text-xs text-ui-muted">
                Esta tienda todavía no vende objetos. Añade al menos uno con su
                precio, o vende solo skills en la sección siguiente.
              </p>
            ) : (
              <div className="space-y-2">
                {draft.items.map((row, index) => (
                  <div
                    key={row.key}
                    className="border border-ui-line bg-ui-surface-2 p-3"
                  >
                    <div className="grid items-end gap-2 sm:grid-cols-[minmax(0,1fr)_110px_110px_auto]">
                      <Field label={`Objeto ${index + 1}`}>
                        <Select
                          value={row.itemId}
                          onValueChange={(value) =>
                            patchRow(row.key, { itemId: value })
                          }
                          aria-label={`Objeto de la fila ${index + 1}`}
                        >
                          <option value="">— Elige un objeto —</option>
                          {catalog.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name}
                              {/* El sufijo marca lo que ya está desbloqueado:
                                  no se puede volver a comprar. */}
                              {item.unlocked === true
                                ? " (ya desbloqueado)"
                                : ""}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Precio">
                        <NumberInput
                          value={row.price}
                          onValueChange={(value) =>
                            patchRow(row.key, { price: value })
                          }
                          min={0}
                          max={9_999_999}
                          placeholder="0"
                        />
                      </Field>
                      <Field label="Stock">
                        <NumberInput
                          value={row.stock}
                          onValueChange={(value) =>
                            patchRow(row.key, { stock: value })
                          }
                          min={0}
                          max={9999}
                          placeholder="∞"
                        />
                      </Field>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        icon="trash"
                        aria-label={`Quitar objeto de la fila ${index + 1}`}
                        onClick={() => removeRow(row.key)}
                      >
                        Quitar
                      </Button>
                    </div>
                    <p className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-ui-faint">
                      {row.itemId
                        ? `${itemName(row.itemId)} · ${row.price ?? 0} ${CURRENCY_NAME} · stock ${stockLabel(row.stock)}`
                        : "Sin objeto seleccionado"}
                    </p>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                icon="plus"
                disabled={catalog.length === 0}
                onClick={addRow}
              >
                Añadir objeto
              </Button>
              <span className="text-[10px] leading-snug text-ui-faint">
                Stock vacío = infinito · 0 = agotado. No repitas el mismo objeto en
                una tienda.
              </span>
            </div>
          </section>

          <section className="panel p-4">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 border-b border-ui-line pb-2">
              <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
                03 · Skills a la venta
              </h2>
              <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-ui-faint">
                {draft.skills.length} fila{draft.skills.length === 1 ? "" : "s"}
              </span>
            </div>

            {skillCatalog.length === 0 ? (
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border border-dashed border-ui-line p-3">
                <p className="text-xs text-ui-muted">
                  La biblioteca de skills está vacía. Crea una skill para poder
                  venderla.
                </p>
                <LinkButton to="/skills/new" variant="ghost" size="sm" icon="plus">
                  Nueva skill
                </LinkButton>
              </div>
            ) : null}

            {draft.skills.length === 0 ? (
              <p className="mb-3 border border-dashed border-ui-line p-3 text-xs text-ui-muted">
                Esta tienda todavía no vende skills. Añade al menos una con su
                precio.
              </p>
            ) : (
              <div className="space-y-2">
                {draft.skills.map((row, index) => (
                  <div
                    key={row.key}
                    className="border border-ui-line bg-ui-surface-2 p-3"
                  >
                    <div className="grid items-end gap-2 sm:grid-cols-[minmax(0,1fr)_110px_110px_auto]">
                      <Field label={`Skill ${index + 1}`}>
                        <Select
                          value={row.skillId}
                          onValueChange={(value) =>
                            patchSkillRow(row.key, { skillId: value })
                          }
                          aria-label={`Skill de la fila ${index + 1}`}
                        >
                          <option value="">— Elige una skill —</option>
                          {skillCatalog.map((skill) => (
                            <option key={skill.id} value={skill.id}>
                              {skill.name}
                              {/* Igual que en objetos: el sufijo avisa de lo
                                  que ya está desbloqueado (no se puede comprar). */}
                              {skill.unlocked === true
                                ? " (ya desbloqueada)"
                                : ""}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Precio">
                        <NumberInput
                          value={row.price}
                          onValueChange={(value) =>
                            patchSkillRow(row.key, { price: value })
                          }
                          min={0}
                          max={9_999_999}
                          placeholder="0"
                        />
                      </Field>
                      <Field label="Stock">
                        <NumberInput
                          value={row.stock}
                          onValueChange={(value) =>
                            patchSkillRow(row.key, { stock: value })
                          }
                          min={0}
                          max={9999}
                          placeholder="∞"
                        />
                      </Field>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        icon="trash"
                        aria-label={`Quitar skill de la fila ${index + 1}`}
                        onClick={() => removeSkillRow(row.key)}
                      >
                        Quitar
                      </Button>
                    </div>
                    <p className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-ui-faint">
                      {row.skillId
                        ? `${skillName(row.skillId)} · ${row.price ?? 0} ${CURRENCY_NAME} · stock ${stockLabel(row.stock)}`
                        : "Sin skill seleccionada"}
                    </p>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                icon="plus"
                disabled={skillCatalog.length === 0}
                onClick={addSkillRow}
              >
                Añadir skill
              </Button>
              <span className="text-[10px] leading-snug text-ui-faint">
                Stock vacío = infinito · 0 = agotado. No repitas la misma skill en
                una tienda.
              </span>
            </div>
            <p className="mt-2 text-[10px] leading-snug text-ui-faint">
              Comprar una skill la desbloquea para la campaña; no se equipa
              automáticamente.
            </p>
          </section>
        </div>

        <aside className="space-y-4">
          <div className="sticky top-6 space-y-4">
            <div className="panel overflow-hidden">
              <div className="border-b border-ui-line bg-ui-surface-3 px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.18em]">
                Vista previa
              </div>
              <div className="space-y-3 p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="display min-w-0 truncate text-xl">
                    {draft.name || "Sin nombre"}
                  </h3>
                  <span className="chip shrink-0 text-ui-faint">
                    {draft.background ? "Con fondo" : "Sin fondo"}
                  </span>
                </div>
                <p className="text-[11px] leading-snug text-ui-muted">
                  {draft.description || "Sin descripción."}
                </p>

                <div className="border-t border-ui-line pt-2">
                  {previewCount === 0 ? (
                    <p className="py-2 text-center text-[11px] text-ui-faint">
                      Sin productos a la venta.
                    </p>
                  ) : (
                    <ul className="space-y-1.5">
                      {draft.items.map((row) => (
                        <li
                          key={row.key}
                          className="flex items-baseline justify-between gap-2 border-b border-ui-line pb-1 last:border-b-0 last:pb-0"
                        >
                          <span className="min-w-0 truncate text-xs font-semibold">
                            {row.itemId
                              ? itemName(row.itemId)
                              : "Sin objeto seleccionado"}
                          </span>
                          <span className="tnum shrink-0 font-mono text-[10px] text-ui-muted">
                            {row.price ?? 0} {CURRENCY_NAME} · {stockLabel(row.stock)}
                          </span>
                        </li>
                      ))}
                      {draft.skills.map((row) => (
                        <li
                          key={row.key}
                          className="flex items-baseline justify-between gap-2 border-b border-ui-line pb-1 last:border-b-0 last:pb-0"
                        >
                          <span className="flex min-w-0 items-center gap-1 text-xs font-semibold">
                            <Icon
                              name="sword"
                              size={10}
                              className="shrink-0 text-ui-faint"
                            />
                            <span className="min-w-0 truncate">
                              {row.skillId
                                ? skillName(row.skillId)
                                : "Sin skill seleccionada"}
                            </span>
                          </span>
                          <span className="tnum shrink-0 font-mono text-[10px] text-ui-muted">
                            {row.price ?? 0} {CURRENCY_NAME} · {stockLabel(row.stock)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="flex items-center justify-between border-t border-ui-line pt-2 font-mono text-[9px] uppercase tracking-[0.12em] text-ui-faint">
                  <span>{previewCount} productos</span>
                  <span className="tnum">Stock total {previewStock}</span>
                </div>
              </div>
            </div>

            <div className="border border-ui-line p-3">
              <div className="mono-label mb-1">ID interno</div>
              <code className="block break-all font-mono text-[10px] text-ui-muted">
                {existing?.id ?? "Se genera al guardar"}
              </code>
              <p className="mt-2 text-[10px] leading-snug text-ui-faint">
                Abrirla es una acción en vivo desde Tiendas o desde la mesa del
                DM; no se guarda en la ficha.
              </p>
            </div>

            <div className="border border-dashed border-ui-line p-3 text-[11px] leading-relaxed text-ui-muted">
              <strong className="font-mono text-[9px] uppercase tracking-[0.14em]">
                Recuerda
              </strong>
              <p className="mt-1">
                Los objetos y skills <strong>ya desbloqueados</strong> no se
                pueden comprar: aparecen marcados en los selectores. Los
                bloqueados son los que la party desbloquea al comprarlos. Las
                skills compradas no se equipan solas.
              </p>
            </div>
          </div>
        </aside>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Eliminar tienda"
        message={
          <>
            Vas a eliminar <strong>«{draft.name || "esta tienda"}»</strong>. Los
            objetos y skills que la party ya compró siguen desbloqueados en la
            campaña.
          </>
        }
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void handleDelete()}
        busy={deleting}
      />
    </div>
  );
}
