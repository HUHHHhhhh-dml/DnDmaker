import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  SESSION_STATUS_LABELS,
  sessionJoinSchema,
  type SessionInfo,
} from "@protocol-life/shared";
import { ApiError, api } from "../lib/api";
import {
  readPlayerSession,
  type StoredPlayerSession,
} from "../lib/sessionAuth";
import { usePlayerStore } from "../store/usePlayerStore";
import { Icon } from "../components/Icons";
import {
  Button,
  Field,
  LinkButton,
  LoadingBlock,
  TextInput,
  cx,
} from "../components/ui";

/**
 * Puerta de entrada del jugador a una mesa LAN.
 *
 * Página independiente del estudio del DM: solo muestra la información
 * pública de la sala y permite unirse o retomar una sesión guardada.
 */
export function JoinPage() {
  const { code: rawCode } = useParams();
  const code = (rawCode ?? "").trim().toUpperCase();
  const navigate = useNavigate();

  const join = usePlayerStore((state) => state.join);
  const restore = usePlayerStore((state) => state.restore);

  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [characterId, setCharacterId] = useState<string | null>(null);
  const [saved, setSaved] = useState<StoredPlayerSession | null>(() =>
    code ? readPlayerSession(code) : null,
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!code) {
      setLoading(false);
      setLoadError("Falta el código de la sala.");
      return;
    }

    setLoading(true);
    setLoadError(null);
    setSaved(readPlayerSession(code));

    void api
      .getSessionInfo(code)
      .then((next) => {
        if (cancelled) return;
        setInfo(next);
        setLoading(false);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setInfo(null);
        setLoadError(
          error instanceof ApiError
            ? error.message
            : "No se pudo consultar la sala. Comprueba que el servidor esté encendido.",
        );
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [code, reloadKey]);

  const players = info?.session.players.length ?? 0;
  const full = info ? players >= info.maxPlayers : false;
  const inCombat = info?.session.status === "combat";

  async function handleRestore() {
    if (!saved || restoring) return;
    setRestoring(true);
    setFormError(null);
    const ok = await restore(code);
    setRestoring(false);
    if (ok) {
      navigate(`/play/${code}`, { replace: true });
      return;
    }
    setSaved(readPlayerSession(code));
    setFormError(
      usePlayerStore.getState().error ??
        "Tu sesión guardada ya no es válida. Vuelve a entrar.",
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!info || submitting) return;

    if (info.requiresPin && pin.trim() === "") {
      setFormError("Escribe el PIN que te compartió el DM.");
      return;
    }

    const parsed = sessionJoinSchema.safeParse({
      name: name.trim(),
      pin: info.requiresPin ? pin.trim() : undefined,
      characterId: characterId ?? undefined,
    });
    if (!parsed.success) {
      setFormError(
        parsed.error.issues[0]?.message ?? "Revisa los datos del formulario.",
      );
      return;
    }

    setFormError(null);
    setSubmitting(true);
    const ok = await join(code, parsed.data);
    setSubmitting(false);

    if (ok) {
      navigate(`/play/${code}`, { replace: true });
      return;
    }
    setFormError(
      usePlayerStore.getState().error ?? "No se pudo entrar a la sala.",
    );
  }

  return (
    <div className="min-h-screen">
      <PlayerBrandHeader />

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-8 sm:py-12">
        {loading ? (
          <LoadingBlock label="Buscando la mesa…" />
        ) : loadError ? (
          <div className="panel mx-auto max-w-xl p-6 sm:p-8">
            <div className="mb-3 flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-ui-danger">
              <Icon name="alert" size={16} /> No se pudo abrir la sala
            </div>
            <h1 className="display text-3xl">La mesa no responde</h1>
            <p className="mt-3 text-sm leading-relaxed text-ui-muted">
              {loadError}
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <Button
                variant="accent"
                size="sm"
                icon="broadcast"
                onClick={() => setReloadKey((value) => value + 1)}
              >
                Reintentar
              </Button>
              <LinkButton to="/" variant="ghost" size="sm" icon="arrow-left">
                Volver al estudio
              </LinkButton>
            </div>
          </div>
        ) : info ? (
          <div className="grid gap-6 lg:grid-cols-[1.05fr_minmax(0,1fr)] lg:gap-10">
            <section className="animate-rise">
              <div className="mono-label mb-2 flex items-center gap-2">
                <span className="inline-block h-2 w-2 bg-rust" />
                Mesa en vivo · Fase 2
              </div>
              <h1 className="display text-5xl text-ui sm:text-6xl">
                {info.campaignName}
              </h1>
              <p className="mt-4 max-w-xl text-sm leading-relaxed text-ui-muted">
                {info.campaignDescription ||
                  "El DM ha abierto la mesa. Elige tu nombre, tu ficha y entra cuando estés listo."}
              </p>

              <div className="mt-6 flex flex-wrap items-center gap-2">
                <span className="chip chip-accent">
                  <Icon name="broadcast" size={11} />
                  {SESSION_STATUS_LABELS[info.session.status]}
                </span>
                <span className="chip">
                  <Icon name="users" size={11} />
                  {players}/{info.maxPlayers} jugadores
                </span>
                <span className="chip">
                  <Icon name="shield" size={11} />
                  {info.requiresPin ? "Requiere PIN" : "Sin PIN"}
                </span>
              </div>

              <div className="panel mt-6 overflow-hidden">
                <div className="flex items-center justify-between border-b border-ui-line-strong bg-ui-surface-3 px-4 py-2.5">
                  <span className="font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-ui-muted">
                    Código de sala
                  </span>
                  <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-ui-faint">
                    Compártelo con tu mesa
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 px-4 py-4">
                  <span className="font-display text-4xl tracking-[0.18em] sm:text-5xl">
                    {info.session.code}
                  </span>
                  <div className="flex h-12 w-12 items-center justify-center border border-ui-line-strong bg-amber/25 pentagon">
                    <Icon name="users" size={22} />
                  </div>
                </div>
              </div>

              <div className="mt-5 grid gap-2 sm:grid-cols-3">
                {[
                  ["01", "Elige tu ficha", "Una ficha libre o una nueva."],
                  ["02", "Entra a la mesa", "Tu token queda en este navegador."],
                  ["03", "Edita en vivo", "Si el DM lo permite, sin recargar."],
                ].map(([index, title, text]) => (
                  <div
                    key={index}
                    className="border border-ui-line bg-ui-surface-2 p-3"
                  >
                    <div className="font-mono text-[10px] text-ui-danger">{index}</div>
                    <div className="mt-1 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-ui">
                      {title}
                    </div>
                    <div className="mt-1 text-[11px] leading-snug text-ui-muted">
                      {text}
                    </div>
                  </div>
                ))}
              </div>

              {info.session.players.length > 0 ? (
                <div className="mt-5">
                  <div className="mono-label mb-2">Ya en la mesa</div>
                  <div className="flex flex-wrap gap-1.5">
                    {info.session.players.map((player) => (
                      <span
                        key={player.id}
                        className={cx(
                          "chip",
                          player.connected && "chip-accent",
                        )}
                      >
                        <span
                          className={cx(
                            "inline-block h-1.5 w-1.5 rounded-full",
                            player.connected ? "bg-ui-ok" : "bg-ui-faint",
                          )}
                        />
                        {player.name}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </section>

            <section className="animate-rise space-y-4">
              {saved ? (
                <div className="panel border-steel bg-steel/10 p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center border border-ui-line-strong bg-ui-surface-2 hexagon">
                      <Icon name="shield" size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="mono-label">Sesión guardada</div>
                      <p className="mt-1 text-sm font-semibold text-ui">
                        Ya entraste como {saved.name}.
                      </p>
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        icon="broadcast"
                        className="mt-3"
                        loading={restoring}
                        onClick={() => void handleRestore()}
                      >
                        Entrar como {saved.name}
                      </Button>
                    </div>
                  </div>
                </div>
              ) : null}

              {!saved ? (
              <form className="panel p-5 sm:p-6" onSubmit={(event) => void handleSubmit(event)}>
                <div className="mb-4 flex items-start justify-between gap-3 border-b border-ui-line-strong pb-3">
                  <div>
                    <div className="mono-label">Nuevo jugador</div>
                    <h2 className="display mt-1 text-2xl">Siéntate a la mesa</h2>
                  </div>
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center border border-ui-line-strong bg-amber/30 pentagon">
                    <Icon name="users" size={18} />
                  </div>
                </div>

                {full ? (
                  <div className="mb-4 flex items-start gap-2 border-2 border-rust bg-rust/10 p-3 text-ui-danger">
                    <Icon name="alert" size={15} className="mt-0.5 shrink-0" />
                    <div className="text-xs leading-relaxed">
                      <strong className="block font-mono text-[10px] uppercase tracking-[0.14em]">
                        Sala llena
                      </strong>
                      Ya hay {players} jugadores de {info.maxPlayers}. Pide al DM
                      que amplíe el aforo o espera a que alguien salga.
                    </div>
                  </div>
                ) : inCombat ? (
                  <div className="mb-4 flex items-start gap-2 border-2 border-amber bg-amber/15 p-3 text-ui">
                    <Icon name="flame" size={15} className="mt-0.5 shrink-0" />
                    <div className="text-xs leading-relaxed">
                      La mesa está en combate. Podrás unirte cuando termine la
                      ronda.
                    </div>
                  </div>
                ) : null}

                {formError ? (
                  <div className="mb-4 border-2 border-rust bg-rust/10 p-3 text-xs font-semibold leading-relaxed text-ui-danger">
                    <span className="flex items-center gap-1.5">
                      <Icon name="alert" size={14} /> {formError}
                    </span>
                  </div>
                ) : null}

                <div className="space-y-4">
                  <Field label="Tu nombre" hint="Entre 1 y 40 caracteres.">
                    <TextInput
                      value={name}
                      onValueChange={setName}
                      placeholder="Arzu"
                      maxLength={40}
                      autoComplete="off"
                      required
                    />
                  </Field>

                  {info.requiresPin ? (
                    <Field
                      label="PIN de la sala"
                      hint="El DM te lo habrá compartido junto al enlace."
                    >
                      <TextInput
                        value={pin}
                        onValueChange={setPin}
                        placeholder="••••"
                        maxLength={12}
                        autoComplete="off"
                        type="password"
                      />
                    </Field>
                  ) : null}

                  <div>
                    <div className="field-label">Tu ficha</div>
                    <div className="space-y-2">
                      <button
                        type="button"
                        aria-pressed={characterId === null}
                        onClick={() => setCharacterId(null)}
                        className={cx(
                          "flex w-full items-center gap-3 border p-2.5 text-left transition-colors",
                          characterId === null
                            ? "border-ui-accent bg-amber/20 "
                            : "border-ui-line bg-ui-surface-2 hover:border-[var(--ui-line-strong)]",
                        )}
                      >
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center border border-ui-line-strong bg-ui-surface-2 pentagon">
                          <Icon name="plus" size={17} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold text-ui">
                            Crear personaje nuevo
                          </span>
                          <span className="block text-[11px] leading-snug text-ui-faint">
                            Se crea una ficha base con stats por defecto. Podrás
                            editarla después.
                          </span>
                        </span>
                        {characterId === null ? (
                          <Icon name="shield" size={16} className="shrink-0 text-ui-danger" />
                        ) : null}
                      </button>

                      {info.availableCharacters.map((character) => {
                        const selected = characterId === character.id;
                        return (
                          <button
                            key={character.id}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => setCharacterId(character.id)}
                            className={cx(
                              "flex w-full items-center gap-3 border p-2.5 text-left transition-colors",
                              selected
                                ? "border-ui-accent bg-amber/20 "
                                : "border-ui-line bg-ui-surface-2 hover:border-[var(--ui-line-strong)]",
                            )}
                          >
                            <span className="relative h-10 w-9 shrink-0 overflow-hidden border border-ui-line-strong bg-ui-surface-2">
                              {character.portrait ? (
                                <img
                                  src={character.portrait}
                                  alt=""
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <span className="flex h-full w-full items-center justify-center font-display text-sm text-ui-faint">
                                  {character.name.slice(0, 1).toUpperCase()}
                                </span>
                              )}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold text-ui">
                                {character.name}
                              </span>
                              <span className="block font-mono text-[9px] uppercase tracking-[0.12em] text-ui-faint">
                                Ficha libre
                              </span>
                            </span>
                            {selected ? (
                              <Icon
                                name="shield"
                                size={16}
                                className="shrink-0 text-ui-danger"
                              />
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <Button
                  type="submit"
                  variant="accent"
                  icon="broadcast"
                  className="mt-5 w-full"
                  loading={submitting}
                  disabled={full || inCombat}
                >
                  Entrar a la mesa
                </Button>
                <p className="mt-3 text-center font-mono text-[9px] uppercase leading-relaxed tracking-[0.12em] text-ui-faint">
                  Sin cuenta · tu sesión queda guardada en este navegador
                </p>
              </form>
              ) : null}
            </section>
          </div>
        ) : null}
      </main>
    </div>
  );
}

function PlayerBrandHeader() {
  return (
    <header className="border-b border-[var(--ui-line)] bg-[var(--ui-surface-1)] px-4 py-4 text-[var(--ui-text)] sm:px-8">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center border border-[var(--ui-line-strong)] bg-[var(--ui-surface-2)] pentagon">
            <span className="font-display text-sm text-[var(--ui-accent)]">PD</span>
          </div>
          <div>
            <div className="font-display text-lg leading-none tracking-wide">
              PROTOCOL DND
            </div>
            <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.24em] text-[var(--ui-text-muted)]">
              Mesa de jugador · LAN
            </div>
          </div>
        </div>
        <Link
          to="/"
          className="inline-flex items-center gap-2 border border-[var(--ui-line)] px-3 py-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-[var(--ui-text-muted)] transition-colors hover:border-[var(--ui-accent)] hover:text-[var(--ui-text)]"
        >
          <Icon name="arrow-left" size={13} />
          Volver al estudio
        </Link>
      </div>
    </header>
  );
}
