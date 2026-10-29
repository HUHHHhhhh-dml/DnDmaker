# PROTOCOL DND — Documento de Diseño v0.1

> **Estado:** borrador para revisión
> **Fecha:** 2026-10-26
> **Autores:** tú + DeepSeek
> **Referencias:** [`reference/protocol-game-v1.1.html`](../reference/protocol-game-v1.1.html) (prototipo original), Figma (pendiente de exportar capturas)
> **Contrato de datos:** [`schema-v0.1.ts`](./schema-v0.1.ts)

---

## 0. Cómo leer este documento

Este documento es la **base** del proyecto: la idea es que puedas modificarlo después sin reescribir todo.

- Las secciones marcadas **DECISIÓN** son valores por defecto que propongo. Si no te gustan, se cambian aquí y se reflejan en el motor.
- Los bloques de código son el **contrato de datos**. La versión real vivirá en `schema-v0.1.ts` y luego en `packages/shared`.
- Lo que es **contenido** (objetos, skills, efectos, personajes, encuentros) se edita desde la app y se guarda como datos. Lo que es **motor** (clash, turnos, daño) se programa una vez y se parametriza.
- v0.1 no es la versión final: es la base jugable y extensible.

---

## 1. Visión

**PROTOCOL DND** es una aplicación para que un **DM** cree y dirija su propia campaña de rol, con contenido totalmente personalizado, y para que sus **jugadores** se conecten a la mesa desde el navegador.

El corazón del proyecto es:

1. **Estudio del DM:** crear y modificar objetos, habilidades, efectos, personajes, NPCs, enemigos y encuentros.
2. **Mesa en vivo:** el DM hostea la campaña, genera un código/PIN y los jugadores se unen.
3. **Combate táctico:** side-view por rondas, inspirado en *Limbus Company*: habilidades con monedas, **clash**, daño mitigado por DEF y **status effects**.
4. **Base modificable:** el DM puede cambiar contenido y parámetros de reglas sin tocar el código.

---

## 2. Principios de diseño

| Principio | Qué significa |
|---|---|
| **Data-driven** | Objetos, skills, efectos y enemigos son datos editables, no código hardcodeado. |
| **Server-authoritative** | El servidor resuelve tiradas, daño y estado. El cliente solo envía intenciones y anima. |
| **Local-first** | El DM puede hostear desde su PC; no dependemos de una nube para jugar. |
| **Extensible** | El modelo tiene huecos para tiendas, mazmorras, mapas e IA sin romper lo anterior. |
| **Intuitivo** | El DM no debería escribir JSON para crear contenido: formularios, previsualización y validación. |
| **Separación contenido/motor** | El motor lee definiciones; el contenido se cambia desde la app. |

---

## 3. Alcance

### 3.1 MVP (v0.1)

Incluye:

- Campaña con configuración de reglas.
- Biblioteca de **objetos** (equipo y utilidad) con editor.
- Biblioteca de **habilidades** con editor.
- Biblioteca de **efectos de estado** con editor.
- Fichas de **personajes** (jugador, NPC) y **enemigos**.
- **Host/join** con código de sala + PIN.
- Fichas compartidas en vivo; el DM puede ver y modificar **fuera de combate**.
- **Editor de encuentros** y **motor de combate** con clash, monedas, DEF y status effects.
- Guardado local, export/import de campaña y log de combate.
- Interfaz DM y vista jugador.

### 3.2 Fuera de alcance (v0.1)

- Cuentas de usuario, login social y matchmaking: **descartado** (la sesión usa tokens, no cuentas).
- IA automática de enemigos: **descartado** (el DM controla a los enemigos).
- App móvil nativa: **descartado** (la web será responsive).
- Mazmorras jugables (solo modelo y editor básico).
- Tiendas funcionales en v0.1 (el modelo queda listo). **Ojo:** las tiendas son de campaña, con **Clean Shards** (moneda del juego); nunca dinero real.
- Mapas con grid, niebla de guerra, tokens.
- Voz/video integrados.
- Balanceo automático o “recomendador” de encuentros.

> Lo marcado como **descartado** (cuentas de usuario, IA automática, app móvil) no se planea ni para versiones futuras.

### 3.3 Supuestos

- **DECISIÓN:** 1 DM + hasta **6 jugadores** por sala.
- **DECISIÓN:** se juega desde navegador; el DM corre el servidor en su PC y los jugadores de la **misma WiFi** entran con un link/QR + PIN, sin instalar nada.
- **DECISIÓN:** el combate es por rondas y se resuelve por **SPD**. Para **redirigir** un ataque hay que ser **estrictamente más rápido** que el atacante; con la misma velocidad o menos, no se puede.
- **DECISIÓN:** cada unidad tiene **2 Skill Slots base**. Algunos objetos/efectos pueden añadir slots. Dominios y hábitats consumen 1 slot.
- **DECISIÓN:** el DM controla a los enemigos manualmente en vivo.
- **DECISIÓN:** los jugadores solo editan su ficha **fuera de combate**. En combate el DM solo juega como enemigo; nadie modifica fichas ni enemigos en medio del combate.

---

## 4. Roles y flujos

### 4.1 DM

- Crea la campaña y configura sus reglas y permisos.
- Crea/edita objetos, habilidades, efectos, personajes y encuentros.
- Abre la sala (Host), comparte link/QR + código/PIN.
- Ve las fichas de todos, las modifica y entrega objetos **fuera de combate**.
- Inicia encuentros y controla enemigos en vivo.
- Puede terminar el combate; no ajusta HP/efectos en medio del combate.

#### ¿Qué reglas define el DM?

| Grupo | Ejemplos |
|---|---|
| **Mesa** | máximo de jugadores, PIN, quién puede editar fichas, descanso. |
| **Combate** | fórmula de DEF, empate de clash, Skill Slots base, full heads, cooldowns. |
| **Contenido** | qué objetos/skills/efectos existen, rarezas, restricciones, precios. |
| **Campaña** | progresión, recompensas, muerte/revive, casas de campaña. |

El motor fija **cómo** se resuelve (clash, turnos, daño). El DM define **qué** contenido existe y **con qué parámetros** se juega. No necesitas escribir código: la app expone formularios para esas reglas.

### 4.2 Jugador

- Se une con link/QR + PIN + nombre.
- Crea/edita su personaje (stats, equipo, skills, inventario) según permisos.
- Ve su ficha, la party y el estado del combate.
- Declara sus acciones (hasta sus Skill Slots) y bloquea.
- No puede editar fichas ajenas ni iniciar encuentros.

### 4.3 Flujo de sesión

```text
DM abre la app
  → crea/elige campaña
  → Host
  → la app muestra un link LAN (ej. http://192.168.0.122:3000), un QR y un PIN
  → jugadores abren el link, ponen PIN + nombre
  → eligen/crean personaje
  → el DM ve la party y empieza cuando quiera
```

**Jugador (misma WiFi):**

```text
abre el link/QR
  → Join
  → PIN
  → elige/crea personaje
  → Unirse
```

Sin cuenta, sin instalar nada, sin configuración de red más allá del link.

### 4.4 Flujo de combate

```text
DM elige un encuentro y pulsa Start
  → el servidor crea CombatState (ronda 1)
  → se muestran unidades, HP, efectos y orden de velocidad
  → jugadores y DM declaran sus acciones (hasta sus Skill Slots)
  → todos bloquean
  → el servidor resuelve clash/daño/efectos
  → se reproduce el log animado
  → siguiente ronda o fin del encuentro
```

---

## 5. Glosario

| Término | Definición |
|---|---|
| **Campaña** | Contenedor de contenido, reglas y sesiones. |
| **Personaje** | Ficha de jugador, NPC o enemigo. |
| **Unidad** | Personaje instanciado en un combate (con HP actual y efectos). |
| **Skill** | Habilidad activa con monedas, clash y daño. |
| **Skill Slot** | Cupo de acciones por ronda; base 2, ampliable con objetos/efectos. |
| **Cooldown** | Rondas de espera antes de volver a usar un dominio/hábitat. |
| **Redirect** | Interceptar un ataque dirigido a un aliado; exige más SPD que el atacante. |
| **Clash** | Enfrentamiento entre dos habilidades que se atacan mutuamente. |
| **Moneda** | Tirada binaria (cara/cruz) que suma poder de clash o daño. |
| **Coins** | Número de monedas de una skill. |
| **Base / Coin** | Poder de clash base y por cara. |
| **Damage / Coin Damage** | Daño base y por cara. |
| **DEF** | Defensa; reduce daño recibido. |
| **SPD** | Velocidad; ordena las acciones. |
| **Luck** | Probabilidad extra de cara. |
| **Efecto** | Status effect (Burn, Bleed, etc.) definido como datos. |
| **Encuentro** | Grupo de enemigos + condiciones + recompensas. |
| **Sala** | Instancia de juego hosteada por el DM. |
| **DM fiat** | Ajuste manual del DM **fuera de combate**. |

---

## 6. Modelo de datos

### 6.1 Relaciones

```text
Campaign 1─* Item
Campaign 1─* Skill
Campaign 1─* EffectDefinition
Campaign 1─* SpecialAbility
Campaign 1─* Character (player / npc / enemy)
Campaign 1─* Encounter ──* Character (enemigos)
Campaign 1─* Shop
Campaign 1─* Dungeon ──* Encounter
Campaign 1─1 Ruleset + Settings
Session 1─1 Campaign
CombatState 1─1 Encounter
CombatState 1─* CombatUnit ──1 Character
CombatUnit 1─* AppliedEffect ──1 EffectDefinition
```

### 6.2 Entidades principales

#### Campaign

| Campo | Tipo | Notas |
|---|---|---|
| `id` | `string` | UUID interno. |
| `name` | `string` | Nombre visible. |
| `description` | `string?` | Texto libre. |
| `schemaVersion` | `number` | `1` en v0.1. |
| `createdAt` / `updatedAt` | ISO string | Auditoría. |
| `rules` | `Ruleset` | Parámetros del motor. |
| `settings` | `CampaignSettings` | Jugadores, permisos, PIN e imagen base del muñeco de equipo. |
| `content` | objeto | Items, skills, effects, specials, characters, encounters, shops, dungeons. |

`CampaignSettings` incluye `maxPlayers`, `allowPlayerEdit`, `allowPlayerEditDuringCombat`, `requirePin`, `pin` y `baseCharacterImage` (imagen base del muñeco de equipo; default `/assets/base-character.png`).

#### Item

| Campo | Tipo | Notas |
|---|---|---|
| `id` | `string` | UUID; **no** usar `code` como PK. |
| `code` | `string?` | Código visible (ej. `AASS-164`), editable. |
| `name` | `string` | |
| `description` | `string?` | |
| `slot` | `"horns" \| "hand" \| "armor" \| "leg" \| "utility"` | |
| `rarity` | `string?` | Libre (Common, Rare, Unique...). |
| `unlocked` | `boolean?` | Si es `true`, los jugadores lo ven y pueden elegirlo. Default: solo DM. |
| `image` | `string?` | URL o `/uploads/...`. |
| `stats` | `Partial<Stats>` | Suma a los stats base. |
| `effects` | `{ effectId, stacks? }[]` | Efectos pasivos al equipar. |
| `uses` / `useEffect` | `number?` / `EffectAction[]?` | Solo utilidad. |
| `tags` | `string[]?` | Filtros y sinergias. |
| `price` | `number?` | Para tiendas futuras. |

#### Skill

| Campo | Tipo | Notas |
|---|---|---|
| `id`, `code`, `name`, `description` | | Igual que Item. |
| `coins` | `number` | ≥ 1. |
| `baseClash` | `number` | Poder de clash inicial. |
| `coinClash` | `number` | Suma por cara al clash. |
| `baseDamage` | `number` | Daño base. |
| `coinDamage` | `number` | Suma por cara al daño. |
| `fullHeadsMultiplier` | `number?` | Por defecto 2; `1` lo desactiva. |
| `unlocked` | `boolean?` | Si es `true`, los jugadores la ven y pueden elegirla. Default: solo DM. |
| `target` | `"single"` | v0.1 solo un objetivo. |
| `effects` | `{ effectId, chance?, stacks? }[]` | Se aplican al impactar. |
| `animation` | `string?` | Nombre de animación (futuro). |

#### SpecialAbility (dominios / hábitats)

| Campo | Tipo | Notas |
|---|---|---|
| `id`, `code`, `name`, `description` | | |
| `duration` | `number` | Turnos que dura el efecto. |
| `cooldown` | `number?` | Solo para habilidades reutilizables (`oncePerCombat: false`); no se usa en v0.1. |
| `oncePerCombat` | `boolean?` | Default `true` en v0.1. |
| `target` | `"self" \| "team" \| "field"` | Default `team`. |
| `effects` | `EffectAction[]` | Buffs/efectos que aplica. |

#### EffectDefinition

| Campo | Tipo | Notas |
|---|---|---|
| `id`, `code`, `name`, `description`, `icon` | | |
| `maxStacks` | `number?` | Tope de stacks. |
| `stackMode` | `"add" \| "refresh" \| "replace"` | Cómo se acumula. |
| `duration` | `{ type: "turns", default } \| { type: "permanent" }` | |
| `triggers` | `{ when, actions }[]` | `roundStart`, `roundEnd`, `onUseSkill`, `onTakeDamage`, `onClashWin`, `onClashLose`, `onDefeat`. |
| `tags` | `string[]?` | |

#### Character

| Campo | Tipo | Notas |
|---|---|---|
| `id`, `name`, `kind` | `"player" \| "npc" \| "enemy"` | |
| `portrait`, `description` | `string?` | |
| `baseStats` | `Stats` | HP base, DEF, ATK, SPD, LUCK, Skill Slots. |
| `equipment` | `Record<EquipmentSlot, Id \| null>` | |
| `skills` | `(Id \| null)[]` | Exactamente 3 slots en v0.1. |
| `special` | `{ domainId?, habitatId? }` | Habilidades especiales. |
| `inventory` | `{ itemId, qty }[]` | |
| `notes` | `string?` | |
| `ownerId` | `string?` | Jugador dueño (si aplica). |

#### Encounter

| Campo | Tipo | Notas |
|---|---|---|
| `id`, `name`, `description`, `background` | | |
| `enemies` | `{ characterId, count?, overrides? }[]` | |
| `rewards` | `{ itemIds?, currency?, notes? }` | |
| `victory` / `defeat` | `string?` | Condiciones narrativas. |

#### Ruleset

```ts
interface Ruleset {
  defenseConstant: number;        // default 100 (mitigación porcentual)
  minDamage: number;              // default 1
  maxSkillSlots: number;          // default 6
  tieRule: "cancel_both" | "defender_wins" | "both_half";
  fullHeadsMultiplier: number;    // default 2
  luckCap: number;                // default 0.9
  luckFloor: number;              // default 0.1
  hpPersistence: "persist" | "restore";
}
```

La mitigación de DEF es **porcentual con rendimientos decrecientes**:

```text
mitigacion = DEF / (DEF + defenseConstant)
```

Con `defenseConstant = 100`:

| DEF | Mitigación |
|---|---|
| 0 | 0% |
| 25 | 20% |
| 50 | 33% |
| 100 | 50% |
| 150 | 60% |
| 200 | 66% |
| 300 | 75% |

Ventaja frente a `DEF/3` plana: nunca llegas a inmunidad, escala mejor con stats altos y los números siguen siendo legibles. La DEF negativa se trata como 0 en v0.1; en v0.2 se puede añadir vulnerabilidad.

#### Session / Room

| Campo | Tipo | Notas |
|---|---|---|
| `id`, `code` | `string` | Código de 6 caracteres sin ambigüedad. |
| `campaignId` | `string` | |
| `dmToken` | `string` | Secreto del DM (no se muestra a jugadores). |
| `players` | `{ id, name, token, characterId?, connected }[]` | |
| `status` | `"lobby" \| "playing" \| "combat"` | |

#### CombatState

| Campo | Tipo | Notas |
|---|---|---|
| `id`, `encounterId` | `string` | |
| `round` | `number` | Empieza en 1. |
| `phase` | `"declaring" \| "resolving" \| "ended"` | |
| `seed` | `string` | Semilla del RNG. |
| `units` | `CombatUnit[]` | |
| `actions` | `Record<unitId, DeclaredAction[]>` | Hasta `skillSlots` por unidad. |
| `lockedUnits` | `Record<unitId, boolean>` (opcional) | Lock por unidad, incluidas las que no declararon acciones; las derrotadas no cuentan. |
| `specialCooldowns` | `Record<unitId, Record<specialId, number>>` | Rondas restantes de cada dominio/hábitat. |
| `log` | `CombatEvent[]` | |
| `winner` | `"players" \| "enemies" \| undefined` | |

### 6.3 Ejemplo de objeto y skill

```json
{
  "id": "itm_01HX...",
  "code": "AASS-164",
  "name": "CIVIL",
  "description": "Cuernos otorgados a civiles para reducir Incidentes.",
  "slot": "horns",
  "stats": { "hpMax": 3, "def": 2, "atk": 3 },
  "image": "https://...",
  "tags": ["civil", "starter"]
}
```

```json
{
  "id": "skl_01HX...",
  "code": "BETI-928",
  "name": "ODACHI",
  "coins": 3,
  "baseClash": 5,
  "coinClash": 7,
  "baseDamage": 20,
  "coinDamage": 5,
  "fullHeadsMultiplier": 2,
  "target": "single",
  "effects": []
}
```

### 6.4 Identificadores y versionado

- **ID interno:** UUID/ULID, inmutable. Es la clave real.
- **Code:** código visible y editable (ej. `AASS-164`). Se puede cambiar sin romper referencias.
- **schemaVersion:** `1` en v0.1. Cualquier cambio incompatible sube la versión y añade migración.
- **Export/import:** la campaña se exporta como JSON con `schemaVersion`; el import valida con Zod y migra si hace falta.

### 6.5 Validación

- Zod en `packages/shared` para validar todo lo que entra por API y por import.
- Reglas de negocio en el motor, no en la UI: el servidor rechaza acciones inválidas.
- Límites: nombre 1–80 chars, descripción 0–2000, imágenes ≤ 5 MB, `coins` 1–20, stats -999..999 (salvo HP base > 0).

---

## 7. Reglas de combate v0.1

> **Nota:** estas reglas son la base. Los parámetros numéricos viven en `Ruleset`; el resto del flujo se puede ampliar en v0.2.

### 7.1 Stats y derivados

Cada unidad tiene:

- **HPMax** = `baseStats.hpMax` + suma de `stats.hpMax` del equipo + modificadores de efectos.
- **DEF** = `baseStats.def` + equipo + efectos.
- **ATK** = `baseStats.atk` + equipo + efectos.
- **SPD** = `baseStats.spd` + equipo + efectos.
- **LUCK** = `baseStats.luck` + equipo + efectos (puntos porcentuales).
- **Skill Slots** = `baseStats.skillSlots` + equipo + efectos; mínimo 1, máximo `rules.maxSkillSlots` (default 6).

**DECISIÓN:** stats base por defecto para un personaje nuevo: `hpMax: 50, def: 0, atk: 0, spd: 10, luck: 0, skillSlots: 2`.

### 7.2 Estructura de ronda

1. **Inicio de ronda:** se disparan los efectos con `roundStart`, en orden de SPD.
2. **Declaración:** cada unidad elige hasta **`skillSlots` acciones** (base 2). Cada acción puede ser:
   - una skill + objetivo,
   - una utilidad + objetivo,
   - un dominio/hábitat (consume 1 slot).
3. **Bloqueo:** cada jugador pulsa “Listo”; el DM bloquea a los enemigos. Cuando todos están listos, se resuelve.
4. **Resolución:** las acciones se ejecutan en orden de **SPD descendente**.
5. **Fin de ronda:** se disparan efectos `roundEnd`, se descuentan duraciones/cooldowns y se pasa a la siguiente ronda.

**DECISIÓN:** 2 Skill Slots base; los objetos/efectos pueden sumar slots (máximo 6).

### 7.3 Declaración de acciones

```ts
interface DeclaredAction {
  unitId: string;
  slot: number; // 1..skillSlots
  skillId?: string;
  utilityId?: string;
  special?: "domain" | "habitat";
  targetId?: string;
  /** Si está presente, esta acción redirige un ataque contra este aliado. */
  redirectFor?: string;
  locked: boolean;
}
```

- Cada unidad puede declarar hasta `skillSlots` acciones; cada una ocupa un **slot distinto** (1..`skillSlots`). El número de slot ordena la UI; **no** limita el clash.
- En v0.1 las declaraciones son **abiertas** (el DM ve todo). En v0.2 se puede añadir modo oculto.
- Un jugador puede cambiar sus acciones mientras no esté `locked`.
- El DM puede bloquear a todos los enemigos con un botón.
- **Redirigir:** `redirectFor` = aliado protegido, `targetId` = atacante. Exige `SPD` estrictamente mayor que la del atacante; si no, la acción es inválida. La redirección ocupa **1 Skill Slot**.

### 7.4 Orden de resolución

- Orden: `SPD` descendente.
- Empate de SPD: primero jugadores, luego enemigos; si persiste, por `id` ascendente (estable).
- **Redirección:** una unidad puede gastar una acción para interceptar un ataque dirigido a un aliado si su SPD es **estrictamente mayor** que la del atacante. Esa acción ocupa un Skill Slot y **cambia el objetivo del clash**: el atacante clasha contra el redirigidor, no contra el aliado original. Si la SPD es igual o menor, la redirección es inválida (la UI no la ofrece y el servidor la rechaza).
- Cada acción se resuelve una vez. Una unidad puede tener varias acciones (slots) en la misma ronda.
- Si una unidad es derrotada antes de su turno, pierde sus acciones restantes.

### 7.5 Clash

Un **clash** ocurre cuando dos unidades se atacan **mutuamente**, sin importar el número de slot.

- Cada unidad numera sus acciones `1..skillSlots` solo para la UI y la declaración; el clash **no** depende de que coincidan los números.
- Cuando una acción de A ataca a B, se busca la **primera acción no resuelta de B que apunte a A**; si existe, clash; si no, es **one-sided**.
- A puede tener varias acciones y clashar varias veces (una por acción).
- Si B tiene menos acciones que A, las acciones extra de A son **one-sided**.
- Si A ataca a B y B no le apunta → **one-sided**.
- **Redirección:** una acción de redirección puede ocupar cualquier slot y clasha con el ataque entrante. El redirigidor debe ser más rápido y gasta 1 Skill Slot. Solo se permite **una redirección por ataque**; si hay varias, se resuelve la del redirigidor más rápido.
- Una acción solo puede participar en **un** clash; una unidad puede tener varios clashes (uno por acción).

Resolución del clash:

1. Ambos tiran sus monedas.
2. `clashPower = baseClash + (caras × coinClash)`.
3. Gana el mayor `clashPower`.
4. **Empate:** según `rules.tieRule`:
   - `cancel_both` (default): ambas acciones se cancelan; nadie hace daño ni aplica efectos.
   - `defender_wins`: gana el defensor (el que no inició).
   - `both_half`: ambos hacen daño a la mitad.
5. El ganador aplica daño y efectos; el perdedor no hace daño (salvo efectos `onClashLose`).

**DECISIÓN:** empate = se cancelan ambas acciones. **Emparejamiento:** por apuntarse, sin importar el slot.

### 7.6 Monedas y Luck

Para cada moneda:

```text
probCara = clamp(0.5 + LUCK / 100, luckFloor, luckCap)
cara = rng() < probCara
```

- `LUCK` se expresa en puntos porcentuales: `LUCK 10` → +10% de probabilidad.
- Cada cara suma `coinClash` al clash y `coinDamage` al daño.
- Las cruces no suman (no restan) en v0.1.
- **Full heads:** si todas las monedas salen caras, el daño se multiplica por `fullHeadsMultiplier` (default 2).

**DECISIÓN:** `coinClash` y `coinDamage` pueden ser negativos para skills de riesgo; en ese caso una cara resta. Si prefieres que nunca resten, se valida `>= 0` en el editor.

### 7.7 Daño y DEF

Fórmula v0.1:

```text
raw = ATK + skill.baseDamage + (caras × skill.coinDamage)
raw = raw × (fullHeads ? rules.fullHeadsMultiplier : 1)
mitigacion = max(0, DEF) / (max(0, DEF) + rules.defenseConstant)
final = max(rules.minDamage, floor(raw * (1 - mitigacion)))
```

- `defenseConstant` default **100**: la mitigación es porcentual con rendimientos decrecientes.
- `minDamage` default **1**: un golpe siempre hace al menos 1 (salvo inmunidad explícita).
- **Daño puro:** `damageType: "pure"` ignora DEF (para futuras skills).
- La DEF negativa se trata como 0 en v0.1 (vulnerabilidad queda para v0.2).
- El daño se resta del HP actual de la unidad.

**DECISIÓN:** mitigación porcentual con `defenseConstant = 100`, mínimo 1. Es más satisfactoria que `DEF/3` plana: evita inmunidades, escala con stats altos y no vuelve inútiles los golpes débiles.

> Alternativa si quieres algo más “de juego táctico”: `final = max(1, floor(raw * 100 / (100 + DEF) - flatPierce))`, con `flatPierce` como stat de penetración. Lo dejamos para v0.2.

### 7.8 One-sided attacks

- No hay clash: el atacante tira monedas solo para daño.
- Se aplica la misma fórmula de daño y efectos.
- Si el objetivo está usando una utilidad, no hay clash; la utilidad se resuelve en su orden de SPD si sobrevive.

### 7.9 Utilidad

- La utilidad es un ítem con `uses` y `useEffect`.
- Usarla consume **1 Skill Slot** de la ronda.
- No hace clash.
- Al usarla se descuenta 1 uso y se aplican sus `EffectAction` (curación, buff, etc.).
- Si no quedan usos, no se puede declarar.

### 7.10 Dominios y hábitats

- Son habilidades especiales (`SpecialAbility`) con `duration` y `oncePerCombat` (default `true` en v0.1).
- **Consumen 1 Skill Slot** de la ronda.
- **No hacen clash**: se resuelven en su orden de SPD y aplican su efecto al equipo.
- Al activarse, aplican su efecto al equipo del usuario (`target: "team"`) durante `duration` rondas.
- **En v0.1 son 1 vez por combate.** El campo `cooldown` queda en el modelo para habilidades futuras reutilizables (`oncePerCombat: false`), pero no se usa con las de v0.1.
- Ejemplo: `+100 DEF`, `+50 ATK`, `+60 HP` durante 4 rondas, 1 vez por combate.
- **DECISIÓN:** coste de 1 slot, 1 vez por combate, aplica al equipo.

### 7.11 Status effects

Un efecto es una definición con **triggers** y **acciones**:

```ts
interface EffectDefinition {
  id: string;
  name: string;
  maxStacks?: number;
  stackMode?: "add" | "refresh" | "replace";
  duration?: { type: "turns"; default: number } | { type: "permanent" };
  triggers: {
    when: "roundStart" | "roundEnd" | "onUseSkill" | "onTakeDamage" |
          "onClashWin" | "onClashLose" | "onDefeat";
    actions: EffectAction[];
  }[];
}
```

Acciones disponibles en v0.1:

- `damage` (`base`, `perStack`, `damageType`)
- `heal` (`base`, `perStack`)
- `modifyStat` (`stat`, `mode`, `amount`, `perStack`)
- `applyEffect` (`effectId`, `stacks`)
- `consumeStacks` (`amount`)

Aplicación:

```ts
interface AppliedEffect {
  effectId: string;
  stacks: number;
  remainingTurns?: number;
  sourceId?: string;
}
```

- Al aplicar un efecto se respeta `maxStacks` y `stackMode`.
- `remainingTurns` se descuenta al final de cada ronda, después de los triggers `roundEnd`.
- Si llega a 0, se elimina.
- Los efectos permanentes no se descuentan.

Ejemplos iniciales:

| Efecto | Trigger | Acción | Notas |
|---|---|---|---|
| **Burn** | `roundEnd` | `damage { perStack: 2 }` + `consumeStacks 1` | Dura 3 rondas, máx 5 stacks. |
| **Bleed** | `onUseSkill` | `damage { perStack: 1 }` + `consumeStacks 1` | Castiga acciones. |
| **Protection** | pasivo | `modifyStat def +5 por stack` | Dura 3 rondas. |
| **Haste** | pasivo | `modifyStat spd +3 por stack` | Dura 3 rondas. |

**DECISIÓN:** estos 4 efectos son el set inicial; el editor permite crear más.

### 7.12 Muerte y fin de encuentro

- HP ≤ 0 → unidad `defeated = true`, sale del orden de turno y no puede actuar.
- Los enemigos derrotados se quitan del combate.
- Los jugadores derrotados quedan fuera hasta el final del combate; **no se reviven en medio**.
- El combate termina cuando un bando no tiene unidades activas, o cuando el DM pulsa “End encounter”.
- **HP persistente:** por defecto el HP actual se mantiene al terminar el combate (`hpPersistence: "persist"`); **fuera de combate** el DM puede curar con un botón “Rest party”.

**DECISIÓN:** HP persistente + descanso **fuera** de combate. En combate nadie ajusta HP ni efectos: el DM solo controla enemigos.

### 7.13 RNG y log

- El servidor genera una **semilla** por encuentro y usa un PRNG determinista (ej. `mulberry32`).
- Cada tirada se registra en `CombatEvent` con unidad, skill, monedas, resultado y totales.
- El log permite replay, depuración y que los clientes animen lo mismo.
- El cliente **nunca** genera números aleatorios para el combate.

### 7.14 Ejemplo de ronda

Unidad A (SPD 12, ATK 20, DEF 10) usa una skill de 3 monedas:
`baseClash 5, coinClash 7, baseDamage 10, coinDamage 5`.
Unidad B (SPD 10, DEF 12) usa una skill de 2 monedas:
`baseClash 8, coinClash 5, baseDamage 15, coinDamage 5`.

1. A tira: cara, cruz, cara → clash `5 + 7 + 7 = 19`.
2. B tira: cara, cara → clash `8 + 5 + 5 = 18`.
3. Gana A (19 > 18). B no hace daño.
4. Daño de A: `20 + 10 + (2 caras × 5) = 40`.
5. Mitigación de B: `12 / (12 + 100) ≈ 0.107` → `40 × 0.893 = 35.7` → **35**.
6. B pierde 35 HP. Si B tenía 50, queda en 15.
7. Se aplican efectos de la skill de A (si tiene).

Si A hubiera sacado las 3 caras: daño `(20 + 10 + 15) × 2 = 90`; `90 × 0.893 = 80.35` → **80**.

### 7.15 Parámetros configurables

Todo esto vive en `campaign.rules` y se puede editar desde la app:

| Parámetro | Default | Qué cambia |
|---|---|---|
| `defenseConstant` | 100 | Cuánto reduce la DEF (porcentual). |
| `minDamage` | 1 | Daño mínimo. |
| `maxSkillSlots` | 6 | Tope de slots por unidad. |
| `tieRule` | `cancel_both` | Empate de clash: cancela ambas acciones. |
| `fullHeadsMultiplier` | 2 | Bonus por todas caras. |
| `luckCap` / `luckFloor` | 0.9 / 0.1 | Límites de probabilidad. |
| `hpPersistence` | `persist` | HP entre combates. |

---

## 8. Arquitectura técnica

### 8.1 Stack

| Capa | Tecnología | Por qué |
|---|---|---|
| Frontend | **React + TypeScript + Vite + Tailwind** | Rápido de iterar, componentes, responsive. |
| Estado | **Zustand** | Simple, sin boilerplate. |
| Backend | **Node + TypeScript + Fastify** | Ligero, tipado, fácil de hostear. |
| Tiempo real | **Socket.IO** | Rooms, reconexión, acks. |
| DB | **SQLite + Drizzle ORM** | Local, cero configuración, exportable. |
| Validación | **Zod** | Mismo esquema en cliente y servidor. |
| Tests | **Vitest** | Rápido; motor puro. |
| Monorepo | **pnpm workspaces** | Compartir tipos y lógica. |

### 8.2 Estructura

```text
protocol-life/
  apps/
    web/                 # React (DM + jugador)
    server/              # Fastify + Socket.IO + SQLite
  packages/
    shared/              # tipos, Zod, motor de reglas, RNG
  docs/
  reference/
  data/                  # SQLite, uploads, exports (git-ignored)
```

### 8.3 Servidor autoritativo

- El cliente envía **intenciones** (`declare_action`, `equip_item`, etc.).
- El servidor valida permisos, fase y reglas; resuelve y emite eventos.
- El cliente no calcula daño ni tiradas; solo anima el log.
- El DM también es un cliente con rol `dm`; sus acciones pasan por el servidor.

### 8.4 Persistencia

- SQLite con tablas: `campaigns`, `items`, `skills`, `effects`, `characters`, `encounters`, `sessions`, `combat_logs`.
- Contenido anidado (equipo, efectos) puede ir en columnas JSON validadas.
- Autosave tras cada mutación.
- Export/import de campaña completa en JSON.
- Backup automático diario del archivo SQLite (copia) en `data/backups/`.

### 8.5 Hosting

- **Desarrollo:** `pnpm dev` levanta web + server en localhost.
- **LAN (v0.1):** el DM pulsa Host; el server escucha en `0.0.0.0:3000`; la app muestra `http://<IP-LAN>:3000`, un **QR** y el **PIN**. Los jugadores en la misma WiFi abren el link, ponen el PIN, eligen personaje y entran. Sin instalar nada, sin internet.
- **Requisitos LAN:** permitir el puerto 3000 en el firewall del DM; si el router tiene “aislamiento de clientes / AP isolation”, desactivarlo.
- **Internet:** no es necesario para v0.1. Si algún día juegan fuera de la red, se añade túnel (Cloudflare Tunnel/Tailscale) o VPS; no lo complicamos ahora.
- **PIN:** código de sala + PIN. No es autenticación fuerte, pero para LAN es suficiente.

### 8.6 Seguridad y permisos

- Sin cuentas en v0.1: tokens de sesión.
- `dmToken` secreto; `playerToken` por jugador.
- El servidor comprueba:
  - solo el DM inicia/termina encuentros;
  - los ajustes de HP/fichas se hacen **fuera de combate**;
  - un jugador solo edita su personaje;
  - solo la unidad dueña declara sus acciones;
  - fase correcta (no declarar si ya se resolvió).
- En combate **nadie** edita fichas ni enemigos; el DM solo elige acciones de enemigos.
- Rate limit en join y en mutaciones.
- Validación Zod en cada payload.
- No confiar en IDs del cliente para permisos: usar el token.

### 8.7 Imágenes

- v0.1: campo URL + subida local.
- Uploads a `data/uploads/<uuid>.<ext>`, límite 5 MB, MIME permitido (`png`, `jpg`, `webp`, `gif`).
- Servir estático con cache.
- **Recomendación:** usar upload para el contenido final (funciona offline y no depende de un host externo). La URL queda para prototipar rápido.
- Convertir a WebP y generar miniatura para el editor.

### 8.8 Animaciones (futuro)

- v0.1: sin animaciones; el motor emite eventos y el cliente los reproduce después.
- **CSS/keyframes** para feedback de UI: monedas, números de daño, shake, flash, barras de HP.
- **Lottie** para efectos vectoriales ligeros (slashes, explosiones, buffs).
- **Rive** o **Spine** para personajes 2D con esqueleto y estados (idle, attack, hit, death).
- **PixiJS/Phaser** si el side-view necesita muchas partículas o sprites.
- **Recomendación:** empezar con CSS + Lottie; si el side-view crece, Rive (más fácil de integrar y animar que Spine).
- Regla clave: la animación **nunca** bloquea la lógica. El cliente encola los `CombatEvent` y los reproduce en una timeline; si el jugador salta la animación, el estado ya está resuelto en el servidor.

### 8.9 Testing

- Tests unitarios del motor: clash, daño, DEF, full heads, efectos, empates.
- Tests de integración: dos clientes, join, editar ficha, iniciar combate, declarar, resolver.
- Test de determinismo: misma semilla → mismo log.
- Playwright para flujos críticos (opcional en v0.1).

---

## 9. Eventos y API (v0.1)

### 9.1 Cliente → Servidor

| Evento | Payload | Quién |
|---|---|---|
| `room:join` | `{ code, pin?, name }` | Jugador |
| `room:leave` | `{}` | Todos |
| `campaign:update` | `{ patch }` | DM |
| `content:create` | `{ type, data }` | DM |
| `content:update` | `{ type, id, patch }` | DM |
| `content:delete` | `{ type, id }` | DM |
| `character:create` | `{ character }` | DM / jugador (propio) |
| `character:update` | `{ id, patch }` | DM / dueño |
| `character:equip` | `{ characterId, slot, itemId }` | DM / dueño |
| `character:grantItem` | `{ characterId, itemId, qty }` | DM |
| `encounter:start` | `{ encounterId }` | DM |
| `combat:declare` | `{ actions: DeclaredAction[] }` | Dueño |
| `combat:lock` | `{}` | Todos |
| `combat:end` | `{}` | DM |

### 9.2 Servidor → Cliente

| Evento | Payload | Cuándo |
|---|---|---|
| `state:full` | `{ campaign, session, combat? }` | Al conectar / cambio grande |
| `room:players` | `{ players }` | Join/leave |
| `content:changed` | `{ type, item }` | CRUD |
| `character:changed` | `{ character }` | Edición/equipo |
| `combat:started` | `{ combat }` | Start |
| `combat:event` | `{ event }` | Cada paso de la resolución |
| `combat:state` | `{ combat }` | Snapshot tras resolver |
| `combat:ended` | `{ winner, log }` | Fin |
| `error` | `{ code, message }` | Validación/permiso |

**DECISIÓN:** en v0.1 se puede emitir `state:full` tras cada mutación (campañas pequeñas) para simplificar; optimizar después.

---

## 10. Roadmap

### Fase 0 — Diseño (este documento)

- **Entregable:** doc v0.1 + schema TypeScript + decisiones revisadas.
- **Criterio:** puedes leerlo y decir “sí, esta es la base” o “cambia esto”.

### Fase 1 — Estudio del DM (local)

- Scaffold del monorepo.
- SQLite + Drizzle + Zod.
- CRUD de items, skills, effects, characters, encounters.
- Editor con formularios y preview.
- Ficha de personaje con equipo y stats derivados.
- Export/import JSON.
- Tests del motor de stats.

**Criterio de aceptación:** crear un objeto, una skill y un personaje; equipar; ver stats; recargar y que persista; exportar e importar.

### Fase 2 — Mesa en vivo

- Host/join con código + PIN.
- Sesión con tokens, reconexión.
- Fichas compartidas; DM ve y edita; jugador edita la suya.
- Lista de party y presencia.
- Permisos y validación.

**Criterio:** dos navegadores se unen; el jugador edita su ficha y el DM lo ve en vivo; un jugador no puede editar la ficha de otro.

### Fase 3 — Encuentros y combate

- Editor de encuentros.
- `CombatState`, turnos, declaraciones, lock.
- Motor de clash, monedas, daño, DEF, full heads.
- Status effects y utilidad.
- UI side-view + log animado.
- DM console para enemigos (sin editar fichas en combate).

**Criterio:** el DM inicia un encuentro; 2 jugadores declaran; se resuelve una ronda con clash, daño y un efecto; el log coincide con lo esperado; se puede terminar el combate.

### Fase 4 — Contenido avanzado y pulido

- Tiendas funcionales (Clean Shards, no dinero real).
- Mazmorras (modelo + editor + recorrido básico).
- Balance, animaciones, sonidos.
- Deploy/túnel documentado (solo si algún día se juega fuera de LAN).
- Backup/restore.

**Criterio:** una sesión completa de principio a fin sin tocar la base de datos a mano.

### Extras (post-v0.1)

- Mapas con grid, niebla, tokens.
- Modo oculto de declaraciones.
- Historial de campaña, diario, handouts.
- Animaciones más elaboradas (Rive/Spine).

---

## 11. Decisiones (v0.1)

| # | Tema | Decisión | Estado |
|---|---|---|---|
| 1 | Fórmula de DEF | Mitigación porcentual `DEF / (DEF + 100)`, mínimo 1 | Resuelto |
| 2 | Empate de clash | Se cancelan ambas acciones | Resuelto |
| 3 | Stat SPD | Base 10; ordena turnos. Redirigir exige SPD estrictamente mayor | Resuelto |
| 4 | Acciones por ronda | 2 Skill Slots base; objetos/efectos suman; tope 6 | Resuelto |
| 5 | Declaraciones | Abiertas | Resuelto |
| 6 | HP entre combates | Persistente + descanso fuera de combate | Resuelto |
| 7 | Status effects iniciales | Burn, Bleed, Protection, Haste | Resuelto (se amplían después) |
| 8 | Hosting | LAN misma WiFi, link/QR + PIN | Resuelto |
| 9 | Jugadores | 6 + DM | Resuelto |
| 10 | Edición en combate | Solo DM fuera de combate; en combate nadie edita | Resuelto |
| 11 | Dominios/hábitats | 1 Skill Slot, 1 vez por combate, equipo | Resuelto |
| 12 | Imágenes | Upload local principal + URL opcional | Resuelto |
| 13 | Emparejamiento con 2+ acciones | Cualquier slot (por apuntarse) | Resuelto |
| 14 | Coste de redirección | 1 Skill Slot, requiere SPD estrictamente mayor | Resuelto |

### Todas las decisiones de v0.1 están cerradas

- **DEF:** porcentual `DEF/(DEF+100)`.
- **Dominios:** 1 vez por combate.
- **Imágenes:** upload principal + URL opcional.
- **Emparejamiento:** cualquier slot, siempre que se apunten.
- **Redirección:** 1 Skill Slot.

---

## 12. Próximos pasos

1. **Scaffold del proyecto** (Fase 1): monorepo, tipos, SQLite, primera pantalla de biblioteca de objetos.
2. **Capturas/export de Figma** para alinear la UI (no bloquea el inicio).
3. **Playtest temprano** con 2–3 personas cuando haya combate.

---

## Anexo A — Checklist del MVP

- [ ] Crear campaña.
- [ ] Crear/editar objeto de equipo.
- [ ] Crear/editar skill.
- [ ] Crear/editar efecto.
- [ ] Crear personaje y equipar.
- [ ] Stats derivados correctos.
- [ ] Guardar/recargar.
- [ ] Export/import.
- [ ] Host + join con link/QR + PIN.
- [ ] Ficha compartida en vivo.
- [ ] Crear encuentro.
- [ ] Iniciar combate.
- [ ] Declarar hasta 2 Skill Slots y bloquear.
- [ ] Clash + daño + DEF.
- [ ] Redirección con SPD mayor.
- [ ] Status effect.
- [ ] Dominio/hábitat 1 vez por combate.
- [ ] Log de combate.
- [ ] Fin de combate.

## Anexo B — Ejemplo de campaña (resumen)

```json
{
  "schemaVersion": 1,
  "name": "Campaña de prueba",
  "rules": {
    "defenseConstant": 100,
    "minDamage": 1,
    "maxSkillSlots": 6,
    "tieRule": "cancel_both",
    "fullHeadsMultiplier": 2,
    "luckCap": 0.9,
    "luckFloor": 0.1,
    "hpPersistence": "persist"
  },
  "content": {
    "items": [],
    "skills": [],
    "effects": [],
    "specials": [],
    "characters": [],
    "encounters": [],
    "shops": [],
    "dungeons": []
  }
}
```

## Anexo C — Referencias

- Prototipo original: [`reference/protocol-game-v1.1.html`](../reference/protocol-game-v1.1.html)
- Contrato de datos: [`schema-v0.1.ts`](./schema-v0.1.ts)
- Figma: pendiente de exportar capturas.
- Inspiración de combate: *Limbus Company* (monedas, clash, side-view).
