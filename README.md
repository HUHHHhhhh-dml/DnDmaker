# PROTOCOL LIFE

**PROTOCOL LIFE** es una aplicación local-first para dirigir campañas de rol en mesa. El DM crea el contenido desde un estudio propio y los jugadores se conectan desde el navegador por la WiFi local. El combate está inspirado en *Limbus Company*: monedas, clash, DEF y estados.

![Mesa del DM con una jugadora conectada](./docs/screenshots/fase-2-mesa-dm.png)

## Características

### Estudio del DM

- Campañas con objetos, skills, efectos, personajes, encuentros, tiendas y mazmorras.
- Fichas con equipo por capas, stats derivados en vivo, imágenes locales y export/import JSON.
- Enemigos y **jefes enemigos** con cambio de fase configurable.
- Validación de referencias, contenido bloqueado/desbloqueado y editor de reglas.

### Mesa en vivo por LAN

- Sala con código de 6 caracteres, link LAN, QR y PIN opcional.
- Jugadores conectados en tiempo real por Socket.IO, cada uno con su ficha y su token.
- El jugador solo puede editar su propia ficha; el DM conserva el control de la mesa.
- Reconexión, presencia en línea y estado saneado (sin enemigos ni notas privadas).

### Combate por rondas

- Iniciativa con SPD + tirada, declaración de acciones por SkillSlots y clash por unidad.
- Monedas, daño con mitigación de DEF, efectos, utilidad, dominios, hábitats y redirección.
- Side-view con party a la derecha y enemigos a la izquierda, sprites únicos o por capas.
- Cinemática de clash, log de combate y HP persistente entre encuentros.
- **Capas de skill** delantera y trasera, además de la capa de arma heredada.

### Progresión y Soul Points

- Nivel de personaje con subida de nivel desde la ficha del DM.
- Progresión configurable por campaña: el nivel puede subir **HP máximo**, **DEF** y/o **Soul Points**, cada uno con su cantidad por nivel.
- Cada objeto tiene un **coste en Soul Points**; el personaje parte de una base de 10.
- Si el equipo supera el límite, el personaje queda **OVERCHARGED** y recibe **1.5× daño**.
- Los Soul Points usados/máximo se muestran en el muñeco de equipo, bajo «Equipado N/5».

### Economía y contenido

- **Clean Shards** como bolsa común de la party.
- Tiendas en vivo con precio, stock y desbloqueo de objetos y skills para la campaña.
- Mazmorras lineales con salas de encuentro, jefe, descanso y tesoro.
- Reparto de botín por turnos cuando está desactivado el reparto automático.

### Dados de mesa 3D

- d4, d6, d8, d10, d12, d20 y d100 con física simulada en el servidor.
- Lanzamiento con arrastre, rebotes, múltiples dados y trayectoria compartida para toda la sala.
- Siete skins, sonido sintetizado con Web Audio y celebraciones de Nat 20 / Nat 1.

### Local-first

- Los datos viven en SQLite local; no hay cuentas ni servicios externos.
- Export/import de campañas y copias de seguridad automáticas o manuales.
- Backups del SQLite y restauración por CLI con el servidor parado.

## Instalación rápida

Requisitos: **Node.js >= 22** y **npm >= 10**.

```bash
git clone https://github.com/HUHHHhhhh-dml/DnDmaker.git
cd DnDmaker
npm install
npm run dev
```

- Estudio del DM: <http://localhost:5173>
- API: <http://localhost:3001/api/health>
- Vite muestra en la terminal la **IP LAN** para que se conecten los jugadores.

En el primer arranque se crea una campaña de ejemplo editable con objetos, skills, personajes y un encuentro.

### Producción

```bash
npm run build
npm start
```

La web, la API y Socket.IO se sirven juntos en <http://localhost:3001>.

### Windows

Se recomienda **Windows nativo** con Node.js 22 LTS y el build de producción. No copies `node_modules` desde Linux: `better-sqlite3` usa un binario nativo distinto. Si falla la instalación, instala **Visual Studio Build Tools** con «Desktop development with C++» y Python 3.

Los detalles de LAN, firewall, backup/restore y paso de campañas entre equipos están en la guía completa.

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor (3001) + web (5173) con recarga en caliente. |
| `npm test` | Suite completa con Vitest. |
| `npm run typecheck` | TypeScript estricto en los tres workspaces. |
| `npm run build` | Build de producción de la web. |
| `npm start` | Sirve la web compilada, la API y Socket.IO. |
| `npm run backup` | Copia manual del SQLite. |
| `npm run restore -- <archivo>` | Restaura una copia con el servidor parado. |

## Documentación

- [Guía completa de desarrollo, roadmap y notas técnicas](./README-COMPLETO.md)
- [Diseño v0.1](./docs/DISENO-v0.1.md)
- [Contrato de datos v0.1](./docs/schema-v0.1.ts)
- [Changelog](./CHANGELOG.md)
