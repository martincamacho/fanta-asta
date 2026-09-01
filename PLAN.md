# Fanta-Asta — Plan de Ingeniería

> Aplicación web de subastas en vivo para fantasy fútbol, inspirada en [FantaBuzzer](https://www.fantabuzzer.com/).
> Diferencia clave: **sin hardware** — cada participante usa su celular como pulsador (buzzer), y funciona tanto presencial como remoto.

---

## 1. Análisis del producto de referencia

FantaBuzzer vende un kit de 8–14 pulsadores físicos USB + software de escritorio ("FantaAsta Buzz"). Sus funcionalidades núcleo:

| Funcionalidad | Descripción |
|---|---|
| Banditore electrónico | El software emula a un martillero: llama jugadores, gestiona ofertas y adjudica |
| Pulsadores | Cada participante se "reserva" o hace un rilancio (contraoferta) apretando su botón |
| Anti-disputas | El sistema decide de forma objetiva quién ofertó primero — cero peleas |
| Orden de llamada | Random, por nombre, por rol, o elección manual jugador a jugador |
| Configuración de liga | Presupuesto (crediti), composición de plantillas (P/D/C/A), modo Classic o Mantra |
| Richiama | Lista de jugadores llamados pero no asignados, para volver a subastarlos |
| Export/Import | Plantillas a Excel, CSV, imagen (tablero); integración con plataforma de juego |

### Qué mejoramos respecto al original
1. **Sin hardware**: el celular de cada uno es el buzzer (PWA, sin instalar nada — se entra con un código de sala tipo Kahoot).
2. **Remoto o presencial**: misma app; en presencial se proyecta el tablero en una TV.
3. **Ofertas con monto**: además del rilancio de +1, permitir puja libre ("salto" a un monto).
4. **Historial y log completo** de cada subasta (auditable → cero disputas).

---

## 2. Dominio y reglas de negocio

### Entidades
- **Liga/Sala**: código de acceso, admin (banditore), configuración.
- **Participante**: nombre de equipo, presupuesto restante, plantilla en construcción.
- **Jugador (listone)**: nombre, equipo real, rol (P/D/C/A clásico; roles Mantra opcional), cotización inicial.
- **Subasta (de un jugador)**: estados `llamado → en_puja → adjudicado | desierto`.
- **Oferta**: participante, monto, timestamp **del servidor** (orden autoritativo).

### Máquina de estados de una subasta
```
IDLE → CALLED (banditore llama un jugador, precio base)
CALLED → BIDDING (primera oferta; arranca countdown, ej. 5s)
BIDDING → BIDDING (cada rilancio reinicia el countdown)
BIDDING → SOLD (countdown llega a 0 → adjudicado al mejor postor)
CALLED → UNSOLD (nadie oferta en X segundos → va a lista "richiama")
```

### Reglas de validación (server-side, siempre)
- No podés ofertar más que tu presupuesto restante **menos** (cupos vacíos restantes − 1) — regla clásica del fantacalcio: siempre tenés que poder pagar 1 crédito por cada cupo que te falta llenar.
- No podés ofertar por un rol cuyo cupo ya llenaste.
- No podés superar tu propia oferta vigente.
- El servidor resuelve empates por timestamp de llegada (anti-disputa).

---

## 3. Arquitectura técnica

### Requisito crítico: tiempo real con autoridad del servidor
La esencia del producto es "quién apretó primero". Eso exige:
- **WebSockets** (no polling) con un **servidor autoritativo**: el orden lo decide el timestamp de recepción en el server, nunca el cliente.
- **Countdown en el servidor**: los clientes solo renderizan; el server emite ticks/deadline.
- **Reconexión resiliente**: si un participante pierde conexión, al volver recibe el estado completo (snapshot + resync).
- **Estado en memoria + persistencia**: la subasta viva se maneja en memoria (latencia mínima) y se persiste cada evento (event log) para recuperación ante caída.

### Stack recomendado
| Capa | Elección | Por qué |
|---|---|---|
| Monorepo | pnpm workspaces + TypeScript | Tipos compartidos entre server y clientes |
| Backend realtime | **Node.js + Fastify + Socket.IO** | Rooms nativas, reconexión y acks incluidos, autoritativo |
| Base de datos | **SQLite (dev) → PostgreSQL (prod)** vía Drizzle ORM | Cero fricción local, migración directa |
| Frontend | **React + Vite (PWA)** | Una sola SPA con 3 vistas: banditore, buzzer móvil, tablero TV |
| Estilos | Tailwind CSS | Velocidad, consistencia |
| Estado cliente | Zustand + eventos socket | Simple, sin boilerplate |
| Testing | Vitest (motor de subasta con tests exhaustivos) + Playwright (e2e multi-cliente) | El motor es lo más delicado |
| Deploy | Fly.io / Railway (server con estado) + mismo server sirve la SPA | Socket.IO necesita proceso persistente (no serverless) |

> Nota: se descarta serverless/Supabase Realtime para el core porque el countdown y la resolución de empates requieren un proceso con estado y reloj propio.

### Estructura del monorepo
```
fanta-asta/
├── packages/
│   └── shared/          # Tipos, eventos socket, reglas de validación (isomórficas)
├── apps/
│   ├── server/          # Fastify + Socket.IO + Drizzle + motor de subasta
│   └── web/             # React SPA: /admin, /sala/:code (buzzer), /tablero/:code
├── data/                # Listone de jugadores (CSV seed)
└── PLAN.md
```

### Protocolo de eventos (Socket.IO, tipado en shared)
```
Cliente → Server:  room:join, room:leave, auction:call, auction:bid {amount?},
                   auction:cancel, admin:config, admin:kick
Server → Cliente:  room:state (snapshot completo), auction:called, auction:bid_accepted,
                   auction:bid_rejected {reason}, auction:countdown {deadline},
                   auction:sold, auction:unsold, roster:updated, error
```

---

## 4. Vistas de la aplicación

1. **Home / Crear sala**: el admin configura liga (presupuesto, cupos por rol, modo, timer) y obtiene código de 6 caracteres + QR.
2. **Buzzer (móvil, participante)**: pantalla gigante con el jugador en subasta, oferta actual, botón enorme **+1 / RILANCIO** y campo de puja libre; su presupuesto y cupos restantes siempre visibles.
3. **Banditore (admin)**: buscador del listone, orden de llamada (random/rol/nombre/manual), control de subasta (llamar, anular, richiama), vista de todas las plantillas.
4. **Tablero (TV/proyector)**: jugador actual en grande, countdown animado, historial de ofertas en vivo, plantillas y presupuestos de todos.
5. **Post-asta**: export CSV/Excel/imagen de plantillas.

---

## 5. Fases de desarrollo (con subagentes)

### Fase 0 — Fundaciones (secuencial, 1 agente)
Scaffolding del monorepo, tooling (TS, ESLint, Vitest), tipos y eventos en `shared`, esquema DB, seed del listone (CSV de ejemplo).
**Entregable**: `pnpm dev` levanta server + web vacíos, tipos compartidos compilan.

### Fase 1 — Motor de subasta (1 agente, la pieza crítica)
Máquina de estados en el server, reglas de validación, countdown autoritativo, event log, resolución de empates, resync por snapshot. **Test-first**: suite Vitest exhaustiva (pujas simultáneas, presupuesto límite, reconexión).
**Entregable**: motor testeado sin UI, simulable por script.

### Fase 2 — UI en paralelo (3 agentes, tras Fase 1)
- Agente A: vista Buzzer móvil (participante)
- Agente B: vista Banditore (admin) + creación de sala
- Agente C: vista Tablero TV + animaciones de countdown/adjudicación

Los tres consumen el mismo protocolo tipado de `shared` → integración sin fricciones.

### Fase 3 — Ciclo de vida completo (2 agentes en paralelo)
- Agente A: import de listone real (CSV), función richiama, edición manual de plantillas.
- Agente B: export CSV/Excel/imagen, persistencia/recuperación de sala ante caída del server.

### Fase 4 — Endurecimiento (1 agente + e2e)
Playwright multi-cliente (8 buzzers simultáneos), reconexión móvil (lock de pantalla), latencia, pulido visual, deploy.

### Backlog — ideas tomadas de la [guía oficial de FantaAsta Buzz](https://www.fantabuzzer.com/guida-fantaasta-buzz/)
Replicamos el software oficial sin el kit físico (las cuentas/celulares son los pulsadores). Ya cubierto por el MVP: llamada manual y al azar, countdown, modo +Uno, richiama, correcciones del admin, base de asta, recuperación ante caídas (SQLite = su "RIPRENDI"), presupuesto y maxBid visibles. Para sumar:
- **Modos de orden de llamada**: *Alfabético* (con salto a letra e inversión de orden) y *Por valor* (quotazione asc/desc), ambos con filtro por rol — se suman a manual y random.
- **Base de asta configurable**: fija (1 crédito) o igual a la quotazione del jugador.
- **Valores visibles u ocultos**: opción de esconder quotazioni durante el asta.
- **Anti doble-toque**: ignorar pulsaciones del mismo participante dentro de ~300ms (su "intervallo rilanci"); el orden entre participantes ya lo resuelve el server.
- **Banditore audible**: "uno... due... tre... ¡assegnato!" o beeps en los últimos segundos (Web Audio / speechSynthesis en tablero y buzzer).
- **Bonus/malus de créditos**: el admin ajusta el presupuesto de un equipo (+/-), útil para reglas caseras.
- **Modo Premi&Parla**: el botón solo reserva el turno y la oferta se canta de viva voz (el admin tipea el monto) — para astas presenciales más picantes.
- **Cupos por rango** (min–max por rol) además de cupos fijos.
- **Export "para Leghe Fantacalcio"**: CSV en el formato que importa la plataforma oficial, además de XLSX/PNG.
- **Pantalla "Assegnazioni"**: historial completo de adjudicaciones (quién, cuánto, cuándo).

### Gaps detectados (análisis propio, no estaban en la guía)
- **Ficha del jugador en la UI**: los datos scrapeados de `data/players.json` (fantamedia, MV, FVM, altura, nacimiento, pie, nacionalidad, descripción) todavía no se muestran — endpoint `GET /api/players/:id/profile` + modal/panel de ficha al llamar un jugador (era el pedido original "la información de cada jugador con la imagen y todo").
- **Pausar/reanudar** el contador (admin) — indispensable en astas reales (discusiones, baño, pizza).
- **Wake lock** en el buzzer: que el celular no bloquee la pantalla en medio del asta (Screen Wake Lock API).
- **PWA**: manifest + ícono para "agregar a inicio" en el teléfono.
- **Identidad visual oficial**: paleta extraída del CSS de fantacalcio.it — primario `hsl(217,93%,52%)`, dark navy `hsl(229,26%,24%)`, secundario naranja `hsl(19,95%,64%)`, success `hsl(96,70%,46%)`, danger `hsl(350,98%,65%)`, alternative violeta `hsl(257,76%,55%)`, superficies blancas y badges como los de su ficha de jugador. Restyling para que parezca de la familia Fantacalcio/FantaBuzzer.
- **Fin del asta**: estado "asta terminada" cuando todos llenaron los cupos (o el admin la cierra), con pantalla de resumen final. ✅ hecho
- **"Volver a subastar" en un toque** (pedido del usuario): botón sobre un jugador ya vendido en la plantilla de un equipo → unassign + call encadenados con confirmación. ✅ hecho
- **Adjudicación directa** (pedido del usuario): en plena subasta, elegir participante + créditos y adjudicar ya (cancel + assign encadenados en la UI). ✅ hecho
- **Sorteo y ronda de llamadas** (pedido del usuario): sorteo animado en el tablero, modo 'turns' donde cada participante llama en su turno desde el buzzer, avance circular salteando plantillas llenas. ✅ hecho

### Fase 5 — Ligas y cuentas (tras el MVP funcional)
Pedido del usuario: crear liga → agregar usuarios por email → cada uno se crea su cuenta y entra a esa liga; el creador es el admin.
- **users**: email + nombre + password (hash argon2/bcrypt), sesión por cookie httpOnly. Registro y login simples.
- **leagues**: nombre, admin (creador), config default del asta. **league_members**: liga ↔ usuario.
- **Invitaciones sin infraestructura de email** (v1): el admin carga los emails de sus amigos → la app genera un link de invitación por cada uno (token firmado); el admin lo comparte por WhatsApp. Al abrirlo, la persona se registra con ese email (o hace login) y queda adentro de la liga. Enviar emails reales (Resend/SES) queda como mejora.
- **El asta se lanza desde la liga**: el admin la inicia y los miembros entran ya identificados (participantId = userId) — sin tipear códigos. La sala efímera por código se mantiene como modo rápido sin cuenta.
- **Persistencia post-asta**: página de la liga con el resultado permanente — plantilla de cada uno, quién tiene cada jugador y a cuánto lo pagó, historial de astas.

**Regla de integración**: cada fase termina con tests en verde y una demo funcional; ningún agente toca `shared` sin actualizar los tests del motor.

---

## 6. Decisiones tomadas

1. **Listone**: jugadores de **Serie A** (fantacalcio). Ya descargado como seed en `data/listone-classic.csv` (527 jugadores, temporada 2026-27) desde las [listas de FantaBuzzer](https://www.fantabuzzer.com/liste/). Formato: `C,T,M,Nome,Squadra,Quotazione,ID,EID` — usamos `C` (rol clásico P/D/C/A), `Nome`, `Squadra`, `Quotazione`, `ID`. Distribución: 63 P / 186 D / 192 C / 88 A. El importador además acepta CSV genérico `Nome|Squadra|Ruolo|Quotazione` para actualizaciones futuras. (Se evita scraping en vivo: frágil y con problemas de ToS.)

### 1b. Fichas de jugador con imagen (estilo fantacalcio.it)
- El `ID` de nuestro CSV **es el mismo ID de fantacalcio.it** (verificado: Dimarco = 254 en ambos).
- **Imágenes**: patrón universal `https://content.fantacalcio.it/web/campioncini/21/card/<ID>.png` (existe variante `small/`; el `21` es carpeta de temporada, no de equipo). Ya descargadas **todas** a `data/campioncini/<ID>.png` (55 MB) → se sirven desde nuestro propio server, sin depender de fantacalcio.it en runtime. *Nota: imágenes propiedad de Fantacalcio® — uso privado entre amigos, no comercial.*
- **Datos extendidos** (opcional, Fase 3): script one-time `scripts/scrape-players.ts` que recorre las fichas (`fantacalcio.it/serie-a/squadre/<equipo>/<slug>/<ID>`, server-rendered) y arma `data/players.json` con fantamedia, media voto, fecha de nacimiento, altura, pie, nacionalidad. Requiere User-Agent de navegador (curl pelado da bloqueo) y delay ≥1s entre requests. La ficha en la UI (modal al llamar un jugador en el asta) muestra: foto grande, rol, equipo, quotazione + esos datos si están.
2. **Flujo de sala**: sin login. El admin crea la sala eligiendo **liga y créditos disponibles** + cupos por rol; comparte el código/QR; todos entran desde el navegador del celular y ven la subasta en vivo mientras participan.
3. **Idioma de la UI**: español, con strings centralizados para traducir después.

## Decisiones abiertas (confirmar antes de Fase 0)

1. **Modo Mantra** (roles múltiples por jugador): → *Propuesta: fuera del MVP; el modelo de datos lo deja previsto.*
2. **Timer de rilancio** (decidido): cada puja reinicia el countdown a **60 segundos** ("si uno puja se agrega un minuto"), configurable por sala. Primera oferta: 30s.
3. **Control del admin** (decidido): además de llamar jugadores y cerrar/saltear el contador, el admin tiene **ajustes manuales** (`admin:assign`/`admin:unassign`): asignar/mover/quitar jugadores y corregir precios sin validación de reglas — el escape ante cualquier problema con la app.
