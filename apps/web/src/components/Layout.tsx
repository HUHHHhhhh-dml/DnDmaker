import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import type { IconName } from "../components/Icons";
import { Icon } from "../components/Icons";
import { EditCampaignModal, NewCampaignModal } from "../components/CampaignModals";
import { Button, LoadingBlock, NoticeBar, cx } from "../components/ui";
import { useAppStore } from "../store/useAppStore";
import { useLiveStore } from "../store/useLiveStore";

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  countKey?: "items" | "skills" | "effects" | "characters" | "encounters";
  end?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Panel", icon: "grid", end: true },
  { to: "/table", label: "Mesa", icon: "broadcast" },
  { to: "/items", label: "Objetos", icon: "cube", countKey: "items" },
  { to: "/skills", label: "Skills", icon: "sword", countKey: "skills" },
  { to: "/effects", label: "Efectos", icon: "flame", countKey: "effects" },
  { to: "/characters", label: "Personajes", icon: "users", countKey: "characters" },
  { to: "/encounters", label: "Encuentros", icon: "skull", countKey: "encounters" },
];

export function Layout() {
  const loadAll = useAppStore((state) => state.loadAll);
  const bootLoading = useAppStore((state) => state.bootLoading);
  const campaign = useAppStore((state) => state.campaign);
  const notice = useAppStore((state) => state.notice);
  const clearNotice = useAppStore((state) => state.clearNotice);
  const busy = useAppStore((state) => state.busy);
  const campaignLoading = useAppStore((state) => state.campaignLoading);

  const [newCampaignOpen, setNewCampaignOpen] = useState(false);
  const [editCampaignOpen, setEditCampaignOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importCampaign = useAppStore((state) => state.importCampaign);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const liveCampaignId = campaign?.id;
  useEffect(() => {
    if (!liveCampaignId) return;
    void useLiveStore.getState().resume(liveCampaignId);
    return () => {
      useLiveStore.getState().detach();
    };
  }, [liveCampaignId]);

  async function handleImportFile(file: File | undefined) {
    if (!file) return;
    try {
      const imported = await importCampaign(file);
      navigate("/");
      if (imported) setNewCampaignOpen(false);
    } catch {
      // store notifica
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  if (bootLoading) return <Splash />;

  if (!campaign) {
    return (
      <>
        <Welcome
          onCreate={() => setNewCampaignOpen(true)}
          onImport={() => fileInputRef.current?.click()}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => void handleImportFile(event.target.files?.[0])}
        />
        <NewCampaignModal open={newCampaignOpen} onClose={() => setNewCampaignOpen(false)} />
        <NoticeBar notice={notice} onClose={clearNotice} />
      </>
    );
  }

  const counts = {
    items: campaign.content.items.length,
    skills: campaign.content.skills.length,
    effects: campaign.content.effects.length,
    characters: campaign.content.characters.length,
    encounters: campaign.content.encounters.length,
  };

  const sidebar = (
    <SidebarContent
      onEditCampaign={() => setEditCampaignOpen(true)}
      onNewCampaign={() => setNewCampaignOpen(true)}
      onImport={() => fileInputRef.current?.click()}
      counts={counts}
    />
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[280px_minmax(0,1fr)]">
      {(busy || campaignLoading) && (
        <div className="fixed inset-x-0 top-0 z-[70] h-1 overflow-hidden bg-amber/30">
          <div className="h-full w-1/3 animate-pulse bg-rust" />
        </div>
      )}

      <aside className="hidden border-r-2 border-ink bg-ink lg:sticky lg:top-0 lg:block lg:h-screen lg:overflow-y-auto">
        {sidebar}
      </aside>

      <header
        className={cx(
          "sticky top-0 z-30 flex items-center justify-between border-b-2 border-ink bg-ink px-4 py-3 text-paper lg:hidden",
          mobileOpen && "invisible",
        )}
      >
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center border border-paper/60 bg-paper text-ink pentagon">
            <span className="font-display text-[11px]">P</span>
          </div>
          <span className="font-display text-sm uppercase tracking-wide">Protocol Life</span>
        </div>
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center border-2 border-paper/60"
          onClick={() => setMobileOpen(true)}
          aria-label="Abrir menú"
        >
          <Icon name="menu" size={18} />
        </button>
      </header>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Cerrar menú"
            className="absolute inset-0 bg-ink/80"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-[290px] animate-rise overflow-y-auto border-r-2 border-ink bg-ink">
            <div className="flex justify-end p-2">
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center border border-paper/50 text-paper"
                onClick={() => setMobileOpen(false)}
                aria-label="Cerrar menú"
              >
                <Icon name="close" size={16} />
              </button>
            </div>
            {sidebar}
          </div>
        </div>
      ) : null}

      <main className="min-w-0">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-10">
          {campaignLoading && !campaign ? (
            <LoadingBlock label="Cargando campaña…" />
          ) : (
            <Outlet context={{ onEditCampaign: () => setEditCampaignOpen(true) }} />
          )}
        </div>
        <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 border-t border-ink/15 px-4 py-5 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint sm:px-8">
          <span>PROTOCOL LIFE · Fase 2 — mesa en vivo</span>
          <span>SQLite local · LAN misma WiFi · sin cuentas</span>
        </footer>
      </main>

      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(event) => void handleImportFile(event.target.files?.[0])}
      />

      <NewCampaignModal open={newCampaignOpen} onClose={() => setNewCampaignOpen(false)} />
      <EditCampaignModal open={editCampaignOpen} onClose={() => setEditCampaignOpen(false)} />
      <NoticeBar notice={notice} onClose={clearNotice} />
    </div>
  );
}

function SidebarContent({
  onEditCampaign,
  onNewCampaign,
  onImport,
  counts,
}: {
  onEditCampaign: () => void;
  onNewCampaign: () => void;
  onImport: () => void;
  counts: Record<string, number>;
}) {
  const campaigns = useAppStore((state) => state.campaigns);
  const activeCampaignId = useAppStore((state) => state.activeCampaignId);
  const selectCampaign = useAppStore((state) => state.selectCampaign);
  const campaign = useAppStore((state) => state.campaign);
  const exportCampaign = useAppStore((state) => state.exportCampaign);
  const liveSession = useLiveStore((state) => state.session);
  const liveConnected = useLiveStore((state) => state.connected);

  return (
    <div className="flex min-h-full flex-col">
      <div className="border-b border-paper/15 px-5 pb-5 pt-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center border border-paper/60 bg-paper pentagon">
            <span className="font-display text-sm text-rust">PL</span>
          </div>
          <div>
            <div className="font-display text-lg leading-none tracking-wide text-paper">
              PROTOCOL
              <br />
              LIFE
            </div>
            <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.24em] text-paper/50">
              DM Studio · v0.2
            </div>
          </div>
        </div>

        <div className="mt-6">
          <label className="mb-1.5 block font-mono text-[9px] uppercase tracking-[0.2em] text-paper/45">
            Campaña activa
          </label>
          <div className="flex gap-1.5">
            <select
              value={activeCampaignId ?? ""}
              onChange={(event) => void selectCampaign(event.target.value)}
              className="min-w-0 flex-1 cursor-pointer border-2 border-paper/30 bg-ink px-2 py-2 text-xs font-semibold text-paper outline-none focus:border-amber"
            >
              {campaigns.map((entry) => (
                <option key={entry.id} value={entry.id} className="bg-ink text-paper">
                  {entry.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={onEditCampaign}
              className="flex h-9 w-9 shrink-0 items-center justify-center border-2 border-paper/30 text-paper/80 transition-colors hover:border-amber hover:text-amber"
              title="Ajustes de campaña"
              aria-label="Ajustes de campaña"
            >
              <Icon name="edit" size={15} />
            </button>
          </div>
          {campaign?.description ? (
            <p className="mt-2 line-clamp-2 text-[11px] leading-snug text-paper/45">
              {campaign.description}
            </p>
          ) : null}
        </div>
      </div>

      <nav className="flex-1 py-3">
        <div className="px-5 pb-2 font-mono text-[9px] uppercase tracking-[0.24em] text-paper/35">
          Estudio
        </div>
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cx("nav-link", isActive && "nav-link-active")
            }
          >
            <Icon name={item.icon} size={16} />
            <span className="flex-1">{item.label}</span>
            {item.countKey ? (
              <span className="font-mono text-[10px] text-paper/40">
                {String(counts[item.countKey] ?? 0).padStart(2, "0")}
              </span>
            ) : null}
          </NavLink>
        ))}

        {liveSession ? (
          <div className="mt-5 px-5">
            <Link
              to="/table"
              className="block border border-amber/60 bg-amber/10 px-3 py-2 transition-colors hover:bg-amber/20"
            >
              <div className="flex items-center gap-2 font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-amber">
                <span
                  className={
                    liveConnected
                      ? "h-1.5 w-1.5 rounded-full bg-emerald-400"
                      : "h-1.5 w-1.5 rounded-full bg-amber"
                  }
                />
                Sala en vivo · {liveSession.code}
              </div>
              <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.12em] text-paper/45">
                {liveSession.players.length} jugador
                {liveSession.players.length === 1 ? "" : "es"} · abrir mesa
              </div>
            </Link>
          </div>
        ) : null}

        <div className="mt-6 px-5 pb-2 font-mono text-[9px] uppercase tracking-[0.24em] text-paper/35">
          En marcha
        </div>
        <div className="space-y-1 px-5">
          <p className="text-[10px] leading-relaxed text-paper/40">
            Fase 2: mesa LAN con link + PIN.
            <br />
            Fase 3: encuentros y combate.
          </p>
        </div>
      </nav>

      <div className="border-t border-paper/15 p-4">
        <div className="mb-2 flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-paper/40">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          SQLite local · guardado automático
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="dark-ghost"
            size="sm"
            icon="download"
            onClick={() => void exportCampaign()}
          >
            Exportar
          </Button>
          <Button variant="dark-ghost" size="sm" icon="upload" onClick={onImport}>
            Importar
          </Button>
        </div>
        <button
          type="button"
          onClick={onNewCampaign}
          className="mt-2 flex w-full items-center justify-center gap-2 border border-dashed border-paper/25 py-2 font-mono text-[9px] uppercase tracking-[0.18em] text-paper/50 transition-colors hover:border-amber hover:text-amber"
        >
          <Icon name="plus" size={12} /> Nueva campaña
        </button>
      </div>
    </div>
  );
}

function Splash() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-ink text-paper">
      <div className="flex h-20 w-20 animate-pulse items-center justify-center border-2 border-paper/60 bg-paper pentagon">
        <span className="font-display text-xl text-rust">PL</span>
      </div>
      <div className="font-display text-2xl uppercase tracking-[0.08em]">Protocol Life</div>
      <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-paper/50">
        Abriendo el estudio del DM…
      </div>
    </div>
  );
}

function Welcome({
  onCreate,
  onImport,
}: {
  onCreate: () => void;
  onImport: () => void;
}) {
  const error = useAppStore((state) => state.error);
  const busy = useAppStore((state) => state.busy);
  const loadAll = useAppStore((state) => state.loadAll);

  return (
    <div className="grid min-h-screen bg-paper lg:grid-cols-[1.15fr_1fr]">
      <section className="relative flex flex-col justify-between overflow-hidden border-b-2 border-ink bg-ink p-8 text-paper sm:p-12 lg:border-b-0 lg:border-r-2">
        <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rotate-12 border-2 border-paper/10 bg-hatch opacity-40" />
        <div className="relative">
          <div className="mb-8 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center border-2 border-paper/70 bg-paper pentagon">
              <span className="font-display text-sm text-rust">PL</span>
            </div>
            <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-paper/60">
              Protocol Life · DM Studio
            </div>
          </div>
          <h1 className="display text-6xl leading-[0.85] sm:text-8xl">
            PROTOCOL
            <br />
            <span className="text-amber">LIFE</span>
          </h1>
          <p className="mt-6 max-w-md text-sm leading-relaxed text-paper/70">
            El estudio del DM: crea tu campaña, tu arsenal de objetos, tus skills,
            tus efectos y las fichas de tu mesa. Todo local, todo editable, sin
            tocar código.
          </p>
        </div>

        <div className="relative mt-10 grid max-w-md grid-cols-3 gap-3">
          {[
            ["01", "Contenido", "Objetos, skills y efectos data-driven."],
            ["02", "Fichas", "Equipo, slots y stats derivados."],
            ["03", "Persistencia", "SQLite local + export/import."],
          ].map(([index, title, text]) => (
            <div key={index} className="border border-paper/20 p-3">
              <div className="font-mono text-[10px] text-amber">{index}</div>
              <div className="mt-2 font-mono text-[9px] font-bold uppercase tracking-[0.16em]">
                {title}
              </div>
              <div className="mt-1 text-[10px] leading-snug text-paper/45">{text}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-md">
          <div className="mono-label mb-2 flex items-center gap-2">
            <span className="h-2 w-2 bg-rust" />
            Primera vez
          </div>
          <h2 className="display text-3xl">Abre tu mesa</h2>
          <p className="mt-3 text-sm leading-relaxed text-ink-soft">
            Crea una campaña nueva con contenido de ejemplo o importa una que
            exportaste antes. Los datos se guardan en el SQLite de tu máquina.
          </p>

          {error ? (
            <div className="mt-5 border-2 border-rust bg-rust/10 p-3 text-sm text-rust-deep">
              <div className="mb-1 flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.16em]">
                <Icon name="alert" size={14} /> No hay conexión con el servidor
              </div>
              {error}
              <button
                type="button"
                onClick={() => void loadAll()}
                className="mt-2 block font-mono text-[10px] font-bold uppercase tracking-[0.16em] underline"
              >
                Reintentar
              </button>
            </div>
          ) : null}

          <div className="mt-7 space-y-3">
            <Button variant="accent" icon="plus" className="w-full" onClick={onCreate} loading={busy}>
              Crear campaña
            </Button>
            <Button variant="ghost" icon="upload" className="w-full" onClick={onImport}>
              Importar campaña (.json)
            </Button>
          </div>
          <div className="mt-6 border-t-2 border-ink/15 pt-4 font-mono text-[10px] uppercase leading-relaxed tracking-[0.14em] text-ink-faint">
            Fase 1 · sin red, sin cuentas
            <br />
            UI en español · contenido editable
          </div>
        </div>
      </section>
    </div>
  );
}
