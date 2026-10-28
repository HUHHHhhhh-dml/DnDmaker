# HANDOFF — PROTOCOL LIFE · Fase 4

> **Instrucción para el siguiente agente:** continúa desde aquí. Fase 3 está
> cerrada (`11aa86b`); **4A está commiteada en `409f5e1`**. El plan original de
> Fase 4 está en [`PROMPTS-FASE-4.md`](./PROMPTS-FASE-4.md), pero **4B/4C se
> redefinieron** a la dungeon lineal+ de
> [`DISENO-DUNGEON-LINEAL.md`](./DISENO-DUNGEON-LINEAL.md). No rehagas Fase 3,
> no cambies reglas de combate ni permisos. Trabaja en español y pide OK al
> final de cada checkpoint.

---

## 1. Estado

| Elemento | Estado |
|---|---|
| Fase 3 (3A–3G) | Cerrada en `11aa86b` |
| Análisis y prompts Fase 4 | `0363109` |
| **4A · Economía, tiendas y botín** | **Commiteada en `409f5e1`** |
| **4B/4C · Dungeon lineal+** | **Pendiente, diseño cerrado** |
| 4D / 4E | Pendientes |
| Fase 5 · Crawler 2D | Futuro (ver diseño) |
| `npm test` | 191/191 en 17 archivos |
| `npm run typecheck` | OK (shared + server + web) |
| `npm run build` | OK (aviso conocido de chunk > 500 kB) |

Repo: `/home/serahdml/Documents/GAMES/protocol-life`, rama `master`.
`409f5e1` contiene 4A y `4e523f8` los cambios de combate del usuario
(apuntado de apoyo/hostiles en `CombatScene`). Árbol limpio al cerrar este
handoff.

**Servidor de desarrollo del usuario:** hay un `npm run dev` vivo (API 3001,
Vite 5173) apuntando a `data/protocol-life.sqlite`. Editar servidor reinicia
`tsx watch` y reabre la DB real (solo checkpoint WAL; no se han escrito datos
de prueba). **No usar la DB real ni NUUUMC para tests/QA.** Los tests abren
`mkdtemp`.

## 2. Decisiones confirmadas por el usuario

| # | Decisión |
|---|---|
| D4-1 | **Bolsa de party** `Campaign.wallet.cleanShards`, en `campaigns.extras.wallet`. Moneda **A**: el botín de moneda se suma **una vez** a la bolsa común (equidad automática). |
| D4-1b | Los objetos de `EncounterRewards.itemIds` se entregan a **todos** los personajes de jugador (se duplican a propósito). Con la opción OFF habrá **reparto por turnos en orden snake** (1-2-3-3-2-1) por iniciativa del combate. |
| D4-1c | Idempotencia **por combate** (flag `rewardsApplied`), no por encuentro. |
| D4-2 | DM crea/edita tiendas; el jugador compra solo para su personaje y fuera de combate; sin venta; solo objetos `unlocked`. |
| D4-2b | `stock` ausente = infinito, `0` = agotado; `qty` 1–99. |
| D4-2c | La economía **no es frontera de seguridad**: el jugador puede añadir objetos desbloqueados editando su ficha. Se acepta y se documenta. |
| D4-3 | Mazmorras lineales por orden de `rooms` + `entryRoomId`, sin mapa ni niebla. |
| D4-3b | **Tiendas en vivo (4A-3)**: el DM abre una tienda en la mesa y toda la sala ve una escena a pantalla completa. Ya no existe `Shop.open`. Comprar paga el precio y **desbloquea el objeto para toda la campaña** (no entra al inventario). El DM cierra y los jugadores vuelven a su hoja. |
| D4-4 | Backup diario + `npm run backup` / `npm run restore`; restore sin servidor. |
| D4-5 | Sin sonido/deploy ni recomendador automático. |
| Split | 4A en dos checkpoints: **4A-1** (economía/tiendas) y **4A-2** (reparto de botín). Solo se introduce `shareLoot` cuando la rama OFF funcione. |

## 3. Qué hace ya 4A-1

### Contrato (`packages/shared`)

- `Campaign.wallet: { cleanShards: number }` (obligatorio en el tipo; el schema
  lo acepta ausente con `default 0` para importar exports de Fase 3).
- `Shop.background?: string` (imagen/GIF o URL de vídeo); `ShopItem.stock?`.
  **`Shop.open` se retiró en 4A-3**: la apertura es en vivo por sesión.
- `CampaignWallet`, `CombatRewardSummary`; `CombatState.rewardsApplied?` y
  `CombatState.rewardSummary?`.
- Schemas: `walletSchema`, `shopItemSchema`, `shopInputSchema`, `shopSchema`,
  `shopPatchSchema`, `shopBuyInputSchema`, `shopOpenInputSchema`,
  `walletAdjustInputSchema`; tipos `ShopInput`, `ShopPatchInput`,
  `ShopBuyInput`, `ShopOpenInput`, `WalletAdjustInput`.
- `DEFAULT_WALLET`. (4A-3 añade `ShopScene`, `ShopSceneItem`, `ShopSceneItemInfo`
  y `ShopSceneEvent`; 4A-2 añade `LootDraft`.)
- `combatStateSchema` incluye `rewardsApplied` y `rewardSummary` (si no, Zod
  los borra al persistir el combate: bug real detectado en tests).
- `validateShop()` + `validateContent()` valida tiendas (referencias,
  duplicados, aviso de objeto bloqueado) y detecta IDs de tienda duplicados.

### Servidor (`apps/server`)

- `campaigns.extras` tipado `{ shops: Shop[]; dungeons: Dungeon[]; wallet? }`.
  Helpers privados `readExtras`/`writeExtras`; **toda** escritura de extras va
  dentro de `Repository.transaction()`.
- Métodos: `listShops`, `getShop`, `createShop`, `updateShop`, `deleteShop`,
  `adjustWallet` (delta, nunca < 0), `buyShopItemUnlock` (4A-3: bolsa + stock +
  `unlocked`, sin inventario), `grantEncounterRewards` (moneda a la bolsa +
  objetos a cada personaje) y `addInventoryItem` (reparto de botín).
- Rutas:
  - `GET/POST /api/campaigns/:campaignId/shops`
  - `PATCH/DELETE /api/campaigns/:campaignId/shops/:shopId`
  - `POST /api/campaigns/:campaignId/wallet` `{ delta }`
  - (4A-3) `GET /api/sessions/:code/shop`, `POST .../shop/open` `{ shopId }`,
    `POST .../shop/close`, `POST .../shop/buy` `{ itemId }`.
  - Errores: `insufficient_funds`, `out_of_stock`, `item_already_unlocked`,
    `shop_not_open`, `player_only`, `dm_only`, `combat_lock`, `invalid_payload`.
- `sanitizeCampaign` (jugador): incluye la bolsa y sigue ocultando enemigos,
  notas, encuentros, PIN y **tiendas** (4A-3 manda la escena aparte).
- Recompensas en `CombatService.endEncounter`, dentro de la misma transacción
  que el HP: solo `winner === "players"` y `!rewardsApplied`; moneda una vez,
  objetos a cada unidad `players`. `onCombatEnded` emite `campaign:refresh`.
- Export/import: conserva bolsa y tiendas y **remapea los IDs de tienda**
  (`register(content.shops, "shp")`).

### Web (`apps/web`)

- `lib/api.ts`: `createShop`, `updateShop`, `deleteShop`, `adjustWallet`,
  `getActiveShop`, `openShop`, `closeShop`, `buyShopItem`, `CampaignCounts`.
- `ShopsPage`: lista, buscador, contadores, Editar, Eliminar y **Abrir en la
  mesa** (necesita sesión en vivo de la misma campaña).
- `ShopEditorPage` (`/shops/new`, `/shops/:shopId`): filas objeto/precio/stock,
  **Fondo de la escena** (`ImageField`), validación, preview, borrado.
- `Layout`/`App`: nav «Tiendas» (icono `book`) + rutas + contadores.
- `DashboardPage`: tile Tiendas + panel de bolsa.
- `TablePage` (DM): panel de bolsa, ajuste inline y panel «Tienda en la mesa»
  (abrir/cerrar) + `ShopScene` en la columna principal.
- `PlayerTablePage`: `ShopScene` a pantalla completa (combate > tienda > hoja);
  ya **no** hay panel de tienda inline.

### Tests

`apps/server/src/economy.test.ts` (18 tests, SQLite temporal):
bolsa (0 inicial, ajuste, negativos, campaña Fase 3 sin wallet, PATCH no la
pierde), CRUD/validación de tienda, fondo export/import con remapeo, saneado
del jugador (sin tiendas, con bolsa) y recompensas (moneda + objetos a todos,
idempotencia, sin ganador, objetos repetidos, sin recompensas, resumen).

`apps/server/src/shop-scene.test.ts` (12 tests): abrir/cerrar con objetos
bloqueados, permisos DM/jugador, reemplazo de tienda, borrado con escena
abierta, combate (no abrir, no comprar, cierre al iniciar), compra = bolsa +
stock + `unlocked` sin inventario, recompra 409, sin fondos/stock/fuera de
tienda, sin tienda abierta, DM no compra, `activeShop` en `/state` y
export/import del desbloqueo.

`apps/server/src/loot.test.ts` (11 tests): ajuste `shareLoot` por PATCH, ON
sin reparto y objetos a todos, OFF con reparto y moneda pagada sin objetos,
1 jugador auto-entrega, `lootDraft` en `GET /state`, empezar combate cierra el
reparto, turnos (solo el del turno, DM no elige), serpiente entre rondas,
saltar turno y cerrar (sobrantes sin asignar).

`packages/shared/src/loot.test.ts` (11 tests): orden por SPD, serpiente,
`applyLootPick` (entrega, errores, fin de pool), saltar/cerrar.

`packages/shared/src/validation.test.ts`: +1 test de `validateShop` y duplicados.

## 4. 4A-2 — reparto de botín

- `CampaignSettings.shareLoot?: boolean` (default `true`) + helper
  `sharesLoot(settings)`; toggle en el modal de campaña.
- Con OFF y **2+ jugadores**, `CombatService.endEncounter` crea un **loot
  draft** en la misma transacción que HP y moneda:
  - moneda a la bolsa común (una vez); objetos **no** se entregan;
  - `pool` = `itemIds` del encuentro (duplicados = copias);
  - `order` = SPD descendente del combate, empate por `characterId`;
  - turnos **serpiente** (rondas impares adelante, pares atrás);
  - con 0–1 jugadores se entregan igual (un reparto de una persona no aporta).
- Tabla nueva `loot_drafts` (DDL idempotente, FK cascade a campaña/sesión,
  índice único parcial: un reparto activo por sesión). No sale en el export.
- `LootService` (`apps/server/src/loot.ts`): `getBySession`,
  `createForVictory` (sin transacción propia: la abre el cierre de combate),
  `closeActiveForSession`, `pick` (solo tu turno, solo tu ficha, entrega el
  objeto al elegir), `skip`/`close` (solo DM). Un objeto borrado entre combate
  y elección responde 422 `invalid_item` y el DM puede cerrar.
- Rutas: `GET /api/sessions/:code/loot`, `POST .../loot/pick`
  `{ itemIndex }`, `POST .../loot/skip`, `POST .../loot/close`.
- Evento `loot:updated` a la sala; `state:full` y `GET /state` incluyen
  `lootDraft`; al empezar un combate se cierra el reparto pendiente.
- UI: `LootDraftPanel` (pool agrupado por objeto, «Te toca a ti»/«Esperando
  a…», historial, DM con Saltar/Cerrar), montado en la mesa del jugador
  (también en la escena de resultado del combate) y en la del DM.

Deuda conocida de 4A-2:

- Un jugador que se une **con el reparto ya creado** no entra en el orden (el
  DM puede saltar turnos). Un jugador que se va en su turno deja el reparto
  parado hasta que el DM salta.
- El draft `done` solo viaja por `loot:updated`; tras un `refresh` el jugador
  lo pierde (el servidor solo devuelve el activo). No se puede recargar el
  reparto cerrado.
- Sin QA en navegador (no hay tooling de browser en el entorno).

### 4A-3 — escena de tienda

- `Shop` pierde `open` y gana `background` (imagen/GIF subido o URL; si es
  `.mp4`/`.webm` el cliente lo reproduce en bucle).
- Tabla nueva `active_shops` (una por sesión, FK cascade). La escena se
  reconstruye desde el contenido, así que refleja precios/stock al día.
- `ShopSceneService` (`apps/server/src/shop-scene.ts`): `getBySession`,
  `open` (DM, fuera de combate), `close`, `buy` (jugador, tienda abierta) y
  `closeForSession` (al empezar combate). Compra = `repo.buyShopItemUnlock`:
  valida stock/fondos/no desbloqueado y en una transacción descuenta la bolsa,
  baja stock y pone `item.unlocked = true`. **No toca inventarios.**
- Rutas: `GET /api/sessions/:code/shop`, `POST .../shop/open` `{ shopId }`,
  `POST .../shop/close`, `POST .../shop/buy` `{ itemId }`.
- Evento `shop:state` `{ shop }`; `state:full` y `GET /state` incluyen
  `activeShop`. Editar/borrar una tienda abierta reemite la escena.
- La campaña saneada del jugador ya **no** incluye tiendas: la escena manda su
  propio snapshot con objetos bloqueados.
- UI: `ShopScene` (`components/shop/`) con fondo imagen/vídeo, lista
  scrolleable a la derecha (icono, stats, precio dorado, stock), compra con
  confirmación Sí/No, DM con «Cerrar tienda». El jugador la ve a pantalla
  completa (combate > tienda > hoja); el DM la ve en la mesa y abre/cierra
  desde el panel «Tienda en la mesa» o desde la lista de tiendas.
- El editor de tienda pierde el toggle de abierta y gana «Fondo de la escena»
  (`ImageField`).

Deuda conocida de 4A-3:

- Comprar solo requiere ser jugador de la sesión, no una ficha concreta: el
  desbloqueo es de campaña.
- Un vídeo externo funciona por URL, pero la subida local solo acepta
  imágenes/GIF (multipart de 5 MB).
- Sin QA en navegador.

## 5. Cosas que hay que saber antes de tocar

- **Extras es una sola columna JSON**: cualquier escritura de bolsa/tiendas
  debe ser read-modify-write **dentro de una transacción**.
- **`combatStateSchema` recorta campos desconocidos**: todo campo nuevo del
  `CombatState` debe añadirse al schema o se pierde al guardar.
- `campaignSchema` es el contrato de import/export: los campos nuevos deben ser
  opcionales con default para no romper exports antiguos.
- Sin migraciones: nada de `ALTER TABLE`. 4C usará tabla nueva por DDL.
- UI nueva: primitivas y tokens `--ui-*`; no `bg-paper*`, `text-ink*`,
  `shadow-stamp`, `bg-white`.
- No commitear sin permiso del usuario.

## 6. Siguiente: 4B/4C — dungeon lineal+

La 4B/4C originales (lista de salas sin escena) quedan **sustituidas** por el
diseño de [`DISENO-DUNGEON-LINEAL.md`](./DISENO-DUNGEON-LINEAL.md):

- Salas como **escenas a pantalla completa** con fondo propio (imagen/GIF/URL
  de vídeo), texto público y notas privadas.
- Tipos: `encounter`, `boss`, `rest`, `treasure`; acciones del DM: iniciar
  encuentro, descansar, abrir cofre, avanzar, terminar.
- Run por sesión (`dungeon_runs` por DDL), recompensas de cofre reutilizando
  la economía y `shareLoot`/loot draft, hook de victoria para marcar la sala.
- Editor `DungeonsPage` + `DungeonEditorPage`, remapeo de ids de mazmorra y
  sala en export/import.
- Sin mapa, grid, niebla ni movimiento: eso es **Fase 5 (crawler 2D)**.

Orden recomendado: 4B (modelo + editor: shared, repository, rutas, tests, UI)
y luego 4C (run + escena). Checkpoint al final de cada uno. Después 4D
(backup/restore) y 4E (QA/docs).

## 7. Prompt sugerido para el siguiente chat

```text
Continúa PROTOCOL LIFE en /home/serahdml/Documents/GAMES/protocol-life.
Lee docs/HANDOFF-FASE-4.md, docs/DISENO-DUNGEON-LINEAL.md y
docs/PROMPTS-FASE-4.md. Fase 3 cerrada; 4A commiteada en 409f5e1 y los cambios
de combate del usuario en 4e523f8 (191/191, typecheck y build verdes; árbol
limpio).
Preflight: git status/log, npm test, npm run typecheck, npm run build.
Implementa 4B (modelo + editor de la dungeon lineal+): tipos/schemas/
validación, CRUD en extras, rutas DM, remapeo en export/import, tests con
SQLite temporal y UI (DungeonsPage + DungeonEditorPage). No toques combate ni
4C-4E. Checkpoint: tests/typecheck/build + resumen y espera OK. No commit.
```
