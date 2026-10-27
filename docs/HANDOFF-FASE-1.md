# HANDOFF — PROTOCOL LIFE · Fase 1

> **Instrucción para el siguiente agente:** continúa el proyecto desde aquí. El diseño v0.1 ya está cerrado; **no lo rediseñes ni vuelvas a preguntar las decisiones de la sección 3**. Tu tarea es ejecutar la **Fase 1** (estudio del DM local). Trabaja en español con el usuario, con tono cercano, y mantén el orden de este documento.

---

## 1. Contexto del proyecto

El usuario está construyendo **PROTOCOL LIFE**, una app para que un **DM** cree y dirija su campaña de rol con contenido totalmente personalizado, y para que sus jugadores se conecten desde el navegador. El combate está inspirado en *Limbus Company*: side-view, skills con monedas, clash, DEF y status effects.

- **Ruta del proyecto:** `/home/serahdml/Documents/GAMES/protocol-life`
- **Documento de diseño:** [`docs/DISENO-v0.1.md`](./DISENO-v0.1.md) (todas las decisiones cerradas)
- **Contrato de datos:** [`docs/schema-v0.1.ts`](./schema-v0.1.ts)
- **Prototipo original (solo referencia visual/mecánica):** [`reference/protocol-game-v1.1.html`](../reference/protocol-game-v1.1.html)
- **README:** [`README.md`](../README.md)

El prototipo es un HTML único con `localStorage` y datos hardcodeados. **No se reutiliza su arquitectura.** Sí se reutilizan la estética, la lógica de monedas/clash y el modelo de contenido.

---

## 2. Estado actual

- Diseño v0.1 **completo y cerrado**.
- **No hay código de la app todavía.**
- No hay repo git inicializado.
- No hay dependencias instaladas.
- El schema TypeScript existe y parsea con Node.
- El usuario quiere una **base modificable**: reglas parametrizadas y contenido editable desde la app, sin tocar código.

---

## 3. Decisiones cerradas (NO volver a preguntar)

| Tema | Decisión |
|---|---|
| **Jugadores** | 1 DM + **6 jugadores** máximo. |
| **Hosting** | **LAN misma WiFi**. El DM corre el servidor local; la app muestra link/QR + PIN. Sin cuentas, sin internet, sin túneles en v0.1. |
| **UI** | Español. El contenido puede tener nombres en inglés. |
| **Nombre** | **PROTOCOL LIFE**. |
| **Skill Slots** | **2 base**; `skillSlots` es un stat; objetos/efectos pueden sumar; **máximo 6**. |
| **Acciones por ronda** | Hasta `skillSlots` acciones. Cada una ocupa un slot distinto (solo UI/orden). |
| **Clash** | Ocurre cuando dos unidades **se apuntan mutuamente**, **sin importar el slot**. Se empareja con la **primera acción no resuelta** del rival que apunte al atacante. Si no hay, es one-sided. |
| **Empate de clash** | Se **cancelan ambas acciones**; nadie hace daño ni aplica efectos. |
| **Redirección** | Gasta **1 Skill Slot**; requiere **SPD estrictamente mayor** que el atacante; cambia el objetivo del clash al redirigidor; una redirección por ataque (la del más rápido). |
| **DEF** | Mitigación porcentual: `DEF / (DEF + 100)`, mínimo 1 de daño. DEF negativa = 0 en v0.1. |
| **HP entre combates** | Persistente. El DM puede descansar/curar al equipo **fuera de combate**. |
| **Edición en combate** | **Nadie** edita fichas ni enemigos en combate. El DM solo controla enemigos. |
| **Declaraciones** | Abiertas (el DM ve todo). |
| **SPD** | Base 10; ordena turnos; redirección exige más SPD. |
| **Status effects** | Set inicial: **Burn, Bleed, Protection, Haste**. Data-driven; se amplían después. |
| **Dominios/hábitats** | Cuestan **1 Skill Slot**, son **1 vez por combate**, aplican al equipo. `cooldown` queda opcional en el modelo para futuras habilidades reutilizables, pero **no se usa en v0.1**. |
| **Imágenes** | **Upload local principal**; URL opcional para pruebas. |
| **Tiendas** | Son de campaña, con **Clean Shards** (moneda del juego); **nunca dinero real**. |
| **Descartado** | Cuentas de usuario, IA automática, app móvil nativa. No se harán ni después. |

---

## 4. Stack y entorno

- **Node:** v26.10.0
- **npm:** 11.19.1
- **pnpm:** no instalado
- **corepack:** no disponible
- **git:** 2.56.0
- **npm registry:** accesible (`npm ping` responde)

**Recomendación:** usar **npm workspaces** (ya está instalado) en lugar de pnpm. Si el usuario prefiere pnpm, instalarlo con `npm i -g pnpm` y actualizar el README/doc, pero no es necesario.

Stack:

- **Web:** React + TypeScript + Vite + Tailwind + Zustand.
- **Servidor:** Node + TypeScript + Fastify + SQLite + Drizzle ORM.
- **Compartido:** Zod + motor de reglas puro + PRNG determinista.
- **Tests:** Vitest.
- **Monorepo:** `apps/web`, `apps/server`, `packages/shared`.

> Nota: Node 26 trae `node:sqlite` integrado. Si Drizzle con `better-sqlite3` da problemas de build nativo, se puede usar `node:sqlite` o `better-sqlite3`; elegir lo que funcione y documentarlo.

---

## 5. Alcance de la Fase 1

**Incluye (solo local, sin red):**

1. Scaffold del monorepo.
2. `packages/shared`:
   - tipos del schema v0.1,
   - esquemas Zod,
   - motor de stats derivados (equipo + efectos),
   - utilidades de validación.
3. `apps/server`:
   - Fastify,
   - SQLite + Drizzle,
   - CRUD de campañas, items, skills, effects, characters, encounters,
   - export/import de campaña.
4. `apps/web`:
   - layout base (sidebar/nav),
   - dashboard de campaña,
   - biblioteca de objetos,
   - editor de objetos (stats, slot, imagen, descripción),
   - editor de skills,
   - editor de efectos,
   - ficha de personaje con equipo y stats derivados.
5. Seed con 3–4 objetos y skills del prototipo.
6. `npm run dev` levanta web + server.
7. Tests unitarios de stats derivados y validación.

**NO incluye todavía:**

- Host/join, PIN, WebSocket.
- Combate.
- Tiendas/mazmorras funcionales.
- Login/cuentas.
- Multiplayer.

**Criterio de aceptación Fase 1:**

- Crear una campaña.
- Crear/editar un objeto y una skill.
- Crear un personaje y equiparlo.
- Ver stats derivados correctos (HP, DEF, ATK, SPD, LUCK, Skill Slots).
- Recargar y que persista en SQLite.
- Exportar/importar la campaña.
- `npm run dev` funciona sin pasos manuales.

---

## 6. Modelo de datos: lo esencial

El contrato completo está en [`docs/schema-v0.1.ts`](./schema-v0.1.ts). Resumen:

### Stats

```ts
interface Stats {
  hpMax: number;
  def: number;
  atk: number;
  spd: number;
  luck: number;       // puntos porcentuales
  skillSlots: number; // base 2
}
```

### Character

- `id` (UUID/ULID), `name`, `kind: "player" | "npc" | "enemy"`.
- `baseStats: Stats`.
- `equipment: Record<"horns" | "hand" | "armor" | "leg" | "utility", Id | null>`.
- `skills: (Id | null)[]` — exactamente 3 slots.
- `special: { domainId?, habitatId? }`.
- `inventory: { itemId, qty }[]`.
- `ownerId?`.

### Item

- `slot`: `horns | hand | armor | leg | utility`.
- `stats?: Partial<Stats>`.
- `effects?: { effectId, stacks? }[]`.
- `uses?`, `useEffect?` para utilidad.
- `image?`.
- `code?` visible, **no** es clave primaria.

### Skill

- `coins`, `baseClash`, `coinClash`, `baseDamage`, `coinDamage`.
- `fullHeadsMultiplier?` (default 2).
- `target: "single"`.
- `effects?: { effectId, chance?, stacks? }[]`.

### EffectDefinition

- `maxStacks?`, `stackMode?`, `duration?`.
- `triggers: { when, actions }[]`.
- `when`: `roundStart | roundEnd | onUseSkill | onTakeDamage | onClashWin | onClashLose | onDefeat`.
- `actions`: `damage`, `heal`, `modifyStat`, `applyEffect`, `consumeStacks`.

### Ruleset

```ts
{
  defenseConstant: 100,
  minDamage: 1,
  maxSkillSlots: 6,
  tieRule: "cancel_both",
  fullHeadsMultiplier: 2,
  luckCap: 0.9,
  luckFloor: 0.1,
  hpPersistence: "persist"
}
```

### Identificadores

- `id`: UUID/ULID inmutable.
- `code`: código visible editable.
- `schemaVersion: 1` en la campaña.
- Export/import JSON validado con Zod.

---

## 7. Reglas de combate (para tenerlas presentes; no implementar aún)

- Orden por **SPD** descendente.
- **Clash:** se apuntan mutuamente, sin importar slot; primera acción no resuelta del rival que te apunte.
- **Monedas:** `probCara = clamp(0.5 + LUCK/100, 0.1, 0.9)`.
- **Clash power:** `baseClash + caras × coinClash`.
- **Daño:** `raw = ATK + baseDamage + caras × coinDamage`; full heads multiplica; `mitigacion = DEF/(DEF+100)`; `final = max(1, floor(raw * (1 - mitigacion)))`.
- **Empate:** cancela ambas acciones.
- **Redirección:** 1 Skill Slot, SPD mayor, una por ataque.
- **Dominios:** 1 slot, 1 vez por combate, equipo.
- **HP persistente**; sin ediciones en combate.
- **RNG del servidor** con semilla y log (para Fase 3).

---

## 8. Plan de ejecución recomendado

### Paso 0 — Confirmar defaults

El usuario ya dijo que quiere arrancar Fase 1. Confirma brevemente:

- UI en español.
- Nombre PROTOCOL LIFE.
- npm workspaces (o pnpm si lo pide).
- Alcance Fase 1 (solo estudio local).

Si el usuario no responde o dice “dale”, usar esos defaults y avanzar.

### Paso 1 — Repo y scaffold

```bash
cd /home/serahdml/Documents/GAMES/protocol-life
git init
```

Crear:

- `package.json` raíz con workspaces.
- `package-lock.json` se genera al instalar.
- `.gitignore` (`node_modules`, `data/*.sqlite`, `data/uploads`, `dist`, `.env`).
- `tsconfig.base.json`.
- `apps/web`, `apps/server`, `packages/shared`.

### Paso 2 — `packages/shared`

- Copiar/adaptar los tipos de `docs/schema-v0.1.ts`.
- Crear esquemas Zod equivalentes.
- Implementar `calculateStats(character, content)` puro y testeable.
- Implementar validaciones de negocio (slots, skillSlots, etc.).
- Tests con Vitest.

### Paso 3 — `apps/server`

- Fastify + `@fastify/static` (si sirve el build web) + CORS en dev.
- SQLite + Drizzle.
- Tablas: `campaigns`, `items`, `skills`, `effects`, `characters`, `encounters`.
- Endpoints CRUD.
- Seed de campaña de prueba.
- Export/import JSON.

### Paso 4 — `apps/web`

- Vite + React + TS + Tailwind + Zustand.
- Layout: sidebar + contenido.
- Pantallas:
  1. Dashboard de campaña.
  2. Biblioteca de objetos (grid + filtros).
  3. Editor de objeto (formulario + preview).
  4. Editor de skill.
  5. Editor de efecto.
  6. Ficha de personaje (equipo + stats).
- Conectar con el server por HTTP.
- Seed visible desde el día uno.

### Paso 5 — Dev y verificación

- `npm run dev` (concurrently web+server).
- Verificar el criterio de aceptación de la sección 5.
- Tests: `npm test`.
- Commit inicial.

---

## 9. Trampas y notas

- **No** usar `localStorage` como fuente de verdad: la persistencia es SQLite.
- **No** hardcodear contenido: seed inicial, pero editable.
- **No** implementar host/join ni combate en Fase 1.
- **No** añadir cuentas, IA ni app móvil.
- **No** editar `docs/DISENO-v0.1.md` para cambiar reglas sin que el usuario lo pida; ya están cerradas.
- **Tailwind:** usar una versión estable y documentar la configuración; si es v4, seguir su setup.
- **SQLite:** si `better-sqlite3` falla por build nativo en Node 26, usar `node:sqlite` o `libsql`.
- **Imágenes:** en Fase 1, permitir URL y upload local simple; no optimizar todavía.
- **UI:** mantener el estilo del prototipo (papel, bordes negros, formas geométricas) hasta que el usuario pase Figma.
- **Idioma:** UI en español; nombres de contenido pueden estar en inglés.
- **Tono:** cercano, en español, sin condescendencia. El usuario usa expresiones cariñosas; responder con calidez pero sin exagerar.

---

## 10. Prompt corto para pegar en el chat nuevo

> Hola. Continúa el proyecto **PROTOCOL LIFE** en `/home/serahdml/Documents/GAMES/protocol-life`. El diseño v0.1 está cerrado en `docs/DISENO-v0.1.md` y `docs/schema-v0.1.ts`; no lo rediseñes. Empieza la **Fase 1**: monorepo con `apps/web`, `apps/server`, `packages/shared`; React+TS+Vite+Tailwind+Zustand; Fastify+SQLite+Drizzle; Zod; Vitest. Alcance: estudio del DM local (campaña, items, skills, effects, characters, encounters), CRUD, ficha con stats derivados, seed y `npm run dev`. Sin host/join ni combate todavía. Usa npm workspaces (Node 26, npm 11; pnpm no está instalado), UI en español, nombre PROTOCOL LIFE. Sigue el handoff completo en `docs/HANDOFF-FASE-1.md` y arranca con el scaffold.

---

## 11. Archivos que debe leer el siguiente agente

1. `docs/HANDOFF-FASE-1.md` (este archivo).
2. `docs/DISENO-v0.1.md` — secciones 3, 6, 7, 8, 10, 11.
3. `docs/schema-v0.1.ts` — contrato completo.
4. `reference/protocol-game-v1.1.html` — solo para estilo/referencia.

Con eso debería poder continuar sin releer toda la conversación.
