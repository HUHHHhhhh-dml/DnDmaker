# PROTOCOL LIFE

Aplicación para que un **DM** cree y dirija su campaña de rol con contenido personalizado, y para que su mesa se conecte desde el navegador por la WiFi local. El combate está inspirado en *Limbus Company*: skills con monedas, clash, DEF y status effects.

> **Estado actual: Fase 2 completada** — estudio del DM + mesa en vivo LAN (link/QR + PIN, sesiones con tokens, fichas compartidas en tiempo real y presencia). El combate llega en la Fase 3.

![Mesa del DM con una jugadora conectada](./docs/screenshots/fase-2-mesa-dm.png)

## Arranque rápido

Requisitos: **Node >= 22** (probado con Node 26.10.0) y **npm >= 10** (probado con 11.19.1). No hace falta pnpm.

```bash
cd protocol-life
npm install
npm run dev
```

- Estudio del DM: <http://localhost:5173>
- API (Fastify): <http://localhost:3001/api/health>
- En la terminal, Vite muestra la **IP LAN** (por ejemplo `http://192.168.0.122:5173`).

En el primer arranque se crea automáticamente la campaña **Campaña de prueba** con 7 objetos, 5 skills, 4 efectos, 4 personajes y 1 encuentro. Todo es editable.

Los datos viven en `data/protocol-life.sqlite` (ignorado por git). Las imágenes subidas van a `data/uploads/`.

### Jugar en LAN

1. El DM abre **Mesa → Abrir sala**. Puede activar un PIN; el servidor genera un código de 6 caracteres.
2. La pantalla de mesa muestra el **link LAN**, el **QR** y el **PIN**.
3. Los jugadores (misma WiFi) abren el link desde el móvil u otro PC.
4. Eligen nombre, PIN y ficha libre (o crean una nueva).
5. Ya están dentro: ven su ficha, la party y editan su personaje si el DM lo permite.

Si el link no abre, revisa el firewall del equipo del DM y desactiva el *aislamiento de clientes* del router. En desarrollo la web escucha en `0.0.0.0:5173` y la API en `0.0.0.0:3001`; en producción `npm run build && npm start` sirve ambos en el puerto de la API.

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | Levanta servidor (3001) y web (5173), con LAN habilitada y recarga en caliente. |
| `npm run dev:server` / `npm run dev:web` | Solo uno de los dos. |
| `npm test` | Vitest: stats, validación, API, sesiones/permisos, Socket.IO e import/export. |
| `npm run typecheck` | TypeScript estricto en los tres workspaces. |
| `npm run build` | Build de producción de la web (`apps/web/dist`). |
| `npm start` | Arranca el servidor; si existe `apps/web/dist`, también sirve la web y el socket. |
| `npm run seed` | Garantiza que exista la campaña inicial (no borra ni duplica). |

## Qué incluye

### Fase 1 — Estudio del DM

- Monorepo npm workspaces con `apps/web`, `apps/server` y `packages/shared`.
- Tipos del contrato v0.1, esquemas Zod, motor puro de stats derivados y validación de referencias.
- Fastify + SQLite + Drizzle, CRUD de campañas, objetos, skills, efectos, personajes y encuentros.
- Subida local de imágenes, export/import JSON con remapeo de IDs y seed editable.
- Web con dashboard, bibliotecas, editores, ficha con equipo y stats en vivo, ajustes de reglas.
- UI en español, estética de papel + bordes negros + formas geométricas, responsive.

### Fase 2 — Mesa en vivo

- **Host/join LAN** con código de 6 caracteres, link construido con la IP LAN, QR y PIN opcional.
- **Sesiones con tokens**: `dmToken` y un `playerToken` por jugador, persistidos en SQLite y en `localStorage`.
- **Fichas compartidas**: el DM y los jugadores editan; los cambios se empujan por Socket.IO sin recargar.
- **Party y presencia** en vivo: quién está en línea, su ficha y sus stats derivados.
- **Permisos de servidor**: el jugador solo edita su propia ficha; no puede tocar contenido, campaña, export ni otras fichas. En combate no se edita (preparado para Fase 3).
- **Estado del jugador saneado**: sin enemigos, sin notas del DM, sin PIN y sin encuentros.
- **Biblioteca por desbloqueo**: el DM ve todos los objetos/skills y decide con un interruptor cuáles aparecen a los jugadores. Hay vistas “DM · todo” y “Jugadores · desbloqueados”.
- **Muñeco de equipo del jugador**: slots alrededor de la imagen base, overlay de objetos con imagen y stats, y capas de equipo sobre el personaje. Las skills se eligen desde sus pentágonos.
- **Imagen base configurable**: el DM la elige en la campaña nueva o en los ajustes; el seed trae una base 200×300 y arte local para varios objetos.
- **Reconexión**: recargar la pestaña recupera la sesión guardada; cerrar la sala libera las fichas.
- **Recuperación del DM**: abrir una sala nueva reemplaza la anterior y permite fijar el PIN desde la propia mesa.

### Fase 3 — Encuentros y combate

- **Encuentros** con enemigos, recuento y overrides, dos capas de escena (piso y
  pared) y tema `paper`/`night`; el DM puede cambiar la escena en vivo.
- **Motor puro y determinista**: SPD base + tirada 1..4 con la seed del combate,
  iniciativa, clash por unidad (sin importar slot), monedas, DEF/(DEF+100),
  efectos, utilidad, dominio/hábitat, redirección y HP persistente.
- **Side-view** con party a la derecha y enemigos a la izquierda, sprites en
  capas o `portrait`, SkillSlots pentagonales, líneas de intención
  (azul/amarillo/rojo/verde) y `targetSlot` visual.
- **Declaración abierta**: el DM controla a los enemigos y cada jugador su
  unidad. El servidor resuelve cuando todas las unidades vivas están bloqueadas.
- **Cinemática de clash** desde los eventos ya resueltos: monedas girando,
  totales, perdedor tachado y daño. Nunca bloquea la lógica.
- **HP enemigo** en porcentaje para jugadores; exacto para el DM y la party. En
  combate nadie edita fichas ni HP: el DM solo controla enemigos.
- **Presencia**: los jugadores desconectados no entran al iniciar el combate; si
  se desconectan a mitad, su unidad se auto-bloquea para que la ronda avance y
  se conserva para la reconexión.

#### Cómo jugar un encuentro

1. El DM crea los enemigos en **Personajes** y arma el grupo en **Encuentros**
   (enemigos, capas de piso/pared y tema de escena).
2. En **Mesa**, abre la sala y comparte el link/QR/PIN. Los jugadores entran,
   eligen ficha y aparecen en la party.
3. El DM inicia el encuentro desde la mesa. La escena muestra la party a la
   derecha y los enemigos a la izquierda.
4. Cada jugador hace click en un SkillSlot de su personaje, elige la skill y
   luego el objetivo; la línea muestra la intención y el slot visual elegido.
   Después pulsa **Listo**.
5. El DM declara las acciones de los enemigos y pulsa **Listo (todos)**.
6. Cuando todas las unidades vivas están bloqueadas, el servidor resuelve la
   ronda: monedas, clash, daño, efectos y cinemática. No hay cálculos en el
   cliente.
7. Se repiten las rondas hasta la victoria o la derrota. Al terminar, el HP de
   la party se guarda; fuera de combate, **Rest party** cura a la party.

### Capturas

| Mesa del jugador | Entrada a la sala |
|---|---|
| ![Mesa del jugador](./docs/screenshots/fase-2-mesa-jugador.png) | ![Join](./docs/screenshots/fase-2-join.png) |

| Muñeco de equipo | Overlay de objetos |
|---|---|
| ![Muñeco](./docs/screenshots/fase-2-muneco-equipo.png) | ![Overlay](./docs/screenshots/fase-2-overlay-objetos.png) |

| Biblioteca del DM | Biblioteca de jugadores |
|---|---|
| ![Biblioteca DM](./docs/screenshots/fase-2-biblioteca.png) | ![Biblioteca jugadores](./docs/screenshots/fase-2-biblioteca-jugadores.png) |

| Panel del DM | Ficha con stats derivados |
|---|---|
| ![Panel](./docs/screenshots/fase-1-panel.png) | ![Ficha](./docs/screenshots/fase-1-ficha.png) |

## Estructura

```text
protocol-life/
  apps/
    web/                 # React + Vite + Tailwind + Zustand
      src/
        components/      # layout, UI, tarjetas, muñeco de equipo, editor del jugador
        pages/           # estudio del DM + JoinPage/PlayerTablePage
        store/           # useAppStore (DM), useLiveStore (mesa DM), usePlayerStore
        lib/             # api, sessionAuth, helpers
      public/assets/     # imagen base y arte local del seed
    server/              # Fastify + SQLite + Drizzle + Socket.IO
      src/
        app.ts           # buildApp (rutas, realtime, estáticos, errores)
        db.ts            # SQLite + DDL idempotente (incluye sessions)
        schema.ts        # tablas Drizzle
        repository.ts    # CRUD, validación, export/import
        sessions.ts      # salas, tokens, presencia, saneado
        realtime.ts      # Socket.IO
        routes.ts        # API HTTP + auth de sesión + uploads
        network.ts       # detección de IPs LAN
        seed.ts          # contenido inicial
  packages/
    shared/              # tipos, Zod, stats, validación, contrato de sesión
  docs/                  # diseño, contrato, notas y capturas
  data/                  # SQLite/uploads (git-ignored)
```

## Stack

- **Web:** React 19, TypeScript, Vite 8, Tailwind CSS 4, Zustand 5, React Router 7, Socket.IO Client, `qrcode.react`.
- **Servidor:** Node, Fastify 5, Socket.IO 4, SQLite (`better-sqlite3`) y Drizzle ORM.
- **Compartido:** Zod 4 + motor puro de stats y validación.
- **Tests:** Vitest 5 + `socket.io-client` en integración.
- **Monorepo:** npm workspaces (Node 26, npm 11).

### Notas de implementación

- **SQLite:** `better-sqlite3@13` funciona en Node 26. WAL, FKs y DDL idempotente; no hace falta `drizzle-kit` en esta fase.
- **Sesiones en SQLite:** una sala activa por campaña. Los tokens son secretos y nunca salen en las vistas públicas. La presencia se resetea al arrancar el servidor y se reconstruye al reconectar.
- **Mutaciones por HTTP, eventos por Socket.IO:** el servidor valida permisos y después emite `campaign:refresh`/`session:players`; el cliente nunca muta por socket.
- **PIN:** usa los ajustes de la campaña y se puede fijar al abrir la sala. Es una barrera de conveniencia en LAN, **no autenticación fuerte**.
- **Tokens:** el DM y cada jugador reciben un token aleatorio. Se guardan en `localStorage` con claves separadas por rol; cada pestaña tiene su propio contexto en memoria.
- **Desbloqueo:** `unlocked?: boolean` en `Item` y `Skill`. Ausente o `false` = solo DM. Los jugadores solo pueden elegir contenido desbloqueado; el servidor rechaza con `403 content_locked`. Lo que ya lleva un personaje se conserva en su ficha aunque el DM lo vuelva a bloquear.
- **Contenido JSON validado:** las entidades completas viven en columnas JSON validadas con Zod; las tiendas/mazmorras del modelo se guardan en `campaigns.extras`.
- **Base visual:** `campaign.settings.baseCharacterImage` (default `/assets/base-character.png`). Las imágenes de objeto se usan a la vez como arte del slot y como capa sobre la base; el seed trae capas locales 200×300 para CIVIL, WARRIOR, SIMPLE ARMOR, WHITE BOOTS y BROKEN FETTERS. El arte de ejemplo viene del prototipo original y se puede reemplazar subiendo imágenes.
- **Stats derivados:** `(base + planos) × (1 + porcentajes)`, Skill Slots limitados a `1..rules.maxSkillSlots`.
- **Moneda:** **Clean Shards**. Nunca dinero real.

## Modelo y decisiones

El diseño v0.1 está cerrado en [`docs/DISENO-v0.1.md`](./docs/DISENO-v0.1.md) y el contrato en [`docs/schema-v0.1.ts`](./docs/schema-v0.1.ts).

- 1 DM + hasta 6 jugadores por sala, LAN con link/QR + PIN.
- 2 Skill Slots base, máximo 6; dominios/hábitats cuestan 1 slot y son 1 vez por combate.
- DEF porcentual: `DEF / (DEF + 100)`, daño mínimo 1.
- Empate de clash: se cancelan ambas acciones.
- HP persistente entre combates; el DM descansa al equipo fuera de combate.
- Imágenes: upload local + URL opcional.
- En combate nadie edita fichas; el DM solo controla enemigos.
- Side-view híbrido decidido para Fase 3: party por capas, enemigos con sprite único, fallback a retrato.
- Sin cuentas, sin IA automática, sin app móvil nativa.

## API

Todas las respuestas de error usan `{ "error": { "code", "message", "issues?" } }`. Cuando hay una sala abierta, las mutaciones requieren `x-session-token` (o `Authorization: Bearer`); si no hay sala, se mantiene el modo local de Fase 1.

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/health` | Estado del servidor. |
| GET | `/api/network` | IPs LAN detectadas para el link. |
| GET/POST | `/api/campaigns` | Listar / crear campaña. |
| GET/PATCH/DELETE | `/api/campaigns/:id` | Obtener / editar / borrar campaña. |
| POST | `/api/campaigns/:id/session` | Abrir (o reemplazar) la sala; acepta `requirePin`/`pin`. |
| GET | `/api/sessions/:code` | Info pública de la sala (sin tokens). |
| GET | `/api/sessions/:code/state` | Estado para DM o jugador según token; el jugador recibe campaña saneada. |
| POST | `/api/sessions/:code/join` | Unirse con nombre, PIN y ficha opcional. |
| POST | `/api/sessions/:code/leave` | Salir y liberar la ficha. |
| POST | `/api/sessions/:code/close` | Cerrar la sala (solo DM). |
| GET | `/api/campaigns/:id/export` | Exportar campaña (solo DM si hay sala). |
| POST | `/api/campaigns/import` | Importar JSON y remapear referencias. |
| GET/POST | `/api/campaigns/:id/:type` | Listar / crear contenido (`items`, `skills`, `effects`, `characters`, `encounters`). |
| GET/PATCH/DELETE | `/api/content/:type/:id` | Leer / editar / borrar; el jugador solo puede editar su ficha. |
| GET | `/api/campaigns/:id/characters/:charId/sheet` | Ficha con equipo y stats derivados. |
| POST | `/api/uploads` | Subir imagen (multipart `file`, máx. 5 MB). |
| GET | `/uploads/:file` | Servir imagen subida. |

**Socket.IO** (mismo origen, path `/socket.io`; auth `{ code, token }`):

- Servidor → cliente: `session:state`, `session:players`, `campaign:refresh`, `session:closed`, `session:error`.
- El cliente no muta por socket: las escrituras van por HTTP y se validan en el servidor.

### Permisos

- **DM:** todo el contenido, campaña, fichas y cierre de sala.
- **Jugador:** solo su propia ficha, si `allowPlayerEdit` y fuera de combate. No puede cambiar `kind`/`ownerId` ni borrar contenido.
- Los GET de contenido son locales/LAN; la vista del jugador usa el estado saneado. La seguridad asume una WiFi de confianza y **no está pensada para exponer el servidor a internet**.

## Import / export

- Export: JSON con `schemaVersion: 1`, reglas, settings y todo el contenido.
- Import: valida con Zod, comprueba referencias, genera IDs nuevos para campaña y contenido, y remapea equipo, skills, efectos, inventarios, encuentros y recompensas. Se puede importar el mismo archivo varias veces sin colisiones.

## Variables de entorno

| Variable | Default | Uso |
|---|---|---|
| `PORT` | `3001` | Puerto del servidor. |
| `HOST` | `0.0.0.0` | Interfaz de escucha; LAN habilitada. Usa `127.0.0.1` para aislar. |
| `PROTOCOL_DATA_DIR` | `./data` | Carpeta de datos. |
| `PROTOCOL_DB` | `./data/protocol-life.sqlite` | Ruta del SQLite. |
| `PROTOCOL_UPLOADS_DIR` | `./data/uploads` | Carpeta de imágenes. |
| `PROTOCOL_WEB_DIST` | `./apps/web/dist` | Build web que sirve el servidor (si existe). |
| `PROTOCOL_API_URL` | `http://127.0.0.1:3001` | Destino del proxy de Vite (API + Socket.IO). |
| `VITE_API_URL` | vacío (same-origin) | API base del cliente si se sirve por separado. |

## Tests

```bash
npm test
```

- `packages/shared`: stats derivados, porcentajes, stacks, límites, referencias, schemas Zod y campaña; side-view (`visual.test.ts`) y motor de combate (`combat/engine.test.ts`).
- `apps/server/src/api.test.ts`: CRUD, ficha derivada, persistencia, export/import.
- `apps/server/src/sessions.test.ts`: host/join, PIN, tokens, permisos, saneado, límite de jugadores, salida/cierre y liberación de fichas.
- `apps/server/src/realtime.test.ts`: dos clientes Socket.IO reales, presencia, refresco al editar y cierre de sala.
- `apps/server/src/combat.test.ts`: snapshot, escena, presencia/auto-lock, HP persistente, Rest party, export/import visual y bloqueo de edición en combate.
- `apps/server/src/combat-round.test.ts`: declaraciones, slots, redirección, efectos, determinismo con seed y resolución de rondas.
- `apps/server/src/combat-socket.test.ts`: consola DM/jugador por Socket.IO, permisos, reconexión y fin de combate.
- `apps/web/src/lib/combat.test.ts` y `clash.test.ts`: contrato de `targetSlot` y lectura de la cinemática de clash.

## Roadmap

- **Fase 1 — Estudio del DM:** completada.
- **Fase 2 — Mesa en vivo:** completada.
- **Fase 3 — Encuentros y combate:** completada (`CombatState`, declaraciones, clash, monedas, DEF, efectos, utilidad, log animado, consola del DM y side-view híbrido).
- **Fase 4 — Contenido avanzado:** tiendas con Clean Shards, mazmorras, balance, animaciones, backup/restore.

## Documentos

- [Diseño v0.1](./docs/DISENO-v0.1.md)
- [Contrato de datos v0.1](./docs/schema-v0.1.ts)
- [Notas de implementación de Fase 1](./docs/FASE-1.md)
- [Notas de implementación de Fase 2](./docs/FASE-2.md)
- [Rediseño de combate y cierre de 3F.5](./docs/REDISENO-COMBATE.md)
- [Mapa de migración al tema oscuro](./docs/UI-MIGRATION-MAP.md)
- [Changelog de Fase 3](./CHANGELOG.md)
- [Prompts de Fase 4](./docs/PROMPTS-FASE-4.md)
- [Decisión de side-view (Fase 3)](./docs/DECISION-SIDE-VIEW.md)
- [Handoff / plan de Fase 1](./docs/HANDOFF-FASE-1.md)
- [Prototipo original](./reference/protocol-game-v1.1.html) (solo referencia estética/mecánica)
