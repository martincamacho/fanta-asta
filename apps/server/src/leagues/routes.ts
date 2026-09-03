import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { InviteInfo, LeagueDetail, RoomConfig, User, WatchlistEntry } from '@fanta/shared';
import { validateConfigRanges } from '../engine/room.js';
import { mergeRoomConfig, type RoomManager } from '../engine/roomManager.js';
import { sendInviteEmail } from './email.js';
import { LeagueStore, type InviteRow } from './store.js';

export const SESSION_COOKIE = 'fanta_session';
const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Deps {
  store: LeagueStore;
  manager: RoomManager;
}

function fail(reply: FastifyReply, status: number, error: string) {
  return reply.code(status).send({ error });
}

function origin(req: FastifyRequest): string {
  // APP_ORIGIN (deploy) gana; si no, el origin del request (dev).
  return process.env.APP_ORIGIN ?? `${req.protocol}://${req.headers.host ?? 'localhost'}`;
}

function inviteInfo(row: InviteRow, base: string): InviteInfo {
  return {
    token: row.token,
    email: row.email,
    url: `${base}/invitacion/${row.token}`,
    acceptedByUserId: row.accepted_by,
  };
}

export function registerLeagueRoutes(app: FastifyInstance, { store, manager }: Deps): void {
  const sessionUser = (req: FastifyRequest): User | null => {
    const token = req.cookies[SESSION_COOKIE];
    return token ? store.getUserBySession(token) : null;
  };

  const setSession = (reply: FastifyReply, userId: string): void => {
    const token = store.createSession(userId);
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_MAX_AGE_S,
    });
  };

  /** Devuelve el usuario logueado o corta con 401. */
  const requireUser = (req: FastifyRequest, reply: FastifyReply): User | null => {
    const user = sessionUser(req);
    if (!user) void fail(reply, 401, 'Necesitás iniciar sesión');
    return user;
  };

  // ── Auth ─────────────────────────────────────────────────────────────────

  app.post('/api/auth/register', async (req, reply) => {
    const body = (req.body ?? {}) as { email?: unknown; name?: unknown; password?: unknown };
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!EMAIL_RE.test(email)) return fail(reply, 400, 'Email inválido');
    if (!name) return fail(reply, 400, 'Falta el nombre');
    if (password.length < 6) return fail(reply, 400, 'La contraseña debe tener al menos 6 caracteres');

    const user = store.createUser(email, name, password);
    if (user === 'email_taken') return fail(reply, 409, 'Ese email ya está registrado');
    setSession(reply, user.id);
    return { user };
  });

  /**
   * Identidad liviana ("passwordless-lite"): encuentra o crea el usuario por
   * email SIN contraseña y abre sesión. Si el email está protegido con
   * contraseña → 409 needsPassword (la web pide login normal).
   */
  app.post('/api/auth/claim', async (req, reply) => {
    const body = (req.body ?? {}) as { email?: unknown; name?: unknown };
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const rawName = typeof body.name === 'string' ? body.name.trim() : '';

    if (!EMAIL_RE.test(email)) return fail(reply, 400, 'Email inválido');

    const result = store.claimUser(email, rawName || undefined);
    if (result === 'has_password') {
      return reply
        .code(409)
        .send({ error: 'Ese email ya tiene una cuenta con contraseña: iniciá sesión', needsPassword: true });
    }
    if (result === 'name_required') return fail(reply, 400, 'Falta el nombre');
    setSession(reply, result.id);
    return { user: result };
  });

  /** Protege la cuenta: setea/cambia la contraseña del usuario logueado. */
  app.post('/api/auth/set-password', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    const body = (req.body ?? {}) as { password?: unknown };
    const password = typeof body.password === 'string' ? body.password : '';
    if (password.length < 6) return fail(reply, 400, 'La contraseña debe tener al menos 6 caracteres');
    store.setPassword(user.id, password);
    return reply.code(204).send();
  });

  app.post('/api/auth/login', async (req, reply) => {
    const body = (req.body ?? {}) as { email?: unknown; password?: unknown };
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    const result = store.verifyLogin(email, password);
    if (result === 'passwordless') {
      // Distinguible para la web: esta cuenta entra directo con el email (claim).
      return reply
        .code(401)
        .send({ error: 'Esta cuenta no tiene contraseña: entrá directo con tu email', passwordless: true });
    }
    if (!result) return fail(reply, 401, 'Email o contraseña incorrectos');
    setSession(reply, result.id);
    return { user: result };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) store.deleteSession(token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.code(204).send();
  });

  app.get('/api/auth/me', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    return { user, leagues: store.leaguesForUser(user.id) };
  });

  // ── Ligas ────────────────────────────────────────────────────────────────

  app.post('/api/leagues', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    const body = (req.body ?? {}) as { name?: unknown };
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return fail(reply, 400, 'Falta el nombre de la liga');
    return store.createLeague(name, user.id);
  });

  app.get('/api/leagues/:id', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    const { id } = req.params as { id: string };
    const league = store.getLeague(id);
    if (!league) return fail(reply, 404, 'La liga no existe');
    if (!store.isMember(league.id, user.id)) return fail(reply, 403, 'No sos miembro de esta liga');

    const detail: LeagueDetail = {
      ...league,
      members: store.getMembers(league.id),
      auctions: store.getAuctions(league.id),
    };
    if (league.adminUserId === user.id) {
      const base = origin(req);
      detail.invites = store.getInvitesForLeague(league.id).map((row) => inviteInfo(row, base));
    }
    return detail;
  });

  app.post('/api/leagues/:id/invites', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    const { id } = req.params as { id: string };
    const league = store.getLeague(id);
    if (!league) return fail(reply, 404, 'La liga no existe');
    if (league.adminUserId !== user.id) return fail(reply, 403, 'Solo el admin de la liga puede invitar');

    const body = (req.body ?? {}) as { emails?: unknown };
    const emails = Array.isArray(body.emails)
      ? body.emails.filter((e): e is string => typeof e === 'string').map((e) => e.trim())
      : [];
    if (emails.length === 0) return fail(reply, 400, 'Falta la lista de emails');
    if (emails.some((e) => !EMAIL_RE.test(e))) return fail(reply, 400, 'Hay emails inválidos en la lista');

    const base = origin(req);
    const result: Array<InviteInfo & { emailSent: boolean }> = [];
    for (const email of emails) {
      const info = inviteInfo(store.createOrReuseInvite(league.id, email, user.id), base);
      // El email es best-effort: sin RESEND_API_KEY (o ante fallas) queda en false
      // y el invite se comparte a mano (WhatsApp). Nunca rompe la creación.
      const emailSent = await sendInviteEmail({ to: email, leagueName: league.name, url: info.url });
      result.push({ ...info, emailSent });
    }
    return result;
  });

  // ── Invitaciones (link compartible) ──────────────────────────────────────

  app.get('/api/invites/:token', async (req, reply) => {
    const { token } = req.params as { token: string };
    const invite = store.getInvite(token);
    if (!invite) return fail(reply, 404, 'Invitación no encontrada');
    const league = store.getLeague(invite.league_id);
    if (!league) return fail(reply, 404, 'Invitación no encontrada');
    const user = sessionUser(req); // opcional: es un endpoint público
    return {
      leagueName: league.name,
      email: invite.email,
      alreadyMember: !!user && store.isMember(league.id, user.id),
    };
  });

  app.post('/api/invites/:token/accept', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    const { token } = req.params as { token: string };
    const invite = store.getInvite(token);
    if (!invite) return fail(reply, 404, 'Invitación no encontrada');

    // Idempotente: si ya sos miembro (por este u otro camino), listo.
    if (store.isMember(invite.league_id, user.id)) {
      store.markInviteAccepted(token, user.id);
      return { leagueId: invite.league_id };
    }
    // Un invite ya usado por OTRA persona no se puede reutilizar.
    if (invite.accepted_by !== null && invite.accepted_by !== user.id) {
      return fail(reply, 409, 'Esta invitación ya fue usada por otra persona');
    }
    // Se acepta con el usuario logueado aunque su email difiera del invitado
    // (los links se comparten por WhatsApp).
    store.addMember(invite.league_id, user.id);
    store.markInviteAccepted(token, user.id);
    return { leagueId: invite.league_id };
  });

  // ── Astas de liga y tickets ──────────────────────────────────────────────

  app.post('/api/leagues/:id/auctions', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    const { id } = req.params as { id: string };
    const league = store.getLeague(id);
    if (!league) return fail(reply, 404, 'La liga no existe');
    if (league.adminUserId !== user.id) return fail(reply, 403, 'Solo el admin de la liga puede crear astas');

    const body = (req.body ?? {}) as { config?: Partial<RoomConfig> };
    const configPatch: Partial<RoomConfig> = { ...(body.config ?? {}) };
    if (!configPatch.leagueName) configPatch.leagueName = league.name;
    const rangeError = validateConfigRanges(mergeRoomConfig(configPatch));
    if (rangeError !== null) return fail(reply, 400, rangeError);

    const { code, adminToken } = manager.createRoom(configPatch);
    store.linkAuction(code, league.id);
    return { code, adminToken };
  });

  app.get('/api/rooms/:code/ticket', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    const code = (req.params as { code: string }).code.toUpperCase();
    if (!manager.getRoom(code)) return fail(reply, 404, 'La sala no existe');
    // Filosofía "link = invitación": conocer el código alcanza (igual que el
    // tablero y el export). Si la sala es de liga y el usuario logueado todavía
    // no es miembro, se lo incorpora automáticamente — la puerta lateral
    // amistosa; las invitaciones formales siguen siendo el camino prolijo.
    const league = store.leagueForRoom(code);
    if (league && !store.isMember(league.id, user.id)) {
      store.addMember(league.id, user.id);
    }

    return { participantId: store.getOrCreateTicket(code, user.id), name: user.name };
  });

  // ── Watchlist privada pre-asta ───────────────────────────────────────────
  // PRIVADA del usuario logueado por sala: nunca se expone en rosters ni por
  // el socket. Como el ticket, no requiere membresía de liga.

  app.get('/api/rooms/:code/watchlist', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    const code = (req.params as { code: string }).code.toUpperCase();
    if (!manager.getRoom(code)) return fail(reply, 404, 'La sala no existe');
    return { entries: store.getWatchlist(user.id, code) };
  });

  app.put('/api/rooms/:code/watchlist', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return reply;
    const code = (req.params as { code: string }).code.toUpperCase();
    if (!manager.getRoom(code)) return fail(reply, 404, 'La sala no existe');

    const body = (req.body ?? {}) as { entries?: unknown };
    if (!Array.isArray(body.entries)) return fail(reply, 400, 'Falta la lista de entries');
    if (body.entries.length > 100) return fail(reply, 400, 'La watchlist admite hasta 100 jugadores');

    const entries: WatchlistEntry[] = [];
    const seen = new Set<number>();
    for (const raw of body.entries as Array<Record<string, unknown>>) {
      const playerId = raw?.playerId;
      const maxPrice = raw?.maxPrice ?? null;
      if (typeof playerId !== 'number' || !Number.isFinite(playerId)) {
        return fail(reply, 400, 'playerId inválido en la watchlist');
      }
      if (maxPrice !== null && (!Number.isInteger(maxPrice) || (maxPrice as number) < 1)) {
        return fail(reply, 400, 'maxPrice debe ser un entero ≥ 1 o null');
      }
      if (seen.has(playerId)) return fail(reply, 400, 'La watchlist tiene jugadores repetidos');
      seen.add(playerId);
      const entry: WatchlistEntry = { playerId, maxPrice: maxPrice as number | null };

      // Pizarra de planificación: slot 0..49 o null/ausente.
      if (raw.slot !== undefined && raw.slot !== null) {
        if (!Number.isInteger(raw.slot) || (raw.slot as number) < 0 || (raw.slot as number) > 49) {
          return fail(reply, 400, 'slot debe ser un entero entre 0 y 49, o null');
        }
        entry.slot = raw.slot as number;
      } else if (raw.slot === null) {
        entry.slot = null;
      }

      // Etiqueta libre ≤40 chars; trim; vacía → null.
      if (raw.note !== undefined && raw.note !== null) {
        if (typeof raw.note !== 'string' || raw.note.trim().length > 40) {
          return fail(reply, 400, 'note debe ser un texto de hasta 40 caracteres, o null');
        }
        entry.note = raw.note.trim() || null;
      } else if (raw.note === null) {
        entry.note = null;
      }

      // Grupo de la pizarra: mismas reglas que note.
      if (raw.group !== undefined && raw.group !== null) {
        if (typeof raw.group !== 'string' || raw.group.trim().length > 40) {
          return fail(reply, 400, 'group debe ser un texto de hasta 40 caracteres, o null');
        }
        entry.group = raw.group.trim() || null;
      } else if (raw.group === null) {
        entry.group = null;
      }

      entries.push(entry); // campos desconocidos extra se stripean
    }

    store.setWatchlist(user.id, code, entries);
    return { entries };
  });
}
