/**
 * Smoke test end-to-end contra el server real (debe estar corriendo en :3001).
 * Crea una sala, une admin + 2 participantes, subasta 2 jugadores (uno vendido,
 * uno desierto) y verifica créditos, rosters y richiama.
 *
 *   pnpm tsx scripts/smoke.ts
 */
import { io, type Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  JoinAck,
  Player,
  RoomState,
  ServerToClientEvents,
} from '@fanta/shared';

const BASE = process.env.BASE_URL ?? 'http://localhost:3001';
type C = Socket<ServerToClientEvents, ClientToServerEvents>;

function connect(): C {
  return io(BASE, { transports: ['websocket'] });
}

function join(
  socket: C,
  payload: Parameters<ClientToServerEvents['room:join']>[0],
): Promise<JoinAck> {
  return new Promise((resolve) => socket.emit('room:join', payload, resolve));
}

function nextState(socket: C, pred: (s: RoomState) => boolean, label: string): Promise<RoomState> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout esperando: ${label}`)), 15000);
    const handler = ({ state }: { state: RoomState }) => {
      if (pred(state)) {
        clearTimeout(timer);
        socket.off('room:state', handler);
        resolve(state);
      }
    };
    socket.on('room:state', handler);
  });
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function main() {
  console.log('1. Creando sala…');
  const res = await fetch(`${BASE}/api/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ config: { bidTimerSeconds: 2, callTimerSeconds: 3 } }),
  });
  const { code, adminToken } = (await res.json()) as { code: string; adminToken: string };
  assert(code?.length === 6, `sala creada: ${code}`);

  const players = (await (await fetch(`${BASE}/api/players`)).json()) as Player[];
  assert(players.length > 500, `listone cargado: ${players.length} jugadores`);
  const [target, target2] = players;
  assert(target && target2, 'hay jugadores para subastar');

  console.log('2. Conectando admin + 2 participantes…');
  const admin = connect();
  const p1 = connect();
  const p2 = connect();
  const aAck = await join(admin, { code, as: 'admin', adminToken });
  assert(aAck.ok, 'admin unido');
  const j1 = await join(p1, { code, as: 'player', name: 'Equipo Martín' });
  const j2 = await join(p2, { code, as: 'player', name: 'Equipo Rival' });
  assert(j1.ok && j1.participantId, 'participante 1 unido');
  assert(j2.ok && j2.participantId, 'participante 2 unido');
  const id1 = (j1 as Extract<JoinAck, { ok: true }>).participantId!;

  console.log(`3. Subastando a ${target.name} (${target.team})…`);
  const called = nextState(p1, (s) => s.auction.phase === 'called', 'called');
  admin.emit('auction:call', { playerId: target.id });
  await called;

  const bid1 = nextState(p1, (s) => s.auction.bids.length === 1, 'primera oferta');
  p1.emit('auction:bid', {});
  await bid1;
  const bid2 = nextState(p1, (s) => s.auction.bids.length === 2, 'rilancio p2');
  p2.emit('auction:bid', { amount: 5 });
  await bid2;
  const bid3 = nextState(p1, (s) => s.auction.bids.length === 3, 'rilancio p1');
  p1.emit('auction:bid', {});
  await bid3;

  console.log('4. Esperando que venza el countdown (2s)…');
  const sold = await nextState(p1, (s) => s.auction.phase === 'sold', 'sold');
  assert(sold.auction.winnerId === id1, 'ganó el participante 1 (última oferta)');
  const winner = sold.participants.find((p) => p.id === id1)!;
  assert(winner.roster.some((e) => e.playerId === target.id && e.price === 6), 'roster: jugador a 6 créditos');

  console.log(`5. Subasta desierta de ${target2.name}…`);
  await nextState(p1, (s) => s.auction.phase === 'idle', 'vuelta a idle');
  const unsold = nextState(p1, (s) => s.auction.phase === 'unsold', 'unsold');
  admin.emit('auction:call', { playerId: target2.id });
  const un = await unsold;
  assert(un.unsoldPlayerIds.includes(target2.id), 'jugador desierto en lista richiama');

  console.log('\n✅ SMOKE TEST OK');
  admin.close(); p1.close(); p2.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(`\n❌ ${err.message}`);
  process.exit(1);
});
