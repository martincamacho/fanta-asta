import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { DEFAULT_CONFIG, type RoomState } from '@fanta/shared';
import { RESULT_DISPLAY_MS, Room } from '../src/engine/room.js';
import { RoomManager, migrateState } from '../src/engine/roomManager.js';
import { loadProfiles } from '../src/data/profiles.js';
import { buildRoseCsv } from '../src/export/rose.js';
import { createServer, type FantaServer } from '../src/server.js';
import { FakeClock, joinPlayer, makePlayers, makeRoom } from './helpers.js';

describe('pausa (admin)', () => {
  it('pause guarda los ms restantes, bloquea ofertas; resume respeta lo que restaba', () => {
    const { room, clock, events } = makeRoom({ bidTimerSeconds: 5 });
    const ana = joinPlayer(room, 'Ana');
    const beto = joinPlayer(room, 'Beto');
    room.call(101);
    room.bid(ana, 3);

    clock.advance(2_000); // quedan 3s
    expect(room.pause()).toEqual({ ok: true });
    expect(room.state.auction.pausedRemainingMs).toBe(3_000);
    expect(room.state.auction.deadline).toBeNull();
    expect(events.find((e) => e?.type === 'paused')).toBeTruthy();

    // Las ofertas durante la pausa se rechazan y el tiempo no corre
    expect(room.bid(beto, 10)).toEqual({ ok: false, reason: 'paused' });
    clock.advance(60_000);
    expect(room.state.auction.phase).toBe('bidding');
    expect(room.state.auction.bids).toHaveLength(1);

    // pause de una pausa → error; resume rearma exactamente los 3s
    expect(room.pause()).toEqual({ ok: false, error: 'not_pausable' });
    expect(room.resume()).toEqual({ ok: true });
    expect(room.state.auction.pausedRemainingMs).toBeNull();
    expect(room.state.auction.deadline).toBe(clock.now() + 3_000);
    expect(events.find((e) => e?.type === 'resumed')).toBeTruthy();

    clock.advance(2_999);
    expect(room.state.auction.phase).toBe('bidding');
    expect(room.bid(beto, 10).ok).toBe(true); // ofertar vuelve a andar
    clock.advance(5_000);
    expect(room.state.auction.phase).toBe('sold');
    expect(room.state.auction.winnerId).toBe(beto);
  });

  it('pause también en called; resume de algo no pausado → error; sin countdown no hay pausa', () => {
    const { room, clock } = makeRoom({ callTimerSeconds: 20 });
    joinPlayer(room, 'Ana');
    expect(room.pause()).toEqual({ ok: false, error: 'no_auction' });

    room.call(101);
    expect(room.resume()).toEqual({ ok: false, error: 'not_paused' });
    clock.advance(15_000);
    room.pause();
    clock.advance(120_000); // pausada: no expira
    expect(room.state.auction.phase).toBe('called');
    room.resume();
    clock.advance(5_000); // los 5s que restaban
    expect(room.state.auction.phase).toBe('unsold');

    // callTimer 0 → called sin deadline → no hay nada que pausar
    clock.advance(RESULT_DISPLAY_MS);
    room.updateConfig({ callTimerSeconds: 0 });
    room.call(102);
    expect(room.pause()).toEqual({ ok: false, error: 'not_pausable' });
  });

  it('la pausa sobrevive a un restart: se restaura pausada, sin timer, y resume anda', () => {
    const { room, clock } = makeRoom({ bidTimerSeconds: 5 });
    const ana = joinPlayer(room, 'Ana');
    room.call(101);
    room.bid(ana, 2);
    clock.advance(1_000);
    room.pause();
    expect(room.state.auction.pausedRemainingMs).toBe(4_000);

    // "restart": snapshot JSON → Room nueva con otro reloj
    const snapshot = JSON.parse(JSON.stringify(room.state)) as RoomState;
    const clock2 = new FakeClock();
    const restored = new Room({
      code: snapshot.code,
      config: snapshot.config,
      players: makePlayers(),
      clock: clock2,
      initialState: snapshot,
    });

    expect(restored.state.auction.pausedRemainingMs).toBe(4_000);
    clock2.advance(3_600_000); // NO se re-armó timer: sigue pausada
    expect(restored.state.auction.phase).toBe('bidding');

    expect(restored.resume()).toEqual({ ok: true });
    clock2.advance(4_000);
    expect(restored.state.auction.phase).toBe('sold');
  });
});

describe('fin del asta (finishedAt)', () => {
  it('se setea solo cuando todos llenan los cupos tras una venta; call/bid rechazados, assign permitido', () => {
    const { room, clock, events } = makeRoom({ slots: { P: 1, D: 0, C: 0, A: 0 }, budget: 20 });
    const ana = joinPlayer(room, 'Ana');
    const beto = joinPlayer(room, 'Beto');

    room.call(101);
    room.bid(ana, 2);
    clock.advance(5_000); // Ana llena su único cupo
    expect(room.state.finishedAt).toBeNull(); // Beto todavía no

    clock.advance(RESULT_DISPLAY_MS);
    room.call(102);
    room.bid(beto, 2);
    clock.advance(5_000); // Beto también → fin automático
    expect(room.state.finishedAt).toBe(clock.now());
    expect(events.filter((e) => e?.type === 'finished')).toHaveLength(1);

    clock.advance(RESULT_DISPLAY_MS);
    expect(room.call(103)).toEqual({ ok: false, error: 'finished' });
    expect(room.bid(ana, 5)).toEqual({ ok: false, reason: 'no_auction' });

    // Correcciones post-asta siguen permitidas
    expect(room.assign(103, ana, 7)).toEqual({ ok: true });
    expect(room.unassign(103)).toEqual({ ok: true });
    // Una vez finished, queda finished (el unassign no lo revierte)
    expect(room.state.finishedAt).not.toBeNull();
  });

  it('admin:assign que llena el último cupo también dispara el fin', () => {
    const { room } = makeRoom({ slots: { P: 1, D: 0, C: 0, A: 0 } });
    const ana = joinPlayer(room, 'Ana');
    expect(room.state.finishedAt).toBeNull();
    room.assign(101, ana, 1);
    expect(room.state.finishedAt).not.toBeNull();
  });

  it('room:finish manual: solo en idle, idempotente; no hay evento para reabrir', () => {
    const { room, events } = makeRoom();
    const ana = joinPlayer(room, 'Ana');

    room.call(101);
    expect(room.finish()).toEqual({ ok: false, error: 'auction_in_progress' });
    room.bid(ana, 1);
    expect(room.finish()).toEqual({ ok: false, error: 'auction_in_progress' });
    room.cancel();

    expect(room.finish()).toEqual({ ok: true });
    expect(room.state.finishedAt).not.toBeNull();
    const at = room.state.finishedAt;
    expect(room.finish()).toEqual({ ok: true }); // idempotente
    expect(room.state.finishedAt).toBe(at); // y no re-marca ni re-emite
    expect(events.filter((e) => e?.type === 'finished')).toHaveLength(1);
    expect(room.call(102)).toEqual({ ok: false, error: 'finished' });
  });
});

describe('base de asta por quotazione', () => {
  it('la primera oferta mínima es la cotización; por debajo se rechaza too_low', () => {
    const { room, players } = makeRoom({ baseBidMode: 'quotazione' });
    const ana = joinPlayer(room, 'Ana');
    const beto = joinPlayer(room, 'Beto');
    expect(players.get(101)?.quotazione).toBe(10);

    room.call(101);
    expect(room.bid(ana, 9)).toEqual({ ok: false, reason: 'too_low' });

    const first = room.bid(ana); // sin amount = mínimo → la quotazione
    expect(first.ok && first.bid.amount === 10).toBe(true);

    // Tras la primera oferta, vale el rilancio normal
    expect(room.bid(beto, 10)).toEqual({ ok: false, reason: 'too_low' });
    expect(room.bid(beto)).toMatchObject({ ok: true, bid: { amount: 11 } });
  });
});

describe('migración de snapshots viejos', () => {
  it('migrateState completa config y campos nuevos de AuctionState/RoomState', () => {
    // Snapshot pre-fase-6: sin baseBidMode/hideValues/pausedRemainingMs/finishedAt
    const old = {
      code: 'VIEJA1',
      config: {
        leagueName: 'Liga Vieja',
        budget: 300,
        slots: { P: 3, D: 8, C: 8, A: 6 },
        bidTimerSeconds: 5,
        callTimerSeconds: 20,
        minIncrement: 1,
      },
      participants: [{ id: 'u1', name: 'Ana', connected: true, roster: [{ playerId: 101, price: 7 }] }],
      auction: { phase: 'idle', playerId: null, bids: [], deadline: null, winnerId: null },
      unsoldPlayerIds: [201],
      serverTime: 0,
    } as unknown as RoomState;

    const migrated = migrateState(old);
    expect(migrated.config.budget).toBe(300); // lo guardado gana...
    expect(migrated.config.baseBidMode).toBe(DEFAULT_CONFIG.baseBidMode); // ...y lo nuevo toma el default
    expect(migrated.config.hideValues).toBe(DEFAULT_CONFIG.hideValues);
    expect(migrated.auction.pausedRemainingMs).toBeNull();
    expect(migrated.finishedAt).toBeNull();
  });

  it('RoomManager.restore levanta un snapshot viejo escrito directo en SQLite', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fanta-mig-'));
    const dbPath = path.join(dir, 'fanta.sqlite');

    const oldState = {
      code: 'VIEJA2',
      config: { leagueName: 'Pre-migración', budget: 250, slots: { P: 3, D: 8, C: 8, A: 6 }, bidTimerSeconds: 5, callTimerSeconds: 20, minIncrement: 1 },
      participants: [{ id: 'u1', name: 'Ana', connected: true, roster: [] }],
      auction: { phase: 'idle', playerId: null, bids: [], deadline: null, winnerId: null },
      unsoldPlayerIds: [],
      serverTime: 0,
    };
    const raw = new Database(dbPath);
    raw.exec(
      'CREATE TABLE rooms (code TEXT PRIMARY KEY, admin_token TEXT NOT NULL, state_json TEXT NOT NULL, updated_at INTEGER NOT NULL)',
    );
    raw.prepare('INSERT INTO rooms VALUES (?, ?, ?, ?)').run('VIEJA2', 'tok', JSON.stringify(oldState), 0);
    raw.close();

    const manager = new RoomManager({ players: makePlayers(), dbPath, clock: new FakeClock() });
    expect(manager.restore()).toBe(1);
    const room = manager.getRoom('VIEJA2')!;
    expect(room.state.config).toEqual({ ...DEFAULT_CONFIG, leagueName: 'Pre-migración', budget: 250, bidTimerSeconds: 5, callTimerSeconds: 20 });
    expect(room.state.auction.pausedRemainingMs).toBeNull();
    expect(room.state.finishedAt).toBeNull();
    // y el motor migrado funciona
    expect(room.call(101)).toEqual({ ok: true });
    manager.close();
  });
});

describe('perfil de jugador y export de rosas (REST)', () => {
  let server: FantaServer;

  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:' });
    await server.app.ready();
  });

  afterAll(async () => {
    await server.app.close();
  });

  it('GET /api/players/:id/profile → 200 con ficha, 404 sin ficha o id inválido', async () => {
    const ok = await server.app.inject({ method: 'GET', url: '/api/players/3/profile' });
    expect(ok.statusCode).toBe(200);
    const profile = ok.json() as { url: string | null; fvm: number | null };
    expect(profile.url).toContain('fantacalcio.it');
    expect(profile).toHaveProperty('mv');
    expect(profile).toHaveProperty('fm');

    const missing = await server.app.inject({ method: 'GET', url: '/api/players/999999/profile' });
    expect(missing.statusCode).toBe(404);
    const invalid = await server.app.inject({ method: 'GET', url: '/api/players/abc/profile' });
    expect(invalid.statusCode).toBe(404);
  });

  it('loadProfiles tolera archivo inexistente (mapa vacío + warn)', () => {
    const warnings: string[] = [];
    const profiles = loadProfiles('/no/existe/players.json', (m) => warnings.push(m));
    expect(profiles.size).toBe(0);
    expect(warnings).toHaveLength(1);
  });

  it('GET /api/rooms/:code/export/rose.csv → formato Leghe: squadra,id,costo sin header, orden de compra', async () => {
    const created = await server.app.inject({ method: 'POST', url: '/api/rooms', payload: {} });
    const { code } = created.json() as { code: string };
    const room = server.manager.getRoom(code)!;

    const anaJoin = room.join(undefined, 'Equipo Ana');
    const betoJoin = room.join(undefined, 'Beto, FC'); // la coma se sanitiza (el parser de Leghe es naif)
    if (!anaJoin.ok || !betoJoin.ok) throw new Error('join falló');

    // Compras de Ana en orden "desordenado" respecto al rol: el export respeta el ORDEN DE COMPRA
    room.assign(5585, anaJoin.participantId, 30); // A - Malen (Roma)
    room.assign(5841, anaJoin.participantId, 19); // P - Svilar (Roma)
    room.assign(2170, betoJoin.participantId, 5); // P - Milinkovic-Savic V.

    const res = await server.app.inject({ method: 'GET', url: `/api/rooms/${code}/export/rose.csv` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toBe(`attachment; filename="rose-${code}.csv"`);

    // sin header; una línea por compra; participante → orden de compra
    expect(res.body).toBe('Equipo Ana,5585,30\r\nEquipo Ana,5841,19\r\nBeto  FC,2170,5\r\n');

    const missing = await server.app.inject({ method: 'GET', url: '/api/rooms/ZZZZZZ/export/rose.csv' });
    expect(missing.statusCode).toBe(404);
  });

  it('buildRoseCsv es determinístico y usa el precio de compra', () => {
    const { room } = makeRoom();
    const ana = joinPlayer(room, 'Ana');
    room.assign(101, ana, 42);
    expect(buildRoseCsv(room.state)).toBe('Ana,101,42\r\n');
  });
});
