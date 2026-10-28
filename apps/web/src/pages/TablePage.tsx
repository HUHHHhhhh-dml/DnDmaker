import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import {
  SESSION_STATUS_LABELS,
  calculateStats,
  type PublicSessionPlayer,
} from "@protocol-life/shared";
import { useAppStore } from "../store/useAppStore";
import { useLiveStore } from "../store/useLiveStore";
import { api } from "../lib/api";
import { Icon } from "../components/Icons";
import { CombatResultPanel } from "../components/combat/CombatResultPanel";
import { DmCombatConsole } from "../components/combat/DmCombatConsole";
import {
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  LinkButton,
  PageHeader,
  SectionTitle,
  Select,
  TextInput,
  Toggle,
  cx,
} from "../components/ui";

export function TablePage() {
  const campaign = useAppStore((state) => state.campaign);
  const busy = useAppStore((state) => state.busy);
  const notify = useAppStore((state) => state.notify);

  const session = useLiveStore((state) => state.session);
  const code = useLiveStore((state) => state.code);
  const connected = useLiveStore((state) => state.connected);
  const loadingLive = useLiveStore((state) => state.loading);
  const liveError = useLiveStore((state) => state.error);
  const host = useLiveStore((state) => state.host);
  const closeSession = useLiveStore((state) => state.close);
  const combat = useLiveStore((state) => state.combat);
  const recentCombat = useLiveStore((state) => state.recentCombat);
  const combatError = useLiveStore((state) => state.combatError);
  const clearCombatError = useLiveStore((state) => state.clearCombatError);
  const startCombat = useLiveStore((state) => state.startCombat);
  const dismissRecentCombat = useLiveStore((state) => state.dismissRecentCombat);
  const restParty = useAppStore((state) => state.restParty);

  const [requirePin, setRequirePin] = useState(
    campaign?.settings.requirePin ?? false,
  );
  const [pin, setPin] = useState(campaign?.settings.pin ?? "");
  const [lanIps, setLanIps] = useState<string[]>([]);
  const [pinError, setPinError] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmRest, setConfirmRest] = useState(false);
  const [selectedEncounterId, setSelectedEncounterId] = useState("");

  useEffect(() => {
    if (!campaign) return;
    setRequirePin(campaign.settings.requirePin ?? false);
    setPin(campaign.settings.pin ?? "");
  }, [campaign?.id, campaign?.settings.requirePin, campaign?.settings.pin]);

  useEffect(() => {
    void api
      .getNetwork()
      .then((result) => setLanIps(result.lanIps))
      .catch(() => setLanIps([]));
  }, []);

  const encounterIds = (campaign?.content.encounters ?? [])
    .map((encounter) => encounter.id)
    .join("|");
  useEffect(() => {
    const ids = encounterIds ? encounterIds.split("|") : [];
    setSelectedEncounterId((current) =>
      current && ids.includes(current) ? current : (ids[0] ?? ""),
    );
  }, [encounterIds]);

  const joinUrl = useMemo(() => {
    if (!code) return "";
    const url = new URL(window.location.origin);
    const currentHost = url.hostname;
    const isLocal =
      currentHost === "localhost" ||
      currentHost === "127.0.0.1" ||
      currentHost === "::1" ||
      currentHost === "[::1]";
    if (isLocal && lanIps[0]) url.hostname = lanIps[0];
    url.pathname = `/join/${code}`;
    url.search = "";
    url.hash = "";
    return url.toString();
  }, [code, lanIps]);

  if (!campaign) return null;

  const activeCampaign = campaign;
  const players = session?.players ?? [];

  async function copyText(value: string, label: string) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      notify("ok", `${label} copiado.`);
    } catch {
      try {
        const area = document.createElement("textarea");
        area.value = value;
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.append(area);
        area.select();
        document.execCommand("copy");
        area.remove();
        notify("ok", `${label} copiado.`);
      } catch {
        notify("error", "No se pudo copiar. Selecciona el texto a mano.");
      }
    }
  }

  function generatePin() {
    const next = String(Math.floor(1000 + Math.random() * 9000));
    setPin(next);
    setRequirePin(true);
    setPinError(null);
  }

  async function handleHost() {
    if (requirePin && pin.trim().length < 4) {
      setPinError("El PIN debe tener al menos 4 caracteres.");
      return;
    }
    setPinError(null);
    try {
      await host(activeCampaign.id, {
        requirePin,
        pin: pin.trim(),
      });
    } catch {
      // Los stores ya muestran el error.
    }
  }

  async function handleClose() {
    await closeSession();
    setConfirmClose(false);
  }

  function handleStartCombat() {
    if (!selectedEncounterId) return;
    startCombat(selectedEncounterId);
  }

  async function handleRestParty() {
    try {
      await restParty();
    } catch {
      // El store ya notificó el error (por ejemplo, combate en curso).
    } finally {
      setConfirmRest(false);
    }
  }

  function playerStats(player: PublicSessionPlayer) {
    if (!player.characterId) return null;
    const character = activeCampaign.content.characters.find(
      (entry) => entry.id === player.characterId,
    );
    if (!character) return null;
    const derived = calculateStats(
      character,
      activeCampaign.content,
      activeCampaign.rules,
    );
    return { character, stats: derived.stats };
  }

  return (
    <div className="animate-rise">
      <PageHeader
        eyebrow="Mesa en vivo · Fase 2"
        title="La mesa"
        description="Abre la sala, comparte el link y el PIN por la WiFi local. Las fichas se actualizan en vivo mientras el DM y los jugadores editan."
        actions={
          session ? (
            <>
              <span
                className={cx(
                  "inline-flex items-center gap-2 border border-ui-line-strong px-2.5 py-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.14em]",
                  connected ? "bg-moss/15 text-ui-ok" : "bg-amber/20 text-ui",
                )}
              >
                <span
                  className={cx(
                    "h-1.5 w-1.5 rounded-full",
                    connected ? "bg-moss" : "bg-amber",
                  )}
                />
                {connected ? "DM conectado" : "Conectando…"}
              </span>
              <Button
                variant="ghost"
                size="sm"
                icon="close"
                onClick={() => setConfirmClose(true)}
              >
                Cerrar sala
              </Button>
            </>
          ) : (
            <LinkButton to="/" variant="ghost" size="sm">
              Volver al panel
            </LinkButton>
          )
        }
      />

      {liveError ? (
        <div className="mb-4 border-2 border-rust bg-rust/10 p-3 text-sm text-ui-danger">
          <div className="mb-1 flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.16em]">
            <Icon name="alert" size={14} /> Aviso de la mesa
          </div>
          {liveError}
        </div>
      ) : null}

      {combatError && !combat ? (
        <div className="mb-4 flex items-start gap-2 border-2 border-rust bg-rust/10 p-3 text-ui-danger">
          <Icon name="alert" size={15} className="mt-0.5 shrink-0" />
          <p className="min-w-0 flex-1 text-xs font-semibold leading-relaxed">
            {combatError}
          </p>
          <button
            type="button"
            onClick={clearCombatError}
            className="shrink-0 font-mono text-[9px] font-bold uppercase tracking-[0.12em] underline"
          >
            Cerrar
          </button>
        </div>
      ) : null}

      {!session ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section className="panel p-5">
            <div className="mono-label mb-2 flex items-center gap-2">
              <span className="h-2 w-2 bg-rust" />
              Abrir sala
            </div>
            <h2 className="display text-3xl">Conecta a tu mesa</h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-ui-muted">
              Al abrir la sala, el servidor local crea un código de 6 caracteres. Los
              jugadores entran desde el navegador con el link y, si lo activas, el PIN.
              Sin cuentas, sin instalar nada, sin internet.
            </p>

            <div className="mt-5 space-y-4 border-t border-ui-line pt-4">
              <Toggle
                checked={requirePin}
                onCheckedChange={(value) => {
                  setRequirePin(value);
                  setPinError(null);
                }}
                label="Exigir PIN para unirse"
                hint="Recomendado si hay más gente en la WiFi. No es autenticación fuerte."
              />
              {requirePin ? (
                <Field label="PIN de la sala" error={pinError ?? undefined}>
                  <div className="flex flex-wrap gap-2">
                    <TextInput
                      value={pin}
                      onValueChange={(value) => {
                        setPin(value);
                        setPinError(null);
                      }}
                      maxLength={12}
                      placeholder="4–12 caracteres"
                      className="max-w-[220px]"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={generatePin}
                    >
                      Generar PIN
                    </Button>
                  </div>
                </Field>
              ) : null}
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-2">
              <Button
                variant="accent"
                icon="broadcast"
                loading={loadingLive || busy}
                onClick={() => void handleHost()}
              >
                Abrir sala
              </Button>
              <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-ui-faint">
                El servidor escucha en tu LAN
              </span>
            </div>
          </section>

          <aside className="space-y-4">
            <div className="panel-dark p-4">
              <div className="mb-2 flex items-center gap-2">
                <Icon name="broadcast" size={16} className="text-amber" />
                <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
                  Cómo funciona
                </h2>
              </div>
              <ol className="space-y-2 text-[11px] leading-relaxed text-ui-muted">
                <li>1. Abres la sala y compartes el link/QR.</li>
                <li>2. Los jugadores ponen su nombre y el PIN.</li>
                <li>3. Eligen o crean su personaje.</li>
                <li>4. Editan su ficha; tú lo ves en vivo.</li>
              </ol>
            </div>
            <div className="border border-dashed border-ui-line p-3 text-[11px] leading-relaxed text-ui-muted">
              <strong className="font-mono text-[9px] uppercase tracking-[0.14em]">
                Red local
              </strong>
              <p className="mt-1">
                Todos deben estar en la misma WiFi. Si el link no abre, revisa el
                firewall del equipo y desactiva el aislamiento de clientes del router.
              </p>
            </div>
          </aside>
        </div>
      ) : (
        <div
          className={cx(
            "gap-5",
            combat ? "block" : "grid lg:grid-cols-[minmax(0,1fr)_340px]",
          )}
        >
          <div className="space-y-5">
            {combat ? null : (
            <section className="panel overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ui-line-strong bg-ui-surface-3 px-4 py-3">
                <div>
                  <div className="mono-label">Sala abierta</div>
                  <div className="mt-0.5 flex items-baseline gap-2">
                    <span className="display text-3xl tracking-[0.1em]">{code}</span>
                    <span className="border border-ui-line-strong bg-ui-surface-2 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.12em]">
                      {SESSION_STATUS_LABELS[session.status]}
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="download"
                    onClick={() => void copyText(code ?? "", "Código")}
                  >
                    Copiar código
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="upload"
                    onClick={() => void copyText(joinUrl, "Link")}
                  >
                    Copiar link
                  </Button>
                </div>
              </div>

              <div className="grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_190px]">
                <div className="min-w-0">
                  <div className="mono-label mb-1">Link para jugadores</div>
                  <div className="break-all border border-ui-line-strong bg-ui-surface-2 px-3 py-2 font-mono text-xs">
                    {joinUrl || "Calculando link…"}
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <div className="border border-ui-line bg-ui-surface-2 p-2">
                      <div className="mono-label">PIN</div>
                      <div className="mt-1 font-display text-xl">
                        {campaign.settings.requirePin
                          ? campaign.settings.pin || "—"
                          : "Sin PIN"}
                      </div>
                    </div>
                    <div className="border border-ui-line bg-ui-surface-2 p-2">
                      <div className="mono-label">Jugadores</div>
                      <div className="mt-1 font-display text-xl">
                        {players.length}/{campaign.settings.maxPlayers}
                      </div>
                    </div>
                  </div>
                  {lanIps.length === 0 ? (
                    <p className="mt-2 text-[10px] leading-relaxed text-ui-danger">
                      No detecté una IP LAN. Comparte la URL actual o revisa la red.
                    </p>
                  ) : (
                    <p className="mt-2 font-mono text-[9px] uppercase tracking-[0.12em] text-ui-faint">
                      LAN: {lanIps.join(" · ")} · puerto{" "}
                      {new URL(joinUrl || window.location.origin).port || "80"}
                    </p>
                  )}
                </div>
                <div className="flex flex-col items-center justify-center border border-ui-line-strong bg-ui-surface-2 p-2">
                  {joinUrl ? (
                    <QRCodeSVG
                      value={joinUrl}
                      size={168}
                      bgColor="#f8f4e9"
                      fgColor="#17150f"
                      level="M"
                      marginSize={4}
                    />
                  ) : (
                    <div className="flex h-[168px] items-center justify-center text-ui-faint">
                      QR
                    </div>
                  )}
                  <span className="mt-2 font-mono text-[8px] uppercase tracking-[0.14em] text-ui-faint">
                    Escanea para entrar
                  </span>
                </div>
              </div>
            </section>
            )}

            {combat ? (
              <DmCombatConsole campaign={activeCampaign} />
            ) : (
              <>
                {recentCombat ? (
                  <CombatResultPanel
                    campaign={activeCampaign}
                    combat={recentCombat}
                    onDismiss={dismissRecentCombat}
                    eyebrow="Último combate (reconexión)"
                  />
                ) : null}

                {session.status === "combat" ? (
                  <section className="panel p-4">
                    <div className="flex items-center gap-2">
                      <Icon name="broadcast" size={16} className="text-ui-accent" />
                      <p className="text-xs font-semibold text-ui-muted">
                        La sala está en combate. Esperando el snapshot del servidor…
                      </p>
                    </div>
                  </section>
                ) : (
                  <section className="panel p-4">
                    <SectionTitle
                      title="Iniciar encuentro"
                      count={activeCampaign.content.encounters.length}
                      action={
                        <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-ui-faint">
                          snapshot de la party
                        </span>
                      }
                    />
                    {activeCampaign.content.encounters.length === 0 ? (
                      <div className="flex flex-wrap items-center justify-between gap-2 border border-dashed border-ui-line p-3">
                        <p className="text-xs text-ui-muted">
                          Todavía no hay encuentros. Crea uno con enemigos para
                          empezar un combate.
                        </p>
                        <LinkButton
                          to="/encounters/new"
                          variant="ghost"
                          size="sm"
                          icon="plus"
                        >
                          Crear encuentro
                        </LinkButton>
                      </div>
                    ) : (
                      <>
                        <p className="mb-3 text-[11px] leading-relaxed text-ui-muted">
                          Al iniciar se congela el estado de la party (stats,
                          equipo, skills y HP) y los enemigos se instancian con
                          sus overrides. Después se declara ronda a ronda.
                        </p>
                        <div className="flex flex-wrap items-end gap-2">
                          <label className="min-w-[220px] flex-1">
                            <span className="field-label">Encuentro</span>
                            <Select
                              aria-label="Encuentro a iniciar"
                              value={selectedEncounterId}
                              onValueChange={setSelectedEncounterId}
                            >
                              {activeCampaign.content.encounters.map(
                                (encounter) => (
                                  <option key={encounter.id} value={encounter.id}>
                                    {encounter.name} ·{" "}
                                    {encounter.enemies.reduce(
                                      (sum, enemy) => sum + (enemy.count ?? 1),
                                      0,
                                    )}{" "}
                                    enemigos
                                  </option>
                                ),
                              )}
                            </Select>
                          </label>
                          <Button
                            type="button"
                            variant="accent"
                            size="sm"
                            icon="sword"
                            onClick={handleStartCombat}
                            disabled={!selectedEncounterId}
                          >
                            Iniciar combate
                          </Button>
                        </div>
                      </>
                    )}
                  </section>
                )}

                <section>
                  <SectionTitle
                    title="Party en vivo"
                    count={players.length}
                    action={
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-ui-faint">
                          {session.dmConnected ? "DM presente" : "DM ausente"}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          icon="plus"
                          onClick={() => setConfirmRest(true)}
                          disabled={
                            players.length === 0 || session.status === "combat"
                          }
                        >
                          Rest party
                        </Button>
                      </div>
                    }
                  />
              {players.length === 0 ? (
                <EmptyState
                  icon="users"
                  title="Todavía no hay jugadores"
                  description="Comparte el link o el QR. En cuanto entren y elijan ficha, aparecerán aquí en tiempo real."
                />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {players.map((player) => {
                    const info = playerStats(player);
                    return (
                      <div
                        key={player.id}
                        className="panel flex flex-col overflow-hidden"
                      >
                        <div className="flex items-center gap-3 border-b border-ui-line-strong bg-ui-surface-3 p-3">
                          <div className="relative h-14 w-12 shrink-0 overflow-hidden border border-ui-line-strong bg-ui-surface-2">
                            {info?.character.portrait ? (
                              <img
                                src={info.character.portrait}
                                alt=""
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center">
                                <span className="font-display text-lg text-ui-faint">
                                  {(info?.character.name ?? player.name)
                                    .slice(0, 1)
                                    .toUpperCase()}
                                </span>
                              </div>
                            )}
                            <span
                              className={cx(
                                "absolute bottom-0 right-0 h-2.5 w-2.5 border border-ui-line-strong",
                                player.connected ? "bg-ui-ok" : "bg-ui-faint",
                              )}
                              title={player.connected ? "Conectado" : "Desconectado"}
                            />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="mono-label flex items-center gap-1.5">
                              <span
                                className={cx(
                                  "h-1.5 w-1.5 rounded-full",
                                  player.connected ? "bg-ui-ok" : "bg-ui-faint",
                                )}
                              />
                              {player.connected ? "En línea" : "Desconectado"}
                            </div>
                            <div className="truncate text-sm font-bold">{player.name}</div>
                            <div className="truncate font-mono text-[9px] text-ui-faint">
                              {info?.character.name ?? "Sin ficha"}
                            </div>
                          </div>
                        </div>
                        <div className="grid flex-1 grid-cols-4 gap-px bg-ui-surface-1">
                          {[
                            ["HP", info?.stats.hpMax ?? "—"],
                            ["DEF", info?.stats.def ?? "—"],
                            ["ATK", info?.stats.atk ?? "—"],
                            ["SLOTS", info?.stats.skillSlots ?? "—"],
                          ].map(([label, value]) => (
                            <div key={label} className="bg-ui-surface-2 px-1 py-2 text-center">
                              <div className="font-mono text-[8px] uppercase tracking-[0.1em] text-ui-faint">
                                {label}
                              </div>
                              <div className="font-display text-sm">{value}</div>
                            </div>
                          ))}
                        </div>
                        {info?.character.id ? (
                          <Link
                            to={`/characters/${info.character.id}`}
                            className="border-t border-ui-line-strong px-3 py-2 text-center font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-ui-accent transition-colors hover:bg-amber/15"
                          >
                            Abrir ficha del jugador →
                          </Link>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
                </section>
              </>
            )}
          </div>

          {combat ? null : (
            <aside className="space-y-4">
            <div className="panel p-4">
              <h2 className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
                Estado de la sala
              </h2>
              <dl className="space-y-2 text-xs">
                <div className="flex justify-between border-b border-ui-line pb-1.5">
                  <dt className="text-ui-muted">Código</dt>
                  <dd className="font-mono font-bold">{code}</dd>
                </div>
                <div className="flex justify-between border-b border-ui-line pb-1.5">
                  <dt className="text-ui-muted">Jugadores</dt>
                  <dd className="font-mono font-bold">
                    {players.length}/{campaign.settings.maxPlayers}
                  </dd>
                </div>
                <div className="flex justify-between border-b border-ui-line pb-1.5">
                  <dt className="text-ui-muted">PIN</dt>
                  <dd className="font-mono font-bold">
                    {campaign.settings.requirePin ? campaign.settings.pin : "No"}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ui-muted">Conexión</dt>
                  <dd className="font-mono font-bold">
                    {connected ? "Socket OK" : "Reconectando"}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="border border-ui-line p-3">
              <div className="mono-label mb-1">PIN y permisos</div>
              <p className="text-[11px] leading-relaxed text-ui-muted">
                Puedes cambiar el PIN y los permisos de edición desde los ajustes de
                campaña. El PIN de la sala usa los ajustes actuales.
              </p>
            </div>

            <div className="border border-dashed border-ui-line p-3 text-[11px] leading-relaxed text-ui-muted">
              <strong className="font-mono text-[9px] uppercase tracking-[0.14em]">
                Wi-Fi local
              </strong>
              <p className="mt-1">
                Los jugadores deben estar en la misma red. Si usas el navegador desde
                otro dispositivo, abre este mismo link de la sala desde la IP LAN del DM.
              </p>
            </div>
            </aside>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmClose}
        title="Cerrar la sala"
        message={
          <>
            Se cerrará la sala <strong>{code}</strong> y se desconectará a los jugadores.
            Sus fichas quedarán libres para la próxima partida.
          </>
        }
        confirmLabel="Cerrar sala"
        onCancel={() => setConfirmClose(false)}
        onConfirm={() => void handleClose()}
        busy={busy}
      />

      <ConfirmDialog
        open={confirmRest}
        title="Rest party"
        message={
          <>
            Se curará al máximo el HP de todas las fichas de la party
            (jugadores y NPCs). Es una acción fuera de combate; los enemigos no
            se tocan.
          </>
        }
        confirmLabel="Descansar"
        onCancel={() => setConfirmRest(false)}
        onConfirm={() => void handleRestParty()}
        busy={busy}
      />
    </div>
  );
}
