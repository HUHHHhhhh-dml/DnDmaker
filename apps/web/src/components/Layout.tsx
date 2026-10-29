import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import type { IconName } from "../components/Icons";
import { Icon } from "../components/Icons";
import { EditCampaignModal, NewCampaignModal } from "../components/CampaignModals";
import { Button, LoadingBlock, NoticeBar, Select, cx } from "../components/ui";
import { useAppStore } from "../store/useAppStore";
import { useLiveStore } from "../store/useLiveStore";

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  countKey?:
    | "items"
    | "skills"
    | "effects"
    | "characters"
    | "encounters"
    | "shops"
    | "dungeons";
  end?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Panel", icon: "grid", end: true },
  { to: "/table", label: "Mesa", icon: "broadcast" },
  { to: "/items", label: "Objetos", icon: "cube", countKey: "items" },
  { to: "/shops", label: "Tiendas", icon: "book", countKey: "shops" },
  { to: "/skills", label: "Skills", icon: "sword", countKey: "skills" },
  { to: "/effects", label: "Efectos", icon: "flame", countKey: "effects" },
  { to: "/characters", label: "Personajes", icon: "users", countKey: "characters" },
  { to: "/encounters", label: "Encuentros", icon: "skull", countKey: "encounters" },
  { to: "/dungeons", label: "Mazmorras", icon: "shield", countKey: "dungeons" },
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
    shops: campaign.content.shops.length,
    dungeons: campaign.content.dungeons.length,
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
    <div className="min-h-screen text-ui lg:grid lg:grid-cols-[280px_minmax(0,1fr)]">
      {(busy || campaignLoading) && (
        <div className="fixed inset-x-0 top-0 z-[70] h-1 overflow-hidden bg-[rgba(217,139,43,0.18)]">
          <div className="h-full w-1/3 animate-pulse bg-ui-accent" />
        </div>
      )}

      {/* Sidebar de escritorio: superficie-1 sobre el fondo de app, separado
          por línea, no por el contraste papel/tinta de antes. */}
      <aside className="hidden border-r border-ui-line bg-ui-surface-1 lg:sticky lg:top-0 lg:block lg:h-screen lg:overflow-y-auto">
        {sidebar}
      </aside>

      <header
        className={cx(
          "sticky top-0 z-30 flex items-center justify-between border-b border-ui-line bg-ui-surface-1 px-4 py-3 text-ui lg:hidden",
          mobileOpen && "invisible",
        )}
      >
        <div className="flex items-center gap-2">
          <div className="pentagon flex h-8 w-8 items-center justify-center border border-ui-line-strong bg-ui-surface-3">
            <span className="display text-[11px] text-ui-accent">PD</span>
          </div>
          <span className="display text-sm uppercase tracking-wide text-ui">Protocol DnD</span>
        </div>
        <button
          type="button"
          className="icon-btn h-9 w-9"
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
            className="absolute inset-0 bg-[rgba(0,0,0,0.72)] backdrop-blur-[2px]"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-[290px] animate-rise overflow-y-auto border-r border-ui-line bg-ui-surface-1">
            <div className="flex justify-end p-2">
              <button
                type="button"
                className="icon-btn"
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
        <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 border-t border-ui-line px-4 py-5 font-mono text-[10px] uppercase tracking-[0.14em] text-ui-faint sm:px-8">
          <span>PROTOCOL DND · mesa en vivo</span>
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
      <div className="border-b border-ui-line px-5 pb-5 pt-6">
        <div className="flex items-center gap-3">
          <div className="pentagon flex h-10 w-10 items-center justify-center border border-ui-line-strong bg-ui-surface-3">
            <span className="display text-sm text-ui-accent">PD</span>
          </div>
          <div>
            <div className="display text-lg leading-none tracking-[0.04em] text-ui">
              PROTOCOL
              <br />
              DND
            </div>
            <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.22em] text-ui-faint">
              DM Studio · v0.2
            </div>
          </div>
        </div>

        <div className="mt-6">
          <label className="mb-1.5 block font-ui text-[9px] font-bold uppercase tracking-[0.18em] text-ui-faint">
            Campaña activa
          </label>
          <div className="flex gap-1.5">
            <Select
              value={activeCampaignId ?? ""}
              onValueChange={(value) => void selectCampaign(value)}
              aria-label="Campaña activa"
              className="min-w-0 flex-1 px-2 py-2 text-xs font-semibold"
            >
              {campaigns.map((entry) => (
                <option key={entry.id} value={entry.id} className="bg-ui-surface-2 text-ui">
                  {entry.name}
                </option>
              ))}
            </Select>
            <button
              type="button"
              onClick={onEditCampaign}
              className="icon-btn h-9 w-9 shrink-0 hover:border-amber hover:text-amber"
              title="Ajustes de campaña"
              aria-label="Ajustes de campaña"
            >
              <Icon name="edit" size={15} />
            </button>
          </div>
          {campaign?.description ? (
            <p className="mt-2 line-clamp-2 text-[11px] leading-snug text-ui-faint">
              {campaign.description}
            </p>
          ) : null}
        </div>
      </div>

      <nav className="flex-1 py-3">
        <div className="px-5 pb-2 font-mono text-[9px] uppercase tracking-[0.22em] text-ui-faint">
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
              <span className="tnum font-mono text-[10px] text-ui-faint">
                {String(counts[item.countKey] ?? 0).padStart(2, "0")}
              </span>
            ) : null}
          </NavLink>
        ))}

        {liveSession ? (
          <div className="mt-5 px-5">
            <Link
              to="/table"
              className="block border border-[rgba(217,139,43,0.45)] bg-[rgba(217,139,43,0.08)] px-3 py-2 transition-colors hover:bg-[rgba(217,139,43,0.14)]"
            >
              <div className="flex items-center gap-2 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-ui-accent">
                <span
                  className={cx(
                    "h-1.5 w-1.5 rounded-full",
                    liveConnected ? "bg-ui-ok" : "bg-ui-accent",
                  )}
                />
                Sala en vivo · {liveSession.code}
              </div>
              <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.1em] text-ui-faint">
                {liveSession.players.length} jugador
                {liveSession.players.length === 1 ? "" : "es"} · abrir mesa
              </div>
            </Link>
          </div>
        ) : null}

        <div className="mt-6 px-5 pb-2 font-mono text-[9px] uppercase tracking-[0.22em] text-ui-faint">
          En marcha
        </div>
        <div className="space-y-1 px-5">
          <p className="text-[10px] leading-relaxed text-ui-faint">
            Fase 2: mesa LAN con link + PIN.
            <br />
            Fase 3: encuentros y combate.
          </p>
        </div>
      </nav>

      <div className="border-t border-ui-line p-4">
        <div className="mb-2 flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-ui-faint">
          <span className="h-1.5 w-1.5 rounded-full bg-ui-ok" />
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
          className="mt-2 flex w-full items-center justify-center gap-2 border border-dashed border-ui-line-strong py-2 font-mono text-[9px] uppercase tracking-[0.16em] text-ui-muted transition-colors hover:border-amber hover:text-amber"
        >
          <Icon name="plus" size={12} /> Nueva campaña
        </button>
      </div>
    </div>
  );
}

function Splash() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-ui text-ui">
      <div className="pentagon flex h-20 w-20 animate-pulse items-center justify-center border border-ui-line-strong bg-ui-surface-3">
        <span className="display text-xl text-ui-accent">PD</span>
      </div>
      <div className="display text-2xl uppercase tracking-[0.06em] text-ui">Protocol DnD</div>
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ui-faint">
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
    <div className="grid min-h-screen bg-ui text-ui lg:grid-cols-[1.15fr_1fr]">
      {/* Hero: superficie-1 con retícula y resplandores cálidos del prototipo. */}
      <section className="relative flex flex-col justify-between overflow-hidden border-b border-ui-line bg-ui-surface-1 p-8 sm:p-12 lg:border-b-0 lg:border-r">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -right-20 -top-20 h-72 w-72 rotate-12 border border-ui-line bg-hatch opacity-40" />
          <div className="absolute -bottom-32 left-1/3 h-80 w-80 rounded-full bg-[radial-gradient(circle,rgba(217,139,43,0.16),transparent_65%)] blur-2xl" />
          <div className="absolute -left-24 top-1/3 h-72 w-72 rounded-full bg-[radial-gradient(circle,rgba(161,38,30,0.18),transparent_65%)] blur-2xl" />
        </div>
        <div className="relative">
          <div className="mb-8 flex items-center gap-3">
            <div className="pentagon flex h-11 w-11 items-center justify-center border border-ui-line-strong bg-ui-surface-3">
              <span className="display text-sm text-ui-accent">PD</span>
            </div>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ui-faint">
              Protocol DnD · DM Studio
            </div>
          </div>
          <h1 className="display text-6xl leading-[0.85] sm:text-8xl">
            PROTOCOL
            <br />
            <span className="text-ui-accent">DND</span>
          </h1>
          <p className="mt-6 max-w-md text-sm leading-relaxed text-ui-muted">
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
            <div key={index} className="border border-ui-line bg-ui-surface-2 p-3">
              <div className="font-mono text-[10px] text-ui-accent">{index}</div>
              <div className="mt-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-ui">
                {title}
              </div>
              <div className="mt-1 text-[10px] leading-snug text-ui-faint">{text}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-md">
          <div className="mono-label mb-2 flex items-center gap-2">
            <span className="h-2 w-2 bg-ui-accent" />
            Primera vez
          </div>
          <h2 className="display text-3xl text-ui">Abre tu mesa</h2>
          <p className="mt-3 text-sm leading-relaxed text-ui-muted">
            Crea una campaña nueva con contenido de ejemplo o importa una que
            exportaste antes. Los datos se guardan en el SQLite de tu máquina.
          </p>

          {error ? (
            <div className="mt-5 border border-[rgba(226,121,108,0.55)] bg-[rgba(226,121,108,0.08)] p-3 text-sm text-ui-danger">
              <div className="mb-1 flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em]">
                <Icon name="alert" size={14} /> No hay conexión con el servidor
              </div>
              {error}
              <button
                type="button"
                onClick={() => void loadAll()}
                className="mt-2 block font-mono text-[10px] font-bold uppercase tracking-[0.14em] underline"
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
          <div className="mt-6 border-t border-ui-line pt-4 font-mono text-[10px] uppercase leading-relaxed tracking-[0.12em] text-ui-faint">
            Fase 1 · sin red, sin cuentas
            <br />
            UI en español · contenido editable
          </div>
        </div>
      </section>
    </div>
  );
}
