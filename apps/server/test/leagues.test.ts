import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { InviteInfo, LeagueDetail, LeagueSummary, User } from '@fanta/shared';
import { createServer, type FantaServer } from '../src/server.js';

let server: FantaServer;

/** Cookie de sesión de la respuesta de un inject. */
function sessionCookie(res: { cookies: Array<{ name: string; value: string }> }): Record<string, string> {
  const cookie = res.cookies.find((c) => c.name === 'fanta_session');
  if (!cookie) throw new Error('no vino cookie de sesión');
  return { fanta_session: cookie.value };
}

async function register(email: string, name: string, password = 'secreta1') {
  const res = await server.app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email, name, password },
  });
  expect(res.statusCode).toBe(200);
  const { user } = res.json() as { user: User };
  return { user, cookies: sessionCookie(res) };
}

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:' });
  await server.app.ready();
});

afterAll(async () => {
  await server.app.close();
});

describe('auth', () => {
  it('register valida entrada, crea sesión y me() responde con la cookie', async () => {
    const bad = await server.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'no-es-email', name: 'X', password: 'secreta1' },
    });
    expect(bad.statusCode).toBe(400);
    expect((bad.json() as { error: string }).error).toBeTruthy();

    const shortPass = await server.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'ana@test.com', name: 'Ana', password: '12345' },
    });
    expect(shortPass.statusCode).toBe(400);

    const { user, cookies } = await register('ana@test.com', 'Ana');
    expect(user).toMatchObject({ email: 'ana@test.com', name: 'Ana' });

    const me = await server.app.inject({ method: 'GET', url: '/api/auth/me', cookies });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toEqual({ user, leagues: [] });

    const anon = await server.app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(anon.statusCode).toBe(401);
  });

  it('register duplicado → 409 (aunque cambie mayúsculas/minúsculas)', async () => {
    const dup = await server.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'ANA@Test.com', name: 'Otra Ana', password: 'secreta1' },
    });
    expect(dup.statusCode).toBe(409);
    expect((dup.json() as { error: string }).error).toContain('registrado');
  });

  it('login ok / credenciales inválidas con mensaje genérico / logout mata la sesión', async () => {
    const badPass = await server.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'ana@test.com', password: 'incorrecta' },
    });
    expect(badPass.statusCode).toBe(401);
    const badUser = await server.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'nadie@test.com', password: 'incorrecta' },
    });
    expect(badUser.statusCode).toBe(401);
    // mensaje genérico idéntico: no filtra si el email existe
    expect(badUser.json()).toEqual(badPass.json());

    const login = await server.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'ana@test.com', password: 'secreta1' },
    });
    expect(login.statusCode).toBe(200);
    const cookies = sessionCookie(login);

    const logout = await server.app.inject({ method: 'POST', url: '/api/auth/logout', cookies });
    expect(logout.statusCode).toBe(204);
    const after = await server.app.inject({ method: 'GET', url: '/api/auth/me', cookies });
    expect(after.statusCode).toBe(401);
  });
});

describe('ligas, invitaciones, astas y tickets', () => {
  let ana: { user: User; cookies: Record<string, string> };
  let beto: { user: User; cookies: Record<string, string> };
  let carla: { user: User; cookies: Record<string, string> };
  let league: LeagueSummary;
  let invite: InviteInfo;
  let roomCode: string;

  beforeAll(async () => {
    ana = await register('ana.liga@test.com', 'Ana');
    beto = await register('beto@test.com', 'Beto');
    carla = await register('carla@test.com', 'Carla');
  });

  it('crear liga: el creador queda admin y primer miembro; aparece en me()', async () => {
    const anon = await server.app.inject({ method: 'POST', url: '/api/leagues', payload: { name: 'Serie Amigos' } });
    expect(anon.statusCode).toBe(401);

    const res = await server.app.inject({
      method: 'POST',
      url: '/api/leagues',
      payload: { name: 'Serie Amigos' },
      cookies: ana.cookies,
    });
    expect(res.statusCode).toBe(200);
    league = res.json() as LeagueSummary;
    expect(league).toMatchObject({ name: 'Serie Amigos', adminUserId: ana.user.id, memberCount: 1 });

    const me = await server.app.inject({ method: 'GET', url: '/api/auth/me', cookies: ana.cookies });
    expect((me.json() as { leagues: LeagueSummary[] }).leagues).toEqual([league]);
  });

  it('detalle solo para miembros; invites solo para el admin', async () => {
    const outsider = await server.app.inject({
      method: 'GET',
      url: `/api/leagues/${league.id}`,
      cookies: beto.cookies,
    });
    expect(outsider.statusCode).toBe(403);

    const asAdmin = await server.app.inject({
      method: 'GET',
      url: `/api/leagues/${league.id}`,
      cookies: ana.cookies,
    });
    expect(asAdmin.statusCode).toBe(200);
    const detail = asAdmin.json() as LeagueDetail;
    expect(detail.members.map((m) => m.userId)).toEqual([ana.user.id]);
    expect(detail.auctions).toEqual([]);
    expect(detail.invites).toEqual([]); // presente (vacío) porque es el admin

    const missing = await server.app.inject({ method: 'GET', url: '/api/leagues/otra', cookies: ana.cookies });
    expect(missing.statusCode).toBe(404);
  });

  it('invites: solo admin; genera token+url; reusa el pendiente del mismo email', async () => {
    const notAdmin = await server.app.inject({
      method: 'POST',
      url: `/api/leagues/${league.id}/invites`,
      payload: { emails: ['beto@test.com'] },
      cookies: beto.cookies,
    });
    expect(notAdmin.statusCode).toBe(403);

    const res = await server.app.inject({
      method: 'POST',
      url: `/api/leagues/${league.id}/invites`,
      payload: { emails: ['beto@test.com'] },
      cookies: ana.cookies,
    });
    expect(res.statusCode).toBe(200);
    const invites = res.json() as InviteInfo[];
    expect(invites).toHaveLength(1);
    invite = invites[0]!;
    expect(invite.email).toBe('beto@test.com');
    expect(invite.acceptedByUserId).toBeNull();
    expect(invite.url).toContain(`/invitacion/${invite.token}`);

    // mismo email → devuelve el invite pendiente existente
    const again = await server.app.inject({
      method: 'POST',
      url: `/api/leagues/${league.id}/invites`,
      payload: { emails: ['Beto@Test.com'] },
      cookies: ana.cookies,
    });
    expect((again.json() as InviteInfo[])[0]?.token).toBe(invite.token);
  });

  it('GET /api/invites/:token es público y accept es idempotente', async () => {
    const publicView = await server.app.inject({ method: 'GET', url: `/api/invites/${invite.token}` });
    expect(publicView.statusCode).toBe(200);
    expect(publicView.json()).toEqual({
      leagueName: 'Serie Amigos',
      email: 'beto@test.com',
      alreadyMember: false,
    });

    const anonAccept = await server.app.inject({ method: 'POST', url: `/api/invites/${invite.token}/accept` });
    expect(anonAccept.statusCode).toBe(401);

    const accept = await server.app.inject({
      method: 'POST',
      url: `/api/invites/${invite.token}/accept`,
      cookies: beto.cookies,
    });
    expect(accept.statusCode).toBe(200);
    expect(accept.json()).toEqual({ leagueId: league.id });

    // idempotente
    const acceptAgain = await server.app.inject({
      method: 'POST',
      url: `/api/invites/${invite.token}/accept`,
      cookies: beto.cookies,
    });
    expect(acceptAgain.statusCode).toBe(200);
    expect(acceptAgain.json()).toEqual({ leagueId: league.id });

    // ahora Beto es miembro: ve el detalle (sin invites, no es admin) y alreadyMember=true
    const detail = await server.app.inject({ method: 'GET', url: `/api/leagues/${league.id}`, cookies: beto.cookies });
    expect(detail.statusCode).toBe(200);
    expect((detail.json() as LeagueDetail).members.map((m) => m.userId)).toEqual([ana.user.id, beto.user.id]);
    expect((detail.json() as LeagueDetail).invites).toBeUndefined();

    const viewAsMember = await server.app.inject({
      method: 'GET',
      url: `/api/invites/${invite.token}`,
      cookies: beto.cookies,
    });
    expect((viewAsMember.json() as { alreadyMember: boolean }).alreadyMember).toBe(true);

    // el admin ve el invite como aceptado
    const adminDetail = await server.app.inject({ method: 'GET', url: `/api/leagues/${league.id}`, cookies: ana.cookies });
    expect((adminDetail.json() as LeagueDetail).invites?.[0]?.acceptedByUserId).toBe(beto.user.id);

    const notFound = await server.app.inject({ method: 'GET', url: '/api/invites/inexistente' });
    expect(notFound.statusCode).toBe(404);
  });

  it('crear asta de liga (solo admin) y verla en /api/rooms/:code con leagueId', async () => {
    const notAdmin = await server.app.inject({
      method: 'POST',
      url: `/api/leagues/${league.id}/auctions`,
      payload: {},
      cookies: beto.cookies,
    });
    expect(notAdmin.statusCode).toBe(403);

    const res = await server.app.inject({
      method: 'POST',
      url: `/api/leagues/${league.id}/auctions`,
      payload: { config: { budget: 350 } },
      cookies: ana.cookies,
    });
    expect(res.statusCode).toBe(200);
    const created = res.json() as { code: string; adminToken: string };
    roomCode = created.code;
    expect(roomCode).toMatch(/^[A-Z2-9]{6}$/);
    expect(created.adminToken).toMatch(/^[0-9a-f-]{36}$/);

    const room = server.manager.getRoom(roomCode)!;
    expect(room.state.config.budget).toBe(350);
    expect(room.state.config.leagueName).toBe('Serie Amigos'); // hereda el nombre de la liga

    const info = await server.app.inject({ method: 'GET', url: `/api/rooms/${roomCode}` });
    expect(info.json()).toEqual({ exists: true, leagueName: 'Serie Amigos', leagueId: league.id });

    const detail = await server.app.inject({ method: 'GET', url: `/api/leagues/${league.id}`, cookies: ana.cookies });
    expect((detail.json() as LeagueDetail).auctions.map((a) => a.roomCode)).toEqual([roomCode]);
  });

  it('ticket: estable por (sala, usuario); no-miembro se INCORPORA a la liga (link = invitación); sin sesión 401', async () => {
    const anon = await server.app.inject({ method: 'GET', url: `/api/rooms/${roomCode}/ticket` });
    expect(anon.statusCode).toBe(401);

    // Carla no era miembro: el link de la sala alcanza → ticket 200 + alta automática en la liga
    const outsider = await server.app.inject({
      method: 'GET',
      url: `/api/rooms/${roomCode}/ticket`,
      cookies: carla.cookies,
    });
    expect(outsider.statusCode).toBe(200);
    const carlaTicket = outsider.json() as { participantId: string; name: string };
    expect(carlaTicket.name).toBe('Carla');

    // quedó en league_members: aparece como miembro en el detalle de la liga
    const detail = await server.app.inject({ method: 'GET', url: `/api/leagues/${league.id}`, cookies: ana.cookies });
    expect((detail.json() as LeagueDetail).members.map((m) => m.userId)).toContain(carla.user.id);

    // y su ticket es estable en llamadas siguientes
    const again = await server.app.inject({
      method: 'GET',
      url: `/api/rooms/${roomCode}/ticket`,
      cookies: carla.cookies,
    });
    expect(again.json()).toEqual(carlaTicket);

    const t1 = await server.app.inject({ method: 'GET', url: `/api/rooms/${roomCode}/ticket`, cookies: beto.cookies });
    expect(t1.statusCode).toBe(200);
    const ticket1 = t1.json() as { participantId: string; name: string };
    expect(ticket1.name).toBe('Beto');
    expect(ticket1.participantId).toMatch(/^[0-9a-f-]{36}$/);

    const t2 = await server.app.inject({ method: 'GET', url: `/api/rooms/${roomCode}/ticket`, cookies: beto.cookies });
    expect(t2.json()).toEqual(ticket1); // ESTABLE

    // otro usuario → otro participantId
    const tAna = await server.app.inject({ method: 'GET', url: `/api/rooms/${roomCode}/ticket`, cookies: ana.cookies });
    expect((tAna.json() as { participantId: string }).participantId).not.toBe(ticket1.participantId);
  });

  it('ticket en sala SIN liga: alcanza con estar logueado, estable por (sala, usuario); sin sesión 401', async () => {
    const plain = await server.app.inject({ method: 'POST', url: '/api/rooms', payload: {} });
    const { code } = plain.json() as { code: string };

    // sin sesión sigue siendo 401
    const anon = await server.app.inject({ method: 'GET', url: `/api/rooms/${code}/ticket` });
    expect(anon.statusCode).toBe(401);

    // con sesión: 200 aunque la sala no pertenezca a ninguna liga (flujo código/QR)
    const t1 = await server.app.inject({
      method: 'GET',
      url: `/api/rooms/${code}/ticket`,
      cookies: beto.cookies,
    });
    expect(t1.statusCode).toBe(200);
    const ticket1 = t1.json() as { participantId: string; name: string };
    expect(ticket1.name).toBe('Beto');
    expect(ticket1.participantId).toMatch(/^[0-9a-f-]{36}$/);

    // ESTABLE: mismo (sala, usuario) → mismo participantId
    const t2 = await server.app.inject({
      method: 'GET',
      url: `/api/rooms/${code}/ticket`,
      cookies: beto.cookies,
    });
    expect(t2.json()).toEqual(ticket1);

    // otro usuario logueado (sin ninguna liga en común) → otro participantId, también 200
    const tCarla = await server.app.inject({
      method: 'GET',
      url: `/api/rooms/${code}/ticket`,
      cookies: carla.cookies,
    });
    expect(tCarla.statusCode).toBe(200);
    expect((tCarla.json() as { participantId: string }).participantId).not.toBe(ticket1.participantId);

    // sala suelta: /api/rooms/:code sigue sin leagueId
    const info = await server.app.inject({ method: 'GET', url: `/api/rooms/${code}` });
    expect(info.json()).toEqual({ exists: true, leagueName: 'Mi Liga' });

    const missing = await server.app.inject({
      method: 'GET',
      url: '/api/rooms/ZZZZZZ/ticket',
      cookies: beto.cookies,
    });
    expect(missing.statusCode).toBe(404);
  });
});
