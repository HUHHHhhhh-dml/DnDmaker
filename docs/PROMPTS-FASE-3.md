# PROMPTS — FASE 3 · Encuentros y combate

> **Cómo usar:** ejecuta los prompts **en orden**. Cada uno asume que el anterior ya está implementado y mergeado. Si usas varios chats/subagentes, pásale a cada uno su prompt + los archivos indicados. El documento de diseño manda: [`DISENO-v0.1.md`](./DISENO-v0.1.md) y [`schema-v0.1.ts`](./schema-v0.1.ts).

## Prompt maestro para un chat nuevo (copiar y pegar)

```text
Hola. Este chat es exclusivo para la FASE 3 de PROTOCOL LIFE (encuentros y combate).

Proyecto: /home/serahdml/Documents/GAMES/protocol-life
Diseño cerrado: docs/DISENO-v0.1.md y docs/schema-v0.1.ts. No rediseñes ni cambies reglas.
Side-view cerrado: docs/DECISION-SIDE-VIEW.md (híbrido por ficha).
Handoff: docs/HANDOFF-FASE-1.md
Prompts de Fase 3: docs/PROMPTS-FASE-3.md

Antes de escribir código:
1. Lee docs/HANDOFF-FASE-1.md, docs/DISENO-v0.1.md (secciones 6, 7, 9, 10, 11), docs/schema-v0.1.ts, docs/DECISION-SIDE-VIEW.md y docs/PROMPTS-FASE-3.md.
2. Ejecuta el Prompt 0 (preflight): verifica que Fase 1 y Fase 2 están completas (monorepo, SQLite, CRUD, fichas, host/join, tests, npm run dev).
3. Si falta algo, DETENTE y dime exactamente qué falta. No improvises la base.
4. Si todo está, ejecuta Fase 3 en orden: 3A → 3B → 3C → 3D → 3E → 3F → 3G.
5. Trabaja con checkpoints: al final de cada subfase corre tests, resume archivos cambiados y espera mi OK antes de seguir (o continúa si te digo "sigue").

Reglas cerradas que NO puedes cambiar:
- Clash cuando se apuntan mutuamente, sin importar slot; empareja con la primera acción no resuelta del rival que te apunte.
- Empate: cancela ambas acciones.
- Redirección: 1 Skill Slot, SPD estrictamente mayor, una por ataque.
- DEF: DEF/(DEF+100), mínimo 1.
- 2 Skill Slots base, máximo 6; dominios 1 slot, 1 vez por combate.
- HP persistente; sin editar fichas/HP en combate; el DM solo controla enemigos.
- Declaraciones abiertas; 6 jugadores + DM.
- Sin cuentas, IA ni app móvil.
- Side-view híbrido: party en capas (leg → armor → horns → hand), enemigos sprite único; fallback capas → battleSprite → portrait → placeholder. Campos: visualMode, battleSprite, bodyImage, weaponImage.
- Stack: React+TS+Vite+Tailwind+Zustand; Fastify+SQLite+Drizzle; Zod; Vitest; npm workspaces.

Empieza por el preflight y dime el estado antes de tocar código.
```

---

## Prerrequisitos de toda la Fase 3

- Fase 1 completa: monorepo, `packages/shared`, `apps/server`, `apps/web`, SQLite, CRUD de contenido, fichas y stats derivados.
- Fase 2 completa: host/join, sesiones con PIN/tokens, fichas compartidas en vivo, permisos DM/jugador.
- `npm test` y `npm run dev` funcionando.
- Si algo de esto falta, **detente y repórtalo**; no improvises la base.

---

## Prompt 0 — Preflight

```text
Eres el agente que continúa PROTOCOL LIFE en /home/serahdml/Documents/GAMES/protocol-life.

Antes de tocar código:
1. Lee docs/HANDOFF-FASE-1.md, docs/DISENO-v0.1.md (secciones 6, 7, 9, 10, 11), docs/schema-v0.1.ts y docs/DECISION-SIDE-VIEW.md.
2. Confirma que los campos visuales (visualMode, battleSprite, bodyImage, weaponImage) siguen comentados en schema-v0.1.ts; se activan en 3A.
3. Verifica que existen y funcionan:
   - apps/web, apps/server, packages/shared
   - SQLite + Drizzle
   - CRUD de items/skills/effects/characters/encounters
   - host/join con PIN y sesiones
   - ficha compartida en vivo
4. Corre `npm test` y `npm run dev`; reporta el estado.

Si falta Fase 1 o Fase 2, DETENTE y dime exactamente qué falta. No empieces Fase 3 sobre una base incompleta.

Si todo está, responde con:
- estado actual,
- archivos clave,
- riesgos detectados,
- plan de Fase 3 en 6 pasos.
No escribas código todavía.
```

---

## Prompt 3A — Dominio de combate y snapshot

```text
Continúa PROTOCOL LIFE. Ya leíste el diseño y la base está completa.

OBJETIVO: crear el dominio de combate en el servidor y el snapshot de encuentro, sin motor de reglas todavía.

LEE: docs/DISENO-v0.1.md (secciones 6.2, 7.1–7.5, 7.12, 9), docs/schema-v0.1.ts, docs/DECISION-SIDE-VIEW.md.

ENTREGABLES:
1. Tipos compartidos en packages/shared:
   - CombatState, CombatUnit, DeclaredAction, CombatEvent, Team, CombatPhase.
   - Añade `slot` a DeclaredAction (1..skillSlots).
   - `CombatState.actions: Record<unitId, DeclaredAction[]>`.
   - `CombatState.specialCooldowns: Record<unitId, Record<specialId, number>>`.
2. Activa los campos visuales de la decisión side-view:
   - `Character.visualMode?: "portrait" | "layered"`, `battleSprite?`, `bodyImage?`.
   - `Skill.weaponImage?`.
   - Descomenta/exporta los tipos, actualiza Zod, DB/JSON y export/import.
3. Persistencia:
   - Tabla `combat_states` (JSON validado) y `combat_events` (log append-only).
   - Migración Drizzle.
4. Snapshot al iniciar encuentro:
   - Copia stats/equipo/skills/effects de cada Character a CombatUnit.
   - Copia también los campos visuales (o guárdalos en el snapshot de la unidad) para el renderer.
   - HP actual desde la ficha.
   - No referencies la ficha viva para stats durante el combate.
5. Servicio `startEncounter(campaignId, encounterId, sessionId)`:
   - Crea CombatState en fase `declaring`, ronda 1, seed aleatoria.
   - Instancia enemigos según `Encounter.enemies` (count/overrides).
   - Emite evento `combat:started`.
6. Servicio `endEncounter(combatId, reason)`:
   - Fase `ended`, winner opcional.
   - Persiste HP resultante en las fichas (hpPersistence = persist).
   - No permite revivir/editar en medio.
7. Tests:
   - Snapshot correcto (incluyendo campos visuales).
   - Enemigos con count/overrides.
   - Persistencia y recarga de CombatState.
   - Export/import conserva visualMode/battleSprite/bodyImage/weaponImage.

RESTRICCIONES:
- No implementes aún tiradas, clash ni daño.
- No permitas editar fichas/enemigos durante el combate.
- No agregues `combat:dmAdjust`.

CRITERIO: iniciar un encuentro con 2 jugadores + 1 enemigo crea un CombatState válido, persistido, y `endEncounter` guarda el HP.
```

---

## Prompt 3B — Motor de reglas puro

```text
Continúa PROTOCOL LIFE. El dominio de combate ya existe.

OBJETIVO: implementar el motor de reglas puro en packages/shared, sin I/O ni React.

LEE: docs/DISENO-v0.1.md (sección 7 completa), docs/schema-v0.1.ts.

CREA: packages/shared/src/combat/
- rng.ts: PRNG determinista (mulberry32 o xoshiro128**), con seed string.
- coins.ts: rollCoins(skill, stats, rng, rules) -> { coins, heads, clashPower, rawDamage }.
- clash.ts: resolveClash(attackerAction, defenderAction, rules, rng) -> ClashResult.
- damage.ts: computeDamage(raw, def, rules, damageType) -> number.
- effects.ts: applyEffect, tickEffects, collectTriggers, consumeStacks.
- round.ts: resolveRound(state, actions, content, rules) -> { state, events }.
- types.ts: resultados y eventos internos.

REGLAS EXACTAS (no las cambies):
- probCara = clamp(0.5 + LUCK/100, 0.1, 0.9).
- clashPower = baseClash + caras * coinClash.
- Daño: raw = ATK + baseDamage + caras * coinDamage; si todas caras, raw *= fullHeadsMultiplier.
- Mitigación: def/(def+100), DEF negativa = 0; final = max(1, floor(raw*(1-mitigacion))).
- Empate de clash: cancel_both (ambas acciones se cancelan).
- Clash: se apuntan mutuamente sin importar slot; se empareja con la primera acción no resuelta del rival que apunte al atacante.
- Redirección: 1 Skill Slot, SPD estrictamente mayor, una por ataque; el redirigidor clasha contra el atacante.
- Dominios/hábitats: 1 Skill Slot, 1 vez por combate, no clash, aplican al equipo.
- Utilidad: 1 Skill Slot, no clash, consume usos.
- Status effects: triggers roundStart/roundEnd/onUseSkill/onTakeDamage/onClashWin/onClashLose/onDefeat; acciones damage/heal/modifyStat/applyEffect/consumeStacks.
- Set inicial: Burn, Bleed, Protection, Haste.

TESTS OBLIGATORIOS (con seeds fijos):
1. Todas caras vs todas cruces.
2. Full heads multiplica daño.
3. DEF 0/50/100/200 y mínimo 1.
4. Empate cancela ambas acciones.
5. Clash cruzando slots (A slot 1 vs B slot 2).
6. Redirección válida (SPD mayor) e inválida (igual/menor).
7. Burn/Bleed/Protection/Haste.
8. Utilidad con usos.
9. Dominio una vez por combate.
10. Determinismo: misma seed -> mismo resultado.

RESTRICCIONES:
- Sin dependencias de servidor, DB o UI.
- Sin números aleatorios fuera del PRNG inyectado.
- Sin hardcodear contenido: todo viene de `content`/definiciones.

CRITERIO: `npm test` pasa y el motor se puede llamar con un estado de prueba sin tocar la DB.
```

---

## Prompt 3C — Orquestador de ronda y declaraciones

```text
Continúa PROTOCOL LIFE. El motor puro ya está testeado.

OBJETIVO: conectar el motor al ciclo de ronda del servidor: declarar, bloquear, resolver, emitir eventos y terminar.

LEE: docs/DISENO-v0.1.md (7.2–7.5, 7.12–7.13, 9), packages/shared/src/combat/*.

ENTREGABLES:
1. Servicio `declareActions(sessionPlayer, combatId, actions[])`:
   - Valida que sea la unidad del jugador (o DM para enemigos).
   - Valida slots únicos 1..skillSlots.
   - Valida target vivo, skill/utilidad/dominio disponible.
   - Valida redirección: SPD > atacante, aliado vivo.
   - Guarda acciones y emite `combat:event`.
2. Servicio `lockActions(combatId, actor)`:
   - Jugador bloquea su unidad; DM bloquea enemigos.
   - Cuando todos los vivos están lock, pasa a `resolving`.
3. `resolveCombatRound(combatId)`:
   - Orden SPD descendente (empate: jugadores, luego id).
   - Resuelve acciones una por una.
   - Empareja clash con la primera acción no resuelta del rival que apunte al atacante.
   - Aplica redirección, daño, efectos, utilidad, dominios.
   - Tick de efectos y cooldowns al final.
   - Marca defeated, detecta fin de combate.
   - Persiste estado y eventos.
   - Emite `combat:event` por cada paso y `combat:state` al final.
4. Idempotencia: si se reintenta resolver, no duplica daño.
5. Tests de integración:
   - 2 jugadores + 2 enemigos, 2 slots cada uno.
   - Un clash cruzado, un one-sided, una redirección, un efecto.
   - Fin de combate por bando sin unidades.
   - Misma seed -> mismo log.

RESTRICCIONES:
- El servidor es autoritativo; el cliente no calcula.
- No permitas declarar si la fase no es `declaring`.
- No edites HP/fichas en combate.
- El DM solo declara acciones de enemigos y puede terminar el combate.

CRITERIO: una ronda completa se resuelve y el log coincide con el motor puro; dos clientes ven el mismo estado.
```

---

## Prompt 3D — API y WebSocket de combate

```text
Continúa PROTOCOL LIFE. El ciclo de ronda ya funciona en el servidor.

OBJETIVO: exponer la API/eventos de combate y conectar la sesión en vivo.

LEE: docs/DISENO-v0.1.md (9, 8.6), apps/server.

ENTREGABLES:
1. Eventos cliente -> servidor:
   - combat:start { encounterId } (solo DM)
   - combat:declare { actions: DeclaredAction[] }
   - combat:lock {}
   - combat:end {} (solo DM)
2. Eventos servidor -> cliente:
   - combat:started { combat }
   - combat:event { event }
   - combat:state { combat }
   - combat:ended { winner, log }
   - error { code, message }
3. Permisos:
   - Solo el dueño declara su unidad.
   - Solo DM inicia/termina y declara enemigos.
   - Nadie edita fichas/HP en combate.
   - Rechazar acciones fuera de fase.
4. Reconnect:
   - Al reconectar, enviar `state:full` con el CombatState actual.
5. Validación Zod de payloads.
6. Tests de dos clientes:
   - Uno declara, el otro ve el estado.
   - Un jugador no puede declarar por otro.
   - DM inicia y termina.

RESTRICCIONES:
- No `combat:dmAdjust`.
- No confiar en IDs del cliente; usar token de sesión.
- No bloquear el event loop con bucles largos; el combate es pequeño (7 unidades).

CRITERIO: dos navegadores juegan una ronda completa por WebSocket sin desincronizarse.
```

---

## Prompt 3E — UI de combate del jugador

```text
Continúa PROTOCOL LIFE. La API de combate ya funciona.

OBJETIVO: construir la pantalla de combate del jugador, side-view, con declaración por slots y log.

LEE: docs/DISENO-v0.1.md (7, 8.8), docs/DECISION-SIDE-VIEW.md, reference/protocol-game-v1.1.html (estilo), apps/web.

ENTREGABLES:
1. Componente `CombatSprite`:
   - Recibe la unidad/ficha y resuelve el modo visual con los defaults de DECISION-SIDE-VIEW.md.
   - Modo `layered`: `bodyImage` + orden `leg → armor → horns → hand`. La utilidad NO se dibuja en el cuerpo.
   - Si la unidad usa una skill con `weaponImage`, esa capa sustituye temporalmente la mano durante la acción.
   - Modo `portrait`: `battleSprite` → `portrait` → placeholder geométrico.
   - Si `layered` no tiene `bodyImage`, cae a sprite único sin romper la escena.
   - `portrait` sigue siendo la imagen de ficha/menús; no se usa como sprite salvo fallback.
2. Layout side-view:
   - Jugadores a la izquierda, enemigos a la derecha.
   - Tarjeta por unidad: nombre, HP, DEF, efectos, SPD, Skill Slots.
   - Barra de HP y estados.
3. Declaración:
   - Elegir hasta skillSlots acciones (skill/utilidad/dominio).
   - Asignar slot 1..N, objetivo y, si aplica, redirección (aliado + atacante).
   - Solo mostrar redirección si SPD > atacante.
   - Botón "Listo" / lock.
4. Resolución:
   - Reproducir el log de eventos en orden (cola/timeline).
   - Mostrar tiradas, clash, daño, curación, efectos, derrotas.
   - No calcular nada en el cliente.
5. Ficha read-only durante combate.
6. Responsive y accesible; mantener el estilo del prototipo.
7. Plantilla de assets:
   - Capas: PNG 1024×1024, transparente, pies al 90% de la altura, mismo lienzo para todas.
   - Sprite único: PNG/WEBP 1024×1024 o 1024×1536, cuerpo completo, mirando a la izquierda.
   - Render con `object-fit: contain` y anclaje inferior.
8. Estados: esperando, declarando, resuelto, terminado.

RESTRICCIONES:
- Sin RNG en el cliente.
- Sin editar stats/HP.
- Sin animaciones que bloqueen la lógica; el estado ya está resuelto.
- No implementes aún animaciones complejas (Rive/Spine/Lottie); deja hooks.

CRITERIO: un jugador puede declarar 2 acciones, bloquear y ver la ronda resuelta con log y daño; la party se dibuja por capas y un enemigo con solo `portrait` se ve correctamente.
```

---

## Prompt 3F — UI del DM y editor de encuentros

```text
Continúa PROTOCOL LIFE. La UI del jugador ya funciona.

OBJETIVO: construir el editor de encuentros y la consola de combate del DM.

LEE: docs/DISENO-v0.1.md (4.1, 6.2 Encounter, 7.12, 8.6), docs/DECISION-SIDE-VIEW.md.

ENTREGABLES:
1. Editor de encuentros:
   - Nombre, descripción, fondo.
   - Elegir enemigos del contenido, count, overrides (incluye overrides visuales si hace falta).
   - Recompensas y notas.
   - Validación y guardado.
2. Consola de combate:
   - Ver todas las fichas (read-only) y el estado.
   - Elegir acciones de enemigos (slots, objetivos, redirección si aplica).
   - Botón "Listo" para enemigos.
   - Iniciar/terminar encuentro.
   - Log completo.
3. Editor “Visual de combate” en la ficha:
   - Selector de modo (`sprite único` / `capas`).
   - Campos `battleSprite` y `bodyImage`.
   - Vista previa en vivo del montaje con el equipo actual.
   - Nota en el editor de objetos: `Item.image` se usa como capa de combate si la ficha está en modo capas.
4. Sin edición de stats/HP en combate.
5. Fuera de combate:
   - "Rest party" para curar.
   - Editar fichas y contenido.
6. Tests de UI/flujo:
   - DM crea encuentro, inicia, declara enemigos, termina.
   - Cambiar `visualMode`/`battleSprite`/`bodyImage` y verlo en la preview y en combate.
   - Export/import conserva los campos visuales.

RESTRICCIONES:
- No `dmAdjust` en combate.
- No IA de enemigos.
- No agregar tiendas/mazmorras.

CRITERIO: el DM puede crear un encuentro, iniciarlo, jugar enemigos y terminarlo sin tocar la DB.
```

---

## Prompt 3G — Integración, QA y aceptación

```text
Continúa PROTOCOL LIFE. Todas las piezas de Fase 3 están implementadas.

OBJETIVO: integración final, pruebas end-to-end y cierre de Fase 3.

TAREAS:
1. Flujo completo:
   - Campaña -> 2 jugadores -> encuentro -> 2 rondas -> efecto -> victoria -> fin.
   - Verificar que el HP persiste y que "Rest party" funciona fuera de combate.
2. Pruebas:
   - `npm test` (unitarios + integración).
   - Test de determinismo con seed fija.
   - Test de reconexión a mitad de combate.
   - Test de permisos (jugador no puede editar otro; DM no puede editar HP en combate).
3. Side-view:
   - Party en capas (leg → armor → horns → hand); enemigo con solo `portrait`.
   - Placeholder sin imagen; fallback sin `bodyImage`.
   - `weaponImage` sustituye la mano al usar la skill.
   - `visualMode`, `battleSprite`, `bodyImage` y `weaponImage` persisten en export/import.
4. Calidad:
   - `npm run build`.
   - `npm run dev` limpio.
   - Revisar logs y errores de consola.
5. Documentación:
   - Actualizar README con cómo jugar un encuentro.
   - Añadir CHANGELOG de Fase 3.
6. Reporte final:
   - Qué se implementó.
   - Qué quedó fuera.
   - Riesgos y próximos pasos (Fase 4).

CRITERIO DE ACEPTACIÓN:
- El DM inicia un encuentro con 2 jugadores.
- Cada jugador declara hasta 2 acciones y bloquea.
- Se resuelve un clash (incluyendo slots distintos), daño con DEF, un status effect y una redirección.
- El log coincide con el estado.
- El combate termina y el HP queda persistido.
- La party se dibuja por capas; un enemigo con solo `portrait` se ve bien.
- El fallback sin `bodyImage` y el placeholder no rompen la escena.
- Export/import conserva `visualMode`, `battleSprite`, `bodyImage` y `weaponImage`.
- `npm test` y `npm run build` pasan.

NO HAGAS:
- No cambies las reglas cerradas.
- No agregues host/join (ya existe) ni tiendas/mazmorras.
- No agregues cuentas, IA ni app móvil.
```

---

## Apéndice — Checklist de aceptación Fase 3

- [ ] Editor de encuentros con enemigos, count y overrides.
- [ ] Iniciar encuentro crea CombatState y snapshot.
- [ ] Declarar hasta `skillSlots` acciones por unidad.
- [ ] Bloqueo de jugadores y DM.
- [ ] Clash por apuntarse, sin importar slot.
- [ ] Empate cancela ambas acciones.
- [ ] Redirección con SPD mayor, 1 Skill Slot.
- [ ] DEF `DEF/(DEF+100)`, mínimo 1.
- [ ] Full heads multiplica daño.
- [ ] Burn, Bleed, Protection, Haste.
- [ ] Utilidad consume usos y slot.
- [ ] Dominio 1 vez por combate, 1 slot, equipo.
- [ ] HP persistente y “Rest party” fuera de combate.
- [ ] Nadie edita fichas/HP en combate.
- [ ] Log de combate completo y determinista.
- [ ] UI jugador + consola DM.
- [ ] Side-view híbrido: party en capas, enemigos sprite único, fallback y placeholder.
- [ ] Editor “Visual de combate” con preview.
- [ ] `weaponImage` sustituye la mano al usar la skill.
- [ ] Export/import conserva `visualMode`, `battleSprite`, `bodyImage` y `weaponImage`.
- [ ] Reconnect a mitad de combate.
- [ ] `npm test`, `npm run build`, `npm run dev` OK.

---

## Nota sobre el orden

Si quieres paralelizar, 3B (motor puro) puede ir en paralelo con 3A (dominio), y 3E/3F pueden empezar con mocks del estado de combate. Pero la integración final (3G) requiere todo lo anterior. No paralelices 3C/3D con cambios de reglas.
