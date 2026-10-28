# Changelog

## Fase 4 — Contenido avanzado y operación (2026-10-28)

### Añadido

- **Economía Clean Shards (4A)**: bolsa común `campaign.wallet.cleanShards`
  persistida en `campaigns.extras.wallet`; el DM la ajusta y las recompensas de
  encuentro pagan moneda una sola vez e identifican el botín entregado.
- **Tiendas (4A/4A-2/4A-3)**: CRUD con objetos y skills, precio y stock; escena
  en vivo a pantalla completa con fondo imagen/GIF/vídeo. Comprar paga la bolsa
  y desbloquea el producto para la campaña (sin inventario ni equipado
  automático); `shop:state`, `state:full` y bloqueo en combate.
- **Reparto de botín (4A-2)**: `settings.shareLoot`; con OFF y 2+ jugadores se
  crea un loot draft por turnos en orden serpiente (SPD), con historial, saltar
  y cerrar. Tabla `loot_drafts` con DDL idempotente.
- **Mazmorras lineales+ (4B)**: `DungeonRoom` con `kind` (`encounter`, `boss`,
  `rest`, `treasure`), descripción pública, notas privadas, fondo, encuentro,
  recompensa y `unlockRewards`; CRUD DM en `campaigns.extras.dungeons`,
  validación, editor `DungeonsPage`/`DungeonEditorPage`, nav y contador.
- **Run de mazmorra (4C)**: tabla `dungeon_runs`, `DungeonRunService`, rutas
  `start/encounter/rest/chest/advance/end`, escena `DungeonScene` para DM y
  jugador, panel «Mazmorra en la mesa», hook de victoria, recompensas de cofre,
  idempotencia de cofres/descansos y prioridad combate > mazmorra > tienda >
  hoja. Tienda y mazmorra no conviven.
- **Skills en tienda y cofre**: `Shop.skills`, `DungeonRewards.skillIds`; comprar
  o abrir un cofre desbloquea la skill para la campaña sin equiparla. Los cofres
  con `unlockRewards` desbloquean también sus objetos.
- **Backup/restore (4D)**: `Database#backup` seguro con el servidor abierto,
  copia diaria en `data/backups/` con retención configurable, `npm run backup`,
  restore por CLI con validación de integridad, copia `pre-restore-*` y lock del
  servidor por PID. Sin endpoint HTTP de restore.
- **QA y documentación (4E)**: test end-to-end de Fase 4 con 2 jugadores,
  `README` de tiendas/mazmorras/backup y este changelog.
- **Dados de mesa**: bandeja bajo la bolsa de la party y en el panel lateral del
  DM, con d20, d12, d100, d10, d8, d6 y d4; botones +/− para tirar hasta 20
  dados del mismo tipo y sumarlos; tirada resuelta en servidor (`POST /dice`),
  pop de 5 s para toda la sala (`dice:rolled`) y log efímero de las últimas
  tiradas. Los **Nat 20** en d20 llenan la pantalla de brillitos dorados y los
  **Nat 1** muestran bordes rojos con un pequeño rumble; solo cuenta la cara
  individual, respeta `prefers-reduced-motion` y no cambia reglas. Sin SQLite ni
  cambios en combate.

### Cambios

- `EncounterRewards` y las recompensas de mazmorra comparten la entrega
  transaccional; `grantRewards` es la pieza común de encuentro y cofre.
- `validateShop` avisa cuando un objeto/skill **ya desbloqueado** no se podrá
  comprar (los bloqueados son los que se desbloquean al pagar).
- `state:full` y `GET /state` incluyen `lootDraft`, `activeShop` y `dungeonRun`.
- Export/import remapea tiendas, skills de tienda, mazmorras, salas, entrada,
  encuentros y recompensas de cofre.

### Corregido

- Las notas privadas de una mazmorra nunca viajan en la escena pública.
- El GET de mazmorras exige DM cuando la campaña está en vivo.
- Borrar un encuentro, objeto o skill referenciado por tienda/mazmorra queda
  bloqueado con `content_referenced`.
- El candidato de la tienda se reconstruye después de comprar, sin stock/estado
  obsoletos.

### Tests

- `npm test`: 256 tests en 23 archivos. Incluye economía, tiendas, skills,
  loot, mazmorras, run de mazmorra, backup/restore, dados (tirada múltiple,
  Nat 20/Nat 1) y QA end-to-end de Fase 4.
- `npm run typecheck` y `npm run build` verdes; solo el aviso conocido de chunk
  > 500 kB.
- Sin QA visual en navegador (el entorno no incluye tooling de screenshot).

## Fase 3 — Encuentros y combate (2026-10-27)

### Añadido

- **Encuentros**: enemigos con recuento y overrides, recompensas, dos capas de
  escena (piso/pared), tema `paper`/`night` y vista previa en el editor.
- **Dominio de combate**: snapshot de stats/equipo/skills/efectos, estado
  persistido en SQLite, HP persistente al terminar y `Rest party` fuera de
  combate.
- **Motor puro** en `packages/shared`: SPD base + tirada 1..4 con seed,
  iniciativa, clash por unidad, monedas, DEF/(DEF+100), daño mínimo 1, efectos,
  utilidad, dominio/hábitat y redirección con SPD estrictamente mayor.
- **Declaraciones y lock**: 2 slots base (máx. 6), acciones abiertas, lock por
  unidad y resolución automática cuando todas las unidades vivas están listas.
- **Socket.IO**: `combat:start`, `combat:declare`, `combat:lock`, `combat:event`,
  `combat:state`, `combat:ended` y `combat:scene`; permisos DM/jugador por token
  y `state:full` con el combate vivo para reconexiones.
- **Side-view real**: party a la derecha y enemigos a la izquierda, sprites en
  capas o `portrait`, fallback a placeholder, `weaponImage` al usar una skill,
  SkillSlots pentagonales, líneas de intención y `targetSlot` visual.
- **Cinemática de clash**: monedas girando, totales, perdedor tachado y daño
  correlacionado desde `CombatEvent`, sin bloquear la lógica.
- **Tema oscuro F0–F7**: tokens `--ui-*`/`--scene-*`, primitivas y shell,
  combate, mesa, fichas, dashboard, bibliotecas, editores y modales.
- **Leyenda de líneas** como botón `?` con overlay que se cierra al hacer click
  fuera o con Escape.

### Cambios

- La presencia manda: un jugador desconectado no entra al iniciar el combate. Si
  se desconecta a mitad, su unidad se auto-bloquea con cero acciones, la ronda
  puede resolverse y la unidad se conserva para la reconexión.
- Los jugadores ven el HP enemigo en porcentaje; el DM y la party lo ven exacto.
- En combate nadie edita fichas/HP: el DM solo controla enemigos.
- `targetSlot` es solo presentación; el clash sigue siendo por unidad.

### Corregido

- Clases Tailwind inertes (`border-ui-line-strong/NN` y variantes `hover:` sobre
  utilidades `ui-*`) que dejaban bordes/textos blancos plenos.
- La leyenda de líneas ya no tapa los SkillSlots.
- QR con zona de silencio (`marginSize={4}`) sin cambiar el layout.
- Contraste de textos sobre rellenos de acento (`text-ui-on-accent`).

### Tests

- `npm test`: 138 tests en 13 archivos (stats, validación, API, sesiones,
  realtime, combate, rondas, sockets, targetSlot y clash).
- `npm run typecheck` y `npm run build` verdes; solo el aviso conocido de chunk
  > 500 kB.
