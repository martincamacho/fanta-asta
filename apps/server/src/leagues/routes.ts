import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { InviteInfo, LeagueDetail, RoomConfig, User } from '@fanta/shared';
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

  app.post('/api/auth/login', async (req, reply) => {
    const body = (req.body ?? {}) as { email?: unknown; password?: unknown };
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    const user = store.verifyLogin(email, password);
    if (!user) return fail(reply, 401, 'Email o contraseña incorrectos');
    setSession(reply, user.id);
    return { user };
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
    const league = store.leagueForRoom(code);
    // Salas sin liga: el flujo por código de siempre, acá no hay ticket.
    if (!league) return fail(reply, 404, 'Esta sala no pertenece a ninguna liga');
    if (!store.isMember(league.id, user.id)) return fail(reply, 403, 'No sos miembro de la liga de esta sala');

    return { participantId: store.getOrCreateTicket(code, user.id), name: user.name };
  });
}
