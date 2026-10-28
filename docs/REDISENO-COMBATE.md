# Rediseño de combate (3F.5)

> Estado: prototipo visual aprobado en dirección. Pendiente de conectar al
> estado real. No forma parte de la QA final 3G.

## Decisiones aprobadas

- **Escena prioritaria**: la mesa de combate ocupa la mayor parte de la
  pantalla. Skills, estadísticas e inventario van debajo.
- **Party a la derecha, enemigos a la izquierda**.
- **Dos fondos**: BG-1 piso (`Encounter.background`) y BG-2 pared
  (`Encounter.backgroundWall`).
- **Tema de escena** `paper` / `night`, controlado por el DM en tiempo real.
  Los jugadores reciben el cambio; no pueden modificarlo.
- **SkillSlots pentagonales** encima de cada sprite. Click en slot → menú
  inferior de skills; click en skill → objetivos iluminados; click en objetivo
  → línea de intención.
- **Líneas**:
  - azul: ataque sin respuesta;
  - amarilla: clash;
  - roja: ataque enemigo;
  - verde: apoyo.
  El clash sigue siendo por unidad y sin importar slot (regla cerrada).
- **Velocidad**: cada unidad tira `SPD base + 1..4` al iniciar el combate,
  una vez, con la seed del combate. El total ordena turnos y redirección.
- **TargetSlot**: `DeclaredAction.targetSlot` es visual. No cambia el
  emparejamiento de clash.
- **HP enemigo visible para jugadores**: solo porcentaje redondeado. El DM ve
  HP exacto. La party ve su HP exacto.
- **Inspección de personaje**: click en sprite → stats abajo. El DM puede
  inspeccionar a cualquiera; un jugador solo a su personaje y aliados.

## Prototipo

Ruta aislada, sin tocar el combate real:

- `/design/combat` — escena por defecto.
- `/design/combat/night` — variante nocturna.
- `/design/combat/target` — modo selección de objetivo.
- `/design/combat/clash` — overlay de clash.
- `/design/combat/player` — perspectiva de jugador (sin HP exacto enemigo).
- Sufijo `-static` para capturas sin animaciones.

Componentes:

- `apps/web/src/pages/CombatScenePrototype.tsx`
- `apps/web/src/pages/CombatScenePrototype.css`

Assets de concepto (temporales):

- `apps/web/public/assets/design/bg-floor.png`
- `apps/web/public/assets/design/bg-wall.png`
- `apps/web/public/assets/design/sp-*.png`

Fuentes locales (OFL):

- `apps/web/public/fonts/darker-grotesque-latin.woff2`
- `apps/web/public/fonts/space-grotesk-latin.woff2`
- `apps/web/public/fonts/inter-latin.woff2`


## Estado de implementación

- ✅ Contrato servidor 3F.5: roll de SPD, `targetSlot` visual, escena de dos
  capas, tema y evento `combat:scene` solo DM.
- ✅ Editor de encuentros: `backgroundWall`, `sceneTheme` y preview de capas.
- ✅ HP enemigo en porcentaje para jugadores en tarjetas y log; DM/party exacto.
- ✅ `npm test`: 138/138 (13 archivos: contrato servidor, `targetSlot`,
  presencia/auto-lock y lectura de la cinemática de clash).
- ✅ Prototipo visual: stats al inspeccionar, vista DM/jugador, HP enemigo
  estimado, centrado, ficha y tema DM-only. Rutas `/design/combat/*`.
- ✅ Escena real reutilizable (`CombatScene`) integrada en jugador y DM:
  inspección, HP estimado, capas, tema DM, `targetSlot`, skills y avanzado.
- ✅ F1: primitivas y shell oscuro (tokens, tipografía, botones, paneles,
  campos, modales, Layout, foco y 404).
- ✅ Ajuste posterior: cabeceras de jugador y Join migradas al tema oscuro.
- ✅ F0: tokens semánticos `--ui-*`/`--scene-*`, utilidad `.tnum` y
  `theme-color` oscuro; sin cambio visual (mapa F0–F7).
- ✅ Presencia: los jugadores desconectados no entran al iniciar el combate y,
  si se desconectan a mitad, su unidad se auto-bloquea y la ronda se resuelve
  sin perderla.
- ✅ F2: cinemática de clash conectada a `CombatEvent` y combate migrado al
  tema oscuro (panel avanzado, log, resultado, tarjetas y vistas DM/jugador).
- ✅ F4: mesa, fichas, editor del jugador, muñeco, stats, dashboard, Join,
  tarjetas y PlayerTable en tema oscuro (QR y presencia verificados).
- ✅ F5: bibliotecas de efectos, encuentros, objetos, skills y personajes.
- ✅ F6: editores de objeto/skill/efecto/encuentro, acciones de efecto e imagen.
- ✅ F7: modal de campaña, pickers del muñeco, estados vacíos/carga y QA visual;
  el puente de alias `paper`/`ink` se mantiene hasta 3G.
- ✅ 3G: aceptación final de Fase 3 con flujo E2E de 2 jugadores y 2 rondas,
  HP persistente, Rest party, README y CHANGELOG.

## Cinemática de clash (F2)

- `apps/web/src/components/combat/ClashCinematic.tsx` escucha los `clash` nuevos
  de la timeline. Al montar se salta el log histórico (reconexión/recarga) y
  después encola solo lo que llega por `combat:event`; nunca bloquea la lógica.
- `apps/web/src/lib/clash.ts` interpreta `data` sin tipo: `attackerRoll`,
  `defenderRoll`, `winner`, `tie`, `cancelled` y `oneSided`. Las caras salen de
  `CoinRoll.faces` y el total de `CoinRoll.clashPower`.
- El daño no viaja en el `clash`: se correlacionan los `damage` posteriores
  (hasta el siguiente clash/fin de ronda), filtrando por `skillId` para no
  mezclar daño de triggers.
- La UI reproduce un clash a la vez: monedas girando, totales, ganador
  resaltado, perdedor tachado, daño en rojo y barra de HP restante. Auto-avanza
  a los 2,8 s; «Siguiente» y «Saltar» permiten controlarlo. Ataques sin
  respuesta muestran «Sin defensa» en el lado contrario.
- HP en la cinemática: DM/party exacto; hostiles para jugador en porcentaje
  (`≈N%`). El overlay se monta en un portal sobre `<body>` para que ningún
  ancestro con `transform` (`.animate-rise`) lo posicione contra la página.
- F2 también migró `CombatDeclarationPanel`, `CombatLog`, `CombatResultPanel`,
  `CombatantCard`, `CombatSprite`, `CombatVisualPreview`, `DmCombatConsole` y
  `PlayerCombatView` a `--ui-*`/`.panel-dark`; el bloque «Avanzado» conserva
  utilidad, dominio, hábitat y redirección, y la escena avisa de que esas
  acciones se declaran ahí.

## Presencia y jugadores desconectados (3F.5)

- `buildParty` solo incluye a un jugador si tiene `characterId` y
  `SessionPlayer.connected === true`.
- Si no queda ninguno, `startEncounter` responde `422 no_players`:
  «No hay jugadores conectados con ficha en la sala para iniciar el combate.»
  La comprobación va antes de instanciar enemigos y no crea estado de combate.
- A mitad de combate, el socket de combate llama a
  `CombatService.handlePlayerDisconnected(campaignId, characterId)` en el
  `disconnect` del jugador:
  - bloquea su unidad con las acciones que ya tuviera (cero si no declaró);
  - si con eso quedan todas las unidades vivas bloqueadas, resuelve la ronda
    igual que un lock normal;
  - no elimina la unidad: sigue en el snapshot y el lock se limpia al resolver
    la ronda, así que al reconectar puede declarar en la siguiente.
- Riesgo asumido: un corte de red momentáneo bloquea al jugador en esa ronda
  (no pierde unidad ni HP). El servidor no distingue un corte de un cierre de
  pestaña ni cuenta pestañas múltiples; es la misma presencia que ya usaba la
  mesa.

## Contrato servidor (3F.5, ya implementado)

- `Encounter`:
  - `background?: string` → capa **piso** (nombre histórico).
  - `backgroundWall?: string` → capa **pared**.
  - `sceneTheme?: "paper" | "night"` (ausente = `paper`).
- `CombatState.scene?: { floor?, wall?, theme? }`. Viaja dentro de `combat` en
  `combat:started`, `combat:state` y `state:full` (incluido `recentCombat`).
- `CombatUnit.spdRoll?: 1..4`. `stats.spd` ya incluye el roll; `baseStats` no
  cambia. Se conserva tras `resolveRound`.
- `DeclaredAction.targetSlot?: 1..6` (solo presentación). El servidor valida
  contra `target.stats.skillSlots` (`target_slot_out_of_range`).
- Cliente → servidor: `combat:scene { theme?, floor?, wall? }` (≥1 campo,
  `""` limpia capa), solo DM. La sala recibe `combat:state` con `scene`.
- Los jugadores pueden declarar sin `targetSlot` (compatibilidad).

## Plan de integración

1. Editor de encuentros: campos de pared y tema, con vista previa de capas.
3. Escena real reutilizable: misma composición que el prototipo, alimentada
   por `PublicCombatState` y `CombatEvent`.
4. Consola DM: inspección de stats, control de escena en vivo.
5. Jugador: escena, HP enemigo en porcentaje, inspección solo de party.
6. Migrar el resto de pantallas al tema oscuro.
7. QA final y aceptación en 3G.

## Riesgos / notas

- El HP exacto enemigo sigue viajando en el estado del servidor para que el
  motor resuelva. La UI de jugador lo oculta; si se quiere seguridad real,
  habrá que enviar una vista saneada por rol.
- Los assets del PDF son placeholders; los definitivos se subirán desde el
  editor o se sustituirán en `public/assets/design`.
- Las animaciones de clash se reproducen desde los `CombatEvent` ya resueltos;
  nunca bloquean la lógica.

## API propuesta para la escena real

```ts
interface CombatSceneProps {
  combat: PublicCombatState;
  campaign: Campaign;                  // contenido/definiciones
  viewer:
    | { role: "dm" }
    | { role: "player"; characterId: string };
  events: CombatEvent[];               // timeline ya resuelta
  onDeclare: (unitId: string, actions: CombatDeclaration[]) => void;
  onLock: (unitId?: string, actions?: CombatDeclaration[]) => void;
  onSceneChange?: (patch: CombatScenePatchInput) => void; // solo DM
  onInspect?: (unitId: string) => void;
}
```

Comportamiento:
- Party derecha / enemigos izquierda; sprites con `planCombatVisual`.
- Slots por `unit.stats.skillSlots`. Acciones de `combat.actions`.
- Líneas por acción: `targetSlot` si existe; si no, el centro de la unidad.
- DM: todos los slots enemigos editables; jugador: solo su unidad.
- Inspect: DM cualquiera; jugador solo party.
- HP enemigo para jugador: `Math.round(hp / hpMax * 100)%`.
- Tema/capas desde `combat.scene`; toggle DM → `combat:scene`.
- El drawer inferior reutiliza `CombatDraftAction`, `validateDraft`,
  `draftToPayload` y `specialForUnit` para no duplicar reglas.
- La UI no calcula daño, monedas ni clash; solo pinta `CombatEvent`.

## QA visual real (escena 3F.5)

Verificado con un servidor temporal en el puerto 3100 y SQLite temporal
(`mkdtemp`), sin tocar la base real ni NUUUMC:

- DM y jugador ven la escena real centrada, con capas y tema.
- DM declara una skill enemiga contra la party; el jugador la ve.
- Jugador declara su skill contra un hostil; la línea termina en el slot
  elegido (`targetSlot`).
- Al apuntarse mutuamente, la línea pasa a amarilla (clash por unidad).
- El DM cambia `paper` → `night`; el jugador recibe el cambio por
  `combat:state`.
- HP enemigo en jugador: `≈N%`; party y DM exactos.
- El jugador no puede inspeccionar hostiles; el aviso lo explica.
- Ronda resuelta desde sockets reales mientras la página está abierta: la
  cinemática muestra monedas, totales, perdedor tachado (`10` tachado), daño
  (`-34`) y HP estimado del hostil (`≈100% → ≈15%`); «Saltar» cierra el overlay.
- El bloque «Avanzado» se revisó abierto en DM y jugador: superficies oscuras,
  botones de utilidad/dominio/hábitat y el aviso de redirección legibles.
- Sin errores de consola.

## Cierre de 3G (aceptación de Fase 3)

Estado verde al cerrar la fase:

- `npm test`: 138/138 en 13 archivos; `npm run typecheck` y `npm run build` OK
  (solo el aviso conocido de chunk > 500 kB).
- Flujo E2E nuevo en `combat-round.test.ts`: 2 jugadores → encuentro → 2 rondas
  → efecto → victoria → fin, con HP persistente y `Rest party` fuera de combate.
- Determinismo con seed, reconexión a mitad, permisos y side-view ya cubiertos
  por la suite existente.
- QA real en servidor temporal (puerto 3100, SQLite `mkdtemp`) con Chrome
  headless: dashboard, mesa DM, mesa jugador, ficha de personaje, editor de
  jugador, Join, bibliotecas, editores de objeto/skill/encuentro, modal de
  campaña, resultado de combate, escena y cinemática de clash. Sin errores de
  consola.
- README con «Cómo jugar un encuentro» y `CHANGELOG.md` de Fase 3.
- El flujo de declaración avanzada (utilidad, dominio, hábitat y redirección)
  sigue en `CombatDeclarationPanel`; la escena solo declara skills de objetivo
  único y lo indica en el drawer. No se cambiaron reglas.

Deuda conocida (ninguna bloquea el uso actual):

- El HP exacto enemigo sigue viajando en el estado del servidor para que el
  motor resuelva; la UI de jugador lo oculta. Una vista saneada por rol sería
  trabajo de servidor, no de 3F.5.
- Los assets de `public/assets/design` y los placeholders de unidad son
  provisionales.
- Un corte de red momentáneo bloquea la ronda de ese jugador (auto-lock); no
  pierde unidad ni HP y puede declarar en la siguiente.
- El puente de alias `paper`/`ink` de `@theme` sigue vivo (ya no hay pantallas
  con `bg-paper*`/`text-ink*`, solo hovers y rellenos). Retirarlo es una tarea
  de cierre con QA global.
- D5 (textos de 7–9 px) se difirió: subirlos mueve alturas del muñeco y de las
  rejillas de stats.
- El contraste de `panel-dark` frente a `.panel` es sutil (~1,35:1); la señal
  principal es el borde `--ui-line-strong`.
