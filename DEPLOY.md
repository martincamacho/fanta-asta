# Deploy de Fanta Asta

La app necesita un **proceso Node siempre vivo** (WebSockets + countdowns en el server) y un **disco persistente** (SQLite: cuentas, ligas, rosas). Eso descarta hosting serverless (Vercel/Netlify) y complica los planes gratis que "duermen" la app.

## Opción 0 — Gratis de verdad: tu compu + túnel (recomendada para empezar)

La app ya corre en tu Mac. Para un asta puntual con amigos remotos:

```bash
# terminal 1 (si no está corriendo ya)
pnpm --filter @fanta/server dev
# terminal 2 — URL pública temporal
ngrok http 3001
```

Compartís la URL `https://….ngrok-free.app` por WhatsApp y listo. Gratis, sin cuentas nuevas.
**Contras**: URL cambia en cada arranque, pantallita "Visit Site" de ngrok la primera vez, tu Mac prendida durante el asta.
**Variante sin pantallita**: Cloudflare Tunnel (gratis, `brew install cloudflared && cloudflared tunnel --url http://localhost:3001`) — URL `trycloudflare.com` temporal, sin interstitial.

## Opción 1 — Fly.io (~US$3–5/mes, la mejor relación precio/calidad)

Ya está todo preparado ([Dockerfile](Dockerfile) + [fly.toml](fly.toml)).

```bash
brew install flyctl
fly auth signup                        # cuenta (pide tarjeta)
fly launch --no-deploy --copy-config   # usa el fly.toml (cambiá el nombre si está tomado)
fly volumes create fanta_data --region fra --size 1
fly deploy
```

URL fija `https://<app>.fly.dev`, servidor en Frankfurt (región `fra`, al lado de Suiza), disco persistente, no se duerme (`auto_stop_machines = "off"`). Emails: `fly secrets set RESEND_API_KEY=re_... APP_ORIGIN=https://<app>.fly.dev`.

## Opción 2 — Railway (~US$5/mes, la más simple)

Sin config extra: detecta el Dockerfile solo.
1. railway.com → login con GitHub → New Project → Deploy from GitHub repo (subí este repo a GitHub).
2. Settings → Networking → Generate Domain.
3. Agregá un **Volume** montado en `/data` y la variable `DB_PATH=/data/fanta.sqlite`.
4. Variables opcionales: `RESEND_API_KEY`, `APP_ORIGIN`.

Trial con US$5 de crédito una única vez; después plan Hobby US$5/mes.

## ¿Alternativas GRATIS a Railway?

| Opción | Gratis | La trampa |
|---|---|---|
| **Render** (render.com) | ✅ web service free | Se **duerme** a los 15 min sin tráfico (~1 min para despertar: mata un asta en vivo si hay pausa larga) y el disco free es **efímero**: cuentas/ligas se pierden en cada deploy/reinicio. Usable solo en modo "sala por código" para astas puntuales. |
| **Koyeb** | ✅ 1 servicio chico | Similar: instancia free con sleep y sin disco persistente. |
| **Oracle Cloud Always Free** | ✅✅ VPS gratis de verdad (ARM, 24GB RAM) y para siempre | Es una VM pelada: hay que instalar Docker, configurar dominio/HTTPS (Caddy), mantenerla. Es la única opción 100% gratis + siempre viva + con disco. Requiere tarjeta al registrarse y un rato de setup (te puedo guiar). |
| **Tu Mac + ngrok/cloudflared** | ✅ | Solo cuando la compu está prendida; URL temporal. **Para "el día del asta" es perfecta.** |

**Recomendación práctica**: el asta se juega 1–2 veces al año en vivo → usá **tu Mac + ngrok los días de asta** (gratis) y, si quieren la liga con cuentas disponible todo el año, ahí sí Fly/Railway (~US$5/mes) o la VPS gratis de Oracle si no te asusta el setup.

## Emails de invitación (Resend)

La app manda los emails de invitación sola si existe `RESEND_API_KEY` (sin la key, funciona igual con links para WhatsApp).
- Plan gratis: 3.000 emails/mes, 100/día — sobra.
- **Trampa**: sin dominio propio verificado, Resend solo permite enviarte emails **a tu propia casilla** (modo test). Para mandar a tus amigos hace falta verificar un dominio tuyo (~US$10/año el dominio). Alternativa: seguir con los links por WhatsApp, que funcionan igual de bien.
