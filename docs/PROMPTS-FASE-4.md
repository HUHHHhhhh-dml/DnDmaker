# PROMPTS — FASE 4 · Contenido avanzado y pulido

> **Estado:** Fase 3 cerrada en `11aa86b` (3A–3F.5 + 3G). Fase 4 **no empezada**.
> Este documento es el plan y los prompts para ejecutarla. No implementa nada.

## Cómo usar

- Ejecuta los prompts **en orden** y con checkpoints: al final de cada subfase,
  tests/typecheck/build + resumen + OK del usuario antes de seguir.
- Cada prompt asume que el anterior está commiteado.
- Si se reparte entre chats/subagentes, pásale a cada uno su prompt y los
  archivos indicados. El documento de diseño manda:
  [`DISENO-v0.1.md`](./DISENO-v0.1.md) y [`schema-v0.1.ts`](./schema-v0.1.ts).
- No uses la DB real (`data/protocol-life.sqlite`) ni NUUUMC para tests/QA.
  Usa SQLite temporal (`mkdtemp`) o el QA de 3100.

## Análisis de partida (por qué se segmenta)

Lo que **ya existe**:

- Modelo de tiendas y mazmorras en `packages/shared/src/types.ts`:
  `Shop`, `ShopItem`, `Dungeon`, `DungeonRoom`; `CampaignContent.shops` y
  `.dungeons`; schemas Zod en `schemas.ts`; `campaigns.extras` los guarda;
  export/import los remapea.
- `Item.price` y `EncounterRewards.currency` existen, pero **no hay wallet**:
  las recompensas se muestran en la tarjeta del encuentro y no se aplican.
- No hay CRUD de tiendas/mazmorras: `CONTENT_TYPES` solo incluye items, skills,
  effects, characters y encounters; no hay rutas ni páginas.
- No hay recorrido de mazmorra ni estado de sesión para ello.
- No hay backup/restore automático; solo export/import JSON.
- No hay sistema de sonido ni pipeline de animaciones más allá del CSS actual.

Riesgos:

- Añadir columnas a SQLite sin migraciones es caro: este repo inicializa con
  `CREATE TABLE IF NOT EXISTS` y no tiene framework de migraciones. Para Fase 4,
  guarda estado nuevo en JSON (`campaigns.extras`) o en tablas nuevas creadas
  por DDL; evita `ALTER TABLE` improvisado.
- Las tiendas tocan dinero, inventario, stock y permisos: la transacción de
  compra debe ser atómica en el servidor.
- Las mazmorras tocan sesión, combate y recompensas: no metas esa lógica en el
  motor puro; el motor sigue resolviendo solo reglas de combate.
- “Balance, animaciones, sonidos y deploy” son difusos. Se dejan para 4E y no
  bloquean la aceptación si no hay assets o alcance cerrado.

Segmentación propuesta (dependencias):

1. **4A · Economía y tiendas** (wallet, recompensas, CRUD, compra, UI, tests).
2. **4B · Mazmorras: modelo y editor** (CRUD, salas, enlaces a encuentros).
3. **4C · Mazmorras: recorrido** (estado de sesión, sala → encuentro, avance,
   victoria/derrota, reconexión).
4. **4D · Backup/restore y operación** (copias, retención, restore CLI, docs).
5. **4E · Pulido y aceptación** (QA de sesión completa, animaciones/sonido
   opcionales, README/CHANGELOG, reporte final).

4A y 4D pueden ir en paralelo si se reparte; 4C depende de 4B; 4E va al final.

## Decisiones que hay que confirmar antes de 4A

El prompt maestro debe parar si estas decisiones no están confirmadas:

- **D4-1 · Wallet.** Recomendado: **bolsa de party a nivel de campaña**
  (`Campaign.wallet.cleanShards`), persistida en `campaigns.extras.wallet` para
  no migrar columnas. Las compras depositan el objeto en el inventario del
  personaje comprador. Alternativa: wallet por personaje (`Character.currency`),
  que obliga a repartir recompensas y complica la economía compartida.
- **D4-2 · Tiendas.** Recomendado: el DM crea/edita tiendas; los jugadores
  compran **solo para su personaje** y **fuera de combate**; solo se venden
  objetos desbloqueados; **no hay venta** en v1; el DM puede ajustar la wallet.
- **D4-3 · Mazmorras.** Recomendado: recorrido **lineal** por el orden del array
  `rooms`, con `entryRoomId`; sin grafo, sin mapa, sin niebla. El DM avanza
  manualmente; una sala se marca superada al ganar su encuentro.
- **D4-4 · Backup.** Recomendado: copia automática diaria + scripts
  `npm run backup` / `npm run restore`; sin endpoint de restore en vivo (el
  restore exige servidor parado). Opcional: botón DM para crear/descargar copia.
- **D4-5 · Pulido.** Recomendado: sin sonido ni deploy en 4E salvo que el
  usuario lo pida; animaciones solo CSS existente; “balance” = ajustar seed y
  reglas, sin recomendador automático.

---

## Prompt maestro para un chat nuevo

```text
Hola. Este chat es exclusivo para la FASE 4 de PROTOCOL DND (contenido avanzado y pulido).

Proyecto: /home/serahdml/Documents/GAMES/protocol-life
Fase 3 cerrada en el commit 11aa86b. No rehagas 3A–3G.
Diseño: docs/DISENO-v0.1.md y docs/schema-v0.1.ts. No rediseñes reglas.
Prompts: docs/PROMPTS-FASE-4.md. Estado de UI/tema: docs/UI-MIGRATION-MAP.md.
Combate: docs/REDISENO-COMBATE.md. No cambies reglas de combate.

Antes de escribir código:
1. Lee docs/DISENO-v0.1.md (secciones 3.2, 6, 7, 9, 10, 11), docs/schema-v0.1.ts, docs/PROMPTS-FASE-4.md y docs/REDISENO-COMBATE.md.
2. Ejecuta el preflight: git status limpio, npm test, npm run typecheck, npm run build. Baseline: 138/138.
3. Confirma las decisiones D4-1..D4-5 del documento. Si no están confirmadas, DETENTE y pregúntame.
4. Si todo está, ejecuta 4A → 4B → 4C → 4D → 4E en orden.
5. Checkpoints: al final de cada subfase, tests/typecheck/build, resumen de archivos y espera mi OK.

Reglas cerradas:
- Sin cuentas, IA, app móvil ni dinero real. Clean Shards es moneda de juego.
- Sin mapas con grid, niebla ni tokens (post-v0.1).
- No cambiar reglas de combate, HP persistente ni permisos DM/jugador.
- Stack: React+TS+Vite+Tailwind+Zustand; Fastify+SQLite+Drizzle; Zod; Vitest; npm workspaces.
- Tests con SQLite temporal (mkdtemp), nunca data/protocol-life.sqlite ni NUUUMC.
- No commit sin permiso.

Empieza por el preflight y dime estado, huecos y plan corto antes de tocar código.
```

---

## Prompt 0 — Preflight de Fase 4

```text
Eres el agente que continúa PROTOCOL DND en /home/serahdml/Documents/GAMES/protocol-life.

Antes de tocar código:
1. Lee docs/DISENO-v0.1.md, docs/schema-v0.1.ts, docs/PROMPTS-FASE-4.md y docs/REDISENO-COMBATE.md.
2. Verifica git log -1 (debe incluir 11aa86b o posterior), git status limpio y que Fase 3 está cerrada.
3. Corre npm test, npm run typecheck y npm run build. Baseline: 138/138, build OK con el aviso de chunk.
4. Revisa el estado real de Fase 4:
   - Shop/Dungeon en packages/shared/src/types.ts y schemas.ts.
   - campaigns.extras en apps/server/src/db.ts y repository.ts.
   - Ausencia de rutas/CRUD/páginas de tiendas y mazmorras.
   - Character sin wallet; EncounterRewards sin aplicar.
   - Sin backup/restore.
5. Responde: estado, archivos clave, huecos, riesgos y plan de 4A. No escribas código.
```

---

## Prompt 4A — Economía y tiendas

```text
Continúa PROTOCOL DND. Fase 3 cerrada. Implementa 4A: economía de Clean Shards y tiendas funcionales.

LEE: docs/DISENO-v0.1.md (3.2, 6, 7.12, 9), docs/schema-v0.1.ts, packages/shared/src/types.ts, schemas.ts, apps/server/src/repository.ts, routes.ts, apps/server/src/combat/service.ts, apps/web/src/pages/ItemsPage.tsx, ItemEditorPage.tsx, PlayerTablePage.tsx, TablePage.tsx, Layout.tsx, App.tsx, apps/web/src/lib/combat.ts.

OBJETIVO: el DM crea tiendas; el jugador compra con Clean Shards; el servidor valida y aplica la transacción; las recompensas de encuentro alimentan la economía.

ENTREGABLES:
1. Wallet:
   - Añade Campaign.wallet { cleanShards: number } con default 0 (schema Zod, tipo, export/import).
   - Persístelo en campaigns.extras.wallet para no migrar columnas; tolera campañas antiguas sin wallet.
   - Endpoint DM para ajustar la wallet (sumar/restar con validación >=0) y tests.
2. Tiendas:
   - CRUD real de Shop: repository methods y rutas DM /api/campaigns/:id/shops (list/create/update/delete).
   - Valida items existentes, precios >=0, stock >=0/null y sin duplicados.
   - shopInputSchema/shopPatchSchema en shared; no metas shops en CONTENT_TYPES si implica tabla nueva.
   - Export/import y saneado de campaña deben conservar tiendas.
3. Compra:
   - POST /api/sessions/:code/shops/:shopId/buy con token de jugador; body { itemId, qty? }.
   - Valida: sesión/rol, fuera de combate, tienda y item, item desbloqueado, stock, fondos, límite de qty.
   - Transacción atómica: descuenta wallet, descuenta stock, suma/actualiza inventory del personaje del comprador; no deja estados a medias.
   - Emite campaign:refresh/session:players para que DM y jugadores vean wallet, stock e inventario.
   - El DM no compra por jugadores en v1; los jugadores solo compran para su personaje.
4. Recompensas:
   - Al terminar combate con victoria de la party, aplica Encounter.rewards una sola vez: suma currency a la wallet y añade itemIds al inventario de la party (o al líder; decide y documenta).
   - Idempotencia: reabrir/terminar de nuevo no duplica recompensas. Guarda el flag en el estado persistido.
5. UI:
   - ShopsPage + ShopEditorPage (nombre, descripción, items, precio, stock) y entrada en Layout/App con contador.
   - Panel de tienda para jugadores en PlayerTablePage (wallet, objetos, stock, botón comprar) fuera de combate.
   - Mostrar wallet en la mesa; refresco en vivo.
6. Tests (SQLite temporal):
   - CRUD/validación de tienda, export/import.
   - Compra correcta, fondos insuficientes, stock 0, item bloqueado, qty inválida, rol incorrecto, combate activo.
   - Atomicidad (si falla el inventario no se descuenta wallet/stock).
   - Recompensa una sola vez y wallet/inventario resultantes.
   - Rest party y combate existentes siguen verdes.

RESTRICCIONES:
- No dinero real, no cuentas, no venta de objetos en v1, no tocar reglas de combate.
- No bloquees la compra dentro del flujo de combate: simplemente recházala fuera de fase.
- No uses la DB real.

CRITERIO: DM crea tienda con stock; jugador compra y ve inventario/wallet actualizados en vivo; sin fondos o stock no compra; recompensa de victoria se aplica una vez.
```

---

## Prompt 4B — Mazmorras: modelo y editor

```text
Continúa PROTOCOL DND. 4A cerrada. Implementa 4B: CRUD y editor de mazmorras, sin recorrido todavía.

LEE: docs/DISENO-v0.1.md (3.2, 7.12, 9), docs/schema-v0.1.ts, packages/shared/src/types.ts/schemas.ts, apps/server/src/repository.ts/routes.ts, apps/web/src/pages/EncountersPage.tsx/EncounterEditorPage.tsx, Layout.tsx, App.tsx.

OBJETIVO: el DM crea mazmorras con salas y enlaces a encuentros; el modelo queda listo para 4C.

ENTREGABLES:
1. CRUD Dungeon:
   - repository methods + rutas DM /api/campaigns/:id/dungeons (list/create/update/delete).
   - dungeonInputSchema/dungeonPatchSchema; valida nombres, rooms >=1, entryRoomId existente, ids únicos y encounterId existente o null.
   - Persistencia en campaigns.extras.dungeons; export/import y saneado.
2. Editor:
   - DungeonsPage (lista) + DungeonEditorPage: nombre, descripción, entryRoomId, salas (nombre, notas, encuentro vinculado) y orden lineal.
   - Añadir/reordenar/eliminar salas; no permitir borrar la entry sin elegir otra.
   - Entrada en Layout/App con contador; dashboard/count si ya hay patrón.
3. Validación y permisos:
   - Solo DM crea/edita; jugador ve solo mazmorras publicadas/visibles (decide y documenta; recomendado: visibles para jugadores si se usan en sesión).
   - No permitir editar contenido durante combate.
4. Tests:
   - CRUD, validaciones, export/import, borrado de encuentro referenciado bloqueado o desvinculado.
   - Sin tocar aún sesión/recorrido.

CRITERIO: el DM crea una mazmorra de 3 salas, vincula 2 encuentros, elige entrada y todo persiste/exporta.
```

---

## Prompt 4C — Mazmorras: recorrido

```text
Continúa PROTOCOL DND. 4B cerrada. Implementa 4C: recorrido básico de mazmorra ligado a la sesión y al combate.

LEE: docs/DISENO-v0.1.md (3.2, 8, 9), apps/server/src/sessions.ts, combat/service.ts, app.ts, routes.ts, realtime.ts, apps/web/src/pages/TablePage.tsx/PlayerTablePage.tsx, stores.

OBJETIVO: el DM inicia una mazmorra, recorre salas en orden, lanza el encuentro de cada sala y avanza al ganar; los jugadores ven la sala actual y las superadas.

ENTREGABLES:
1. Estado de recorrido:
   - Tabla nueva dungeon_runs (DDL CREATE TABLE IF NOT EXISTS) o JSON de sesión; una run activa por sesión.
   - Campos: sessionId, dungeonId, currentRoomId, clearedRoomIds, status (active/ended), timestamps.
   - No migrar columnas existentes.
2. Servicio:
   - startDungeon(sessionId, dungeonId, entryRoomId?), advanceRoom, endDungeon.
   - startEncounter desde una sala: valida encounterId, no combate activo, misma campaña.
   - Hook al terminar combate: si gana la party, marca la sala actual como superada; si pierde, no avanza.
   - Nunca metas esta lógica en el motor puro; el servicio de mazmorra escucha el cierre de combate.
3. API/Socket:
   - Rutas DM para iniciar/avanzar/terminar (o eventos socket equivalentes, siguiendo el patrón de la mesa).
   - state:full incluye la run para reconexión; jugadores reciben la sala actual sin notas privadas.
4. UI:
   - DM en TablePage: iniciar mazmorra, sala actual, encuentro vinculado, botón iniciar combate, avanzar/terminar.
   - Jugador en PlayerTablePage: nombre de mazmorra, sala actual, notas públicas, salas superadas; sin controles.
   - Refresco en vivo; sin mapa.
5. Tests:
   - Iniciar, sala→encuentro, victoria marca superada, derrota no avanza, avanzar, terminar, reconexión, permisos DM/jugador.
   - La run no se duplica y no rompe combate existente.

CRITERIO: 2 jugadores recorren 2 salas con encuentro, ganan, avanzan y terminan sin tocar la DB.
```

---

## Prompt 4D — Backup/restore y operación

```text
Continúa PROTOCOL DND. 4A–4C cerradas. Implementa 4D: backup/restore seguro y documentado.

LEE: docs/DISENO-v0.1.md (8.3–8.5), apps/server/src/config.ts, db.ts, index.ts, package.json, README.md.

OBJETIVO: no perder la campaña; copias automáticas y restauración controlada.

ENTREGABLES:
1. Backup:
   - Copia diaria del SQLite a data/backups/ con timestamp; retención configurable (default 7).
   - Usa el mecanismo seguro de better-sqlite3 o checkpoint WAL antes de copiar; no copies con la DB a medio escribir.
   - Script npm run backup para copia manual.
2. Restore:
   - Script npm run restore -- <archivo> que exige servidor parado, valida el archivo, hace copia de seguridad del actual y restaura.
   - Sin endpoint HTTP de restore en vivo.
   - Documenta el procedimiento y los riesgos.
3. Opcional DM: botón para crear/descargar copia; si se añade, sin restore.
4. Tests (SQLite temporal):
   - Crea backup, lista/retención, restaura en una DB temporal y conserva campañas/combates.
   - Archivo inválido/ausente no destruye la DB actual.
5. README: sección Backup/restore.

CRITERIO: se crea una copia, se restaura en una DB temporal y la app sigue funcionando; no se toca la DB real en pruebas.
```

---

## Prompt 4E — Pulido, QA y aceptación

```text
Continúa PROTOCOL DND. 4A–4D cerradas. Cierra Fase 4: pulido mínimo, QA de sesión completa y documentación.

LEE: docs/DISENO-v0.1.md (9–11), README.md, CHANGELOG.md, docs/PROMPTS-FASE-4.md.

OBJETIVO: una sesión completa sin tocar la base a mano y con la documentación al día.

TAREAS:
1. QA end-to-end con SQLite temporal:
   - Campaña → 2 jugadores → tienda (comprar) → mazmorra 2 salas → encuentro → recompensa → wallet/inventario → backup/restore.
   - Verifica permisos, reconexión y que el combate no se rompe.
2. Pulido:
   - Revisa consola, estados vacíos, responsive de tiendas/mazmorras y legibilidad.
   - Animaciones/sonido/deploy solo si el usuario lo pide y hay assets; no inventes un pipeline.
   - Balance: ajusta seed/reglas, sin recomendador automático.
3. Documentación:
   - README: secciones “Tiendas y Clean Shards”, “Mazmorras”, “Backup/restore” y cómo jugar una mazmorra.
   - CHANGELOG Fase 4.
4. Tests/build:
   - npm test, npm run typecheck, npm run build.
   - Reporte final: qué se implementó, qué quedó fuera, deuda conocida.

CRITERIO: sesión completa de principio a fin, 2 jugadores, sin tocar SQLite a mano; tests/build verdes.
```

---

## Criterios de aceptación de Fase 4

- El DM crea una tienda con stock y precios; el jugador compra con Clean Shards;
  wallet, stock e inventario se actualizan en el servidor y en vivo.
- Las recompensas de victoria se aplican una sola vez.
- El DM crea una mazmorra de 2–3 salas, vincula encuentros, la recorre y avanza
  al ganar; los jugadores ven la sala actual y las superadas.
- Backup automático/manual y restore documentado; tests con DB temporal.
- `npm test`, `npm run typecheck` y `npm run build` verdes.
- Sin cuentas, IA, app móvil, dinero real, mapas con grid ni cambios de reglas de
  combate.

## Fuera de alcance de Fase 4

- Mapas con grid, niebla de guerra, tokens.
- Venta de objetos en tiendas (v1 solo compra).
- Economía por personaje si se elige wallet de party.
- Sonido/deploy/túnel salvo petición explícita.
- Cuentas, matchmaking, IA de enemigos y app móvil (descartados).
