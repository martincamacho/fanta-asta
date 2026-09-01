import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, type RoomState } from '@fanta/shared';
import { serverNow, useStore } from './store';

function snapshot(overrides: Partial<RoomState> = {}): RoomState {
  return {
    code: 'ABC123',
    config: { ...DEFAULT_CONFIG },
    participants: [],
    auction: {
      phase: 'idle',
      playerId: null,
      bids: [],
      deadline: null,
      pausedRemainingMs: null,
      winnerId: null,
    },
    unsoldPlayerIds: [],
    finishedAt: null,
    callOrder: [],
    turnIndex: null,
    serverTime: Date.now(),
    ...overrides,
  };
}

describe('store', () => {
  beforeEach(() => {
    useStore.getState().resetRoom();
    useStore.setState({ players: new Map(), playersLoaded: false });
  });

  it('applySnapshot reemplaza el estado y calcula el offset del reloj del server', () => {
    const state = snapshot({ serverTime: Date.now() + 5000 });
    useStore.getState().applySnapshot(state);
    const s = useStore.getState();
    expect(s.state).toEqual(state);
    expect(s.serverOffset).toBeGreaterThan(4900);
    expect(s.serverOffset).toBeLessThan(5100);
    expect(serverNow() - Date.now()).toBeGreaterThan(4900);
  });

  it('un snapshot con evento incrementa eventSeq (para re-disparar animaciones)', () => {
    const before = useStore.getState().eventSeq;
    useStore.getState().applySnapshot(snapshot(), { type: 'called', playerId: 254 });
    expect(useStore.getState().eventSeq).toBe(before + 1);
    expect(useStore.getState().lastEvent).toEqual({ type: 'called', playerId: 254 });
    // snapshot sin evento no re-anima ni pisa el último evento
    useStore.getState().applySnapshot(snapshot());
    expect(useStore.getState().eventSeq).toBe(before + 1);
    expect(useStore.getState().lastEvent).toEqual({ type: 'called', playerId: 254 });
  });

  it('setPlayers arma el Map del listone por id', () => {
    useStore.getState().setPlayers([
      { id: 254, name: 'Dimarco', team: 'Inter', role: 'D', quotazione: 31 },
      { id: 5841, name: 'Svilar', team: 'Roma', role: 'P', quotazione: 19 },
    ]);
    const s = useStore.getState();
    expect(s.playersLoaded).toBe(true);
    expect(s.players.get(254)?.name).toBe('Dimarco');
    expect(s.players.size).toBe(2);
  });

  it('resetRoom limpia la sala pero conserva el listone', () => {
    useStore.getState().setPlayers([{ id: 1, name: 'X', team: 'Y', role: 'A', quotazione: 1 }]);
    useStore.getState().applySnapshot(snapshot(), { type: 'config' });
    useStore.getState().setSelfId('yo');
    useStore.getState().resetRoom();
    const s = useStore.getState();
    expect(s.state).toBeNull();
    expect(s.selfId).toBeNull();
    expect(s.eventSeq).toBe(0);
    expect(s.players.size).toBe(1);
  });

  it('flashError guarda el error y sube errorSeq', () => {
    useStore.getState().flashError({ code: 'too_low', message: 'muy baja' });
    const s = useStore.getState();
    expect(s.lastError?.code).toBe('too_low');
    expect(s.errorSeq).toBe(1);
  });
});
