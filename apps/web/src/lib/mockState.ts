/** Motor mock local para iterar el diseño sin backend (?mock=1 o VITE_MOCK=1).
 *  Habla el mismo contrato que el server real: snapshots completos + eventos. */
import {
  DEFAULT_CONFIG,
  nextMinBid,
  validateBid,
  type JoinAck,
  type JoinPayload,
  type Player,
  type RoomEvent,
  type RoomState,
} from '@fanta/shared';
import { useStore } from '../store';

export const MOCK_CODE = 'MOCK01';

/** IDs reales del listone → las imágenes /campioncini/<id>.png funcionan si el server está. */
export const MOCK_PLAYERS: Player[] = [
  { id: 254, name: 'Dimarco', team: 'Inter', role: 'D', quotazione: 31 },
  { id: 2120, name: 'Bastoni', team: 'Inter', role: 'D', quotazione: 14 },
  { id: 5841, name: 'Svilar', team: 'Roma', role: 'P', quotazione: 19 },
  { id: 4312, name: 'Maignan', team: 'Milan', role: 'P', quotazione: 15 },
  { id: 2194, name: 'Calhanoglu', team: 'Inter', role: 'C', quotazione: 28 },
  { id: 4777, name: 'McTominay', team: 'Napoli', role: 'C', quotazione: 27 },
  { id: 2423, name: 'Pulisic', team: 'Milan', role: 'C', quotazione: 24 },
  { id: 2764, name: 'Martinez L.', team: 'Inter', role: 'A', quotazione: 33 },
  { id: 6052, name: 'Hojlund', team: 'Napoli', role: 'A', quotazione: 28 },
];

const RIVALS = [
  { id: 'mock-r1', name: 'La Scaloneta' },
  { id: 'mock-r2', name: 'Cholismo FC' },
  { id: 'mock-r3', name: 'Muchachos' },
];

const playersMap = new Map(MOCK_PLAYERS.map((p) => [p.id, p]));

let state: RoomState | null = null;
let phaseTimer: ReturnType<typeof setTimeout> | null = null;
let rivalTimer: ReturnType<typeof setTimeout> | null = null;
let selfId: string | null = null;

function freshState(): RoomState {
  return {
    code: MOCK_CODE,
    config: { ...DEFAULT_CONFIG, leagueName: 'Liga de Prueba' },
    participants: [
      {
        id: 'mock-r1',
        name: 'La Scaloneta',
        connected: true,
        roster: [{ playerId: 5841, price: 24 }],
        budgetBonus: 0,
      },
      { id: 'mock-r2', name: 'Cholismo FC', connected: true, roster: [], budgetBonus: 20 },
      {
        id: 'mock-r3',
        name: 'Muchachos',
        connected: false,
        roster: [{ playerId: 2423, price: 31 }],
        budgetBonus: 0,
      },
    ],
    // Arranca en plena puja por Dimarco: ideal para iterar el diseño en vivo.
    auction: {
      phase: 'bidding',
      playerId: 254,
      bids: [
        { participantId: 'mock-r1', amount: 20, at: Date.now() - 9000 },
        { participantId: 'mock-r2', amount: 24, at: Date.now() - 4000 },
      ],
      deadline: Date.now() + 45_000,
      pausedRemainingMs: null,
      winnerId: null,
    },
    unsoldPlayerIds: [4312],
    finishedAt: null,
    callOrder: [],
    turnIndex: null,
    serverTime: Date.now(),
  };
}

/** En modo 'turns', pasa el turno de llamada al siguiente. */
function advanceTurn(): void {
  if (!state || state.config.callMode !== 'turns' || state.callOrder.length === 0) return;
  state.turnIndex = ((state.turnIndex ?? -1) + 1) % state.callOrder.length;
}

function emptyAuction(): RoomState['auction'] {
  return {
    phase: 'idle',
    playerId: null,
    bids: [],
    deadline: null,
    pausedRemainingMs: null,
    winnerId: null,
  };
}

function push(event?: RoomEvent): void {
  if (!state) return;
  state.serverTime = Date.now();
  useStore.getState().applySnapshot(structuredClone(state), event);
}

function clearTimers(): void {
  if (phaseTimer) clearTimeout(phaseTimer);
  if (rivalTimer) clearTimeout(rivalTimer);
  phaseTimer = null;
  rivalTimer = null;
}

function scheduleExpiry(): void {
  if (phaseTimer) clearTimeout(phaseTimer);
  phaseTimer = null;
  if (!state || state.auction.deadline === null) return;
  phaseTimer = setTimeout(expire, Math.max(0, state.auction.deadline - Date.now()));
}

function backToIdle(delayMs: number): void {
  phaseTimer = setTimeout(() => {
    if (!state) return;
    state.auction = emptyAuction();
    advanceTurn();
    push();
  }, delayMs);
}

function expire(): void {
  if (!state) return;
  const a = state.auction;
  if (a.phase === 'bidding' && a.playerId !== null) {
    const last = a.bids[a.bids.length - 1];
    if (!last) return;
    a.phase = 'sold';
    a.winnerId = last.participantId;
    a.deadline = null;
    const winner = state.participants.find((p) => p.id === last.participantId);
    winner?.roster.push({ playerId: a.playerId, price: last.amount });
    push({ type: 'sold', playerId: a.playerId, participantId: last.participantId, price: last.amount });
    backToIdle(4500);
  } else if (a.phase === 'called' && a.playerId !== null) {
    const pid = a.playerId;
    a.phase = 'unsold';
    a.deadline = null;
    if (!state.unsoldPlayerIds.includes(pid)) state.unsoldPlayerIds.push(pid);
    push({ type: 'unsold', playerId: pid });
    backToIdle(3500);
  }
}

/** Un rival contraoferta a veces, para que el diseño se pueda iterar "en vivo". */
function maybeRivalBid(): void {
  if (rivalTimer) clearTimeout(rivalTimer);
  rivalTimer = null;
  if (!state || Math.random() < 0.35) return;
  rivalTimer = setTimeout(() => {
    if (!state) return;
    const a = state.auction;
    if (a.phase !== 'called' && a.phase !== 'bidding') return;
    const last = a.bids[a.bids.length - 1];
    const rivals = RIVALS.filter((r) => r.id !== last?.participantId);
    const rival = rivals[Math.floor(Math.random() * rivals.length)];
    if (!rival) return;
    doBid(rival.id, nextMinBid(state, playersMap));
  }, 800 + Math.random() * 1800);
}

function doBid(participantId: string, amount: number): void {
  if (!state) return;
  const check = validateBid(state, playersMap, participantId, amount);
  if (!check.ok) {
    if (participantId === selfId) {
      useStore.getState().flashError({ code: check.reason, message: 'Oferta rechazada (mock)' });
    }
    return;
  }
  const a = state.auction;
  a.bids.push({ participantId, amount, at: Date.now() });
  a.phase = 'bidding';
  a.deadline = Date.now() + state.config.bidTimerSeconds * 1000;
  const bid = a.bids[a.bids.length - 1];
  push(bid ? { type: 'bid', bid } : undefined);
  scheduleExpiry();
  maybeRivalBid();
}

export const mockEngine = {
  join(payload: JoinPayload): JoinAck {
    if (!state) {
      state = freshState();
      scheduleExpiry();
      maybeRivalBid();
    }
    let participantId: string | undefined;
    if (payload.as === 'player') {
      const existing = state.participants.find((p) => p.id === payload.participantId);
      if (existing) {
        existing.connected = true;
        participantId = existing.id;
      } else {
        participantId = `mock-yo-${Math.random().toString(36).slice(2, 8)}`;
        state.participants.push({
          id: participantId,
          name: payload.name ?? 'Mi Equipo',
          connected: true,
          roster: [],
          budgetBonus: 0,
        });
      }
      selfId = participantId;
    }
    push(participantId ? { type: 'joined', participantId } : undefined);
    return { ok: true, state: structuredClone(state), participantId };
  },

  call(playerId: number): void {
    if (!state) return;
    clearTimers();
    state.auction = {
      ...emptyAuction(),
      phase: 'called',
      playerId,
      deadline:
        state.config.callTimerSeconds > 0
          ? Date.now() + state.config.callTimerSeconds * 1000
          : null,
    };
    push({ type: 'called', playerId });
    scheduleExpiry();
    maybeRivalBid();
  },

  bid(amount?: number): void {
    if (!state || !selfId) return;
    doBid(selfId, amount ?? nextMinBid(state, playersMap));
  },

  cancel(): void {
    if (!state || state.auction.playerId === null) return;
    const pid = state.auction.playerId;
    clearTimers();
    state.auction = emptyAuction();
    push({ type: 'cancelled', playerId: pid });
  },

  pause(): void {
    if (!state || state.auction.pausedRemainingMs !== null) return;
    const a = state.auction;
    if (a.phase !== 'called' && a.phase !== 'bidding') return;
    clearTimers();
    a.pausedRemainingMs = a.deadline !== null ? Math.max(0, a.deadline - Date.now()) : 0;
    a.deadline = null;
    push({ type: 'paused' });
  },

  resume(): void {
    const remaining = state?.auction.pausedRemainingMs;
    if (!state || remaining === null || remaining === undefined) return;
    const a = state.auction;
    a.deadline = remaining > 0 ? Date.now() + remaining : null;
    a.pausedRemainingMs = null;
    push({ type: 'resumed' });
    scheduleExpiry();
    maybeRivalBid();
  },

  setBid(amount: number): void {
    if (!state) return;
    const last = state.auction.bids[state.auction.bids.length - 1];
    if (!last || amount <= 0) return;
    last.amount = Math.floor(amount);
    push({ type: 'bid_amount_set', amount: last.amount });
  },

  budget(participantId: string, delta: number): void {
    if (!state || !Number.isFinite(delta) || delta === 0) return;
    const p = state.participants.find((x) => x.id === participantId);
    if (!p) return;
    p.budgetBonus += Math.trunc(delta);
    push({ type: 'budget_adjusted', participantId, delta: Math.trunc(delta) });
  },

  drawOrder(): void {
    if (!state) return;
    const order = state.participants.map((p) => p.id);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const a = order[i];
      const b = order[j];
      if (a !== undefined && b !== undefined) {
        order[i] = b;
        order[j] = a;
      }
    }
    state.callOrder = order;
    state.turnIndex = state.config.callMode === 'turns' && order.length > 0 ? 0 : null;
    push({ type: 'order_drawn', order });
  },

  skipTurn(): void {
    if (!state || state.turnIndex === null) return;
    advanceTurn();
    const current = state.callOrder[state.turnIndex ?? 0];
    push(current ? { type: 'turn', participantId: current } : undefined);
  },

  finish(): void {
    if (!state || state.finishedAt !== null) return;
    clearTimers();
    state.auction = emptyAuction();
    state.finishedAt = Date.now();
    push({ type: 'finished' });
  },

  close(): void {
    if (!state) return;
    const a = state.auction;
    if (a.phase === 'bidding') {
      clearTimers();
      expire();
    } else if (a.phase === 'called' && a.playerId !== null) {
      clearTimers();
      const pid = a.playerId;
      a.phase = 'unsold';
      a.deadline = null;
      if (!state.unsoldPlayerIds.includes(pid)) state.unsoldPlayerIds.push(pid);
      push({ type: 'unsold', playerId: pid });
      backToIdle(3500);
    }
  },

  kick(participantId: string): void {
    if (!state) return;
    const p = state.participants.find((x) => x.id === participantId);
    if (!p || p.roster.length > 0) return;
    state.participants = state.participants.filter((x) => x.id !== participantId);
    push({ type: 'kicked', participantId });
  },

  assign(playerId: number, participantId: string, price: number): void {
    if (!state) return;
    const a = state.auction;
    if (a.playerId === playerId && (a.phase === 'called' || a.phase === 'bidding')) return;
    for (const p of state.participants) {
      p.roster = p.roster.filter((e) => e.playerId !== playerId);
    }
    const target = state.participants.find((p) => p.id === participantId);
    if (!target) return;
    target.roster.push({ playerId, price });
    state.unsoldPlayerIds = state.unsoldPlayerIds.filter((id) => id !== playerId);
    push({ type: 'assigned', playerId, participantId, price });
  },

  unassign(playerId: number): void {
    if (!state) return;
    for (const p of state.participants) {
      p.roster = p.roster.filter((e) => e.playerId !== playerId);
    }
    push({ type: 'unassigned', playerId });
  },

  config(partial: Partial<import('@fanta/shared').RoomConfig>): void {
    if (!state) return;
    state.config = { ...state.config, ...partial };
    push({ type: 'config' });
  },
};
