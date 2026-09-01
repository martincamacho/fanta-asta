import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import {
  BID_REJECT_MESSAGES,
  type ClientToServerEvents,
  type JoinAck,
  type JoinPayload,
  type Player,
  type RoomConfig,
  type ServerToClientEvents,
} from '@fanta/shared';
import { ENGINE_ERROR_MESSAGES, validateConfigRanges, type Room } from './engine/room.js';
import { DEFAULT_DB_PATH, RoomManager, mergeRoomConfig } from './engine/roomManager.js';
import { DATA_DIR, loadListone, parseCustomListone, playersById } from './data/listone.js';
import { loadProfiles } from './data/profiles.js';
import { buildRoseCsv, buildRoseXlsx } from './export/rose.js';
import { openDatabase } from './db.js';
import { LeagueStore } from './leagues/store.js';
import { registerLeagueRoutes } from './leagues/routes.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CAMPIONCINI_DIR = path.join(DATA_DIR, 'campioncini');
const WEB_DIST = path.resolve(HERE, '../../web/dist');

interface SocketData {
  code?: string;
  as?: JoinPayload['as'];
  participantId?: string;
}

type IoServer = SocketIOServer<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type IoSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

export interface CreateServerOptions {
  dbPath?: string;
  listonePath?: string;
  profilesPath?: string;
  logger?: boolean;
}

export interface FantaServer {
  app: FastifyInstance;
  io: IoServer;
  manager: RoomManager;
  store: LeagueStore;
  players: Player[];
}

export async function createServer(opts: CreateServerOptions = {}): Promise<FantaServer> {
  const players = loadListone(opts.listonePath);
  const byId = playersById(players);
  const dbPath = opts.dbPath ?? process.env.DB_PATH ?? DEFAULT_DB_PATH;
  const db = openDatabase(dbPath);
  const manager = new RoomManager({ players: byId, db, dbPath });
  const store = new LeagueStore(db);
  const restored = manager.restore();
  manager.startBackups(Number(process.env.BACKUP_INTERVAL_MS) || 10 * 60 * 1000);

  const app = Fastify({ logger: opts.logger ?? false });
  if (restored > 0) app.log.info(`Restauradas ${restored} salas desde SQLite`);
  const profiles = loadProfiles(opts.profilesPath, (msg) => app.log.warn(msg));

  await app.register(fastifyCors, { origin: true, credentials: true });
  await app.register(fastifyCookie);

  // Campioncini (imágenes de jugadores)
  await app.register(fastifyStatic, {
    root: CAMPIONCINI_DIR,
    prefix: '/campioncini/',
    decorateReply: !existsSync(WEB_DIST),
  });

  // SPA (si el frontend está buildeado)
  if (existsSync(WEB_DIST)) {
    await app.register(fastifyStatic, { root: WEB_DIST, prefix: '/' });
    app.setNotFoundHandler((req, reply) => {
      const url = req.raw.url ?? '';
      if (
        req.method === 'GET' &&
        !url.startsWith('/api') &&
        !url.startsWith('/campioncini') &&
        !url.startsWith('/socket.io')
      ) {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: 'not found' });
    });
  }

  // ── REST ────────────────────────────────────────────────────────────────

  app.post('/api/rooms', async (req, reply) => {
    const body = (req.body ?? {}) as { config?: Partial<RoomConfig> };
    const rangeError = validateConfigRanges(mergeRoomConfig(body.config));
    if (rangeError !== null) return reply.code(400).send({ error: rangeError });
    const { code, adminToken } = manager.createRoom(body.config);
    return { code, adminToken };
  });

  // Listone propio de la sala (CSV subido por el admin).
  app.post('/api/rooms/:code/listone', async (req, reply) => {
    const code = (req.params as { code: string }).code.toUpperCase();
    const room = manager.getRoom(code);
    if (!room) return reply.code(404).send({ error: 'La sala no existe' });
    const body = (req.body ?? {}) as { adminToken?: unknown; csv?: unknown };
    if (!manager.verifyAdmin(code, typeof body.adminToken === 'string' ? body.adminToken : undefined)) {
      return reply.code(403).send({ error: 'Token de admin inválido' });
    }
    if (typeof body.csv !== 'string' || !body.csv.trim()) {
      return reply.code(400).send({ error: 'Falta el CSV del listone' });
    }
    const parsed = parseCustomListone(body.csv);
    if (parsed.length < 10) {
      return reply.code(400).send({ error: `Listone inválido: solo ${parsed.length} jugadores válidos (mínimo 10)` });
    }
    if (parsed.length > 2000) {
      return reply.code(400).send({ error: 'Listone inválido: más de 2000 jugadores' });
    }
    const r = room.setListone(parsed);
    if (!r.ok) return reply.code(409).send({ error: ENGINE_ERROR_MESSAGES[r.error] });
    return { count: r.count };
  });

  // Listone efectivo de la sala (propio si subió CSV, global si no).
  app.get('/api/rooms/:code/players', async (req, reply) => {
    const code = (req.params as { code: string }).code.toUpperCase();
    const room = manager.getRoom(code);
    if (!room) return reply.code(404).send({ error: 'La sala no existe' });
    return room.customListone ?? players;
  });

  app.get('/api/rooms/:code', async (req) => {
    const { code } = req.params as { code: string };
    const upper = code.toUpperCase();
    const room = manager.getRoom(upper);
    if (!room) return { exists: false };
    const league = store.leagueForRoom(upper);
    return {
      exists: true,
      leagueName: room.state.config.leagueName,
      ...(league ? { leagueId: league.id } : {}),
    };
  });

  app.get('/api/players', async () => players);

  app.get('/api/players/:id/profile', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const profile = Number.isInteger(id) ? profiles.get(id) : undefined;
    if (!profile) return reply.code(404).send({ error: 'No hay ficha para ese jugador' });
    return profile;
  });

  // Export de rosas compatible con el import de Leghe Fantacalcio.
  // Público: con saber el código alcanza (como el tablero).
  app.get('/api/rooms/:code/export/rose.csv', async (req, reply) => {
    const code = (req.params as { code: string }).code.toUpperCase();
    const room = manager.getRoom(code);
    if (!room) return reply.code(404).send({ error: 'La sala no existe' });
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="rose-${code}.csv"`)
      .send(buildRoseCsv(room.state, room.effectivePlayers));
  });

  app.get('/api/rooms/:code/export/rose.xlsx', async (req, reply) => {
    const code = (req.params as { code: string }).code.toUpperCase();
    const room = manager.getRoom(code);
    if (!room) return reply.code(404).send({ error: 'La sala no existe' });
    const buffer = await buildRoseXlsx(room.state, room.effectivePlayers);
    return reply
      .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('content-disposition', `attachment; filename="rose-${code}.xlsx"`)
      .send(buffer);
  });

  registerLeagueRoutes(app, { store, manager });

  // ── Socket.IO ───────────────────────────────────────────────────────────

  const io: IoServer = new SocketIOServer(app.server, {
    cors: { origin: true },
  });

  manager.onChange = (code, state, event) => {
    io.to(code).emit('room:state', { state, event });
  };

  // Cuántos sockets vivos tiene cada participante (varias pestañas / reconexión).
  const liveSockets = new Map<string, number>();
  const connKey = (code: string, participantId: string) => `${code}:${participantId}`;

  const requireRoom = (socket: IoSocket): Room | undefined => {
    const code = socket.data.code;
    const room = code ? manager.getRoom(code) : undefined;
    if (!room) socket.emit('room:error', { code: 'bad_request', message: 'No estás en ninguna sala' });
    return room;
  };

  const requireAdmin = (socket: IoSocket): Room | undefined => {
    const room = requireRoom(socket);
    if (!room) return undefined;
    if (socket.data.as !== 'admin') {
      socket.emit('room:error', { code: 'not_admin', message: 'Solo el admin puede hacer eso' });
      return undefined;
    }
    return room;
  };

  io.on('connection', (socket: IoSocket) => {
    socket.on('room:join', (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : (_: JoinAck) => undefined;
      if (!payload || typeof payload.code !== 'string') {
        return reply({ ok: false, error: 'Pedido inválido' });
      }
      const code = payload.code.toUpperCase();
      const room = manager.getRoom(code);
      if (!room) return reply({ ok: false, error: 'La sala no existe' });

      if (payload.as === 'admin') {
        if (!manager.verifyAdmin(code, payload.adminToken)) {
          return reply({ ok: false, error: 'Token de admin inválido' });
        }
        socket.data = { code, as: 'admin' };
        void socket.join(code);
        return reply({ ok: true, state: room.snapshot() });
      }

      if (payload.as === 'board') {
        socket.data = { code, as: 'board' };
        void socket.join(code);
        return reply({ ok: true, state: room.snapshot() });
      }

      if (payload.as === 'player') {
        const result = room.join(payload.participantId, payload.name);
        if (!result.ok) {
          return reply({ ok: false, error: ENGINE_ERROR_MESSAGES[result.error] });
        }
        socket.data = { code, as: 'player', participantId: result.participantId };
        void socket.join(code);
        const key = connKey(code, result.participantId);
        liveSockets.set(key, (liveSockets.get(key) ?? 0) + 1);
        return reply({ ok: true, state: room.snapshot(), participantId: result.participantId });
      }

      return reply({ ok: false, error: 'Rol de acceso inválido' });
    });

    socket.on('auction:call', (payload) => {
      const room = requireRoom(socket);
      if (!room) return;
      if (!payload || typeof payload.playerId !== 'number') {
        return socket.emit('room:error', { code: 'bad_request', message: 'playerId inválido' });
      }
      const { as, participantId } = socket.data;
      let r;
      if (as === 'admin') {
        r = room.call(payload.playerId); // el admin siempre puede (override)
      } else if (as === 'player' && participantId) {
        r = room.call(payload.playerId, participantId); // válido solo en su turno (callMode 'turns')
      } else {
        return socket.emit('room:error', { code: 'not_admin', message: 'Solo el admin puede hacer eso' });
      }
      if (!r.ok) socket.emit('room:error', { code: 'bad_request', message: ENGINE_ERROR_MESSAGES[r.error] });
    });

    socket.on('order:draw', () => {
      const room = requireAdmin(socket);
      if (!room) return;
      const r = room.drawOrder();
      if (!r.ok) socket.emit('room:error', { code: 'bad_request', message: ENGINE_ERROR_MESSAGES[r.error] });
    });

    socket.on('turn:skip', () => {
      const room = requireAdmin(socket);
      if (!room) return;
      const r = room.skipTurn();
      if (!r.ok) socket.emit('room:error', { code: 'bad_request', message: ENGINE_ERROR_MESSAGES[r.error] });
    });

    socket.on('auction:bid', (payload) => {
      const room = requireRoom(socket);
      if (!room) return;
      const { as, participantId } = socket.data;
      if (as !== 'player' || !participantId) {
        return socket.emit('room:error', { code: 'bad_request', message: 'Solo los participantes pueden ofertar' });
      }
      const amount = payload?.amount;
      if (amount !== undefined && typeof amount !== 'number') {
        return socket.emit('room:error', { code: 'bad_request', message: 'Monto inválido' });
      }
      const r = room.bid(participantId, amount);
      if (!r.ok) {
        socket.emit('room:error', { code: r.reason, message: BID_REJECT_MESSAGES[r.reason] });
      }
    });

    socket.on('auction:cancel', () => {
      const room = requireAdmin(socket);
      if (!room) return;
      const r = room.cancel();
      if (!r.ok) socket.emit('room:error', { code: 'bad_request', message: ENGINE_ERROR_MESSAGES[r.error] });
    });

    socket.on('auction:close', () => {
      const room = requireAdmin(socket);
      if (!room) return;
      const r = room.close();
      if (!r.ok) socket.emit('room:error', { code: 'bad_request', message: ENGINE_ERROR_MESSAGES[r.error] });
    });

    socket.on('auction:pause', () => {
      const room = requireAdmin(socket);
      if (!room) return;
      const r = room.pause();
      if (!r.ok) socket.emit('room:error', { code: 'bad_request', message: ENGINE_ERROR_MESSAGES[r.error] });
    });

    socket.on('auction:resume', () => {
      const room = requireAdmin(socket);
      if (!room) return;
      const r = room.resume();
      if (!r.ok) socket.emit('room:error', { code: 'bad_request', message: ENGINE_ERROR_MESSAGES[r.error] });
    });

    socket.on('room:finish', () => {
      const room = requireAdmin(socket);
      if (!room) return;
      const r = room.finish();
      if (!r.ok) socket.emit('room:error', { code: 'bad_request', message: ENGINE_ERROR_MESSAGES[r.error] });
    });

    socket.on('admin:kick', (payload) => {
      const room = requireAdmin(socket);
      if (!room) return;
      if (!payload || typeof payload.participantId !== 'string') {
        return socket.emit('room:error', { code: 'bad_request', message: 'participantId inválido' });
      }
      const r = room.kick(payload.participantId);
      if (!r.ok) socket.emit('room:error', { code: 'bad_request', message: ENGINE_ERROR_MESSAGES[r.error] });
    });

    socket.on('admin:setBid', (payload) => {
      const room = requireAdmin(socket);
      if (!room) return;
      if (!payload || typeof payload.amount !== 'number') {
        return socket.emit('room:error', { code: 'bad_request', message: 'Monto inválido' });
      }
      const r = room.setBidAmount(payload.amount);
      if (!r.ok) socket.emit('room:error', { code: 'bad_request', message: ENGINE_ERROR_MESSAGES[r.error] });
    });

    socket.on('admin:budget', (payload) => {
      const room = requireAdmin(socket);
      if (!room) return;
      if (!payload || typeof payload.participantId !== 'string' || typeof payload.delta !== 'number') {
        return socket.emit('room:error', { code: 'bad_request', message: 'Ajuste inválido' });
      }
      const r = room.adjustBudget(payload.participantId, payload.delta);
      if (!r.ok) socket.emit('room:error', { code: 'bad_request', message: ENGINE_ERROR_MESSAGES[r.error] });
    });

    socket.on('admin:assign', (payload) => {
      const room = requireAdmin(socket);
      if (!room) return;
      if (
        !payload ||
        typeof payload.playerId !== 'number' ||
        typeof payload.participantId !== 'string' ||
        typeof payload.price !== 'number'
      ) {
        return socket.emit('room:error', { code: 'bad_request', message: 'Asignación inválida' });
      }
      const r = room.assign(payload.playerId, payload.participantId, payload.price);
      if (!r.ok) socket.emit('room:error', { code: 'bad_request', message: ENGINE_ERROR_MESSAGES[r.error] });
    });

    socket.on('admin:unassign', (payload) => {
      const room = requireAdmin(socket);
      if (!room) return;
      if (!payload || typeof payload.playerId !== 'number') {
        return socket.emit('room:error', { code: 'bad_request', message: 'playerId inválido' });
      }
      const r = room.unassign(payload.playerId);
      if (!r.ok) socket.emit('room:error', { code: 'bad_request', message: ENGINE_ERROR_MESSAGES[r.error] });
    });

    socket.on('admin:config', (payload) => {
      const room = requireAdmin(socket);
      if (!room) return;
      if (!payload || typeof payload !== 'object') {
        return socket.emit('room:error', { code: 'bad_request', message: 'Configuración inválida' });
      }
      const r = room.updateConfig(payload);
      if (!r.ok) socket.emit('room:error', { code: 'bad_request', message: ENGINE_ERROR_MESSAGES[r.error] });
    });

    socket.on('disconnect', () => {
      const { code, as, participantId } = socket.data;
      if (!code || as !== 'player' || !participantId) return;
      const key = connKey(code, participantId);
      const remaining = (liveSockets.get(key) ?? 1) - 1;
      if (remaining <= 0) {
        liveSockets.delete(key);
        manager.getRoom(code)?.disconnect(participantId);
      } else {
        liveSockets.set(key, remaining);
      }
    });
  });

  app.addHook('onClose', async () => {
    await new Promise<void>((resolve) => {
      io.close(() => resolve());
    });
    await manager.close(); // flush + backup de despedida; no cierra la db compartida
    db.close();
  });

  return { app, io, manager, store, players };
}
