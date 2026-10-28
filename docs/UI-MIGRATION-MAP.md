# Mapa de migración de UI al tema oscuro

> **Estado:** F0–F7 completos (F2 incluye la cinemática de clash de 3F.5).
> Queda para 3G la retirada opcional del puente de alias.
>
> **3F.5 · auditoría de solo lectura.** Base: `f9b0b83` + cambios sin commitear.
> Se leyeron 37 archivos de `apps/web/src` (más de 16.000 líneas; el prototipo de
> combate está en edición activa por otros agentes). No se modificó código, no se
> instaló nada y no se tocaron `packages/shared`, `apps/server` ni
> `CombatScenePrototype.*`. Este documento es el único artefacto nuevo.
>
> **No propone** cambios de reglas, cálculos, copy ni modelo de datos. Solo
> presentación: superficies, color, tipografía, estados y composición.

**Cómo usarlo:** §0 fija los hallazgos que condicionan todo; §1 dice qué hay y qué
riesgo tiene cada archivo; §2 define las primitivas que evitan tocar 34 archivos a
mano; §3 propone la capa de tokens; §4 ordena el trabajo en fases pequeñas; §5
lista las decisiones pendientes; §6 es el checklist de QA visual; §7 mide dónde
está el coste.

---

## 0. Seis hallazgos que condicionan el orden

1. **El oscuro existe, pero en un compartimento estanco.** `@theme` sigue en clave
   clara y `body` usa `bg-paper` (`styles.css`), mientras `.sv-app` define 14
   variables locales `--sv-*` con las superficies noche (`#0a0907`, `#12100c`,
   `#181510`, `#211c15`). Son dos sistemas en paralelo que no comparten un solo
   token: migrar «el resto» no es reutilizar el prototipo, es extraer su tema.
2. **Los tokens son de paleta, no semánticos.** `ink` es a la vez texto y borde
   (`border-ink` 273 usos, `text-ink` 25), `paper` es a la vez fondo y texto
   (`bg-paper*` 138, `text-paper` 52). Cambiar los valores invierte significados
   (el sidebar `bg-ink` se funde con la página oscura). Se necesita una capa
   semántica (`--ui-surface`, `--ui-text`, `--ui-line`) antes de tocar pantallas.
3. **Los acentos semánticos no pasan contraste en oscuro.** Sobre `#17150f`:
   `moss` 2,62 · `rust` 2,44 · `steel` 2,33 · `rust-deep` 1,75 · `blood` 1,99.
   Solo `paper` (15,6), `paper-light` (16,6), `paper-deep` (13,5), `amber` (6,67)
   y `gold` (8,14) sirven como texto. En claro ya falla `ink-faint` (3,86 sobre
   paper) y se usa 185 veces a 8–10 px.
4. **La tipografía nueva está cargada pero no conectada.** Hay `@font-face` de
   Darker Grotesque, Space Grotesk e Inter, pero `--font-display` sigue en Arial
   Black y `--font-sans` en Segoe UI: solo el prototipo usa las fuentes nuevas.
   Además **JetBrains Mono no tiene `@font-face` ni `.woff2` en `public/fonts`**,
   así que `--font-mono` cae al mono del sistema pese a ~280 usos. En oscuro,
   ≈285 usos de `text-[8px|9px|10px]` con tracking 0,1–0,2 em son el mayor riesgo
   de legibilidad.
5. **La estructura visual depende de dos recursos que el oscuro rompe.** El borde
   `2px ink` y la sombra dura `#17150f` (`--shadow-stamp*`, literal) son la
   jerarquía del sistema; sobre fondo noche el borde se funde (≈1,0–1,2:1) y la
   sombra desaparece. El prototipo resuelve la profundidad con líneas `paper/15`,
   sombras negras grandes y viñeta: es otro lenguaje visual, no una inversión.
6. **El chrome está duplicado.** 5 pantallas de biblioteca repiten
   toolbar+buscador+pills+grid+empty; la ficha repite 10 cabeceras de sección a
   mano; hay 3 mapas de tono (StatChip, NoticeBar, `EVENT_TONE`) y 2 copias de la
   variante de botón. Sin primitivas, cada ajuste de oscuro se paga 5–10 veces.

### Contraste medido (WCAG)

Umbrales: 4,5:1 texto normal · 3:1 texto grande y componentes no textuales (1.4.3
y 1.4.11). Medido con los hex actuales de `styles.css`.

| Token | Hex | Sobre paper | Sobre ink | Sobre noche `#0a0907` | Uso en oscuro |
|---|---|---:|---:|---:|---|
| paper | `#f2ede0` | 1,00 | 15,61 | 17,03 | texto principal |
| paper-light | `#f8f4e9` | 1,06 | 16,61 | 18,11 | superficie elevada |
| paper-deep | `#e5ddc9` | 1,16 | 13,49 | 14,71 | superficie hundida |
| ink-soft | `#4b4639` | 8,04 | 1,94 | 2,12 | **solo en claro** |
| ink-faint | `#7d7665` | 3,86 | 4,04 | 4,41 | **falla AA en ambos** |
| rust | `#a1261e` | 6,39 | 2,44 | 2,66 | relleno + texto paper |
| rust-deep | `#7c1a15` | 8,91 | 1,75 | 1,91 | **solo en claro** |
| amber | `#d98b2b` | 2,34 | 6,67 | 7,28 | texto/indicador en oscuro |
| gold | `#d4a72c` | 1,92 | 8,14 | 8,87 | texto/indicador en oscuro |
| steel | `#33566b` | 6,69 | 2,33 | 2,54 | **solo en claro** |
| moss | `#4d5f3c` | 5,95 | 2,62 | 2,86 | **solo en claro** |
| blood | `#8b1d1d` | 7,84 | 1,99 | 2,16 | **solo en claro** |

Conclusión: en oscuro hay que **aclarar** moss/rust/steel/rust-deep/blood cuando
se usen como texto (propuesta en §3) y **no** reutilizar `ink-faint` como
secundario.

---

## 1. Inventario

Rutas según `App.tsx`: `/`, `/table`, `/items`, `/skills`, `/effects`,
`/characters`, `/encounters`, sus editores, `join/:code`, `play/:code` y el
prototipo aislado `design/combat/:variant`.

### P0 · Combate (prioridad absoluta)

| Archivo | Qué es | Elementos visuales | Riesgos de migración |
|---|---|---|---|
| `pages/CombatScenePrototype.tsx` + `.css` | Prototipo aislado de la escena (16:9, temas paper/night, variantes target/clash/player/static). **En edición: no tocar desde este mapa.** | stage con 2 capas de fondo, viñeta, tags, intel de hostiles, 2 bandos, unidad+sprite, slots pentagonales SVG, líneas SVG, leyenda, iniciativa/vitales, drawer de skills, aside de stats, overlay de clash, footer | 14 `--sv-*` fuera de `@theme`; 121 literales `rgb()`; 17 textos a 7 px y 24 a 8 px; posiciones absolutas (intel 208 px); `aspect-ratio 16/9` con `min-height 540` y `max-height calc(100vh−320px)`; a 1180/860 se reescribe la composición (4:5, 560 px, slots 38→29 px); `--sv-line` al 15 % (<3:1); tema de escena y tema de UI mezclados en el mismo archivo |
| `components/combat/DmCombatConsole.tsx` | Consola del DM: party/enemigos, declaración de enemigos, fichas, log, terminar combate. | panel, cabecera, chips de fase/estado, separador «VS», 2 columnas, panel de declaración, lista de fichas, log, confirm | 3 `.panel` anidados (borde+sombra duplicados); `bg-paper/50` y `bg-ink/20` como separadores; texto de 8 px; duplica la estructura de `PlayerCombatView`; dentro de `TablePage`, que también será oscura → hace falta jerarquía de superficies |
| `components/combat/CombatantCard.tsx` | Tarjeta de unidad del side-view (sprite, HP, stats, efectos, acciones). | borde 2 px, cabecera `paper-deep`, badge de orden, chip «Listo», sprite, barra HP, 3 celdas de stats, chips de efectos, utilidad, acciones declaradas | sombra arbitraria `shadow-[3px_3px_0_0_var(--color-amber)]`; `bg-paper-light/95`; etiquetas de 7 px; separadores con `gap-px bg-ink/20` (invisibles en oscuro); `opacity-75` para derrotado |
| `components/combat/CombatDeclarationPanel.tsx` | Declaración por unidad (3 slots, skill/objetivo/utilidad/redirección). | panel, callout de error/estado, tarjetas de acción, `Select`, botones listos/limpiar, 14 estados `disabled` | panel anidado con `border-2`; tarjetas `border-ink/35 bg-paper/55`; `.field` blanco dentro de bloque oscuro; `rust-deep` como texto; densidad 8–11 px |
| `components/combat/CombatLog.tsx` | Timeline de eventos con reproducción incremental. | panel, filas por evento, mapa de 13 tonos, botones reproducir/saltar, scroll `max-h-[420px]` | `EVENT_TONE` mezcla superficie, borde y texto en strings; «Derrota» invierte a `bg-ink text-paper`; 8 px; muchos nodos (coste de pintado); tonos sin token |
| `components/combat/CombatResultPanel.tsx` | Resultado + log del combate terminado. | panel tintado por ganador, icono hex/pent, chips de resumen, log | el color es la señal principal del resultado y el tinte (`moss`/`rust` al 10 %) pierde contraste en oscuro; `rust-deep`; el icono y el texto deben seguir bastando por sí solos |
| `components/combat/CombatSprite.tsx` | Renderer por capas del sprite de combate. | marco, capas `leg/armor/horns/hand`, `bg-grid`, sombra elíptica, overlay «Derrotado», badge «Actuando» | `bg-paper/45` (superficie clara); sombra `bg-ink/15` invisible en oscuro; `grayscale`; cualquier cambio de encuadre rompe el contrato 200×300 de las capas |
| `components/combat/CombatVisualPreview.tsx` | Vista previa del montaje en la ficha (2 usos). | igual que el sprite + badge de plan | `bg-paper/45`; 8 px; comparte riesgo de alineación con el sprite |
| `pages/PlayerCombatView.tsx` | Vista de combate del jugador. | panel tablero, «VS», resultado, panel de estado, aside declaración + log, `xl` 430 px | duplica el layout de la consola DM (divergencia); 8–11 px; mensajes `rust-deep`; aside fijo |

### P1 · Mesa y fichas

| Archivo | Qué es | Elementos visuales | Riesgos de migración |
|---|---|---|---|
| `pages/TablePage.tsx` | Mesa del DM: abrir sala, código/link, QR, PIN, iniciar encuentro, party en vivo, estado, 2 confirmaciones. | paneles, `panel-dark`, toggle, campos, QR 168 px, tiles de stats, tarjetas de jugador, `dl` de estado, `ConfirmDialog` | QR con `bgColor="#f8f4e9"`/`fgColor="#17150f"` hardcodeados (debe seguir claro para escanear); `bg-emerald-500/600`; caja de link `bg-paper`; aside 340 px; anida la consola de combate |
| `pages/PlayerTablePage.tsx` | Mesa del jugador: ficha, edición, combate, party, estado de sesión. | paneles, cabecera con retrato, chips, `EquipmentDoll`/editor, `CombatResultPanel`, aside | `bg-emerald-400`; 22 usos de 8–10 px; paneles y fichas conviven con el tablero de combate; aside de 340 px |
| `pages/JoinPage.tsx` | Entrada del jugador por link + PIN. | hero, código grande, chips, 3 pasos, formulario, panel de sesión guardada, errores | primera impresión del jugador; superficies claras y `hexagon` con `bg-paper-light`; 10 usos de 8–10 px; fondo de página claro |
| `pages/CharacterSheetPage.tsx` | Ficha completa: identidad, stats, equipo, skills, especiales, inventario, notas, preview, eliminar. | 10+ secciones `panel`, cabeceras numeradas a mano, `EquipmentDoll`, `StatPanel`, `ImageField`, sticky 320 px, `ConfirmDialog` | 10 cabeceras idénticas hechas a mano (`font-mono text-[10px]`); `sticky top-6`; 35 usos de 8–10 px; mucho texto secundario `ink-faint` |
| `components/PlayerSheetEditor.tsx` | Editor de ficha del jugador (01–05) con preview en vivo. | paneles, campos, `StatPanel`, `EquipmentDoll`, `ImageField` | mismos patrones que la ficha; 8 usos de 8–10 px; paneles anidados con `border-t-2` |
| `components/EquipmentDoll.tsx` | Muñeco de equipo: 5 slots, 3 skills, HP, badges, 2 pickers. | grid fijo `92/110/…px`, lienzo 167×250/200×300, barra HP redondeada, botones circle/hex/pentagon/shield, badges, modales | medidas fijas y `drop-shadow-[6px_10px_0_rgba(23,21,15,0.12)]` (sombra oscura sobre oscuro); el lienzo `bg-paper/50` es el fondo del personaje; alineación de capas intocable |
| `components/StatPanel.tsx` | Stats derivados, desglose, avisos. | 6 tiles con tinte (`rust/15`, `steel/15`, `amber/20`, `moss/15`, `gold/20`, `paper-deep`), deltas `moss`/`rust`, chips, avisos | tintes al 15–20 % sobre oscuro se ensucian; deltas a 2,4–2,6:1; 8–9 px; `paper-deep` como «sin acento» |
| `components/cards.tsx` | 5 tarjetas (objeto, skill, efecto, personaje, encuentro) + `CoinRow`. | `panel`, cabecera `paper-deep`, `bg-grid`, pentágono/hexágono, badges `moss`/`rust`, chips, stats 3×2 | `bg-paper-deep/light` en todo el cuerpo; badges de color como estado; 15 usos de 8–10 px; se usan en dashboard y listas, así que deben ser theme-aware |
| `pages/DashboardPage.tsx` | Panel de campaña: bienvenida, party, objetos, encuentros, reglas, estado. | secciones, `SectionTitle`, tarjetas, `panel-dark`, `dl` de reglas, enlaces `rust` | `panel-dark` sobre página oscura pierde sentido; 13 usos de 8–10 px; enlaces `text-rust` a 2,4:1 |

### P2 · Editores y listas

| Archivo | Qué es | Elementos visuales | Riesgos de migración |
|---|---|---|---|
| `pages/ItemsPage.tsx` | Biblioteca de objetos con pestañas DM/jugadores, filtros y búsqueda. | toolbar, segmentado, pills, buscador, grid 1/2/3, `ItemCard` | 7 usos de 8–10 px; pills dependen del borde; estado activo `bg-ink text-paper` |
| `pages/SkillsPage.tsx` | Biblioteca de skills con orden y filtros. | toolbar, segmentado, pills, selector de orden, grid, `SkillCard` | ternario de clases completo en el orden; activo `bg-moss`; 8 usos de 8–10 px |
| `pages/EffectsPage.tsx` | Biblioteca de efectos (la más simple). | buscador, contador, grid 1/2, `EffectCard`, empty | sin `lg:grid-cols-3` (rompe el patrón); campo blanco; **piloto ideal** |
| `pages/CharactersPage.tsx` | Listado de fichas con filtro y «Rest party». | buscador, pills, grid, `CharacterCard`, footer de conteos | disabled + `title` como único motivo; chips de conteo; `ink/15` |
| `pages/EncountersPage.tsx` | Listado de encuentros con aviso de enemigos. | buscador, barra ámbar, grid, `EncounterCard` | aviso escrito a mano (duplica `NoticeBar`); icono `rust` sobre `amber/10`; 8 px |
| `pages/ItemEditorPage.tsx` | Editor de objeto con preview sticky. | paneles, campos, `ImageField`, efectos, preview, aside | 7 `.panel`; `border-0 bg-white/60`; preview `paper-deep`; 15 usos de 8–10 px |
| `pages/SkillEditorPage.tsx` | Editor de skill (monedas, clash, daño, efectos). | paneles, campos, `ImageField`, refs de efecto, preview | `bg-white/60` en dos campos inline; 7 paneles; 17 usos de 8–10 px |
| `pages/EffectEditorPage.tsx` | Editor de efecto (triggers + acciones). | paneles, campos, `EffectActionEditor`, preview | 6 paneles; filas de acción anidadas; 13 usos de 8–10 px |
| `pages/EncounterEditorPage.tsx` | Editor de encuentro (enemigos, recompensas, texto, preview de escena). | paneles, filas de enemigo, checkbox, resumen sticky, select de tema y preview 16:9 con piso/pared | 16 usos de 8–10 px; el preview de escena es una **segunda implementación** de capas (filtros y máscara inline) que debería usar la primitiva `SceneStage`; badge a 8 px |
| `components/EffectActionEditor.tsx` | Editor de acciones de efecto. | filas `border-2 border-ink/70`, cabecera `paper-deep/60`, `Select` sin borde, grids de campos | fila anidada sobre panel: 3 niveles de borde; `Select` con `border-0 bg-transparent` y `focus:shadow-none` pierde foco visible |
| `components/ImageField.tsx` | Subida/URL de imagen con preview. | tile `paper-deep`, franja `rust` en retrato, botones, spinner, error | tile claro sobre oscuro; el error `text-rust` a 2,4:1 |

### P3 · Transversales, modales y estados

| Archivo | Qué es | Elementos visuales | Riesgos de migración |
|---|---|---|---|
| `components/ui.tsx` | Kit de primitivas: botones, campos, toggle, cabeceras, empty/loading, modal, confirm, chip, tags, toast. | todo el repertorio | **cuello de botella**: `.field` blanco, `.panel` claro, `.chip` claro, sombras stamp, `bg-ink/60` de scrim, foco y disabled; duplica la variante de botón y el mapa de tonos |
| `components/CampaignModals.tsx` | Nuevo/editar campaña con pestañas, reglas, mesa y zona peligrosa. | modal, tabs, toggles, bloques hundidos, callouts, confirm | tabs a mano; `bg-paper/60`; `rust-deep` en zona de borrado (1,75:1); doble scroll |
| `components/Icons.tsx` | 27 iconos SVG a `currentColor`. | icono, trazo 2 | sin tono propio: hereda `ink` en contenedores claros; en oscuro deja de verse; sin tamaño/grosor por contexto |
| `components/Layout.tsx` | Shell: sidebar ya `bg-ink`, drawer móvil, bienvenida, splash, footer, barra de carga. | nav, select de campaña, `panel` de sala, botones ghost, barra superior, `bg-emerald-400` | sidebar y página ambos oscuros → sin separación; `bg-emerald-400`; bienvenida y splash tienen fondos claros propios; `bg-hatch` oscuro |
| `App.tsx` | Rutas + 404. | `panel`, 404 gigante, 2 botones | `text-ink/10` desaparece en oscuro; 404 duplica `EmptyState`; no hay proveedor de tema (las rutas de jugador viven fuera de `Layout`) |

---

## 2. Patrones repetidos → primitivas del tema

Estas son las piezas que, si existen, hacen que el oscuro se arregle en un sitio y
no en 34 archivos. No implican cambiar lógica ni props de datos: son envoltorios de
presentación.

| Primitiva propuesta | Sustituye a | Dónde se repite | Estados que debe cubrir |
|---|---|---|---|
| `Surface` / `Panel` (`tone: base\|raised\|inset\|overlay\|dark`) | `.panel`, `.panel-lg`, `.panel-dark`, `border-2 ... bg-paper/xx` | 88 usos de `panel` en 20 archivos | borde, elevación, recorte `cut-corner`, sin sombra dura |
| `Button` / `IconButton` (`primary\|accent\|danger\|ghost\|ghost-dark`) | `.btn*`, `Button`, `LinkButton` | 2 copias del mapa variant→clase; acciones destructivas hoy usan `accent`/`ghost` | hover, active, **focus-visible**, disabled, loading, solo-icono |
| `Field` + `Input/Number/Select/Textarea` (`variant: default\|inline`) | `.field`, `TextInput`, `NumberInput`, `Select`, `TextArea` | 7 controles + `border-0 bg-white/60` en 3 archivos | label, hint, error, foco, disabled, lectura, inline en celdas |
| `Chip` / `Badge` (`tone: neutral\|ok\|danger\|warn\|info\|muted`) | `.chip`, `.chip-accent`, `.chip-rust`, badges a mano | 58 + 9 + 9; 3 mapas de tono | contador, icono, truncado, `max-width` |
| `StatTile` / `StatGrid` | `.stat-tile` (0 usos), celdas de `cards`, `CombatantCard`, `TablePage`, `DollStatBadge` | 6 sitios con grid de stats | label, valor, delta ±, hint, compacto, cifras tabulares |
| `Meter` / `HpBar` (`party\|enemy\|percent\|clash`) | 3 barras HP + barra de resultado + arco HP del muñeco | 6 sitios | valor/máx, %, daño reciente, tamaño xs/sm/md, `role=progressbar` |
| `PentagonSlot` (SVG, no `clip-path`) | `SlotButton` del prototipo, `SkillSlotButton`, `EquipmentSlotButton`, `EmptyState` | 23 pentágonos + 10 hexágonos | normal, activo, targetable, incoming, tono, disabled, tamaño, foco |
| `Card` (media + cabecera + badges + cuerpo + pie) | `ItemCard`, `SkillCard`, `EffectCard`, `CharacterCard`, `EncounterCard` | 5 tarjetas, 3 grids distintos | hover, imagen/placeholder, badges, chips, truncado |
| `SectionHeader` / `PanelSection` (numerada, contador, acción) | `SectionTitle` + 10 cabeceras a mano | ficha ×10, editores ×4 | número, título, contador, acción, borde inferior |
| `ListToolbar` + `SearchField` + `SegmentedTabs` + `FilterPill` + `ResultsLine` + `CardGrid` | toolbar/buscador/pills/segmentado/línea de conteo | 5 bibliotecas, idénticas | colapso móvil, contador, activo, wrap, `overflow-x` |
| `Modal` + `ConfirmDialog` + `DangerZone` + `Sheet` | `Modal`, `ConfirmDialog`, pickers del muñeco, drawer de combate | 3 modales + 2 pickers + drawer | foco atrapado, Escape, scroll lock, footer, ancho, tono peligro |
| `Callout` / `Notice` (inline + toast) | `NoticeBar`, cajas de error de 8 archivos, aviso de encuentros | 10+ copias | tono ok/error/info/warn, icono, acción, cierre |
| `EmptyState` / `LoadingBlock` / `ErrorState` | `EmptyState`, `LoadingBlock`, 404 de `App`, «sin unidades» | 12+ copias | icono, título, descripción, acción, compacto |
| `Icon` + `StatusDot` / `IconTile` | `Icon`, puntos `bg-emerald-*`, tiles con borde | 27 iconos, 8 puntos de estado | tono, tamaño, tile, pulso, etiqueta |
| `SceneStage` | stage del prototipo + preview del editor de encuentros | 2 implementaciones de capas (CSS del prototipo y filtros inline del editor) | capas BG, viñeta, tags, intel, leyenda, dim de targeting, tema paper/night |

**Regla de adopción:** ninguna pantalla nueva a partir de F1 debería usar
`bg-paper*`, `text-ink*`, `border-ink` ni `shadow-stamp` directamente. Esas clases
quedan solo dentro de las primitivas y de los gráficos de escena.

---

## 3. Capa de tokens propuesta

### 3.1 Superficies, texto y líneas

Tomar las superficies noche del prototipo y convertirlas en tokens globales. Los
valores de texto están verificados contra `#12100c` (peor caso de superficie
elevada).

| Token | Valor | Contraste sobre `#12100c` | Nota |
|---|---|---:|---|
| `--ui-bg` | `#0a0907` | — | fondo de app, nunca `#000` puro |
| `--ui-surface-1` | `#12100c` | — | panel base |
| `--ui-surface-2` | `#181510` | — | panel elevado / cabecera |
| `--ui-surface-3` | `#211c15` | — | hundido / hover |
| `--ui-text` | `#f2ede0` | 16,26 | texto principal |
| `--ui-text-muted` | `#b9b1a1` | 8,93 | secundario (sustituye `ink-soft`) |
| `--ui-text-faint` | `#8d8473` | 5,14 | auxiliar mínimo (sustituye `ink-faint`) |
| `--ui-line` | `rgb(242 237 224 / 18%)` | 1,62 | decorativa |
| `--ui-line-strong` | `rgb(242 237 224 / 40%)` | 3,43 | bordes de control (3:1) |
| `--ui-ok` | `#9fbc8c` | 9,09 | texto de éxito |
| `--ui-danger` | `#e2796c` | 6,50 | texto de error/peligro |
| `--ui-info` | `#8fb6cf` | 8,83 | texto informativo |
| `--ui-warn` | `#e09a3f` | 8,02 | aviso |
| `--ui-accent` | `#d98b2b` | 6,95 | acción/énfasis (ya válido) |
| `--ui-gold` | `#d4a72c` | 8,47 | recompensa/dato |

Los tokens de paleta (`paper`, `ink`, `rust`, `moss`…) se conservan para
ilustración, badges con texto `paper` encima y la escena. **No** se usan como
texto sobre oscuro salvo `paper*`, `amber` y `gold`.

### 3.2 Tipografía

| Token | Familia | Uso | Estado actual |
|---|---|---|---|
| `--font-display` | Darker Grotesque | titulares ≥20 px y cifras grandes | apunta a Arial Black |
| `--font-ui` | Space Grotesk | labels, tabs, cifras medianas, kickers | **no existe** |
| `--font-sans` | Inter | texto corrido | apunta a Segoe UI |
| `--font-mono` | JetBrains Mono | datos, IDs, códigos | sin `@font-face` ni woff2 → fallback |

Reglas de migración tipográfica:

- Activar `font-variant-numeric: tabular-nums` en toda cifra que se compare en
  columna (HP, stats, daño, iniciativa, monedas, contadores).
- Cifras de tabla y HP → Space Grotesk o JetBrains Mono; Darker Grotesque solo en
  titulares y cifras ≥24 px (a 8–10 px se vuelve ilegible).
- Subir el mínimo: retirar `text-[8px]` y `text-[9px]` de contenido; 10 px como
  mínimo de label y 11–12 px para datos. Reservar 9 px solo para glifos no
  esenciales (número de slot).
- Reducir tracking 0,02–0,04 em al pasar a Space Grotesk/Inter: sus métricas son
  más anchas y los 0,18–0,22 em actuales rompen líneas.
- Añadir el woff2 de JetBrains Mono y su `@font-face`, o cambiar `--font-mono` a
  una familia disponible (decisión D4).

### 3.3 Profundidad, forma y foco

- **Sombra:** `--shadow-stamp*` usa `#17150f` literal. En oscuro se sustituye por
  elevación real: `0 24px 60px rgb(0 0 0 / 55%)` + `inset 0 1px 0 rgb(242 237 224 / 6%)`
  para paneles, y una variante corta para popovers. Si se quiere conservar el
  «stamp», debe ser `3px 3px 0 0 #000` + línea interior clara (decisión D2).
- **Bordes:** los 273 `border-ink` de 1–2 px pasan a `--ui-line` (decorativo) o
  `--ui-line-strong` (control). Un borde de 2 px `paper/18` no llega a 3:1 y no
  sirve como límite de control.
- **Recortes:** `.btn`, `.pentagon`, `.hexagon` y `.cut-corner` usan `clip-path`;
  el borde 2 px no sigue la silueta recortada (se ve un cuadrado cortado). En
  oscuro, sin sombra, la forma se pierde: usar SVG para pentágonos/hexágonos
  (como el `SlotButton` del prototipo, con `vector-effect: non-scaling-stroke`).
- **Foco:** hoy `focus-visible` solo existe en los slots del prototipo; `.field`
  usa `box-shadow` inset ámbar y el resto confía en el outline del navegador.
  Tokenizar un anillo de 2 px `--ui-accent` + `offset 2px` y aplicarlo a botones,
  pills, tabs, slots, links y filas clicables.
- **Scrim:** `bg-ink/60` sobre página oscura no separa. Usar
  `rgb(0 0 0 / 72%)` + `backdrop-blur`.
- **color-scheme:** declarar `color-scheme: dark` para scrollbars, selects y
  autofill nativos.

### 3.4 Dos temas que no se deben mezclar

- **Tema de UI** (global, oscuro): superficies, texto, controles, modales.
- **Tema de escena** (`paper` / `night`, lo controla el DM en vivo): fondo, viñeta,
  iluminación del stage. Un stage `paper` dentro de una UI oscura es intencional.

Los tokens deben llamarse distinto (`--ui-*` vs `--scene-*`). Si se reutiliza
`--ui-bg` para la escena, el control del DM dejará de tener efecto o cambiará la
UI entera.

---

## 4. Orden de migración en fases pequeñas

Criterio: cada fase se puede revisar sola, no cambia reglas ni estado y deja la
app usable. **F0 y F1 no tocan ningún archivo de combate.** F2 toca la
presentación del combate, nunca su lógica.

### F0 · Fundación de tokens (sin cambio visual)

- Añadir en `styles.css` los tokens `--ui-*`, `--scene-*`, fuentes y escala; dejar
  alias de compatibilidad para que las clases actuales sigan compilando igual.
- Declarar `data-ui-theme` / `color-scheme` y `theme-color` en `index.html`.
- Si se usan utilidades `dark:`, declarar `@custom-variant dark` ligado a
  `data-ui-theme`; hoy no hay ninguna en el código, así que la estrategia es
  atributo + tokens, no `dark:` por clase.
- Corregir `--shadow-stamp*` para que use variables, no hex.
- **Salida:** build verde y capturas idénticas a hoy (solo cambia el CSS
  disponible, no lo aplicado). Sin tocar componentes.

### F1 · Primitivas y shell (sin combate)

- Reescribir `.panel/.btn/.field/.chip` y `ui.tsx` sobre los tokens nuevos, con
  `tone` y estados de foco/disabled.
- Migrar `Layout` (sidebar, drawer, splash, bienvenida, footer), `App` (404) e
  `Icons` (tono heredado correcto).
- **Salida:** shell oscuro revisable con el checklist de §6 sin abrir ninguna
  pantalla de combate.

### F2 · Combate P0 sin lógica — ✅ hecho (3F.5)

- `DmCombatConsole`, `CombatantCard`, `CombatDeclarationPanel`, `CombatLog`,
  `CombatResultPanel`, `CombatSprite`, `CombatVisualPreview`, `PlayerCombatView`.
- Solo clases y JSX de presentación: mismos props, mismos stores, mismos textos,
  mismos roles ARIA. El tema se aplica al subárbol de combate para no obligar a
  migrar `TablePage` en la misma fase.
- Migrado a `--ui-*`/`.panel-dark`: `panel` anidado del avanzado, tonos del log,
  bordes de 2 px, sombras invertidas (`bg-ink/15`, `bg-ink/45`), cabeceras,
  separadores y textos `rust-deep`/`ink-*`.
- Añadida la cinemática de clash real (`ClashCinematic` + `lib/clash.ts`):
  monedas, totales, tachado, daño correlacionado y HP por rol, disparada por
  `CombatEvent` sin tocar el motor.
- **Salida:** una ronda completa (declarar → listos → resolver → cinemática →
  resultado) se ve igual de funcional y en oscuro; sin cambios en el snapshot ni
  en el log.

### F3 · Escena P0

- Extraer `--sv-*` a tokens `--scene-*` y sustituir los 121 `rgb()` por tokens.
- Llevar slots, líneas, drawer y overlay de clash a las primitivas de §2.
- Unificar la escena y el preview del editor de encuentros en `SceneStage`.
- El contrato de escena (`backgroundWall`, `sceneTheme`, `combat.scene`) está
  aterrizando en paralelo (shared/server/editor en edición). F3 no lo implementa:
  solo debe empezar cuando ese contrato esté estable.
- **Salida:** prototipo `design/combat/:variant` y preview del editor idénticos en
  composición, alimentados por tokens; sin romper la variante `paper`.

### F4 · Mesa y fichas P1 — ✅ hecho (3F.5)

- `TablePage`, `PlayerTablePage`, `JoinPage`, `CharacterSheetPage`,
  `PlayerSheetEditor`, `EquipmentDoll`, `StatPanel`, `cards.tsx`, `DashboardPage`.
- `cards.tsx` antes que las pantallas: dashboard y bibliotecas dependen de ellas.
- Migrados a tokens: superficies `bg-ui-surface-*`, líneas `border-ui-line*`,
  texto `text-ui*`, rellenos `bg-ui-ok`/`bg-ui-faint`; `text-paper` sobre
  rellenos pastel pasa a `text-ui-on-accent`.
- Corregidas clases inertes `border-ui-line-strong/NN` (Tailwind las descartaba
  y dejaba un borde blanco pleno).
- QR: plate claro intacto y zona de silencio `marginSize={4}` (misma caja).
- Decisiones aplicadas: D2 «stamp» retirado del uso (los tokens se limpiarán en
  F7), D3 1 px para paneles/divisores y 2 px solo en callouts, arte sobre plate
  oscuro, `panel-dark` se mantiene como inset. D5 (escala 7–9 px) se difiere a F7
  para no mover alturas del muñeco ni de las rejillas.
- **Salida:** mesa en vivo y ficha completas en oscuro; QR y estados de conexión
  verificados.

### F5 · Bibliotecas P2 — ✅ hecho (3F.5)

- `EffectsPage`, `EncountersPage`, `ItemsPage`, `SkillsPage`, `CharactersPage`.
- Toolbars, pills de visibilidad, buscador, grids y empty states migrados a
  `--ui-*`; `cards.tsx` ya venía oscuro de F4.
- No se extrajeron primitivas nuevas (`ListToolbar`, `SegmentedTabs`…) para no
  cambiar estructura: queda como deuda opcional de 3G.
- **Salida:** las 5 listas se ven en oscuro y conservan filtros, contadores y
  navegación.

### F6 · Editores P2 — ✅ hecho (3F.5)

- `ItemEditorPage`, `SkillEditorPage`, `EffectEditorPage`, `EncounterEditorPage`,
  `EffectActionEditor`, `ImageField`.
- Formularios, previews sticky, callouts de error, selects inline y campos de
  imagen migrados; se eliminaron `bg-white/60` y los overrides de foco.
- **Salida:** guardar/validar sigue igual; los editores se ven en oscuro.

### F7 · Modales/estados P3, flip global y QA — ✅ hecho (3F.5)

- `CampaignModals`, pickers del muñeco, toast, empty/loading/error: migrados a
  primitivas y tokens; el modal de ajustes se verifica en QA.
- El puente de alias `paper`/`ink` de `@theme` **se mantiene** hasta 3G: ya no
  hay pantallas con `bg-paper*`/`text-ink*`, pero los alias de acento siguen
  usándose en hover y rellenos. Retirarlo es un cambio de cierre, no de F7.
- QA visual final: dashboard, mesa DM, mesa jugador, ficha, editor, Join,
  bibliotecas, editores, combate y clash.

**Dependencias:** F1 antes que F2–F7; `cards.tsx` antes que dashboard y listas;
`ui.tsx` antes de cualquier formulario. `CombatScenePrototype.*` no se toca
mientras siga en edición.

---

## 5. Decisiones pendientes (una sola vez, no por pantalla)

- **D1 · ¿Invertir `paper/ink` o crear tokens semánticos?** Recomendado: tokens
  semánticos con alias, para no reinterpretar 273 `border-ink`. Si se invierte la
  paleta, el sidebar, `.panel-dark` y los botones primarios cambian de significado.
- **D2 · Sombras.** ¿Se retira el «stamp» en oscuro (recomendado) o se conserva
  como `#000` + línea interior? Afecta a botones, paneles, modales y tarjetas.
- **D3 · Bordes.** ¿2 px `paper/40` para controles (visible, 3:1) o 1 px
  `paper/18` (más cerca del prototipo, pero sin contraste de componente)?
- **D4 · JetBrains Mono.** Añadir el woff2 + `@font-face` o cambiar `--font-mono`
  a una familia instalada. Sin esto, «datos» no tiene tipografía propia.
- **D5 · Escala tipográfica.** Confirmar mínimos (10 px label / 11–12 px dato) y
  el tracking reducido; cambia el alto de tarjetas y tablas.
- **D6 · Tema por rol.** El jugador (`join`/`play`) y el DM comparten tokens; si
  el jugador debe tener una variante más «mesa» (más contraste, menos densidad),
  definirlo antes de F4.

Ninguna de estas decisiones toca reglas, cálculos ni modelo de datos.

---

## 6. QA visual (checklist)

### 6.1 Contraste

- [ ] Texto normal ≥4,5:1; grande ≥3:1; bordes de control e iconos ≥3:1.
- [ ] `ink-faint` y `ink-soft` no aparecen como texto en oscuro; sustituidos por
      `--ui-text-faint` / `--ui-text-muted`.
- [ ] `moss`, `rust`, `steel`, `rust-deep`, `blood` como texto solo en sus
      variantes aclaradas.
- [ ] Tintes (`*/10`, `*/15`, `*/20`) no se usan como color de texto.
- [ ] Estados (ok/error/aviso) no dependen solo del color: llevan icono o texto.
- [ ] El color de las 4 líneas de combate se distingue también en deuteranopía
      (azul/amarillo/rojo/verde) mediante guion, grosor o glifo.

### 6.2 Foco y teclado

- [ ] Todo interactivo tiene `:focus-visible` visible (hoy solo los slots).
- [ ] Anillo de foco no se recorta con `clip-path`; en slots y botones se ve
      completo.
- [ ] `Modal` atrapa el foco, Escape cierra y el foco vuelve al disparador
      (hoy solo hace Escape + scroll lock).
- [ ] Orden de tabulación coherente en drawer de combate, tabs y modales.
- [ ] Foco visible sobre `bg-amber/10`, `bg-rust/10` y `bg-paper/50`.

### 6.3 Disabled, loading y errores

- [ ] `disabled` no se comunica solo con `opacity-40` (≈1,5:1): añadir superficie
      propia y `cursor-not-allowed`; el motivo no depende solo de `title`.
- [ ] `aria-disabled`/`disabled` correctos en botones de declaración y «Listo».
- [ ] Spinner y `loading` visibles en oscuro; texto de carga legible.
- [ ] Errores de formulario y callouts usan `--ui-danger`, no `rust-deep`.

### 6.4 Responsive

- [ ] 320, 360, 390, 768, 1024, 1280, 1440, 1920 sin scroll horizontal.
- [ ] Escena: 16:9 en desktop y 4:5 a ≤860; nada de sprites/slots recortados;
      `max-height calc(100vh−320px)` no colapsa en portátiles de 768 px de alto.
- [ ] Drawer de combate apila identidad + skills + aside; skill cards a 1 columna.
- [ ] Slots táctiles: hoy 29 px a ≤860 (<44 px recomendado) — verificar si se
      acepta o se agrandan.
- [ ] Asides fijos (340/430/320 px) no ahogan el contenido a 1024 px.
- [ ] Modales: bottom sheet en móvil, sin doble scroll (overlay + `max-h-[70vh]`).
- [ ] `sticky` de fichas/editores no tapa el header móvil.

### 6.5 Tipografía y cifras

- [ ] Sin `text-[8px]`/`text-[9px]` en contenido; labels ≥10 px y datos ≥11 px.
- [ ] Cifras tabulares alineadas en columnas (HP `x/y`, stats, daño, iniciativa,
      contadores, monedas).
- [ ] Negativos, `+0`, `—`, `0/0` y tres cifras no desalinean ni recortan.
- [ ] Darker Grotesque solo ≥20–24 px; Space Grotesk/JetBrains en datos.
- [ ] Fallback correcto si JetBrains Mono no carga (ver D4).
- [ ] Uppercase + tracking no parte palabras en 320 px.

### 6.6 Escena de combate

- [ ] Party a la derecha, enemigos a la izquierda, stage centrado.
- [ ] Slots encima de cada sprite, sin solaparse ni salir del stage.
- [ ] Intel: HP enemigo exacto solo DM, porcentaje redondeado en jugador; party
      siempre exacta.
- [ ] Líneas azul/amarillo/rojo/verde con halo y nodo legibles sobre ambos fondos.
- [ ] Modo targeting: dim del stage, resaltado de objetivos y slots, pulso
      desactivado con `prefers-reduced-motion`.
- [ ] Clash overlay por encima del drawer y del toast (hoy ambos en `z-60`).
- [ ] Tema `paper` y `night` conservan legibilidad; el cambio de tema de UI no
      altera el tema de escena.
- [ ] Fondos con transparencia/filtros no dejan halos ni bordes claros.

### 6.7 Específico de oscuro

- [ ] Ningún `#000` puro como fondo; sin «flash» blanco al cargar (`body`,
      `theme-color`, splash).
- [ ] Imágenes con fondo transparente se ven sobre superficie, no sobre paper.
- [ ] QR del lobby sigue con fondo claro y zona de silencio (no invertir).
- [ ] Scrollbars, `::selection`, autofill y controles nativos en oscuro.
- [ ] `bg-white`, `bg-emerald-*`, `bg-grid` y sombras `#17150f` no aparecen fuera
      de primitivas.
- [ ] Estados vacío/carga/error/largo/desconectado revisados en cada pantalla.

---

## 7. Anexo · dónde está el coste

Archivos con más deuda visual (snapshot de la auditoría; el árbol está en
movimiento y el prototipo cambia a diario):

| Archivo | Líneas | `text-[8-10px]` | `font-mono` | `panel` | Hex | Inline | Color off-token |
|---|---:|---:|---:|---:|---:|---:|---:|
| `CharacterSheetPage.tsx` | 1031 | 35 | 31 | 13 | 0 | 0 | 0 |
| `PlayerTablePage.tsx` | 757 | 22 | 20 | 9 | 0 | 0 | 1 |
| `TablePage.tsx` | 717 | 17 | 21 | 8 | 2 | 0 | 2 |
| `EquipmentDoll.tsx` | 649 | 14 | 10 | 0 | 0 | 0 | 0 |
| `ui.tsx` | 603 | 1 | 4 | 2 | 0 | 1 | 0 |
| `ItemEditorPage.tsx` | 598 | 15 | 14 | 7 | 0 | 0 | 1 |
| `SkillEditorPage.tsx` | 561 | 17 | 15 | 7 | 0 | 0 | 2 |
| `EffectEditorPage.tsx` | 530 | 13 | 14 | 6 | 0 | 0 | 0 |
| `CombatDeclarationPanel.tsx` | 528 | 7 | 6 | 2 | 0 | 0 | 0 |
| `JoinPage.tsx` | 498 | 10 | 10 | 4 | 0 | 0 | 0 |
| `CampaignModals.tsx` | 476 | 3 | 5 | 1 | 0 | 0 | 0 |
| `Layout.tsx` | 474 | 19 | 17 | 0 | 0 | 0 | 2 |
| `DmCombatConsole.tsx` | 435 | 8 | 7 | 4 | 0 | 0 | 0 |
| `cards.tsx` | 433 | 15 | 14 | 5 | 0 | 0 | 0 |
| `PlayerCombatView.tsx` | 421 | 5 | 5 | 5 | 0 | 0 | 0 |
| `CombatLog.tsx` | 289 | 4 | 4 | 1 | 0 | 0 | 0 |
| `StatPanel.tsx` | 184 | 9 | 9 | 0 | 0 | 0 | 0 |
| `CombatantCard.tsx` | 199 | 7 | 9 | 0 | 0 | 1 | 0 |
| `CombatSprite.tsx` | 106 | 2 | 2 | 0 | 0 | 0 | 0 |
| `CombatScenePrototype.css` | ≈2400 | 51 | 0 | 0 | 20 | 0 | 0 |

Totales de referencia en `apps/web/src`: `border-ink` 273 · `text-ink-faint` 185 ·
`text-ink-soft` 105 · `font-mono` ~280 · `text-[8-10px]` ≈285 · `font-display` 45 ·
`panel` 88 · `chip` 58 · `pentagon` 23 · `hexagon` 10 · estilos inline 12 · hex en
TSX 6 (más 20 valores distintos en el CSS del prototipo) · clases de paleta por
defecto 8 (5 `emerald`, 3 `white`).

Clases declaradas y sin uso que conviene retirar o promover: `.stat-tile` (0),
`.cut-corner` (0), `.table-line` (0), `.link-quiet` (0). `.panel-lg` (1) y
`.panel-dark` (2) se usan tan poco que su rol puede absorberse en `Surface`.
