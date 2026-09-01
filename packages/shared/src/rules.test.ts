import { describe, expect, it } from 'vitest';
import { maxBid, nextMinBid, validateBid } from './rules.js';
import { DEFAULT_CONFIG, type Participant, type Player, type RoomState } from './types.js';

const players = new Map<number, Player>([
  [1, { id: 1, name: 'Svilar', team: 'Roma', role: 'P', quotazione: 19 }],
  [2, { id: 2, name: 'Dimarco', team: 'Inter', role: 'D', quotazione: 31 }],
]);

function participant(over: Partial<Participant> = {}): Participant {
  return { id: 'p1', name: 'Equipo 1', connected: true, roster: [], budgetBonus: 0, ...over };
}

function state(over: Partial<RoomState> = {}): RoomState {
  return {
    code: 'ABC123',
    config: DEFAULT_CONFIG,
    participants: [participant(), participant({ id: 'p2', name: 'Equipo 2' })],
    auction: { phase: 'bidding', playerId: 2, bids: [{ participantId: 'p2', amount: 10, at: 0 }], deadline: null, pausedRemainingMs: null, winnerId: null },
    unsoldPlayerIds: [],
    callOrder: [],
    turnIndex: null,
    finishedAt: null,
    serverTime: 0,
    ...over,
  };
}

describe('maxBid', () => {
  it('con plantilla vacía deja 1 crédito por cada cupo restante', () => {
    // 500 - (25 cupos vacíos - 1) = 476
    expect(maxBid(participant(), DEFAULT_CONFIG)).toBe(476);
  });

  it('descuenta lo gastado', () => {
    const p = participant({ roster: [{ playerId: 2, price: 100 }] });
    // budget 400, 24 cupos vacíos → 400 - 23 = 377
    expect(maxBid(p, DEFAULT_CONFIG)).toBe(377);
  });
});

describe('nextMinBid', () => {
  it('arranca en 1 sin ofertas', () => {
    const s = state({ auction: { phase: 'called', playerId: 2, bids: [], deadline: null, pausedRemainingMs: null, winnerId: null } });
    expect(nextMinBid(s)).toBe(1);
  });
  it('vigente + incremento', () => {
    expect(nextMinBid(state())).toBe(11);
  });
  it("con baseBidMode='quotazione' arranca en la cotización", () => {
    const s = state({
      config: { ...DEFAULT_CONFIG, baseBidMode: 'quotazione' },
      auction: { phase: 'called', playerId: 2, bids: [], deadline: null, pausedRemainingMs: null, winnerId: null },
    });
    expect(nextMinBid(s, players)).toBe(31); // quotazione de Dimarco
    expect(nextMinBid(s)).toBe(1); // sin el mapa de jugadores, cae a 1
  });
});

describe('validateBid', () => {
  it('acepta un rilancio válido', () => {
    expect(validateBid(state(), players, 'p1', 11)).toEqual({ ok: true });
  });

  it('rechaza si no hay subasta activa', () => {
    const s = state({ auction: { phase: 'idle', playerId: null, bids: [], deadline: null, pausedRemainingMs: null, winnerId: null } });
    expect(validateBid(s, players, 'p1', 11)).toEqual({ ok: false, reason: 'no_auction' });
  });

  it('rechaza ofertas durante la pausa', () => {
    const s = state({ auction: { phase: 'bidding', playerId: 2, bids: [{ participantId: 'p2', amount: 10, at: 0 }], deadline: null, pausedRemainingMs: 42000, winnerId: null } });
    expect(validateBid(s, players, 'p1', 11)).toEqual({ ok: false, reason: 'paused' });
  });

  it('rechaza superar tu propia oferta', () => {
    expect(validateBid(state(), players, 'p2', 11)).toEqual({ ok: false, reason: 'own_bid' });
  });

  it('rechaza oferta que no supera la vigente', () => {
    expect(validateBid(state(), players, 'p1', 10)).toEqual({ ok: false, reason: 'too_low' });
  });

  it('rechaza si excede el máximo (créditos para cupos restantes)', () => {
    expect(validateBid(state(), players, 'p1', 477)).toEqual({ ok: false, reason: 'exceeds_max' });
  });

  it('rechaza si el rol ya está lleno', () => {
    const full = participant({
      roster: Array.from({ length: 8 }, (_, i) => ({ playerId: 100 + i, price: 1 })),
    });
    const withRoles = new Map(players);
    for (let i = 0; i < 8; i++) {
      withRoles.set(100 + i, { id: 100 + i, name: `D${i}`, team: 'X', role: 'D', quotazione: 1 });
    }
    const s = state({ participants: [full, participant({ id: 'p2' })] });
    expect(validateBid(s, withRoles, 'p1', 11)).toEqual({ ok: false, reason: 'role_full' });
  });

  it('rechaza participante desconocido', () => {
    expect(validateBid(state(), players, 'ghost', 11)).toEqual({ ok: false, reason: 'unknown_participant' });
  });

  it('bonus de créditos amplía el máximo', () => {
    const p = participant({ budgetBonus: 50 });
    // (500 + 50) - 24 = 526
    expect(maxBid(p, DEFAULT_CONFIG)).toBe(526);
    const s = state({ participants: [p, participant({ id: 'p2' })] });
    expect(validateBid(s, players, 'p1', 500)).toEqual({ ok: true });
  });

  it('modo rango: min_conflict cuando comprar el rol impide los mínimos de otros', () => {
    // rosterSize 3, mínimos 1P/1D/1A (máx 2 c/u): con 1 D comprado y capacidad 3,
    // comprar OTRO D dejaría 1 lugar para cubrir P y A (faltan 2) → min_conflict.
    const config = {
      ...DEFAULT_CONFIG,
      slots: { P: 2, D: 2, C: 0, A: 2 },
      slotsMin: { P: 1, D: 1, C: 0, A: 1 },
      rosterSize: 3,
    };
    const withD = new Map(players);
    withD.set(300, { id: 300, name: 'Otro D', team: 'X', role: 'D', quotazione: 1 });
    const p = participant({ roster: [{ playerId: 300, price: 1 }] });
    const s = state({
      config,
      participants: [p, participant({ id: 'p2' })],
      auction: { phase: 'bidding', playerId: 2, bids: [{ participantId: 'p2', amount: 10, at: 0 }], deadline: null, pausedRemainingMs: null, winnerId: null },
    });
    expect(validateBid(s, withD, 'p1', 11)).toEqual({ ok: false, reason: 'min_conflict' });
    // pero comprar un P (que cubre un mínimo pendiente) sí se puede
    const sP = state({
      config,
      participants: [p, participant({ id: 'p2' })],
      auction: { phase: 'bidding', playerId: 1, bids: [{ participantId: 'p2', amount: 10, at: 0 }], deadline: null, pausedRemainingMs: null, winnerId: null },
    });
    expect(validateBid(sP, withD, 'p1', 11)).toEqual({ ok: true });
  });

  it('modo rango: roster_full al llegar a rosterSize aunque haya cupos de rol libres', () => {
    const config = { ...DEFAULT_CONFIG, slots: { P: 2, D: 2, C: 0, A: 2 }, slotsMin: { P: 1, D: 1, C: 0, A: 1 }, rosterSize: 3 };
    const withMore = new Map(players);
    withMore.set(300, { id: 300, name: 'D2', team: 'X', role: 'D', quotazione: 1 });
    withMore.set(301, { id: 301, name: 'A1', team: 'X', role: 'A', quotazione: 1 });
    const p = participant({ roster: [{ playerId: 1, price: 1 }, { playerId: 300, price: 1 }, { playerId: 301, price: 1 }] });
    const s = state({ config, participants: [p, participant({ id: 'p2' })] });
    expect(validateBid(s, withMore, 'p1', 11)).toEqual({ ok: false, reason: 'roster_full' });
  });
});
