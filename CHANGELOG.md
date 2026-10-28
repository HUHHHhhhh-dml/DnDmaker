# Changelog

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
