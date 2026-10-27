# PROTOCOL LIFE

Aplicación para que un **DM** cree y dirija su campaña de rol con contenido personalizado, y para que su mesa se conecte desde el navegador. El combate está inspirado en *Limbus Company*: skills con monedas, clash, DEF y status effects.

> **Estado actual: Fase 1 completada** — estudio del DM local (campaña, objetos, skills, efectos, personajes y encuentros), persistencia en SQLite, seed y export/import. Host/join y combate llegan en las fases 2 y 3.

![Panel de campaña](./docs/screenshots/fase-1-panel.png)

## Arranque rápido

Requisitos: **Node >= 22** (probado con Node 26.10.0) y **npm >= 10** (probado con 11.19.1). No hace falta pnpm.

```bash
cd protocol-life
npm install
npm run dev
```

- Web (Vite): <http://localhost:5173>
- API (Fastify): <http://localhost:3001/api/health>

En el primer arranque se crea automáticamente la campaña **Campaña de prueba** con 7 objetos, 5 skills, 4 efectos, 4 personajes y 1 encuentro. Todo es editable desde la app.

Los datos viven en `data/protocol-life.sqlite` (ignorado por git). Las imágenes subidas van a `data/uploads/`.

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | Levanta servidor (3001) y web (5173) con recarga en caliente. |
| `npm run dev:server` / `npm run dev:web` | Solo uno de los dos. |
| `npm test` | Tests de Vitest: motor de stats, validación, API e import/export. |
| `npm run typecheck` | TypeScript estricto en los tres workspaces. |
| `npm run build` | Build de producción de la web (`apps/web/dist`). |
| `npm start` | Arranca el servidor; si existe `apps/web/dist`, también sirve la web. |
| `npm run seed` | Garantiza que exista la campaña inicial (no borra ni duplica). |

## Qué incluye la Fase 1

- **Monorepo npm workspaces** con `apps/web`, `apps/server` y `packages/shared`.
- **Shared:** tipos del contrato v0.1, esquemas Zod, motor puro de stats derivados, validación de referencias y utilidades (`coinChance`, `mitigation`).
- **Servidor:** Fastify + SQLite + Drizzle, CRUD de campañas y contenido, subida local de imágenes, export/import JSON con remapeo de IDs y seed.
- **Web:** layout del estudio, dashboard, biblioteca de objetos con filtros, editores de objetos/skills/efectos, fichas de personaje con equipo y stats en vivo, editor de encuentros, ajustes de reglas de campaña.
- **Diseño:** UI en español, estética de papel + bordes negros + formas geométricas; responsive.
- **Persistencia:** SQLite (WAL) con escritura inmediata; recargar la página no pierde nada.
- **Tests:** stats derivados, validación, API real con SQLite en disco y ciclo export → import.

### Capturas

| Ficha con stats derivados | Arsenal |
|---|---|
| ![Ficha](./docs/screenshots/fase-1-ficha.png) | ![Arsenal](./docs/screenshots/fase-1-arsenal.png) |

## Estructura

```text
protocol-life/
  apps/
    web/                 # React + Vite + Tailwind + Zustand
      src/
        components/      # layout, UI, tarjetas, editores de acciones
        pages/           # dashboard, bibliotecas, editores, ficha
        store/           # estado global (Zustand)
        lib/             # cliente HTTP y helpers
    server/              # Fastify + SQLite + Drizzle
      src/
        app.ts           # buildApp (rutas, estáticos, errores)
        db.ts            # apertura SQLite + DDL idempotente
        schema.ts        # tablas Drizzle
        repository.ts    # CRUD, validación, export/import
        routes.ts        # API HTTP + uploads
        seed.ts          # contenido inicial
  packages/
    shared/              # tipos, Zod, stats, validación
  docs/                  # diseño, contrato, handoff y capturas
  data/                  # SQLite/uploads (git-ignored)
```

## Stack

- **Web:** React 19, TypeScript, Vite 8, Tailwind CSS 4, Zustand 5, React Router 7.
- **Servidor:** Node, Fastify 5, SQLite con `better-sqlite3` y Drizzle ORM.
- **Compartido:** Zod 4 + motor puro de stats y validación.
- **Tests:** Vitest 5.
- **Monorepo:** npm workspaces (Node 26, npm 11).

### Notas de implementación

- **SQLite:** `better-sqlite3@13` compila/funciona en Node 26, así que no hizo falta recurrir a `node:sqlite`. El driver es síncrono y el servidor es local.
- **Drizzle sin `drizzle-kit`:** en Fase 1 el DDL es idempotente y vive en `apps/server/src/db.ts`; así `npm run dev` no exige migraciones manuales. Cuando el esquema crezca se añadirá `drizzle-kit`.
- **Contenido en JSON validado:** las tablas espejan `name`, `code`, `slot`… para listar, pero la entidad completa vive en una columna JSON validada con Zod. Las tiendas y mazmorras (modelo sin UI aún) se guardan en `campaigns.extras` para no perderlas en export/import.
- **Stats derivados:** `(base + modificadores planos) × (1 + porcentajes)`, con Skill Slots limitados a `1..rules.maxSkillSlots`. Los `modifyStat` de efectos equipados se aplican como pasivos; los triggers se usarán en combate.
- **Efectos pasivos:** un objeto puede arrastrar efectos con stacks; si dos objetos aportan el mismo efecto, los stacks se acumulan respetando `maxStacks`.

## Modelo y decisiones

El diseño v0.1 está cerrado en [`docs/DISENO-v0.1.md`](./docs/DISENO-v0.1.md) y el contrato en [`docs/schema-v0.1.ts`](./docs/schema-v0.1.ts).

Puntos clave:

- 1 DM + hasta 6 jugadores, LAN con link/QR + PIN (Fase 2).
- 2 Skill Slots base, máximo 6; dominios/hábitats cuestan 1 slot y son 1 vez por combate.
- DEF porcentual: `DEF / (DEF + 100)`, daño mínimo 1.
- Empate de clash: se cancelan ambas acciones.
- HP persistente entre combates; el DM descansa al equipo fuera de combate.
- Imágenes: upload local + URL opcional.
- En combate nadie edita fichas; el DM solo controla enemigos.
- Sin cuentas, sin IA automática, sin app móvil nativa.

## API (Fase 1)

Todas las respuestas de error usan `{ "error": { "code", "message", "issues?" } }`.

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/health` | Estado del servidor. |
| GET/POST | `/api/campaigns` | Listar / crear campaña (con `seed` opcional). |
| GET/PATCH/DELETE | `/api/campaigns/:id` | Obtener / editar / borrar campaña. |
| GET | `/api/campaigns/:id/export` | Exportar campaña completa en JSON. |
| POST | `/api/campaigns/import` | Importar JSON exportado (crea otra campaña y remapea referencias). |
| GET/POST | `/api/campaigns/:id/:type` | Listar / crear contenido (`items`, `skills`, `effects`, `characters`, `encounters`). |
| GET/PATCH/DELETE | `/api/content/:type/:id` | Leer / editar / borrar una entidad. |
| GET | `/api/campaigns/:id/characters/:characterId/sheet` | Ficha con equipo y stats derivados resueltos. |
| POST | `/api/uploads` | Subir imagen (multipart `file`, máx. 5 MB). |
| GET | `/uploads/:file` | Servir imagen subida. |

Borrar contenido referenciado devuelve **409** con la lista de referencias; no se permite romper fichas ni encuentros.

## Import / export

- Export: descarga un JSON con `schemaVersion: 1`, reglas, settings y todo el contenido (incluidas tiendas/mazmorras del modelo).
- Import: valida el JSON con Zod, comprueba referencias, genera IDs nuevos para la campaña **y todo el contenido**, remapeando equipo, skills, efectos, inventarios, encuentros y recompensas. Se puede importar el mismo archivo varias veces sin colisiones.

## Variables de entorno

| Variable | Default | Uso |
|---|---|---|
| `PORT` | `3001` | Puerto del servidor. |
| `HOST` | `127.0.0.1` | Interfaz de escucha (en Fase 2 será `0.0.0.0` para LAN). |
| `PROTOCOL_DATA_DIR` | `./data` | Carpeta de datos. |
| `PROTOCOL_DB` | `./data/protocol-life.sqlite` | Ruta del SQLite. |
| `PROTOCOL_UPLOADS_DIR` | `./data/uploads` | Carpeta de imágenes. |
| `PROTOCOL_WEB_DIST` | `./apps/web/dist` | Build web que sirve el servidor (si existe). |
| `PROTOCOL_API_URL` | `http://127.0.0.1:3001` | Destino del proxy de Vite. |
| `VITE_API_URL` | vacío (same-origin) | API base del cliente si se sirve por separado. |

## Roadmap

- **Fase 1 — Estudio del DM:** completada.
- **Fase 2 — Mesa en vivo:** host/join con código + PIN, sesión con tokens, fichas compartidas, presencia y permisos.
- **Fase 3 — Encuentros y combate:** `CombatState`, declaraciones, clash, monedas, DEF, efectos, utilidad, log animado, consola del DM y side-view híbrido (party por capas, enemigos con sprite único).
- **Fase 4 — Contenido avanzado:** tiendas, mazmorras, balance, animaciones, backup/restore.

## Documentos

- [Diseño v0.1](./docs/DISENO-v0.1.md)
- [Contrato de datos v0.1](./docs/schema-v0.1.ts)
- [Handoff / plan de Fase 1](./docs/HANDOFF-FASE-1.md)
- [Notas de implementación de Fase 1](./docs/FASE-1.md)
- [Decisión de side-view (Fase 3)](./docs/DECISION-SIDE-VIEW.md)
- [Prototipo original](./reference/protocol-game-v1.1.html) (solo referencia estética/mecánica)
