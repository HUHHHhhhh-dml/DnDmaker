# FASE 1 — Estudio del DM · Notas de implementación

> Estado: **completada**. Este documento resume qué se construyó, cómo verificarlo y qué queda para las siguientes fases. El diseño cerrado sigue en [`DISENO-v0.1.md`](./DISENO-v0.1.md); no se modificó.

![Panel](./screenshots/fase-1-panel.png)

## 1. Lo que ya se puede hacer

- Crear una campaña (con o sin contenido de ejemplo) y cambiar sus reglas de mesa.
- Gestionar la biblioteca de **objetos** (slot, rareza, stats, efectos pasivos, imagen, utilidad con usos).
- Gestionar **skills** (monedas, clash, daño, full heads, efectos al impactar).
- Gestionar **efectos** (triggers + acciones data-driven: daño, curación, modifyStat, aplicar efecto, consumir stacks).
- Gestionar **personajes** (jugador, NPC o enemigo), equipar los cinco slots, elegir 3 skills, dominio/hábitat e inventario.
- Ver **stats derivados** en vivo, con desglose por objeto/efecto, efecto de DEF, probabilidad de cara y avisos de referencias.
- Gestionar **encuentros** (enemigos, cantidades, recompensas, texto de victoria/derrota).
- Subir imágenes locales o pegar URL.
- Exportar la campaña a JSON e importarla con IDs nuevos y referencias remapeadas.
- Persistir todo en SQLite; recargar el navegador o reiniciar el servidor no pierde datos.

## 2. Criterio de aceptación — verificación

| Criterio | Resultado | Cómo se verificó |
|---|---|---|
| Crear una campaña | ✅ | API test + UI (modal de nueva campaña). |
| Crear/editar un objeto y una skill | ✅ | API test + flujo Playwright: crear → editar → recargar. |
| Crear un personaje y equiparlo | ✅ | API test + flujo Playwright: objeto al slot `hand`, skill en slot 1. |
| Stats derivados correctos | ✅ | Tests de `calculateStats`; UI muestra HP 50 / ATK 7 con un objeto de +7 ATK. |
| Recargar y que persista | ✅ | Test de integración cerrando y reabriendo SQLite; Playwright con `reload`. |
| Exportar/importar campaña | ✅ | Test de API + flujo Playwright con descarga y subida real del JSON. |
| `npm run dev` sin pasos manuales | ✅ | `concurrently` levanta web + servidor; seed automático en base vacía. |
| Tests unitarios de stats y validación | ✅ | `npm test` (25 tests de shared + 10 de API). |

## 3. Decisiones de implementación

### 3.1 Workspaces y ejecución

- **npm workspaces** en lugar de pnpm (no estaba instalado), tal como recomendaba el handoff.
- `packages/shared` se consume directamente desde TypeScript (`exports` → `src/index.ts`), sin paso de build. Vite y `tsx` lo resuelven.
- **Tailwind CSS 4** con `@tailwindcss/vite` y tokens en `apps/web/src/styles.css`.
- **TypeScript 5.9** en modo estricto (`noUncheckedIndexedAccess`, `noImplicitOverride`).

### 3.2 Base de datos

- **SQLite + better-sqlite3 13 + Drizzle 0.45.** `better-sqlite3` funciona en Node 26 con binarios precompilados; no se necesitó `node:sqlite`.
- DDL idempotente en `apps/server/src/db.ts` (`CREATE TABLE IF NOT EXISTS`). En Fase 1 no hay `drizzle-kit` para evitar pasos manuales; cuando el esquema cambie se introducirán migraciones.
- `PRAGMA journal_mode = WAL`, `foreign_keys = ON`, `busy_timeout = 5000`.
- Las tablas guardan la entidad completa validada en `data` (JSON) y espejan columnas útiles (`name`, `code`, `slot`, `kind`).
- **Tiendas y mazmorras** están en el modelo pero no tienen UI todavía; se guardan en `campaigns.extras` para sobrevivir al export/import.
- Los **dominios/hábitats** (`SpecialAbility`) viven en una tabla `specials`; la ficha puede asignarlos y el import los conserva.

### 3.3 Motor de stats

`packages/shared/src/stats.ts`:

```text
stat = (base + Σ modificadores planos) × (1 + Σ porcentajes / 100)
Skill Slots = clamp(resultado, 1, rules.maxSkillSlots)
HP máx. = max(1, resultado)
```

- Los efectos pasivos del equipo aportan `modifyStat`; los stacks se acumulan entre fuentes y se recortan a `maxStacks`.
- La ficha muestra contribuciones por fuente, efectos activos, avisos de referencias rotas y stats derivados.
- `mitigation()` y `coinChance()` quedan listas para el motor de combate de Fase 3.
- Las skills equipadas no modifican stats; aportan acciones en combate.

### 3.4 Validación

- **Zod** en la frontera (API e import) y **validación de negocio** en `packages/shared/src/validation.ts`.
- Límites aplicados: nombre 1–80, descripción 0–2000, `coins` 1–20, stats −999..999, Skill Slots 1–6, `maxPlayers` 1–6, imágenes ≤ 5 MB y MIME permitido.
- El servidor bloquea borrados que romperían referencias (409 con detalle), valida personajes al guardar y revalida la campaña completa al importar.
- Los avisos (por ejemplo, objeto equipado en un slot distinto al suyo) no impiden guardar, pero se muestran en la ficha.

### 3.5 Import / export

- El export incluye `schemaVersion`, reglas, settings y todo el contenido.
- El import valida con Zod y `validateCampaign`, y luego **remapea todos los IDs** (campaña, objetos, skills, efectos, personajes, encuentros y especiales), incluyendo:
  - efectos pasivos y `useEffect`,
  - efectos de skills,
  - triggers y `applyEffect`,
  - equipo, skills, especiales e inventario de personajes,
  - enemigos, `overrides`, recompensas, tiendas y mazmorras.
- Importar el mismo archivo dos veces no colisiona.

### 3.6 Imágenes

- `POST /api/uploads` (multipart, campo `file`, 5 MB, PNG/JPG/WEBP/GIF) guarda en `data/uploads` con nombre UUID.
- Se sirven desde `/uploads/:file` con cache largo y validación estricta del nombre.
- El editor permite URL, upload o quitar la imagen. Los uploads funcionan también por el proxy de Vite en desarrollo.

### 3.7 UI

- Layout con sidebar fijo en escritorio y drawer en móvil.
- Estética: papel, rejilla, bordes negros de 2 px, sombras duras, formas recortadas (pentágono/hexágono), tipografía display y mono para datos.
- Estados de carga, avisos (toasts), modales, confirmaciones y errores de validación visibles.
- Páginas: panel, arsenal, editor de objeto, skills, editor de skill, efectos, editor de efecto, fichas, ficha, encuentros, editor de encuentro.
- Los ajustes de campaña (reglas + mesa + borrado) están en un modal accesible desde el panel y la sidebar.

## 4. API

Ver la tabla del [README](../README.md#api-fase-1). Resumen de códigos:

- `400` payload inválido (Zod) con `issues`.
- `404` campaña/contenido inexistente.
- `409` borrado bloqueado por referencias.
- `413`/`415` imagen demasiado grande o formato no permitido.
- `422` validación de negocio al guardar/importar.

## 5. Tests

```bash
npm test
```

- `packages/shared/src/stats.test.ts` — stats base, equipo, porcentajes, stacks, Skill Slots, HP mínimo, referencias rotas, mitigación y probabilidad de cara.
- `packages/shared/src/validation.test.ts` — referencias, IDs duplicados, 3 slots de skill, slots de equipo, encuentros, esquemas Zod, campaña válida y búsqueda de referencias.
- `apps/server/src/api.test.ts` — CRUD real, ficha derivada, PATCH, payload inválido, borrado bloqueado, persistencia cerrando y reabriendo SQLite, export/import con remapeo y seed.

También se verificó el flujo completo en navegador (Playwright, contra `npm run dev`): crear objeto → editar → crear skill → crear personaje → equipar → ver stats → recargar → exportar → importar → comprobar referencias, sin errores de consola.

## 6. Limitaciones conocidas (Fase 1)

- Sin host/join, PIN, WebSocket ni sesiones: todo es local.
- Sin combate ni resolución de encuentros; los encuentros son datos preparados.
- Sin editor de dominios/hábitats, tiendas ni mazmorras (modelo listo, sin UI).
- Sin cuentas de usuario, IA automática ni app móvil nativa (descartado también para el futuro).
- Sin migraciones automáticas de esquema; si cambia el DDL en desarrollo, se recomienda borrar `data/protocol-life.sqlite` y volver a arrancar (el seed se regenera). Para producción/backup se añadirá `drizzle-kit` y backup diario.
- El borrado de una campaña es inmediato y en cascada; la UI pide confirmación y recuerda exportar antes.
- **Visual de combate:** no hay side-view todavía. La decisión para Fase 3 está cerrada en [DECISION-SIDE-VIEW.md](./DECISION-SIDE-VIEW.md): party por capas, enemigos por sprite único y fallback automático.

## 7. Siguiente fase (Fase 2)

1. Host/join LAN: código de sala + PIN, `dmToken`/`playerToken`, presencia y reconexión.
2. Sesión con Socket.IO y `state:full` tras cada mutación.
3. Permisos: el jugador edita su ficha; el DM edita todo fuera de combate.
4. Party compartida en vivo y vista de jugador.
5. Elegir si el servidor escucha en `0.0.0.0` para LAN (con aviso de firewall) y mostrar link/QR.

## 8. Archivos clave

| Archivo | Rol |
|---|---|
| `packages/shared/src/types.ts` | Contrato de datos v0.1. |
| `packages/shared/src/schemas.ts` | Esquemas Zod de entrada/salida/import. |
| `packages/shared/src/stats.ts` | Motor de stats derivados. |
| `packages/shared/src/validation.ts` | Referencias, slots y validación de campaña. |
| `apps/server/src/repository.ts` | CRUD, ficha, export/import y remapeo. |
| `apps/server/src/seed.ts` | Contenido inicial editable. |
| `apps/server/src/db.ts` | Conexión SQLite + DDL. |
| `apps/web/src/store/useAppStore.ts` | Estado de campaña/contenido (Zustand). |
| `apps/web/src/pages/CharacterSheetPage.tsx` | Ficha, equipo y stats en vivo. |
| `apps/web/src/components/StatPanel.tsx` | Visualización de stats y desglose. |

## 9. Decisión registrada para Fase 3

El side-view queda cerrado como **híbrido por ficha**: capas para la party y NPCs importantes, sprite único para enemigos, capas opcionales para jefes, con fallback `capas → battleSprite → portrait → placeholder`. El contrato propuesto (`visualMode`, `battleSprite`, `bodyImage`, `Skill.weaponImage`) está anotado en [`schema-v0.1.ts`](./schema-v0.1.ts) y detallado en [`DECISION-SIDE-VIEW.md`](./DECISION-SIDE-VIEW.md). No se activa en el runtime hasta Fase 3.
