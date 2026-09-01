import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import type { AddressInfo } from 'node:net';
import {
  BID_REJECT_MESSAGES,
  type ClientToServerEvents,
  type ErrorPayload,
  type JoinAck,
  type JoinPayload,
  type Player,
  type RoomEvent,
  type RoomState,
  type ServerToClientEvents,
} from '@fanta/shared';
import { createServer, type FantaServer } from '../src/server.js';
import { ENGINE_ERROR_MESSAGES } from '../src/engine/room.js';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let server: FantaServer;
let baseUrl: string;
const sockets: ClientSocket[] = [];

function client(): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket: ClientSocket = connect(baseUrl, { transports: ['websocket'] });
    sockets.push(socket);
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

function join(socket: ClientSocket, payload: JoinPayload): Promise<JoinAck> {
  return new Promise((resolve) => socket.emit('room:join', payload, resolve));
}

/** Espera el próximo room:state cuyo evento cumpla el predicado. */
function waitForEvent(
  socket: ClientSocket,
  predicate: (event: RoomEvent) => boolean,
): Promise<{ state: RoomState; event: RoomEvent }> {
  return new Promise((resolve) => {
    const handler = (payload: { state: RoomState; event?: RoomEvent }) => {
      if (payload.event && predicate(payload.event)) {
        socket.off('room:state', handler);
        resolve({ state: payload.state, event: payload.event });
      }
    };
    socket.on('room:state', handler);
  });
}

function waitForError(socket: ClientSocket): Promise<ErrorPayload> {
  return new Promise((resolve) => socket.once('room:error', resolve));
}

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:' });
  await server.app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = server.app.server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  for (const s of sockets) s.disconnect();
  await server.app.close();
});

describe('integración REST + socket.io (server real en puerto efímero)', () => {
  it('subasta completa de punta a punta: sala por REST, admin + 2 players, sold', async () => {
    // 1. Crear sala por REST (timers cortos para el test)
    const createRes = await fetch(`${baseUrl}/api/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ config: { leagueName: 'Liga E2E', bidTimerSeconds: 1, callTimerSeconds: 10 } }),
    });
    expect(createRes.status).toBe(200);
    const { code, adminToken } = (await createRes.json()) as { code: string; adminToken: string };
    expect(code).toMatch(/^[A-Z2-9]{6}$/);

    const infoRes = await fetch(`${baseUrl}/api/rooms/${code}`);
    expect(await infoRes.json()).toEqual({ exists: true, leagueName: 'Liga E2E' });
    const missing = await fetch(`${baseUrl}/api/rooms/ZZZZZZ`);
    expect(await missing.json()).toEqual({ exists: false });

    // 2. Listone por REST
    const playersRes = await fetch(`${baseUrl}/api/players`);
    const players = (await playersRes.json()) as Player[];
    expect(players.length).toBeGreaterThan(500);
    const target = players[0]!;

    // 3. Unir admin + 2 players
    const [adminSock, anaSock, betoSock] = await Promise.all([client(), client(), client()]);

    const badAdmin = await join(adminSock!, { code, as: 'admin', adminToken: 'trucho' });
    expect(badAdmin.ok).toBe(false);
    const adminAck = await join(adminSock!, { code, as: 'admin', adminToken });
    expect(adminAck.ok).toBe(true);

    const noName = await join(anaSock!, { code, as: 'player' });
    expect(noName.ok).toBe(false);

    const anaAck = await join(anaSock!, { code, as: 'player', name: 'Ana' });
    const betoAck = await join(betoSock!, { code, as: 'player', name: 'Beto' });
    if (!anaAck.ok || !betoAck.ok) throw new Error('join falló');
    const anaId = anaAck.participantId!;
    const betoId = betoAck.participantId!;
    expect(anaAck.state.participants.map((p) => p.name)).toContain('Ana');

    // 4. Un player NO puede llamar en callMode 'admin' (desde la fase de turnos
    //    el intento llega al motor, que lo rechaza); el admin sí puede.
    const notAllowed = waitForError(anaSock!);
    anaSock!.emit('auction:call', { playerId: target.id });
    const notAllowedErr = await notAllowed;
    expect(notAllowedErr.code).toBe('bad_request');
    expect(notAllowedErr.message).toBe(ENGINE_ERROR_MESSAGES.not_allowed_to_call);

    const called = waitForEvent(anaSock!, (e) => e.type === 'called');
    adminSock!.emit('auction:call', { playerId: target.id });
    const calledPayload = await called;
    expect(calledPayload.state.auction.phase).toBe('called');
    expect(calledPayload.state.auction.playerId).toBe(target.id);
    expect(calledPayload.state.auction.deadline).not.toBeNull();

    // 5. Ofertas: Ana rilancio mínimo (1), Beto salta a 5
    const anaBid = waitForEvent(betoSock!, (e) => e.type === 'bid' && e.bid.participantId === anaId);
    anaSock!.emit('auction:bid', {});
    expect((await anaBid).state.auction.bids.at(-1)?.amount).toBe(1);

    const betoBid = waitForEvent(anaSock!, (e) => e.type === 'bid' && e.bid.participantId === betoId);
    betoSock!.emit('auction:bid', { amount: 5 });
    await betoBid;

    // El admin no puede ofertar
    const adminBidErr = waitForError(adminSock!);
    adminSock!.emit('auction:bid', { amount: 50 });
    expect((await adminBidErr).code).toBe('bad_request');

    // Oferta propia rechazada con mensaje del shared
    const ownBidErr = waitForError(betoSock!);
    betoSock!.emit('auction:bid', {});
    const err = await ownBidErr;
    expect(err.code).toBe('own_bid');
    expect(err.message).toBe(BID_REJECT_MESSAGES.own_bid);

    // 6. Vence el countdown (1s) → sold a Beto, en todos los clientes
    const soldOnAdmin = waitForEvent(adminSock!, (e) => e.type === 'sold');
    const { state, event } = await soldOnAdmin;
    expect(event).toEqual({ type: 'sold', playerId: target.id, participantId: betoId, price: 5 });
    const beto = state.participants.find((p) => p.id === betoId)!;
    expect(beto.roster).toEqual([{ playerId: target.id, price: 5 }]);

    // 7. Reconexión: Beto se cae y vuelve con su participantId → conserva roster
    betoSock!.disconnect();
    const betoSock2 = await client();
    const rejoin = await join(betoSock2, { code, as: 'player', participantId: betoId });
    if (!rejoin.ok) throw new Error('rejoin falló');
    expect(rejoin.participantId).toBe(betoId);
    expect(rejoin.state.participants.find((p) => p.id === betoId)?.roster).toHaveLength(1);
  });

  it('sala inexistente y campioncini estático', async () => {
    const sock = await client();
    const ack = await join(sock, { code: 'NOEXIS', as: 'board' });
    expect(ack).toEqual({ ok: false, error: 'La sala no existe' });

    const img = await fetch(`${baseUrl}/campioncini/5841.png`);
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toContain('image/png');
    const missingImg = await fetch(`${baseUrl}/campioncini/99999999.png`);
    expect(missingImg.status).toBe(404);
  });
});
