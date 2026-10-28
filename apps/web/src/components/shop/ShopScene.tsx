import { useEffect, useMemo, useState } from "react";
import {
  CURRENCY_NAME,
  EQUIPMENT_SLOT_LABELS,
  STAT_KEYS,
  STAT_LABELS,
  type Campaign,
  type ShopScene as ShopSceneState,
  type ShopSceneItem,
  type ShopSceneSkill,
  type ShopSceneSkillInfo,
} from "@protocol-life/shared";
import { Icon } from "../Icons";
import { Button, ConfirmDialog, cx } from "../ui";
import "./ShopScene.css";

/**
 * Escena de tienda en vivo (Fase 4A-3).
 *
 * Es una vista puramente presentacional: el servidor decide si la tienda está
 * abierta, el stock, los fondos y el desbloqueo. Aquí solo se pinta el
 * escaparate, se deshabilitan las compras que ya se sabe que fallarían y se
 * confirma cada compra antes de mandar `onBuy`.
 */

export type ShopSceneViewer = { role: "dm" } | { role: "player" };

export interface ShopSceneProps {
  scene: ShopSceneState;
  campaign: Campaign;
  viewer: ShopSceneViewer;
  busy?: boolean;
  error?: string | null;
  notice?: string | null;
  /** Solo jugador: compra confirmada de un objeto. */
  onBuy?: (itemId: string) => void;
  /** Solo jugador: compra confirmada de una skill (solo la desbloquea). */
  onBuySkill?: (skillId: string) => void;
  /** Solo DM: cierra la tienda y devuelve a los jugadores a su hoja. */
  onClose?: () => void;
}

/** Compra pendiente de confirmar: un objeto o una skill. */
type PendingBuy =
  | { kind: "item"; id: string }
  | { kind: "skill"; id: string };

const VIDEO_SOURCE = /\.(mp4|webm)$/i;

/** Lista vacía estable: evita recalcular memos cuando la escena no trae skills. */
const NO_SKILLS: ShopSceneSkill[] = [];

/** Detecta vídeo por extensión, ignorando query string y hash. */
function isVideoSource(source: string | undefined): boolean {
  if (!source) return false;
  const [path = ""] = source.split(/[?#]/);
  return VIDEO_SOURCE.test(path);
}

function initialOf(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed.slice(0, 1).toUpperCase() : "?";
}

function stockLabel(stock: number | undefined): string {
  if (stock === undefined) return "∞";
  if (stock <= 0) return "Agotado";
  return String(stock);
}

function openedAtLabel(openedAt: string): string {
  const date = new Date(openedAt);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Retrato del objeto: imagen/icono o pentágono con la inicial. */
function ItemArt({ item }: { item: ShopSceneItem["item"] }) {
  const source = item.image ?? item.icon;
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    setBroken(false);
  }, [source]);

  return (
    <div className="shop-item-art" aria-hidden="true">
      {source && !broken ? (
        <img src={source} alt="" onError={() => setBroken(true)} />
      ) : (
        <span className="shop-item-initial">{initialOf(item.name)}</span>
      )}
    </div>
  );
}

/** Solo las stats presentes en el objeto, en el orden canónico del juego. */
function ItemStats({ stats }: { stats: ShopSceneItem["item"]["stats"] }) {
  if (!stats) return null;
  const present = STAT_KEYS.filter((key) => stats[key] !== undefined);
  if (present.length === 0) return null;

  return (
    <ul className="shop-item-stats" aria-label="Stats del objeto">
      {present.map((key) => {
        const value = stats[key];
        if (value === undefined) return null;
        return (
          <li key={key}>
            <span>{STAT_LABELS[key]}</span>
            <b>{value > 0 ? `+${value}` : value}</b>
          </li>
        );
      })}
    </ul>
  );
}

/** Retrato de la skill: imagen si la tiene; si no, el icono de espada. */
function SkillArt({ skill }: { skill: ShopSceneSkillInfo }) {
  const source = skill.image;
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    setBroken(false);
  }, [source]);

  return (
    <div
      className="shop-item-art shop-item-art--skill"
      aria-hidden="true"
      title={skill.name}
    >
      {source && !broken ? (
        <img src={source} alt="" onError={() => setBroken(true)} />
      ) : (
        <Icon name="sword" size={22} />
      )}
    </div>
  );
}

/** Chips de la skill: monedas y los valores base de choque y daño. */
function SkillStats({ skill }: { skill: ShopSceneSkillInfo }) {
  return (
    <ul className="shop-item-stats" aria-label="Stats de la skill">
      <li>
        <span>Monedas</span>
        <b>{skill.coins}</b>
      </li>
      <li>
        <span>Clash</span>
        <b>{skill.baseClash}</b>
        <span>+{skill.coinClash}/cara</span>
      </li>
      <li>
        <span>Daño</span>
        <b>{skill.baseDamage}</b>
        <span>+{skill.coinDamage}/cara</span>
      </li>
    </ul>
  );
}

export function ShopScene({
  scene,
  campaign,
  viewer,
  busy = false,
  error = null,
  notice = null,
  onBuy,
  onBuySkill,
  onClose,
}: ShopSceneProps) {
  const [backgroundFailed, setBackgroundFailed] = useState(false);
  const [pending, setPending] = useState<PendingBuy | null>(null);

  const background = scene.background?.trim() || undefined;
  const video = isVideoSource(background);
  const wallet = campaign.wallet.cleanShards;
  const isDm = viewer.role === "dm";
  // El servidor manda siempre el array; `?? []` cubre escenas de clientes
  // antiguos o snapshots sin la propiedad.
  const skills = scene.skills ?? NO_SKILLS;

  useEffect(() => {
    setBackgroundFailed(false);
  }, [background]);

  // Si la escena cambia bajo el diálogo (compra en otra pestaña, cierre del
  // DM…), el producto pendiente se recalcula y el diálogo se cierra solo.
  useEffect(() => {
    setPending(null);
  }, [scene.shopId]);

  const stats = useMemo(() => {
    const availableIn = (
      entries: Array<{ unlocked: boolean; stock?: number }>,
    ): number =>
      entries.filter(
        (entry) =>
          !entry.unlocked && (entry.stock === undefined || entry.stock > 0),
      ).length;
    const unlockedIn = (
      entries: Array<{ unlocked: boolean }>,
    ): number => entries.filter((entry) => entry.unlocked).length;

    return {
      items: scene.items.length,
      skills: skills.length,
      total: scene.items.length + skills.length,
      available: availableIn(scene.items) + availableIn(skills),
      unlocked: unlockedIn(scene.items) + unlockedIn(skills),
    };
  }, [scene.items, skills]);

  const pendingEntry = useMemo(() => {
    if (!pending) return null;
    if (pending.kind === "item") {
      const entry = scene.items.find((candidate) => candidate.item.id === pending.id);
      return entry ? { kind: "item" as const, entry } : null;
    }
    const entry = skills.find((candidate) => candidate.skill.id === pending.id);
    return entry ? { kind: "skill" as const, entry } : null;
  }, [pending, scene.items, skills]);

  function itemCanBuy(entry: ShopSceneItem): boolean {
    if (viewer.role !== "player" || !onBuy || busy) return false;
    if (entry.unlocked) return false;
    if (entry.stock !== undefined && entry.stock <= 0) return false;
    return wallet >= entry.price;
  }

  function skillCanBuy(entry: ShopSceneSkill): boolean {
    if (viewer.role !== "player" || !onBuySkill || busy) return false;
    if (entry.unlocked) return false;
    if (entry.stock !== undefined && entry.stock <= 0) return false;
    return wallet >= entry.price;
  }

  function requestBuyItem(entry: ShopSceneItem) {
    if (!itemCanBuy(entry)) return;
    setPending({ kind: "item", id: entry.item.id });
  }

  function requestBuySkill(entry: ShopSceneSkill) {
    if (!skillCanBuy(entry)) return;
    setPending({ kind: "skill", id: entry.skill.id });
  }

  function confirmBuy() {
    const current = pendingEntry;
    if (!current) return;
    setPending(null);
    if (current.kind === "item") {
      onBuy?.(current.entry.item.id);
    } else {
      onBuySkill?.(current.entry.skill.id);
    }
  }

  const stageLead = isDm
    ? "La sala ve esta tienda en vivo. Los jugadores compran por confirmación; al cerrar, cada uno vuelve a su hoja."
    : "Compra lo que la party necesite. Cada compra paga el precio de la bolsa y desbloquea el objeto o la skill para toda la campaña.";

  return (
    <div className="shop-scene-frame">
      <section
        className="shop-scene"
        data-viewer={viewer.role}
        aria-label={`Tienda: ${scene.name}`}
      >
        <div className="shop-scene-bg" aria-hidden="true">
          <div className="shop-scene-fallback" />
          {background && !backgroundFailed ? (
            video ? (
              <video
                className="shop-scene-media"
                src={background}
                autoPlay
                loop
                muted
                playsInline
                preload="auto"
                onError={() => setBackgroundFailed(true)}
              />
            ) : (
              <img
                className="shop-scene-media"
                src={background}
                alt=""
                onError={() => setBackgroundFailed(true)}
              />
            )
          ) : null}
        </div>
        <div className="shop-scene-vignette" aria-hidden="true" />

        <div className="shop-scene-content">
          <header className="shop-scene-head">
            <div className="shop-scene-id">
              <div className="shop-scene-kicker">
                <Icon name={isDm ? "broadcast" : "book"} size={12} />
                {isDm ? "Tienda en la mesa" : "Tienda abierta"}
              </div>
              <h2 className="shop-scene-name">{scene.name}</h2>
              {scene.description ? (
                <p className="shop-scene-desc">{scene.description}</p>
              ) : (
                <p className="shop-scene-desc shop-scene-desc--empty">
                  Un puesto improvisado en mitad de la campaña.
                </p>
              )}
            </div>

            <div className="shop-scene-tools">
              <div
                className="shop-wallet"
                aria-label={`Bolsa de la party: ${wallet} ${CURRENCY_NAME}`}
              >
                <span className="shop-wallet-label">Bolsa de la party</span>
                <span className="shop-wallet-value">
                  <b className="text-ui-gold">{wallet}</b>
                  <span>{CURRENCY_NAME}</span>
                </span>
              </div>
              {isDm ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  icon="lock"
                  disabled={busy || !onClose}
                  onClick={onClose}
                  className="shop-close-btn"
                >
                  Cerrar tienda
                </Button>
              ) : (
                <span className="shop-player-note">
                  <Icon name="users" size={12} />
                  El DM cerrará la tienda para volver a tu hoja
                </span>
              )}
            </div>
          </header>

          {error ? (
            <div role="alert" className="shop-banner shop-banner--error">
              <Icon name="alert" size={15} className="shrink-0" />
              <p>{error}</p>
            </div>
          ) : null}
          {notice ? (
            <div role="status" className="shop-banner shop-banner--ok">
              <Icon name="shield" size={15} className="shrink-0" />
              <p>{notice}</p>
            </div>
          ) : null}

          <div className="shop-scene-body">
            <div className="shop-scene-stage">
              <div className="shop-stage-sign" aria-hidden="true">
                <span>{initialOf(scene.name)}</span>
              </div>
              <div className="shop-stage-copy">
                <div className="shop-stage-kicker">
                  <span className="shop-stage-rule" />
                  Escaparate
                </div>
                <p className="shop-stage-lead">{stageLead}</p>
                <div className="shop-stage-meta">
                  <span className="shop-meta-chip">
                    <span>Productos</span>
                    <b>{String(stats.total).padStart(2, "0")}</b>
                  </span>
                  <span className="shop-meta-chip">
                    <span>Disponibles</span>
                    <b>{String(stats.available).padStart(2, "0")}</b>
                  </span>
                  <span className="shop-meta-chip">
                    <span>Desbloqueados</span>
                    <b>{String(stats.unlocked).padStart(2, "0")}</b>
                  </span>
                  <span className="shop-meta-chip shop-meta-chip--time">
                    <span>Abierta</span>
                    <b>{openedAtLabel(scene.openedAt)}</b>
                  </span>
                </div>
                <p className="shop-stage-foot">
                  {isDm
                    ? "Solo el DM ve este control. Los objetos y las skills comprados quedan desbloqueados en la biblioteca de la campaña."
                    : "Comprar no añade nada a tu inventario: el objeto o la skill quedan desbloqueados para toda la campaña. Las skills no se equipan solas."}
                </p>
              </div>
            </div>

            <aside
              className="shop-list"
              aria-label={`Productos a la venta en ${scene.name}`}
            >
              <div className="shop-list-head">
                <div>
                  <div className="shop-list-kicker">A la venta</div>
                  <h3 className="shop-list-title">Productos</h3>
                </div>
                <span className="shop-list-count tnum">
                  {String(stats.total).padStart(2, "0")}
                </span>
              </div>

              {stats.total === 0 ? (
                <div className="shop-list-empty">
                  <div className="shop-list-empty-mark" aria-hidden="true">
                    <Icon name="cube" size={22} />
                  </div>
                  <p className="shop-list-empty-title">El puesto está vacío</p>
                  <p className="shop-list-empty-copy">
                    El DM todavía no ha puesto objetos ni skills a la venta en
                    esta tienda.
                  </p>
                </div>
              ) : (
                <div className="shop-list-scroll">
                  {scene.items.length > 0 ? (
                    <section
                      className="shop-list-section"
                      aria-label="Objetos a la venta"
                    >
                      <div className="shop-list-section-head">
                        <h4>Objetos</h4>
                        <span className="tnum">
                          {String(stats.items).padStart(2, "0")}
                        </span>
                      </div>

                      {scene.items.map((entry) => {
                        const soldOut =
                          entry.stock !== undefined && entry.stock <= 0;
                        const canBuy = itemCanBuy(entry);
                        const noFunds =
                          viewer.role === "player" &&
                          !entry.unlocked &&
                          !soldOut &&
                          wallet < entry.price;

                        return (
                          <article
                            key={entry.item.id}
                            className={cx(
                              "shop-item",
                              entry.unlocked && "is-unlocked",
                              soldOut && "is-sold-out",
                              canBuy && "is-buyable",
                            )}
                            onClick={
                              canBuy ? () => requestBuyItem(entry) : undefined
                            }
                          >
                            <ItemArt item={entry.item} />

                            <div className="shop-item-body">
                              <div className="shop-item-heading">
                                <h4 className="shop-item-name">
                                  {entry.item.name}
                                </h4>
                                {entry.item.code ? (
                                  <span className="shop-item-code">
                                    {entry.item.code}
                                  </span>
                                ) : null}
                              </div>

                              <div className="shop-item-chips">
                                <span className="chip">
                                  {EQUIPMENT_SLOT_LABELS[entry.item.slot]}
                                </span>
                                {entry.item.rarity ? (
                                  <span className="chip shop-chip-rarity">
                                    {entry.item.rarity}
                                  </span>
                                ) : null}
                                {entry.unlocked ? (
                                  <span className="chip shop-chip-unlocked">
                                    <Icon name="unlock" size={9} />
                                    Ya desbloqueado
                                  </span>
                                ) : null}
                              </div>

                              <ItemStats stats={entry.item.stats} />

                              {entry.item.description ? (
                                <p className="shop-item-desc">
                                  {entry.item.description}
                                </p>
                              ) : null}

                              <div className="shop-item-foot">
                                <div className="shop-item-price text-ui-gold">
                                  <span className="shop-item-price-value">
                                    {entry.price}
                                  </span>
                                  <span className="shop-item-price-unit">
                                    {CURRENCY_NAME}
                                  </span>
                                </div>

                                <div className="shop-item-stock">
                                  <span>Stock</span>
                                  <b
                                    className={cx(
                                      soldOut && "shop-item-stock--out",
                                      entry.stock === undefined &&
                                        "shop-item-stock--inf",
                                    )}
                                  >
                                    {stockLabel(entry.stock)}
                                  </b>
                                </div>

                                {viewer.role === "player" ? (
                                  entry.unlocked ? null : soldOut ? (
                                    <span className="shop-item-status shop-item-status--out">
                                      Agotado
                                    </span>
                                  ) : (
                                    <div className="shop-item-action">
                                      {noFunds ? (
                                        <span className="shop-item-warning">
                                          Sin fondos
                                        </span>
                                      ) : null}
                                      <Button
                                        type="button"
                                        variant="accent"
                                        size="sm"
                                        disabled={busy || noFunds || !onBuy}
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          requestBuyItem(entry);
                                        }}
                                      >
                                        Comprar
                                      </Button>
                                    </div>
                                  )
                                ) : null}
                              </div>
                            </div>
                          </article>
                        );
                      })}
                    </section>
                  ) : null}

                  {skills.length > 0 ? (
                    <section
                      className="shop-list-section"
                      aria-label="Skills a la venta"
                    >
                      <div className="shop-list-section-head">
                        <h4>Skills</h4>
                        <span className="tnum">
                          {String(stats.skills).padStart(2, "0")}
                        </span>
                      </div>

                      {skills.map((entry) => {
                        const soldOut =
                          entry.stock !== undefined && entry.stock <= 0;
                        const canBuy = skillCanBuy(entry);
                        const noFunds =
                          viewer.role === "player" &&
                          !entry.unlocked &&
                          !soldOut &&
                          wallet < entry.price;

                        return (
                          <article
                            key={entry.skill.id}
                            className={cx(
                              "shop-item",
                              "shop-item--skill",
                              entry.unlocked && "is-unlocked",
                              soldOut && "is-sold-out",
                              canBuy && "is-buyable",
                            )}
                            onClick={
                              canBuy ? () => requestBuySkill(entry) : undefined
                            }
                          >
                            <SkillArt skill={entry.skill} />

                            <div className="shop-item-body">
                              <div className="shop-item-heading">
                                <h4 className="shop-item-name">
                                  {entry.skill.name}
                                </h4>
                                {entry.skill.code ? (
                                  <span className="shop-item-code">
                                    {entry.skill.code}
                                  </span>
                                ) : null}
                              </div>

                              <div className="shop-item-chips">
                                <span className="chip shop-chip-skill">
                                  <Icon name="sword" size={9} />
                                  Skill
                                </span>
                                {entry.skill.tags?.map((tag) => (
                                  <span key={tag} className="chip">
                                    {tag}
                                  </span>
                                ))}
                                {entry.unlocked ? (
                                  <span className="chip shop-chip-unlocked">
                                    <Icon name="unlock" size={9} />
                                    Ya desbloqueada
                                  </span>
                                ) : null}
                              </div>

                              <SkillStats skill={entry.skill} />

                              {entry.skill.description ? (
                                <p className="shop-item-desc">
                                  {entry.skill.description}
                                </p>
                              ) : null}

                              <div className="shop-item-foot">
                                <div className="shop-item-price text-ui-gold">
                                  <span className="shop-item-price-value">
                                    {entry.price}
                                  </span>
                                  <span className="shop-item-price-unit">
                                    {CURRENCY_NAME}
                                  </span>
                                </div>

                                <div className="shop-item-stock">
                                  <span>Stock</span>
                                  <b
                                    className={cx(
                                      soldOut && "shop-item-stock--out",
                                      entry.stock === undefined &&
                                        "shop-item-stock--inf",
                                    )}
                                  >
                                    {stockLabel(entry.stock)}
                                  </b>
                                </div>

                                {viewer.role === "player" ? (
                                  entry.unlocked ? null : soldOut ? (
                                    <span className="shop-item-status shop-item-status--out">
                                      Agotado
                                    </span>
                                  ) : (
                                    <div className="shop-item-action">
                                      {noFunds ? (
                                        <span className="shop-item-warning">
                                          Sin fondos
                                        </span>
                                      ) : null}
                                      <Button
                                        type="button"
                                        variant="accent"
                                        size="sm"
                                        disabled={
                                          busy || noFunds || !onBuySkill
                                        }
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          requestBuySkill(entry);
                                        }}
                                      >
                                        Comprar
                                      </Button>
                                    </div>
                                  )
                                ) : null}
                              </div>
                            </div>
                          </article>
                        );
                      })}
                    </section>
                  ) : null}
                </div>
              )}

              <p className="shop-list-foot">
                {isDm
                  ? "La escena es la misma que ven los jugadores. Sin botones de compra."
                  : "Confirma cada compra. El stock y la bolsa se actualizan al instante; las skills compradas no se equipan solas."}
              </p>
            </aside>
          </div>
        </div>

        <ConfirmDialog
          open={Boolean(pendingEntry)}
          title={
            pendingEntry?.kind === "skill" ? "Comprar skill" : "Comprar objeto"
          }
          message={
            pendingEntry ? (
              <>
                <p>
                  ¿Comprar{" "}
                  <strong>
                    «
                    {pendingEntry.kind === "item"
                      ? pendingEntry.entry.item.name
                      : pendingEntry.entry.skill.name}
                    »
                  </strong>{" "}
                  por{" "}
                  <strong>
                    {pendingEntry.entry.price} {CURRENCY_NAME}
                  </strong>
                  ?
                </p>
                <p className="shop-confirm-note">
                  {pendingEntry.kind === "skill"
                    ? "La compra descuenta la bolsa común y desbloquea la skill para toda la campaña. No se equipa automáticamente en ninguna ficha."
                    : "La compra descuenta la bolsa común y desbloquea el objeto para toda la campaña. No entra en el inventario de tu ficha."}
                </p>
              </>
            ) : (
              ""
            )
          }
          confirmLabel="Sí"
          cancelLabel="No"
          onCancel={() => setPending(null)}
          onConfirm={confirmBuy}
          busy={busy}
        />
      </section>
    </div>
  );
}
