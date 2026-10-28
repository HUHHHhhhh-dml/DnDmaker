# DISEÑO — Dungeon lineal+ (Fase 4B/4C)

> **Estado:** aprobado conceptualmente por el usuario (2026-10-28). Es un puente
> para jugar ya con la mesa mientras se diseña el **crawler 2D** (Fase 5).
> No hay mapa, grid, niebla ni movimiento: son **salas como escenas**.
>
> Sustituye a la 4B/4C originales del plan (lista de salas + encuentros): la
> amplía con escena por sala, tipos y recompensas, sin tocar el motor de combate.

## 1. La fantasía

```text
Entrada (encuentro) → Pasillo (encuentro) → Fogata (descanso)
   → Guardia (encuentro) → Trono (jefe)
```

El DM inicia la dungeon en la mesa; la sala actual se muestra a pantalla
completa con su fondo. Los jugadores avanzan cuando el DM resuelve la sala y
pulsa «Avanzar». Al terminar, todos vuelven a su hoja.

## 2. Modelo (shared)

```ts
export type DungeonRoomKind = "encounter" | "rest" | "treasure" | "boss";

export interface DungeonRoom {
  id: Id;
  name: string;
  /** Texto público que se ve en la escena de la sala. */
  description?: string;
  /** Notas privadas del DM (nunca llegan al jugador). */
  notes?: string;
  /** Default: "encounter". */
  kind?: DungeonRoomKind;
  /** encounter/boss. */
  encounterId?: Id;
  /** Fondo de la escena de la sala (imagen/GIF subido o URL de vídeo). */
  background?: string;
  /** Solo treasure: recompensa del cofre (misma forma que EncounterRewards). */
  rewards?: EncounterRewards;
}

export interface Dungeon {
  id: Id;
  name: string;
  description?: string;
  entryRoomId?: Id;
  rooms: DungeonRoom[];
}
```

- `rooms` en orden de recorrido. `entryRoomId` es dónde empieza la run (default:
  primera sala).
- Sin cambios en `Encounter`, `Item` ni combate.
- Se mantiene `validateShop`/`findReferences`: borrar un encuentro usado por una
  sala ya está bloqueado y el mensaje dice «mazmorra X».

## 3. Tipos de sala y acciones

| `kind` | Acción en la escena | Se marca superada cuando… |
|---|---|---|
| `encounter` | **Iniciar encuentro** (si no hay combate vivo) | gana la party el encuentro |
| `boss` | Igual, con acento visual de jefe | gana la party |
| `rest` | **Descansar** (cura a la party al máximo, `restParty`) | el DM descansa una vez |
| `treasure` | **Abrir cofre** (entrega `rewards` una vez) | se abre el cofre |

- Una sala sin acción (p. ej. `encounter` sin `encounterId`) es de ambientación:
  el DM puede avanzar directamente.
- Solo el DM ejecuta acciones; los jugadores ven la escena y la ruta.

## 4. Run (estado de sesión)

Tabla nueva por DDL idempotente (sin `ALTER TABLE`):

```sql
CREATE TABLE IF NOT EXISTS dungeon_runs (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
  dungeon_id TEXT NOT NULL,
  status TEXT NOT NULL,              -- active | ended
  state TEXT NOT NULL,               -- JSON validado con Zod
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dungeon_runs_active
  ON dungeon_runs(session_id) WHERE status = 'active';
```

```ts
export interface DungeonRun {
  id: Id;
  campaignId: Id;
  sessionId: Id;
  dungeonId: Id;
  status: "active" | "ended";
  currentRoomId: Id;
  /** Salas resueltas (encuentro ganado, descanso usado, cofre abierto). */
  clearedRoomIds: Id[];
  /** Cofres abiertos (idempotencia de recompensas). */
  openedRoomIds: Id[];
  /** Salas de descanso usadas (idempotencia del heal). */
  restedRoomIds: Id[];
  /** Combate vivo lanzado desde la sala actual, si lo hay. */
  combatId?: Id;
  startedAt: IsoDate;
  updatedAt: IsoDate;
}
```

Invariantes:

- Una run activa por sesión; empezar otra cierra la anterior.
- `currentRoomId` siempre existe en la dungeon.
- `advanceRoom` pasa a la siguiente sala del array. Si ya era la última,
  `ended`/aviso (o el DM termina).
- Empezar un combate normal (fuera de la dungeon) cierra la run.
- Cerrar la sesión elimina la run (cascade).

## 5. Recompensas de cofre

- Moneda → bolsa de party (una vez).
- Objetos:
  - `shareLoot` ON: cada objeto a **todos** los personajes de jugador de la
    sesión (como el botín de encuentro).
  - `shareLoot` OFF y 2+ jugadores: se crea un **loot draft** con los objetos
    del cofre (reutiliza 4A-2); con 0–1 jugadores se entregan.
- Implementación: extraer de `grantEncounterRewards` un
  `grantRewards({ campaignId, characterIds, rewards, grantItems })` reusable
  por encuentro y cofre, y reutilizar `LootService.createForVictory` con
  `combatId` opcional.
- Idempotencia: `openedRoomIds` impide repetir el cofre al volver a la sala.

## 6. Servicio, rutas y eventos

`DungeonRunService` (`apps/server/src/dungeon.ts`):

- `start(code, token, dungeonId, entryRoomId?)` (DM, fuera de combate).
- `getBySession(sessionId)` → `PublicDungeonRun` (con la dungeon embebida:
  nombre, salas públicas, fondo de la sala actual, ruta y superadas).
- `startRoomEncounter(code, token)` → llama a `CombatService.startEncounter`
  con el `encounterId` de la sala; guarda `combatId` en la run.
- `rest(code, token)` → `repo.restParty(campaignId)` una vez por sala.
- `openChest(code, token)` → recompensas del cofre una vez por sala.
- `advance(code, token)` → siguiente sala (solo si la actual está resuelta o no
  tiene acción; si no, `409 room_pending`).
- `end(code, token)` → `ended`; los jugadores vuelven a la hoja.
- Hook de combate: al ganar un encuentro cuya `combatId` coincide, marcar la
  sala como superada. Se engancha en el callback `onCombatEnded` de `app.ts`
  (el motor puro no conoce mazmorras).

Rutas (DM salvo `GET`):

```text
GET    /api/sessions/:code/dungeon
POST   /api/sessions/:code/dungeon/start   { dungeonId, entryRoomId? }
POST   /api/sessions/:code/dungeon/encounter
POST   /api/sessions/:code/dungeon/rest
POST   /api/sessions/:code/dungeon/chest
POST   /api/sessions/:code/dungeon/advance
POST   /api/sessions/:code/dungeon/end
```

- `SessionStateResponse.dungeonRun?: PublicDungeonRun | null` y evento
  `dungeon:state { run }` a la sala (mismo patrón que `loot:updated` /
  `shop:state`).
- `state:full` y `GET /state` incluyen la run para reconexión.
- Errores: `dungeon_not_found`, `room_not_found`, `no_active_run`,
  `room_pending`, `encounter_missing`, `combat_lock`, `dm_only`, `player_only`.

## 7. CRUD de dungeons (4B)

- `Repository`: `listDungeons`, `getDungeon`, `createDungeon`, `updateDungeon`,
  `deleteDungeon` sobre `campaigns.extras.dungeons`, con transacción.
- Schemas: `dungeonRoomInputSchema`, `dungeonInputSchema`, `dungeonPatchSchema`
  (kinds, rewards, background); validación:
  - `rooms.length >= 1`, ids de sala únicos, `entryRoomId` existente;
  - `encounterId` existente o ausente; `boss`/`encounter` sin encuentro →
    aviso, no error;
  - `treasure` sin recompensa → aviso;
  - recompensas con objetos existentes.
- Rutas DM: `GET/POST /api/campaigns/:id/dungeons`,
  `PATCH/DELETE /api/campaigns/:id/dungeons/:dungeonId`; bloqueadas en combate.
- Export/import: **remapear ids de mazmorra y de sala** y `entryRoomId`
  (además de los `encounterId`, ya remapeados). Hoy es deuda conocida.
- UI:
  - `DungeonsPage`: lista con tipo de salas, nº de encuentros, entrada, editar,
    eliminar, abrir en la mesa.
  - `DungeonEditorPage`: nombre/descripción/entrada; filas de sala
    reordenables con tipo, nombre, descripción pública, notas, encuentro,
    fondo y recompensa de cofre; añadir/eliminar; validación y preview.
  - Nav «Mazmorras» + contador; dashboard.

## 8. UI de la run (4C)

- **Jugador**: escena a pantalla completa (mismo lenguaje que `ShopScene`):
  fondo de la sala, nombre/descripción, ruta con salas superadas (sin notas),
  aviso de espera. Sin controles.
- **DM**: en la mesa, panel «Dungeon» con selector, Iniciar, sala actual,
  acciones (encuentro/descanso/cofre), Avanzar, Terminar y la misma escena.
- Prioridad de vistas del jugador: combate > dungeon > tienda > hoja (el
  servidor no permite combinaciones: abrir tienda o dungeon cierra la otra).
- Combate desde la dungeon: al ganar, la sala queda superada; la escena de la
  dungeon vuelve a mostrarse.

## 9. Tests (SQLite temporal)

- CRUD de dungeon: validaciones, entrada, salas, export/import con remapeo.
- Run: iniciar, sala→encuentro, victoria marca superada, derrota no avanza,
  descanso una vez, cofre una vez y con `shareLoot` ON/OFF, avanzar, terminar,
  reconexión (`dungeonRun` en estado), permisos DM/jugador, una run por sesión,
  empezar combate normal cierra la run.

## 10. Fuera de alcance (Fase 5 — Crawler 2D)

- Tilemap, movimiento, colisiones, cámara, triggers por casilla.
- Editor de mapa por capas y tilesets.
- Enemigos patrullando / IA.
- Niebla, tokens, línea de visión.

La lineal+ reutiliza el combate, la economía, el reparto y el lenguaje de
escenas; el crawler 2D se diseñará aparte.

## 11. Decisiones abiertas (defaults propuestos)

| # | Decisión | Default |
|---|---|---|
| D1 | ¿`boss` es solo un `encounter` con acento visual? | Sí, sin mecánicas extra |
| D2 | ¿Se puede avanzar con la sala pendiente? | No: `409 room_pending`; el DM puede terminar o resolver |
| D3 | ¿El descanso cura a toda la party? | Sí, `restParty`, una vez por sala |
| D4 | ¿Cofre con 2+ jugadores y `shareLoot` off? | Loot draft, como el botín |
| D5 | ¿Quién ejecuta las acciones? | Solo el DM; los jugadores miran |
| D6 | ¿Sala sin encuentro? | Permitida como ambientación; avanzar directo |
