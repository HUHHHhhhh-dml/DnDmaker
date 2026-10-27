# Decisión de side-view (Fase 3)

> **Estado:** decisión cerrada el 2026-10-27. Implementación pendiente de la Fase 3.
> **Ámbito:** cómo se dibujan las unidades en el combate side-view.
> **Contrato v0.1:** no se modifica ni se activa todavía; la propuesta de campos está al final de [`schema-v0.1.ts`](./schema-v0.1.ts).

## 1. Decisión

El side-view será **híbrido, por ficha**:

| Tipo de ficha | Visual por defecto |
|---|---|
| Personajes de jugador | **Capas** (cuerpo base + equipo) |
| NPCs importantes | **Capas** (si tienen base) o sprite único |
| Enemigos normales | **Sprite único** (retrato de combate) |
| Jefes | **Sprite único por defecto, capas opcionales** |

Motivo: la party son pocas fichas y su identidad visual *es* el equipo; los enemigos son muchos y variados, y el DM no debería montar cinco capas por esbirro. El modo es una propiedad de la ficha, no una regla rígida por tipo.

## 2. Modos de render

### 2.1 Sprite único

- Usa `battleSprite` (imagen de cuerpo completo para combate).
- Si no existe, cae a `portrait`.
- Si tampoco existe, placeholder geométrico del estudio (sin romper la escena).
- Recomendado para enemigos, bestias, autómatas y cualquier ficha no humana.
- El `portrait` sigue siendo la imagen de ficha, tarjetas y menús; no se usa como sprite de combate salvo fallback.

### 2.2 Capas

- Base: `bodyImage` (cuerpo completo, transparente).
- Encima, en este orden: `leg` → `armor` → `horns` → `hand`.
- La **utilidad no se dibuja en el cuerpo**; va como icono/badge en la UI.
- Si la unidad usa una skill con `weaponImage`, esa imagen sustituye temporalmente la capa del objeto de mano mientras se resuelve la acción.
- Si falta `bodyImage`, el modo capas cae automáticamente a sprite único.
- Los objetos usan su `Item.image` actual como capa. Si más adelante el arte de carta no sirve como capa (por encuadre o fondo), se evalúa añadir `Item.layerImage`; **no forma parte de esta decisión**.

## 3. Contrato propuesto (se activa en Fase 3)

```ts
export type VisualMode = "portrait" | "layered";

export interface Character {
  // ...campos actuales...
  /** Retrato de ficha/menús (ya existe). */
  portrait?: string;
  /** Cómo se dibuja en combate. Ausente = según kind. */
  visualMode?: VisualMode;
  /** Sprite único de combate (modo portrait/sprite). */
  battleSprite?: string;
  /** Base del cuerpo para el modo capas. */
  bodyImage?: string;
}

export interface Skill {
  // ...campos actuales...
  /** Capa de arma mientras se usa esta skill (opcional). */
  weaponImage?: string;
}
```

### Defaults y fallback

- `visualMode` ausente:
  - `kind === "enemy"` → `"portrait"`.
  - resto → `"layered"`.
- Orden de resolución al dibujar:
  1. `visualMode === "layered"` y hay `bodyImage` → capas.
  2. hay `battleSprite` → sprite único.
  3. hay `portrait` → sprite único.
  4. placeholder.
- Si el modo capas no tiene base, se comporta como sprite único sin lanzar error.

### Qué NO incluye esta decisión

- Offsets/ajustes finos por capa: se resuelven con la plantilla de assets. Si hicieran falta, se añadirá un campo aparte más adelante.
- Posición, escala y flip en la escena: pertenecen al escenario/encuentro, no a la ficha. `EncounterEnemy.overrides` puede pisar campos visuales si se necesita una variante.
- Animaciones (Rive/Spine/Lottie), animación por frames y efectos de partículas: fase posterior.
- `Item.layerImage` (arte separado de carta vs. capa): se decide solo si la reutilización de `Item.image` no funciona.

## 4. Plantilla de assets

### Capas (party)

- PNG transparente **1024×1024**.
- Personaje centrado horizontalmente.
- Pies/línea de suelo al **90%** de la altura (y ≈ 922 px).
- Todas las capas (cuerpo, piernas, armadura, cuernos, mano) exportadas en el **mismo lienzo**.
- Sin sombra horneada: la sombra la dibuja la escena.
- La guía/plantilla se publicará en `docs/assets/` cuando empecemos Fase 3.

### Sprite único (enemigos)

- PNG/WEBP con transparencia, 1024×1024 o 1024×1536.
- Encuadre de cuerpo completo, mirando hacia la izquierda (el renderer puede espejar).
- El renderer usa `object-fit: contain` y ancla por la parte inferior.

### Objetos

- `Item.image` se usa tal cual como capa. Ideal: mismo lienzo 1024×1024 y transparencia.
- Las imágenes actuales del seed están vacías; se irán subiendo desde el editor.

## 5. UI prevista en Fase 3

1. Nueva sección **“Visual de combate”** en la ficha:
   - selector de modo (`sprite único` / `capas`);
   - `battleSprite` (sprite único);
   - `bodyImage` (base de capas);
   - vista previa en vivo del montaje, con el equipo actual.
2. El editor de objetos ya existente sirve para subir las capas; se añade una nota de que esa imagen se usa también en combate si la ficha está en modo capas.
3. En la mesa de combate, el componente `CombatSprite` recibe la ficha y aplica defaults/fallback.
4. Los campos viajan en export/import y en la ficha como cualquier otro dato.

## 6. Orden de implementación

1. **Renderer + escena:** `CombatSprite` con sprite único + fallback y placeholder. Validar posiciones/turnos con enemigos.
2. **Capas para la party:** composición de cuerpo + equipo, orden de capas y override de arma.
3. **Editor “Visual de combate”** y vista previa.
4. **Capa de arma por skill** y pulido de assets.
5. **Animaciones** (fuera de esta decisión).

## 7. Criterios de aceptación de Fase 3

- [ ] La party se dibuja por capas y refleja cambios de equipo en la vista previa y en combate.
- [ ] Un enemigo con solo `portrait` se ve correctamente (sprite único).
- [ ] Un enemigo sin ninguna imagen usa placeholder y no rompe la escena.
- [ ] El modo capas sin `bodyImage` cae a sprite único sin errores.
- [ ] Export/import conserva `visualMode`, `battleSprite`, `bodyImage` y `weaponImage`.
- [ ] Los assets siguen la plantilla de 1024×1024 y se ven alineados.
- [ ] Ningún cambio requiere editar código para cambiar el visual de una ficha.

## 8. Por qué se eligió así

- **Carga de contenido:** 6 jugadores con capas es asumible; 10 enemigos con capas no.
- **Calidad:** las capas solo funcionan si todos los assets comparten lienzo y anclaje; para la party vale la pena la disciplina, para esbirros no.
- **Animación:** un sprite único es más fácil de animar (CSS/frames/Rive) que un sistema de capas sin rig.
- **Rendimiento y mantenimiento:** menos capas, menos desalineaciones y menos peso.
- **Fidelidad a Limbus:** la party vestida con su equipo conserva la fantasía; los enemigos mantienen siluetas legibles.

---

Referencias: [`DISENO-v0.1.md`](./DISENO-v0.1.md) · [`schema-v0.1.ts`](./schema-v0.1.ts) · [`FASE-1.md`](./FASE-1.md) · prototipo [`protocol-game-v1.1.html`](../reference/protocol-game-v1.1.html).
