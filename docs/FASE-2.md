# FASE 2 — Mesa en vivo · Notas de implementación

> Estado: **completada**. Cubre host/join LAN, sesiones con tokens, fichas compartidas en tiempo real, presencia y permisos. El combate sigue fuera de alcance hasta la Fase 3.

![Mesa del DM con una jugadora conectada](./screenshots/fase-2-mesa-dm.png)

## 1. Lo que ya se puede hacer

- Abrir una sala LAN desde **Mesa**, con código de 6 caracteres, link, QR y PIN opcional.
- Entrar desde otro navegador/dispositivo con link + PIN + nombre.
- Elegir una ficha de jugador libre o crear una nueva con stats por defecto.
- Ver la party y la presencia en vivo (conectado/desconectado, DM presente).
- Editar la ficha propia (identidad, retrato, stats base, equipo, skills, especiales e inventario) y ver los cambios en el DM al instante.
- Que el DM edite cualquier ficha y el jugador reciba el cambio sin recargar.
- Recargar la pestaña y recuperar la sesión desde el token guardado.
- Salir de la mesa y liberar la ficha; cerrar la sala y avisar a todos.
- Reabrir una sala desde otro navegador aunque la anterior siguiera abierta (reemplazo controlado por el DM local).

## 2. Criterio de aceptación — verificación

| Criterio | Resultado | Cómo se verificó |
|---|---|---|
| Dos navegadores se unen | ✅ | E2E Playwright con dos contextos: DM + jugador. |
| El jugador edita su ficha | ✅ | Cambió nombre y ATK base; guardado vía PATCH con token. |
| El DM lo ve en vivo | ✅ | La mesa del DM actualizó nombre/stats sin recargar (`campaign:refresh`). |
| Un jugador no edita otra ficha | ✅ | Test HTTP: 403 `not_your_character`; además no puede tocar contenido/campaña/export. |
| PIN | ✅ | Host con PIN 4321; join sin PIN/incorrecto → 403. |
| Presencia | ✅ | Test Socket.IO real y E2E: “En línea”, contador y estado del DM. |
| Contenido bloqueado | ✅ | El estado del jugador excluye objetos/skills sin desbloquear; equipar uno devuelve 403 `content_locked`; al desbloquear el DM aparece en vivo. |
| Muñeco visual | ✅ | E2E: clic en un slot abre el overlay con imagen/stats; equipar actualiza el slot y las capas; el seed usa base 200×300. |
| Reconexión / persistencia | ✅ | Recarga de `/table` con auto-resume; tokens en SQLite + localStorage. |
| Cierre de sala | ✅ | El jugador recibe “La sala se cerró”; fichas liberadas. |
| API/permisos | ✅ | 52 tests de Vitest, incluidos 14 de sesiones y 3 de Socket.IO. |

## 3. Arquitectura de la mesa

```text
DM (navegador)                        Servidor local
  └─ POST /campaigns/:id/session ──► SessionService.host()
       ◄─ dmToken + code + LAN IP        sessions (SQLite)
  └─ Socket.IO auth {code, token} ──► presence + eventos
  └─ PATCH /content/characters/:id ─► auth + validación
                                          │
Jugador (navegador)                       ├─ campaign:refresh ─► DM
  └─ GET /sessions/:code ──────────────►  ├─ session:players ─► todos
  └─ POST /sessions/:code/join ───────►   └─ session:closed ──► todos
       ◄─ playerToken + campaña saneada
  └─ PATCH /content/characters/:id ──► solo su ficha
```

- Las **mutaciones** son HTTP con token; el servidor valida y luego emite eventos.
- Los **eventos** son solo notificaciones de estado; el cliente no puede mutar por socket.
- La sala se guarda en la tabla `sessions` (una por campaña), con `dmToken`, `code`, `players` JSON y `status`.

### 3.1 Sesiones

- **Código:** 6 caracteres, alfabeto sin `I`, `O`, `0`, `1`.
- **DM token:** 32 bytes aleatorios en hex; se guarda en localStorage bajo `protocol-life:dm-session:<campaignId>`.
- **Player token:** 32 bytes por jugador; se guarda en `protocol-life:player-session:<code>`.
- **Presencia:** `connected` se persiste en el JSON de jugadores; se resetea al arrancar el servidor y se reconstruye al reconectar. La presencia del DM es de runtime.
- **Una sala por campaña:** abrir otra reemplaza la anterior, libera las fichas reclamadas y avisa por `session:closed`.
- **Recuperación:** el host reemplaza una sala existente aunque el navegador no tenga el token anterior; es una operación de confianza local del DM. Esto permite recuperarse si se borra localStorage o se cambia de navegador.

### 3.2 PIN

- Usa `campaign.settings.requirePin` y `campaign.settings.pin`.
- La pantalla de mesa permite fijarlos al abrir la sala (`requirePin`/`pin` en el body del host).
- El PIN es una barrera de conveniencia LAN; **no** es autenticación fuerte. No exponer el servidor a internet.
- Rate limit básico en join: 20 intentos/minuto por IP+código → 429.

### 3.3 Tokens y permisos

- Si la campaña **no** tiene sala, se mantiene el modo local de Fase 1 (sin token).
- Si hay sala:
  - Contenido/campaña/export/delete: solo `dmToken`.
  - `PATCH characters/:id`: DM cualquiera; jugador solo si `player.characterId === id`, `allowPlayerEdit` y `status !== "combat"`.
  - El jugador no puede enviar `kind` ni `ownerId` (403 `forbidden_fields`).
  - Sin token: 401 `session_required`; token inválido: 401 `invalid_token`.
- La **vista del jugador** se sirve saneada:
  - sin enemigos,
  - sin notas del DM (tampoco las suyas),
  - sin encuentros/tiendas/mazmorras,
  - sin PIN.
- Los GET de campaña/contenido son de LAN y no se consideran secretos; las mutaciones sí están protegidas. La privacidad fuerte por lectura queda para una fase posterior con roles más estrictos.

### 3.4 Biblioteca por desbloqueo

- `Item.unlocked?: boolean` y `Skill.unlocked?: boolean`. Ausente o `false` significa **solo DM**.
- El DM ve dos vistas en las bibliotecas:
  - **DM · todo**: biblioteca completa con filtros Todos / Desbloqueados / Solo DM.
  - **Jugadores · desbloqueados**: exactamente la biblioteca que ve la mesa.
- Cada objeto/skill tiene su interruptor **“Visible para jugadores”** en el editor. El contenido nuevo nace bloqueado.
- El estado saneado del jugador filtra `content.items` y `content.skills`:
  - incluye todo lo desbloqueado;
  - incluye además lo que ya lleve un personaje de la party (equipo, inventario o skills), para no romper stats ni fichas existentes;
  - excluye el resto.
- El servidor no confía en la UI: si un jugador intenta equipar/añadir un objeto o skill bloqueado, responde `403 content_locked`. Su propia ficha actual sigue permitida.
- Un cambio de visibilidad emite `campaign:refresh`; los jugadores ven la biblioteca actualizada sin recargar.
- Los **efectos** siguen compartidos para que los stats derivados y las referencias funcionen; si más adelante se quiere ocultarlos también, se les añade el mismo campo.
- Las dos vistas del DM permiten comprobar de un vistazo qué verá la mesa; el filtro “Solo DM” enseña lo que todavía no se ha desbloqueado.

### 3.5 Muñeco de equipo y base visual

- `CampaignSettings.baseCharacterImage` define la imagen base del jugador. Default: `/assets/base-character.png`; el DM puede subir otra o quitarla al crear/editar la campaña.
- El editor del jugador usa un **muñeco** (no listas desplegables):
  - imagen base al centro, con capas de equipo encima (orden `leg → armor → horns → hand`);
  - slots alrededor: utilidad, cuernos, mano, armadura, piernas;
  - ATK/DEF derivados y barra de HP;
  - tres pentágonos de skill.
- Al pulsar un slot se abre un overlay con los objetos de ese slot: imagen grande, nombre, stats debajo, efectos y botón **Equipar**. El slot se rellena con `Item.image`.
- Al pulsar un pentágono se abre el selector de skills con monedas, clash/daño y Equipar.
- El editor solo ofrece objetos/skills desbloqueados o ya equipados; el servidor mantiene la validación `content_locked`.
- La vista de ficha (sin editar) usa el mismo muñeco en modo lectura.
- Formato recomendado: imagen base y capas PNG **200×300** con transparencia y el mismo lienzo. `Item.image` hace de arte del slot y de capa.
- El seed incluye arte local para CIVIL, WARRIOR, SIMPLE ARMOR, WHITE BOOTS y BROKEN FETTERS (tomado del prototipo original); se puede reemplazar desde el editor.

### 3.6 Tiempo real

Socket.IO en `/socket.io`, autenticado por `{ code, token }`:

- Al conectar: `session:state` + `session:players`.
- Al unirse/salir/conectar/desconectar: `session:players`.
- Tras cualquier mutación: `campaign:refresh` a la campaña; los clientes refetchean su estado (completo para DM, saneado para jugador).
- Cierre: `session:closed` y desconexión de los sockets de la sala.
- Presencia del DM: `dmConnected` en la sesión pública.

El cliente del jugador y el del DM tienen stores separados (`usePlayerStore`, `useLiveStore`) y socket en variable de módulo. No se duplican conexiones.

## 4. UI

### DM

- Nueva entrada **Mesa** en la sidebar y acción en el dashboard.
- Antes de abrir: explicación, PIN opcional, generar PIN, aviso de red.
- Sala abierta: código grande, link LAN, QR, PIN, contador, estado de conexión, party en vivo y cierre con confirmación.
- Al hacer clic en un jugador: enlace a su ficha del estudio para editarla; el jugador recibe el cambio.
- Indicador de sala en la sidebar y auto-resume al recargar.

### Jugador

- `/join/:code`: marca PROTOCOL LIFE, info pública de la campaña/sala, PIN, nombre, selección de ficha o creación, error de sala llena/PIN/cerrada, recuperación de sesión guardada.
- `/play/:code`: ficha propia con retrato, stats derivados y equipo/skills/inventario; botón **Editar ficha** con editor completo; party lateral con presencia y stats; estado de conexión; salida con liberación de ficha; pantalla de “La sala se cerró”.
- Sin acceso al Layout del DM ni a enemigos/notas/PIN.

### Capturas

| Jugador | Entrada |
|---|---|
| ![Mesa del jugador](./screenshots/fase-2-mesa-jugador.png) | ![Join](./screenshots/fase-2-join.png) |

| Muñeco de equipo | Overlay de objetos |
|---|---|
| ![Muñeco](./screenshots/fase-2-muneco-equipo.png) | ![Overlay](./screenshots/fase-2-overlay-objetos.png) |

| Biblioteca del DM (todo) | Biblioteca de jugadores |
|---|---|
| ![Biblioteca DM](./screenshots/fase-2-biblioteca.png) | ![Biblioteca jugadores](./screenshots/fase-2-biblioteca-jugadores.png) |

## 5. API añadida

| Método | Ruta | Auth |
|---|---|---|
| GET | `/api/network` | — |
| POST | `/api/campaigns/:id/session` | — (confianza local del DM) |
| GET | `/api/sessions/:code` | — (público saneado) |
| GET | `/api/sessions/:code/state` | token DM/jugador |
| POST | `/api/sessions/:code/join` | PIN si aplica |
| POST | `/api/sessions/:code/leave` | token jugador |
| POST | `/api/sessions/:code/close` | token DM |

Mutaciones existentes: aceptan `x-session-token` o `Authorization: Bearer`. Errores nuevos: `session_not_found`, `invalid_pin`, `session_full`, `character_claimed`, `session_required`, `invalid_token`, `not_your_character`, `forbidden_fields`, `player_edit_disabled`, `combat_lock`, `dm_only`, `invalid_session`.

## 6. Base de datos

Nueva tabla:

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL UNIQUE REFERENCES campaigns(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  dm_token TEXT NOT NULL,
  status TEXT NOT NULL,
  players TEXT NOT NULL,   -- JSON: SessionPlayer[]
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Junto con `idx_sessions_code`. El DDL es idempotente y se aplica al arrancar; no hay migración destructiva.

## 7. Tests

`npm test` → **52 tests**:

- 25 de `packages/shared`.
- 10 de API de Fase 1.
- 14 de sesiones/permisos (`sessions.test.ts`), incluido el filtrado y bloqueo de contenido.
- 3 de Socket.IO con dos clientes reales (`realtime.test.ts`).

Además, E2E manual con Playwright:
1. DM abre sala con PIN.
2. Jugador entra desde otro contexto, elige ficha, aparece en la party.
3. Jugador edita nombre y ATK; el DM lo ve en vivo.
4. El estado del jugador no incluye enemigos, notas ni PIN.
5. DM cierra la sala; el jugador recibe el aviso.

## 8. Decisiones y límites

- **Sin cuentas:** tokens locales + PIN. Es coherente con el diseño v0.1.
- **Host sin auth:** el endpoint de host es de confianza local; reemplaza la sala anterior. No se expone a internet.
- **Lecturas de campaña:** públicas en LAN; la app del jugador usa el estado saneado. Endurecer lecturas requeriría un rol DM por token y una revisión de la app de Fase 1.
- **Sin edición en combate:** el campo `status: "combat"` ya bloquea al jugador; la Fase 3 lo usará.
- **Sin kick/expulsión:** el DM puede cerrar la sala o el jugador salir. Un kick por jugador queda para Fase 3/4.
- **Sin reconexión visual avanzada:** Socket.IO reconecta; la presencia se actualiza. No hay grace period explícito.
- **Sin sync offline:** el servidor manda; si se cae, el cliente muestra reconexión y refetchea al volver.
- **Arte del muñeco:** base y capas deben compartir lienzo (recomendado 200×300). Si se sube arte de carta en vez de capa, el muñeco puede verse raro; se puede cambiar desde el editor.
- **Inventario:** sigue usando un selector de lista; el muñeco visual cubre equipo y skills.
- **Direcciones LAN:** se detectan IPv4 no internas; si hay varias, se ordenan las privadas primero. Puede requerir elegir otra IP manualmente en redes complejas.
- **Vite en LAN:** `server.host: true` y `allowedHosts: true`; pensado para desarrollo local. En producción sirve Fastify.

## 9. Siguiente fase (Fase 3)

1. `CombatState`, encuentros y declaraciones.
2. Resolución por SPD, clash, monedas, full heads, DEF, efectos y utilidad.
3. `status: "combat"` real y bloqueo de fichas.
4. Log de combate y replay.
5. Side-view híbrido según [`DECISION-SIDE-VIEW.md`](./DECISION-SIDE-VIEW.md).
6. Consola del DM para enemigos.

## 10. Archivos clave

| Archivo | Rol |
|---|---|
| `apps/server/src/sessions.ts` | Salas, tokens, presencia, saneado y liberación de fichas. |
| `apps/server/src/realtime.ts` | Socket.IO, rooms y eventos. |
| `apps/server/src/routes.ts` | API, auth de sesión, host/join/leave/close. |
| `apps/server/src/schema.ts` | Tabla `sessions`. |
| `apps/web/src/store/useLiveStore.ts` | Sesión del DM, socket y auto-resume. |
| `apps/web/src/store/usePlayerStore.ts` | Sesión del jugador, socket y ficha propia. |
| `apps/web/src/pages/TablePage.tsx` | Host, PIN, link/QR y party del DM. |
| `apps/web/src/pages/JoinPage.tsx` | Entrada del jugador. |
| `apps/web/src/pages/PlayerTablePage.tsx` | Ficha y party del jugador. |
| `apps/web/src/components/PlayerSheetEditor.tsx` | Editor restringido del jugador. |
| `apps/web/src/components/EquipmentDoll.tsx` | Muñeco, capas y overlays de objetos/skills. |
| `apps/web/src/components/CampaignModals.tsx` | Nueva campaña y ajustes, incluida la imagen base. |
| `apps/web/public/assets/` | Imagen base y arte local del seed. |
| `packages/shared/src/session.ts` | Contrato público de sesión. |
