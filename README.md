# ⚽ Fanta Asta

Subastas de fantacalcio (Serie A) en vivo, estilo [FantaBuzzer](https://www.fantabuzzer.com/) pero 100% web: **cada celular es el pulsador**. El admin crea la sala, comparte el código/QR, y todos ofertan en tiempo real mientras ven la subasta en vivo — presencial (con tablero en la TV) o remoto.

## Cómo se usa

1. **Crear asta** en `/`: nombre de liga, créditos (default 500), cupos por rol (3P/8D/8C/6A) y timer de rilancio (5s).
2. El admin comparte el **código de 6 caracteres** (o el QR del tablero).
3. Cada participante entra a `/sala/CODIGO` desde el celular con su nombre de equipo.
4. Opcional: abrir `/tablero/CODIGO` en una TV/proyector.
5. El admin llama jugadores (buscador o al azar); todos hacen rilanci con el botón gigante; el countdown se reinicia con cada oferta; al llegar a cero, vendido. Los desiertos quedan en la lista *richiama* para volver a llamarlos.

## Desarrollo

```bash
pnpm install
pnpm dev          # server en :3001 + web en :5173
pnpm test         # tests de reglas + motor de subasta
pnpm typecheck
```

## Arquitectura

Monorepo pnpm — el detalle completo está en [PLAN.md](PLAN.md):

- [`packages/shared`](packages/shared/) — el contrato: tipos, protocolo de eventos Socket.IO y reglas del fantacalcio (validación de ofertas isomórfica: la UI la usa para UX, el server es la autoridad).
- [`apps/server`](apps/server/) — Fastify + Socket.IO. **Servidor autoritativo**: el orden de las pujas lo decide el timestamp de recepción y los countdowns corren en el server (los clientes solo renderizan `deadline`). Estado en memoria + snapshots en SQLite para recuperación.
- [`apps/web`](apps/web/) — React + Vite (PWA). Tres vistas: **buzzer** (móvil, participante), **banditore** (admin) y **tablero** (TV).
- [`data/`](data/) — listone Serie A 2026-27 (527 jugadores con quotazioni) + cards oficiales en `campioncini/` (uso privado, propiedad de Fantacalcio®).
