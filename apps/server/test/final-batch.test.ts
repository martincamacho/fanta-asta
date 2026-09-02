import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { budgetRemaining, maxBid, type LeagueSummary, type User } from '@fanta/shared';
import { validateConfigRanges } from '../src/engine/room.js';
import { RoomManager } from '../src/engine/roomManager.js';
import { parseCustomListone } from '../src/data/listone.js';
import { createServer, type FantaServer } from '../src/server.js';
import { FakeClock, joinPlayer, makePlayers, makeRoom } from './helpers.js';

// ── admin:setBid ───────────────────────────────────────────────────────────

describe('setBidAmount (corrección del banditore)', () => {
  it('corrige la última oferta sin reiniciar el countdown y emite bid_amount_set', () => {
    const { room, clock, events } = makeRoom({ bidTimerSeconds: 5 });
    const ana = joinPlayer(room, 'Ana');
    room.call(101);
    room.bid(ana, 3);
    const deadline = room.state.auction.deadline;

    clock.advance(2_000);
    expect(room.setBidAmount(10)).toEqual({ ok: true });
    expect(room.state.auction.bids.at(-1)?.amount).toBe(10);
    expect(room.state.auction.deadline).toBe(deadline); // NO reinicia
    expect(events.find((e) => e?.type === 'bid_amount_set')).toEqual({ type: 'bid_amount_set', amount: 10 });

    clock.advance(3_000); // el timer original sigue corriendo
    expect(room.state.auction.phase).toBe('sold');
    expect(room.state.participants[0]?.roster).toEqual([{ playerId: 101, price: 10 }]);
  });

  it('valida fase, monto entero ≥1 y > oferta anterior a la última', () => {
    const { room } = makeRoom();
    const ana = joinPlayer(room, 'Ana');
    const beto = joinPlayer(room, 'Beto');

    expect(room.setBidAmount(5)).toEqual({ ok: false, error: 'no_auction' });
    room.call(101);
    expect(room.setBidAmount(5)).toEqual({ ok: false, error: 'no_auction' }); // called sin ofertas

    room.bid(ana, 5);
    expect(room.setBidAmount(0)).toEqual({ ok: false, error: 'invalid_bid_amount' });
    expect(room.setBidAmount(2.5)).toEqual({ ok: false, error: 'invalid_bid_amount' });
    expect(room.setBidAmount(1)).toEqual({ ok: true }); // sin oferta anterior: ≥1 alcanza

    room.bid(beto, 6);
    expect(room.setBidAmount(1)).toEqual({ ok: false, error: 'invalid_bid_amount' }); // ≤ oferta anterior (1)
    expect(room.setBidAmount(2)).toEqual({ ok: true }); // > 1
  });
});

// ── admin:budget ───────────────────────────────────────────────────────────

describe('adjustBudget (bonus/malus de créditos)', () => {
  it('suma al budgetBonus, afecta remaining/maxBid y puede dejar el total negativo', () => {
    const { room, events } = makeRoom({ budget: 100 });
    const ana = joinPlayer(room, 'Ana');
    const p = room.state.participants[0]!;

    expect(room.adjustBudget(ana, 50)).toEqual({ ok: true });
    expect(p.budgetBonus).toBe(50);
    expect(budgetRemaining(p, room.state.config)).toBe(150);
    expect(maxBid(p, room.state.config)).toBe(150 - (25 - 1));
    expect(events.find((e) => e?.type === 'budget_adjusted')).toEqual({
      type: 'budget_adjusted',
      participantId: ana,
      delta: 50,
    });

    expect(room.adjustBudget(ana, -300)).toEqual({ ok: true }); // el admin manda
    expect(budgetRemaining(p, room.state.config)).toBe(-150);

    expect(room.adjustBudget('nadie', 5)).toEqual({ ok: false, error: 'unknown_participant' });
    expect(room.adjustBudget(ana, 1.5)).toEqual({ ok: false, error: 'invalid_delta' });

    room.finish();
    expect(room.adjustBudget(ana, 10)).toEqual({ ok: true }); // permitido incluso finished
  });
});

// ── Premi&Parla ────────────────────────────────────────────────────────────

describe('auctionMode premi_parla', () => {
  it('la oferta ignora el amount custom (reserva la palabra al mínimo); setBid fija el real', () => {
    const { room, clock } = makeRoom({ auctionMode: 'premi_parla', bidTimerSeconds: 5 });
    const ana = joinPlayer(room, 'Ana');
    const beto = joinPlayer(room, 'Beto');
    room.call(101);

    const b1 = room.bid(ana, 50); // el 50 se ignora
    expect(b1.ok && b1.bid.amount === 1).toBe(true);
    const b2 = room.bid(beto, 99); // ídem
    expect(b2.ok && b2.bid.amount === 2).toBe(true);

    expect(room.setBidAmount(25)).toEqual({ ok: true }); // el banditore canta el monto real
    const b3 = room.bid(ana); // el próximo mínimo respeta la corrección
    expect(b3.ok && b3.bid.amount === 26).toBe(true);

    clock.advance(5_000);
    expect(room.state.auction.phase).toBe('sold');
    expect(room.state.participants[0]?.roster).toEqual([{ playerId: 101, price: 26 }]);
  });
});

// ── rosterComplete / rangos ────────────────────────────────────────────────

describe('modo rango (slotsMin/rosterSize) en el motor', () => {
  const rango = { slots: { P: 2, D: 2, C: 0, A: 0 }, slotsMin: { P: 1, D: 0, C: 0, A: 0 }, rosterSize: 2 };

  it('el auto-finish usa rosterTarget (no la suma de máximos)', () => {
    const { room } = makeRoom(rango);
    const ana = joinPlayer(room, 'Ana');
    room.assign(101, ana, 1); // P
    expect(room.state.finishedAt).toBeNull();
    room.assign(201, ana, 1); // D → 2/2 aunque los máximos suman 4
    expect(room.state.finishedAt).not.toBeNull();
  });

  it('roster_full al ofertar con la plantilla completa; el salteo de turnos usa rosterComplete', () => {
    const { room } = makeRoom({ ...rango, callMode: 'turns' });
    const ids = [joinPlayer(room, 'A'), joinPlayer(room, 'B'), joinPlayer(room, 'C')];
    room.drawOrder();
    const order = room.state.callOrder;
    const h1 = order[1]!;
    room.assign(101, h1, 1);
    room.assign(201, h1, 1); // h1 completo (2/2)

    expect(room.skipTurn()).toEqual({ ok: true });
    expect(room.state.turnIndex).toBe(2); // salteó a h1

    room.call(102, order[2]);
    expect(room.bid(h1, 1)).toEqual({ ok: false, reason: 'roster_full' });
    void ids;
  });

  it('validateConfigRanges: min≤max por rol y sum(min) ≤ rosterSize ≤ sum(max)', () => {
    const base = makeRoom().config;
    expect(validateConfigRanges(base)).toBeNull(); // sin rangos no valida nada
    expect(validateConfigRanges({ ...base, slotsMin: { P: 4, D: 8, C: 8, A: 6 } })).toContain('mínimo de P');
    expect(validateConfigRanges({ ...base, rosterSize: 30 })).toContain('rosterSize');
    expect(validateConfigRanges({ ...base, slotsMin: { P: 2, D: 6, C: 6, A: 4 }, rosterSize: 17 })).toContain(
      'rosterSize',
    ); // sum(min)=18 > 17
    expect(
      validateConfigRanges({ ...base, slotsMin: { P: 2, D: 6, C: 6, A: 4 }, rosterSize: 20 }),
    ).toBeNull();
  });

  it('updateConfig rechaza rangos inválidos sin tocar la config', () => {
    const { room } = makeRoom();
    const before = structuredClone(room.state.config);
    expect(room.updateConfig({ slotsMin: { P: 9, D: 0, C: 0, A: 0 } })).toEqual({
      ok: false,
      error: 'invalid_config',
    });
    expect(room.state.config).toEqual(before);
    expect(room.updateConfig({ slotsMin: { P: 1, D: 2, C: 2, A: 1 }, rosterSize: 10 })).toEqual({ ok: true });
  });
});

// ── Listone por sala: parser ───────────────────────────────────────────────

describe('parseCustomListone', () => {
  it('formato clásico: usa los IDs del archivo y saltea headers', () => {
    const csv = [
      'C,T,M,Nome,Squadra,Quotazione,ID,EID',
      'P,P,Por,Svilar,Roma,19,5841,5841',
      'C,T,M,Nome,Squadra,Quotazione,ID,EID',
      'D,D,Dd,Bremer,Juventus,15,2497,2497',
      'C,C,M,Barella,Inter,22,2298,2298',
    ].join('\n');
    const players = parseCustomListone(csv);
    expect(players.map((p) => p.id)).toEqual([5841, 2497, 2298]);
    expect(players[2]).toEqual({ id: 2298, name: 'Barella', team: 'Inter', role: 'C', quotazione: 22 });
  });

  it('formato genérico: header opcional, roles flexibles, quotazione default 1, ids negativos estables', () => {
    const csv = [
      'Nome,Squadra,Ruolo,Quotazione',
      'Tizio,Roma,Portiere,12',
      'Caio,Milan,Dif,',
      'Sempronio,Inter,c,8',
      'Mevio,Napoli,Attaccante',
    ].join('\n');
    const players = parseCustomListone(csv);
    expect(players).toEqual([
      { id: -1, name: 'Tizio', team: 'Roma', role: 'P', quotazione: 12 },
      { id: -2, name: 'Caio', team: 'Milan', role: 'D', quotazione: 1 },
      { id: -3, name: 'Sempronio', team: 'Inter', role: 'C', quotazione: 8 },
      { id: -4, name: 'Mevio', team: 'Napoli', role: 'A', quotazione: 1 },
    ]);
    // estable: re-parsear da los mismos ids
    expect(parseCustomListone(csv)).toEqual(players);
    // sin header también funciona
    expect(parseCustomListone('Tizio,Roma,P,5\nCaio,Milan,D,3')).toHaveLength(2);
  });

  it('filas inválidas se saltean', () => {
    const players = parseCustomListone('Tizio,Roma,X,5\n,,P,2\nCaio,Milan,D,3');
    expect(players).toEqual([{ id: -1, name: 'Caio', team: 'Milan', role: 'D', quotazione: 3 }]);
  });
});

// ── REST: listone por sala, xlsx, validación de config ────────────────────

function genericCsv(n: number): string {
  const roles = ['P', 'D', 'C', 'A'];
  return Array.from({ length: n }, (_, i) => `Jugador${i + 1},Equipo${i % 4},${roles[i % 4]},${i + 1}`).join('\n');
}

describe('REST: listone por sala, export xlsx y config con rangos', () => {
  let server: FantaServer;
  let code: string;
  let adminToken: string;

  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:' });
    await server.app.ready();
    const res = await server.app.inject({ method: 'POST', url: '/api/rooms', payload: {} });
    ({ code, adminToken } = res.json() as { code: string; adminToken: string });
  });

  afterAll(async () => {
    await server.app.close();
  });

  it('POST /api/rooms valida rangos de config (400 con mensaje claro)', async () => {
    const bad = await server.app.inject({
      method: 'POST',
      url: '/api/rooms',
      payload: { config: { slotsMin: { P: 9, D: 8, C: 8, A: 6 } } },
    });
    expect(bad.statusCode).toBe(400);
    expect((bad.json() as { error: string }).error).toContain('mínimo de P');

    const ok = await server.app.inject({
      method: 'POST',
      url: '/api/rooms',
      payload: { config: { slotsMin: { P: 2, D: 6, C: 6, A: 4 }, rosterSize: 20 } },
    });
    expect(ok.statusCode).toBe(200);
  });

  it('POST /:code/listone: 403 token malo, 400 chico, ok con count; GET /players devuelve el efectivo', async () => {
    const badToken = await server.app.inject({
      method: 'POST',
      url: `/api/rooms/${code}/listone`,
      payload: { adminToken: 'trucho', csv: genericCsv(12) },
    });
    expect(badToken.statusCode).toBe(403);

    const tooSmall = await server.app.inject({
      method: 'POST',
      url: `/api/rooms/${code}/listone`,
      payload: { adminToken, csv: genericCsv(5) },
    });
    expect(tooSmall.statusCode).toBe(400);

    // antes de subir: listone global
    const globalList = await server.app.inject({ method: 'GET', url: `/api/rooms/${code}/players` });
    expect((globalList.json() as unknown[]).length).toBeGreaterThan(500);

    const ok = await server.app.inject({
      method: 'POST',
      url: `/api/rooms/${code}/listone`,
      payload: { adminToken, csv: genericCsv(12) },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ count: 12 });

    const effective = await server.app.inject({ method: 'GET', url: `/api/rooms/${code}/players` });
    const players = effective.json() as Array<{ id: number; name: string }>;
    expect(players).toHaveLength(12);
    expect(players[0]).toMatchObject({ id: -1, name: 'Jugador1' });

    // el motor subasta contra el listone propio
    const room = server.manager.getRoom(code)!;
    const ana = joinPlayer(room, 'Ana');
    expect(room.call(-1)).toEqual({ ok: true });
    expect(room.bid(ana, 3).ok).toBe(true);
    room.close(); // sold con id negativo

    // con compras hechas: 409
    const locked = await server.app.inject({
      method: 'POST',
      url: `/api/rooms/${code}/listone`,
      payload: { adminToken, csv: genericCsv(15) },
    });
    expect(locked.statusCode).toBe(409);
  });

  it('GET export/rose.xlsx responde un zip válido (PK) con content-type de Excel', async () => {
    const res = await server.app.inject({ method: 'GET', url: `/api/rooms/${code}/export/rose.xlsx` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toBe(`attachment; filename="rose-${code}.xlsx"`);
    const body = res.rawPayload;
    expect(body.length).toBeGreaterThan(1000);
    expect(body.subarray(0, 2).toString('latin1')).toBe('PK'); // magic de zip/xlsx

    // el CSV usa el listone efectivo (nombre del jugador custom)
    const csv = await server.app.inject({ method: 'GET', url: `/api/rooms/${code}/export/rose.csv` });
    expect(csv.body).toContain('Ana,Jugador1,P,Equipo0,3');
  });

  it('GET /rosters: JSON público con listone efectivo, remaining con bonus y orden de compra', async () => {
    const room = server.manager.getRoom(code)!;
    const ana = room.state.participants[0]!;
    room.adjustBudget(ana.id, 50); // bonus: remaining = 500 + 50 - 3

    const res = await server.app.inject({ method: 'GET', url: `/api/rooms/${code}/rosters` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      leagueId?: string;
      config: { budget: number };
      finishedAt: number | null;
      participants: Array<{
        id: string;
        name: string;
        budgetBonus: number;
        spent: number;
        remaining: number;
        roster: Array<{ player: { id: number; name: string; role: string }; price: number }>;
        slotsFilled: Record<string, number>;
      }>;
    };

    expect(body.leagueId).toBeUndefined(); // sala suelta
    expect(body.config.budget).toBe(500);
    expect(body.finishedAt).toBeNull();
    expect(body.participants).toHaveLength(1);
    const p = body.participants[0]!;
    expect(p).toMatchObject({ id: ana.id, name: 'Ana', budgetBonus: 50, spent: 3, remaining: 547 });
    // listone propio: el jugador con id negativo sale hidratado
    expect(p.roster).toEqual([
      { player: { id: -1, name: 'Jugador1', team: 'Equipo0', role: 'P', quotazione: 1 }, price: 3 },
    ]);
    expect(p.slotsFilled).toEqual({ P: 1, D: 0, C: 0, A: 0 });

    const missing = await server.app.inject({ method: 'GET', url: '/api/rooms/ZZZZZZ/rosters' });
    expect(missing.statusCode).toBe(404);
  });

  it('POST /:code/players: alta manual con listone propio y compras hechas; duplicado 409; e2e subastable', async () => {
    // duplicado exacto contra el listone propio (case-insensitive)
    const dup = await server.app.inject({
      method: 'POST',
      url: `/api/rooms/${code}/players`,
      payload: { adminToken, name: 'jugador1', team: 'equipo0', role: 'P' },
    });
    expect(dup.statusCode).toBe(409);

    // rol inválido → 400; token malo → 403
    const badRole = await server.app.inject({
      method: 'POST',
      url: `/api/rooms/${code}/players`,
      payload: { adminToken, name: 'Nuovo', team: 'X', role: 'Z' },
    });
    expect(badRole.statusCode).toBe(400);
    const badToken = await server.app.inject({
      method: 'POST',
      url: `/api/rooms/${code}/players`,
      payload: { adminToken: 'trucho', name: 'Nuovo', team: 'X', role: 'P' },
    });
    expect(badToken.statusCode).toBe(403);

    // alta ok con rol flexible, aun con compras hechas (Ana ya compró el -1)
    const added = await server.app.inject({
      method: 'POST',
      url: `/api/rooms/${code}/players`,
      payload: { adminToken, name: 'Nuovo Acquisto', team: 'Cremonese', role: 'Attaccante', quotazione: 7 },
    });
    expect(added.statusCode).toBe(200);
    expect(added.json()).toEqual({
      player: { id: -13, name: 'Nuovo Acquisto', team: 'Cremonese', role: 'A', quotazione: 7 },
    }); // siguiente negativo libre tras -1..-12

    const list = await server.app.inject({ method: 'GET', url: `/api/rooms/${code}/players` });
    expect((list.json() as unknown[]).length).toBe(13);

    // e2e: el agregado se subasta de punta a punta
    const room = server.manager.getRoom(code)!;
    const beto = joinPlayer(room, 'Beto Alta');
    expect(room.call(-13)).toEqual({ ok: true });
    expect(room.bid(beto, 2).ok).toBe(true);
    expect(room.close()).toEqual({ ok: true });
    const betoState = room.state.participants.find((p) => p.name === 'Beto Alta')!;
    expect(betoState.roster).toEqual([{ playerId: -13, price: 2 }]);
  });

  it('POST /:code/players en sala SIN listone propio: copia el global y agrega con id -1; ok con subasta activa', async () => {
    const created = await server.app.inject({ method: 'POST', url: '/api/rooms', payload: {} });
    const fresh = created.json() as { code: string; adminToken: string };
    const room = server.manager.getRoom(fresh.code)!;
    expect(room.customListone).toBeNull();

    // incluso con subasta activa
    joinPlayer(room, 'Ana');
    expect(room.call(5841)).toEqual({ ok: true });

    const added = await server.app.inject({
      method: 'POST',
      url: `/api/rooms/${fresh.code}/players`,
      payload: { adminToken: fresh.adminToken, name: 'Fantasma', team: 'Test FC', role: 'd' },
    });
    expect(added.statusCode).toBe(200);
    expect(added.json()).toEqual({
      player: { id: -1, name: 'Fantasma', team: 'Test FC', role: 'D', quotazione: 1 }, // default 1
    });

    // el listone propio quedó como copia del global + el nuevo
    expect(room.customListone).toHaveLength(server.players.length + 1);
    expect(room.effectivePlayers.get(5841)?.name).toBe('Svilar'); // el global sigue ahí
    const list = await server.app.inject({ method: 'GET', url: `/api/rooms/${fresh.code}/players` });
    expect((list.json() as unknown[]).length).toBe(server.players.length + 1);

    // name/team vacíos → 400
    const noName = await server.app.inject({
      method: 'POST',
      url: `/api/rooms/${fresh.code}/players`,
      payload: { adminToken: fresh.adminToken, name: '  ', team: 'X', role: 'P' },
    });
    expect(noName.statusCode).toBe(400);
  });
});

// ── Persistencia del listone propio ────────────────────────────────────────

describe('persistencia del listone por sala', () => {
  it('sobrevive al restore del RoomManager (snapshot con customListone)', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fanta-listone-db-'));
    const dbPath = path.join(dir, 'fanta.sqlite');
    const clock = new FakeClock();

    const m1 = new RoomManager({ players: makePlayers(), dbPath, clock });
    const { code, room } = m1.createRoom();
    const custom = parseCustomListone(genericCsv(11));
    expect(room.setListone(custom)).toEqual({ ok: true, count: 11 });
    clock.advance(250); // debounce de guardado
    await m1.close();

    const m2 = new RoomManager({ players: makePlayers(), dbPath, clock: new FakeClock() });
    expect(m2.restore()).toBe(1);
    const restored = m2.getRoom(code)!;
    expect(restored.customListone).toHaveLength(11);
    expect(restored.effectivePlayers.get(-1)?.name).toBe('Jugador1');
    expect(restored.effectivePlayers.has(101)).toBe(false); // el global ya no aplica
    await m2.close();
  });

  it('migrateState completa budgetBonus 0 en participantes viejos (vía restore ya cubierto en unit)', () => {
    const { room } = makeRoom();
    joinPlayer(room, 'Ana');
    expect(room.state.participants[0]?.budgetBonus).toBe(0); // join lo crea en 0
  });
});

// ── Resend (mockeado) ──────────────────────────────────────────────────────

describe('emails de invitación vía Resend', () => {
  let server: FantaServer;
  let cookies: Record<string, string>;
  let league: LeagueSummary;

  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:' });
    await server.app.ready();
    const reg = await server.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'admin@resend.test', name: 'Admin', password: 'secreta1' },
    });
    const cookie = reg.cookies.find((c) => c.name === 'fanta_session')!;
    cookies = { fanta_session: cookie.value };
    const lg = await server.app.inject({
      method: 'POST',
      url: '/api/leagues',
      payload: { name: 'Liga Resend' },
      cookies,
    });
    league = lg.json() as LeagueSummary;
  });

  afterAll(async () => {
    await server.app.close();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('sin RESEND_API_KEY no llama a nada y emailSent es false', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await server.app.inject({
      method: 'POST',
      url: `/api/leagues/${league.id}/invites`,
      payload: { emails: ['uno@test.com'] },
      cookies,
    });
    const invites = res.json() as Array<{ emailSent: boolean; token: string }>;
    expect(invites[0]?.emailSent).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('con key manda el email (from/subject/link con APP_ORIGIN) y reporta emailSent true', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test_123');
    vi.stubEnv('APP_ORIGIN', 'https://fanta.example');
    const fetchMock = vi.fn(async () => new Response('{"id":"em_1"}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await server.app.inject({
      method: 'POST',
      url: `/api/leagues/${league.id}/invites`,
      payload: { emails: ['dos@test.com'] },
      cookies,
    });
    const invites = res.json() as Array<{ emailSent: boolean; url: string; token: string }>;
    expect(invites[0]?.emailSent).toBe(true);
    expect(invites[0]?.url).toBe(`https://fanta.example/invitacion/${invites[0]?.token}`);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer re_test_123');
    const body = JSON.parse(init.body as string) as { to: string[]; subject: string; html: string; from: string };
    expect(body.to).toEqual(['dos@test.com']);
    expect(body.subject).toBe('Sei stato invitato alla lega Liga Resend');
    expect(body.html).toContain('Unisciti alla lega');
    expect(body.html).toContain("Accetta l'invito");
    expect(body.from).toBe('Fanta Asta <onboarding@resend.dev>');
    expect(body.html).toContain(`https://fanta.example/invitacion/${invites[0]?.token}`);
  });

  it('un fallo del email NO rompe la creación del invite (emailSent false)', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test_123');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));

    const res = await server.app.inject({
      method: 'POST',
      url: `/api/leagues/${league.id}/invites`,
      payload: { emails: ['tres@test.com'] },
      cookies,
    });
    expect(res.statusCode).toBe(200);
    const invites = res.json() as Array<{ emailSent: boolean; token: string }>;
    expect(invites[0]?.emailSent).toBe(false);
    expect(invites[0]?.token).toBeTruthy(); // el invite existe igual

    // y es visible en el detalle de la liga
    const detail = await server.app.inject({ method: 'GET', url: `/api/leagues/${league.id}`, cookies });
    expect((detail.json() as { invites?: unknown[] }).invites?.length).toBe(3);
  });
});

// ── Backups ────────────────────────────────────────────────────────────────

describe('backups de SQLite', () => {
  it('backupNow crea el archivo en <db>/backups y poda a los últimos 20; close hace uno más', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fanta-backup-'));
    const dbPath = path.join(dir, 'fanta.sqlite');
    const manager = new RoomManager({ players: makePlayers(), dbPath, clock: new FakeClock() });
    manager.createRoom();

    const first = await manager.backupNow();
    expect(first).toBeTruthy();
    expect(existsSync(first!)).toBe(true);
    expect(path.dirname(first!)).toBe(path.join(dir, 'backups'));

    for (let i = 0; i < 22; i++) await manager.backupNow();
    const files = readdirSync(path.join(dir, 'backups')).filter((f) => f.startsWith('fanta-'));
    expect(files).toHaveLength(20); // podado

    await manager.close(); // backup de despedida, sigue el tope
    const after = readdirSync(path.join(dir, 'backups')).filter((f) => f.startsWith('fanta-'));
    expect(after).toHaveLength(20);
  });

  it("':memory:' no hace backups", async () => {
    const manager = new RoomManager({ players: makePlayers(), dbPath: ':memory:', clock: new FakeClock() });
    expect(await manager.backupNow()).toBeNull();
    await manager.close();
  });
});
