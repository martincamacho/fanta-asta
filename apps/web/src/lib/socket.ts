/** Wrapper tipado del socket. Reconexión: al reconectar re-emite room:join
 *  con el participantId guardado, y el server devuelve el snapshot completo. */
import { io, type Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  JoinPayload,
  RoomConfig,
  ServerToClientEvents,
} from '@fanta/shared';
import { useStore } from '../store';
import { persist } from './persist';
import { MOCK } from './mock';
import { mockEngine } from './mockState';

type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: AppSocket | null = null;
let joinPayload: JoinPayload | null = null;
let everConnected = false;

function doJoin(): void {
  if (!socket || !joinPayload) return;
  const store = useStore.getState();
  store.setConnection(everConnected ? 'reconnecting' : 'connecting');
  socket.emit('room:join', joinPayload, (ack) => {
    const s = useStore.getState();
    if (ack.ok) {
      everConnected = true;
      s.setJoinError(null);
      s.applySnapshot(ack.state);
      s.setConnection('connected');
      if (ack.participantId && joinPayload) {
        joinPayload = { ...joinPayload, participantId: ack.participantId };
        persist.setParticipantId(joinPayload.code, ack.participantId);
        s.setSelfId(ack.participantId);
      }
    } else {
      s.setConnection('idle');
      s.setJoinError(ack.error);
    }
  });
}

function ensureSocket(): AppSocket {
  if (socket) return socket;
  socket = io({ transports: ['websocket', 'polling'] });
  socket.on('connect', () => {
    if (joinPayload) doJoin();
  });
  socket.on('disconnect', () => {
    if (everConnected) useStore.getState().setConnection('reconnecting');
  });
  socket.io.on('reconnect_attempt', () => {
    if (everConnected) useStore.getState().setConnection('reconnecting');
  });
  socket.on('room:state', ({ state, event }) => {
    useStore.getState().applySnapshot(state, event);
    // La sala cargó un listone propio: todas las vistas pasan a usarlo.
    if (event?.type === 'listone_loaded') {
      void import('./api').then((api) => api.loadPlayers(state.code, true));
    }
  });
  socket.on('room:error', (payload) => {
    useStore.getState().flashError(payload);
  });
  return socket;
}

/** Entra (o re-entra) a una sala. Idempotente: llamalo al montar la vista. */
export function joinRoom(payload: JoinPayload): void {
  joinPayload = payload;
  if (MOCK) {
    const store = useStore.getState();
    store.setConnection('connecting');
    const ack = mockEngine.join(payload);
    if (ack.ok) {
      store.applySnapshot(ack.state);
      store.setConnection('connected');
      if (ack.participantId) {
        persist.setParticipantId(payload.code, ack.participantId);
        store.setSelfId(ack.participantId);
      }
    } else {
      store.setJoinError(ack.error);
    }
    return;
  }
  const s = ensureSocket();
  if (s.connected) doJoin();
}

/** Sale de la sala actual (al navegar fuera). */
export function leaveRoom(): void {
  joinPayload = null;
  everConnected = false;
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  useStore.getState().resetRoom();
}

export const actions = {
  call(playerId: number): void {
    if (MOCK) return mockEngine.call(playerId);
    socket?.emit('auction:call', { playerId });
  },
  /** Sin `amount` = rilancio mínimo (lo resuelve el server). */
  bid(amount?: number): void {
    if (MOCK) return mockEngine.bid(amount);
    socket?.emit('auction:bid', amount === undefined ? {} : { amount });
  },
  cancel(): void {
    if (MOCK) return mockEngine.cancel();
    socket?.emit('auction:cancel');
  },
  close(): void {
    if (MOCK) return mockEngine.close();
    socket?.emit('auction:close');
  },
  /** Pausa el countdown (las ofertas quedan bloqueadas). */
  pause(): void {
    if (MOCK) return mockEngine.pause();
    socket?.emit('auction:pause');
  },
  /** Reanuda el countdown con los ms que restaban. */
  resume(): void {
    if (MOCK) return mockEngine.resume();
    socket?.emit('auction:resume');
  },
  /** Da por terminada el asta (pantalla de resumen final). */
  finish(): void {
    if (MOCK) return mockEngine.finish();
    socket?.emit('room:finish');
  },
  /** Premi&Parla: fija el monto cantado de viva voz sobre la reserva vigente. */
  setBid(amount: number): void {
    if (MOCK) return mockEngine.setBid(amount);
    socket?.emit('admin:setBid', { amount });
  },
  /** Bonus (+) o malus (−) de créditos a un participante. */
  budget(participantId: string, delta: number): void {
    if (MOCK) return mockEngine.budget(participantId, delta);
    socket?.emit('admin:budget', { participantId, delta });
  },
  /** Sortea (o re-sortea) el orden de llamada. */
  drawOrder(): void {
    if (MOCK) return mockEngine.drawOrder();
    socket?.emit('order:draw');
  },
  /** Saltea el turno de llamada actual. */
  skipTurn(): void {
    if (MOCK) return mockEngine.skipTurn();
    socket?.emit('turn:skip');
  },
  kick(participantId: string): void {
    if (MOCK) return mockEngine.kick(participantId);
    socket?.emit('admin:kick', { participantId });
  },
  /** Ajuste manual: asigna/mueve/corrige precio. Sin validación de reglas en el server. */
  assign(playerId: number, participantId: string, price: number): void {
    if (MOCK) return mockEngine.assign(playerId, participantId, price);
    socket?.emit('admin:assign', { playerId, participantId, price });
  },
  /** Ajuste manual: quita un jugador de un roster (devuelve los créditos). */
  unassign(playerId: number): void {
    if (MOCK) return mockEngine.unassign(playerId);
    socket?.emit('admin:unassign', { playerId });
  },
  config(partial: Partial<RoomConfig>): void {
    if (MOCK) return mockEngine.config(partial);
    socket?.emit('admin:config', partial);
  },
};
