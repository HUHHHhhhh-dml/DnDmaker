# Changelog

## Icono de la skill en los pentágonos del combate (2026-10-29)

### Añadido

- Los **SkillSlots** de la escena de combate muestran la **imagen de la skill
  declarada** en ese slot, recortada con la silueta pentagonal del slot.
- El glifo (letra inicial) o el número de slot siguen apareciendo cuando no hay
  skill declarada, así que un slot vacío o una utilidad no cambian.
- El borde del pentágono, el tono de la línea de intención, el estado
  seleccionado y el atenuado de "unidad lista" se dibujan por encima del icono.
- Helper `declaredSkillForSlot` con tests: skill por slot, slot sin skill, otras
  acciones y skill borrada del contenido.

## Acción «Aumentar stacks» (2026-10-28)

### Añadido

- Nueva acción **Aumentar stacks** (`addStacks`) para los efectos: suma una
  cantidad al efecto activo que dispara el trigger.
- Respeta el `maxStacks` del efecto; si ya está en el tope no emite evento ni
  cambia nada.
- Solo afecta a efectos activos: los pasivos de objetos siguen sin modificarse,
  igual que ocurre con `Consumir stacks`.
- El editor de efectos incluye la acción con su campo **Cantidad** y el motor
  emite el evento de subida con los stacks resultantes.
- Test de aumento y tope máximo de stacks.

## Daño dirigido y en área desde efectos (2026-10-28)

### Añadido

- La acción **Daño** ahora tiene selector de objetivo:
  - **Portador**: el que lleva el efecto (default).
  - **Rival**: la unidad rival del trigger, si existe.
  - **Todos los demás**: todas las unidades vivas, aliadas y enemigas por
    igual, excluyendo al portador.
- `Damage.target: "allOthers"` resuelve el daño objetivo por objetivo, con su
  propia DEF y estado OVERCHARGED, y dispara `Al recibir daño` en cada unidad
  golpeada.
- Un efecto con `Al ser derrotado → Daño → Todos los demás` funciona como una
  explosión final que puede encadenar otras derrotas (respetando el límite de
  profundidad de triggers).
- Validación: `Rival` en un trigger sin rival avisa de que se ignorará.
- Tests de explosión al morir que daña por igual a un aliado y a un enemigo.

## Efectos activos al iniciar combate (2026-10-28)

### Añadido

- **`Item.startCombatEffects`**: efectos que el objeto aplica al portador como
  **activos** al empezar un encuentro, no como pasivos.
- Al ser activos, estos efectos **pueden consumirse o caducar** con las reglas
  normales; a diferencia de `Item.effects`, que sigue siendo pasivo y permanente
  durante el combate.
- El snapshot de combate los aplica con `applyEffect`, respetando stacks
  máximos, `stackMode`, duración y `sourceId` del objeto.
- El editor de objetos incorpora la sección **«Efectos al iniciar combate»**,
  separada de los efectos pasivos, y las tarjetas/selector muestran qué efectos
  iniciales aporta el objeto.
- Validación de referencias y `findReferences` cubren los efectos de inicio.
- Test de snapshot que comprueba que un mismo efecto puede existir como pasivo
  (1 stack permanente) y como activo (3 stacks consumibles).

### Corregido

- El editor de objetos ahora envía arrays vacíos (`effects`, `startCombatEffects`,
  `useEffect`) en lugar de omitirlos, y limpia también campos de texto/imagen
  vacíos. Antes, al quitar el último efecto de un objeto y guardar, el PATCH
  conservaba el array anterior y el efecto reaparecía.

## Efectos aplicados al rival (2026-10-28)

### Añadido

- Nuevo trigger **«Al golpear»** (`onDealDamage`): se dispara en el atacante
  cuando su golpe causa daño, con el enemigo golpeado como rival del trigger.
- **`applyEffect` con objetivo**: cada acción «Aplicar efecto» puede dirigirse
  al **portador** (default) o al **rival** del trigger. Esto permite que un
  objeto equipado aplique un efecto al enemigo al golpearlo.
- Los triggers **`onClashWin`**, **`onClashLose`**, **`onUseSkill`** y
  **`onTakeDamage`** también pasan su rival cuando existe, así que el selector
  «Rival» funciona en todos ellos.
- El editor de efectos añade el selector **Objetivo: Portador / Rival** y avisa
  si se elige Rival en un trigger sin rival (`roundStart`, `roundEnd`,
  `onDefeat`).
- Tests de efecto pasivo de objeto aplicando al rival al golpear, al ganar
  clash y de validación del aviso.

## Niveles, Soul Points y OVERCHARGED (2026-10-28)

### Añadido

- **Nivel de personaje** (`Character.level`, base 1) y botón «Subir nivel» en
  la ficha del DM. Las ganancias se calculan desde los ajustes de campaña, no
  se hornean en `baseStats`.
- **Progresión configurable por campaña** (`CampaignSettings.leveling`): tres
  opciones independientes para que el nivel suba **HP máximo**, **DEF** y/o
  **Soul Points**, cada una con su cantidad por nivel. Se configura al crear la
  campaña y también en los ajustes.
- **Coste en Soul Points por objeto** (`Item.soulCost`, 0 por defecto).
- Capacidad base de **10 Soul Points**; el nivel puede ampliarla. Los Soul
  Points usados son la suma del coste del equipo.
- **OVERCHARGED**: si el equipo supera la capacidad, el personaje recibe
  **1.5× daño** y se marca en la ficha, el muñeco de equipo, la hoja de combate
  y el log.
- El muñeco de equipo muestra `Soul Points usados/máximo` justo debajo de
  «Equipado N/5», con aviso OVERCHARGED cuando corresponde.
- El editor de objetos permite configurar el coste SP; las tarjetas y el
  selector de equipo lo muestran.
- Tests de stats/nivel, multiplicador de daño y snapshot de combate.

## Capas de skill delante y detrás del personaje (2026-10-28)

### Añadido

- **`Skill.backImage` y `Skill.frontImage`**: dos capas opcionales que se
  dibujan alrededor del personaje mientras la skill está activa. La trasera va
  detrás del cuerpo y del equipo; la delantera va por encima de todo. Se puede
  usar solo una o ambas.
- Funcionan con **cualquier modo visual**: fichas por capas y fichas de sprite
  único (incluidos enemigos y jefes). Se espejan junto al personaje en la
  escena cuando corresponde.
- El editor de Skills incorpora una sección de **Capas de combate** con campos
  independientes para la capa trasera y la delantera.
- La vista previa de la ficha y el renderer de combate (`CombatSprite`,
  `CombatScene`) componen `trasera → cuerpo + equipo → delantera`.
- `weaponImage` se mantiene como campo heredado para no romper campañas
  anteriores; el editor conserva su valor al guardar.
- Export/import y tests del plan visual cubren las capas nuevas.

## Fase 4F — Jefe enemigo con cambio de fase (2026-10-28)

### Añadido

- **Nuevo tipo de ficha `boss` («Jefe enemigo»)**, distinto de jugador, NPC y
  enemigo. En combate usa `team: "enemies"` y cuenta como enemigo para
  encuentros, recompensas y victoria/derrota.
- **Cambio de fase único por jefe** (`bossPhase`): al terminar la ronda con la
  vida en `thresholdPct` (1–99) o menos, el jefe pasa de la ficha base a la
  fase 2. La transición es **unidireccional**: curarse por encima del umbral no
  revierte sprite ni habilidades, y un jefe que muere en esa misma ronda no
  cambia.
- Overrides de fase 2 para nombre, descripción, retrato, modo visual, sprites y
  las tres skills. Si se omiten, se conservan los valores de la fase 1.
- La fase se evalúa **al final de la ronda**, después de daño/efectos y antes
  de avanzar `round`: las acciones ya declaradas usan la fase 1 y la fase 2
  está disponible para declarar en la ronda siguiente. El sprite se actualiza
  en cuanto se publica el estado resuelto.
- Evento de log `bossPhase` («Cambio de fase») y editor de ficha para
  configurar umbral, etiqueta, overrides visuales y habilidades de fase 2.
- Validación de referencias de skills de fase 2, listados y encuentros
  actualizados para reconocer jefes como enemigos.

## Fase 4E+ — skin Vetas de oro (2026-10-29)

### Añadido

- **Skin Vetas de oro**: obsidiana negra con vetas doradas procedurales, motas
  de oro y un brillo metálico sutil. El patrón se genera por cara en el atlas
  con una paleta de oro (sin naranja de lava) y usa el atlas como `emissiveMap`
  con intensidad baja para que las vetas destaquen sin parecer lava.
- Material más vítreo y metálico que la skin Negra, con contorno oscuro en los
  números para mantener la legibilidad.
- La bandeja se tiñe de obsidiana cálida con acentos dorados; el selector
  **Aspecto** pasa a siete opciones y la elección sigue persistiendo.
- Tests de contraste, patrón `gold-veins`, `emissiveFromAtlas`, contorno,
  metalness y lista estable de siete skins.

## Fase 4E+ — skin Volcánica (2026-10-29)

### Añadido

- **Skin Volcánica**: basalto oscuro con grietas de lava procedurales, brasas y
  vetas incandescentes. El patrón se genera por cara en el atlas (determinista,
  sin imágenes) y el propio atlas se usa como `emissiveMap`, de modo que las
  grietas y los números brillan de forma estática.
- **Contorno de tinta** opcional para números sobre texturas complejas; la
  volcánica lo usa para mantener el número legible sobre las grietas.
- La bandeja se tiñe de basalto y naranja lava; el selector **Aspecto** pasa a
  seis opciones y la elección sigue persistiendo.
- Tests de contraste, patrón de lava, `emissiveFromAtlas`, contorno y lista
  estable de seis skins.

## Fase 4E+ — skins Ámbar, Jade y Carmesí (2026-10-29)

### Añadido

- **Tres skins nuevas** para el dado 3D y la bandeja:
  - **Ámbar**: resina cálida, números oscuros, aristas y acentos dorados.
  - **Jade**: cuerpo verde profundo, números menta y acentos jade.
  - **Carmesí**: cuerpo vino, números crema y acentos cobre.
- La lista **Aspecto** pasa a cinco opciones; la elección sigue persistiendo en
  `localStorage` y se aplica al atlas, material, aristas, etiquetas flotantes y
  a los colores de la bandeja.
- Tests de contraste WCAG para las cinco skins, ids válidos, orden estable,
  fondos únicos y persistencia.

## Fase 4E+ — sonido de dados (2026-10-29)

### Añadido

- **Sonido sintetizado con Web Audio**, sin ficheros ni dependencias: roce de
  lanzamiento y chasquido por cada impacto de la trayectoria, con tono según el
  dado (d4 más agudo, d20 más grave) y paneo estéreo según el punto de la mesa.
  En multi-dado se acotan los impactos y se usa un compresor para no saturar.
- **Botón de altavoz** en la cabecera de la bandeja con estado persistido en
  `localStorage` (`protocol-life-dice-sound`, activo por defecto). Al reactivar
  suena una pequeña prueba; al silenciar se paran los sonidos programados.
- **Nat 20 y Nat 1 con sonido propio**: el 20 añade un arpegio de campana
  ascendente (cinco notas con armónico y chispas de ruido); el 1, un golpe grave
  descendente con retumbe de baja frecuencia. Suenan una vez por tirada, respetan
  el mute y se suman a los impactos de la caída.
- **Fallback con sonido**: las tiradas que caen al pop (sin 3D, WebGL o
  reduced-motion) reproducen un breve rattle; las que usa la escena 3D
  sincronizan los impactos con el reloj de audio.
- El `AudioContext` se crea y desbloquea dentro del clic/arrastre del usuario y
  se reanuda de forma perezosa; si el navegador lo impide, la tirada sigue sin
  sonido.

### Tests

- Preferencia persistida, estado del store, perfil de impacto, paneo, orden,
  acotado de impactos, tono por tipo de dado y especificación del arpegio del
  Nat 20 / golpe del Nat 1.

## Fase 4E+ — física para todos los dados (2026-10-29)

### Añadido

- **d4, d6, d8, d10 y d12 con física real**: geometrías compartidas en
  `diceGeometry.ts` (tetraedro, cubo, octaedro, trapezoedro pentagonal y
  dodecaedro), caras planas, numeración de opuestas y lectura del resultado.
  El d4 se lee por el **vértice superior**; el resto por la cara superior.
- **d100 como pareja de d10**: el servidor simula dos cuerpos (decenas y
  unidades), combina `00-90 + 0-9` (00+0 = 100) y el cliente muestra las dos
  caras y una etiqueta con el resultado combinado de cada pareja. Los topes
  físicos son 6 d100 (12 d10).
- **Atlas y malla genéricos**: cada cara poligonal se proyecta a un tile y se
  triangula con UVs; el d4 pinta tres números por cara, junto a sus vértices.
  Skins Hueso/Negra aplicadas a todos los dados.
- **Arrastre y rebotes en todos los dados**: el gesto envía `bounces` 1..4
  también para d4/d6/d8/d10/d12/d100; el servidor busca la restitución que
  clava el objetivo en todos los cuerpos (en d100, en los dos d10).
- **Multi-dado para todos los tipos**: d4/d6/d8 hasta 12, d10 hasta 10, d12
  hasta 7, d20 hasta 12 y d100 hasta 6; etiquetas por dado (o por pareja en
  d100), cámara de grupo y pop con suma/desglose. Por encima del tope se usa el
  pop clásico.

### Cambios

- `DiceRoll.trajectories` convive con `DiceRoll.trajectory` (dado único normal);
  en d100 `trajectory` no se usa y `trajectories` lleva los dos d10.
- `DiceTrajectory.face` es la cara (o vértice en d4); en d100 es la cara de ese
  d10 y el resultado combinado vive en `DiceRoll.results`.
- Se eliminó el atlas específico del d20; la escena 3D pasó a `DiceScene`.
- El emisivo del cuerpo se redujo para que la skin Negra mantenga el cuerpo
  oscuro y los números marfil legibles.

## Fase 4E+ — dados físicos, rebotes y skins (2026-10-28)

### Añadido

- **d20 con física real en el servidor**: caída, rebotes y cara superior
  simulados con `cannon-es`; la trayectoria grabada reproduce la misma tirada en
  todos los clientes y la cámara se acerca al número del resultado.
- **Lanzar arrastrando**: el dado grande de la bandeja se arrastra para orientar
  el lanzamiento. La distancia marca la fuerza y los **rebotes** contra la mesa
  (1..4); el servidor los usa como objetivo visual y ajusta la restitución sin
  tocar la cara final. El pop y la bandeja muestran «N rebotes en la mesa».
- **Skins Hueso/Negra**: lista desplegable bajo los dados, persistida en
  `localStorage`; cambia el atlas, material, aristas y emisivo del dado 3D y los
  colores/iconos de la bandeja. La negra usa cuerpo oscuro y números marfil.
- **Varios d20 en la mesa**: de 2 a 12 dados simulados en el mismo mundo con
  colisiones; `DiceRoll.trajectories` lleva una trayectoria por dado, la escena
  los reproduce juntos, la cámara encuadra el grupo y cada dado muestra su
  resultado en una etiqueta. El pop resume suma y desglose; Nat 20/1 por cara
  individual, cola y saltar se mantienen. Por encima de 12 dados se usa el pop.

### Cambios

- `DiceThrowInput` y el schema de la API aceptan `bounces` (1..4); los frames de
  trayectoria se redondean a 0,1 mm para reducir el payload (≈30 KB con 5 dados).
- El anillo de impacto solo aparece en contactos contra la mesa; las paredes y
  los choques entre dados no cuentan como rebote.
- El resultado sigue siendo autoridad del servidor: la simulación es la única
  fuente de las caras; si falla, la tirada cae al pop clásico.

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

- La cinemática de clash permanece 4,8 s por resolución (2 s más) y muestra una
  barra de progreso que indica cuándo se cerrará o pasará al siguiente clash.
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
