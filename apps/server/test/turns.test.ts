import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, type RoomConfig, type RoomState } from '@fanta/shared';
import { ENGINE_ERROR_MESSAGES } from '../src/engine/room.js';
import { migrateState } from '../src/engine/roomManager.js';
import { joinPlayer, makeRoom, type TestRoom } from './helpers.js';

/** Sala en modo turnos con N participantes y sorteo hecho. */
function turnsRoom(
  n: number,
  configPatch: Partial<RoomConfig> = {},
): TestRoom & { ids: string[]; order: string[] } {
  const t = makeRoom({ callMode: 'turns', ...configPatch });
  const ids = Array.from({ length: n }, (_, i) => joinPlayer(t.room, `Equipo${i + 1}`));
  expect(t.room.drawOrder()).toEqual({ ok: true });
  return { ...t, ids, order: [...t.room.state.callOrder] };
}

describe('sorteo del orden (order:draw)', () => {
  it('baraja todos los ids, arranca la ronda en turns y es re-sorteable', () => {
    const { room, ids, order, events } = turnsRoom(4);

    expect([...order].sort()).toEqual([...ids].sort()); // permutación exacta
    expect(room.state.turnIndex).toBe(0);
    expect(events.find((e) => e?.type === 'order_drawn')).toEqual({ type: 'order_drawn', order });
    expect(events.find((e) => e?.type === 'turn')).toEqual({ type: 'turn', participantId: order[0] });

    // re-sorteo permitido sin subasta activa
    expect(room.drawOrder()).toEqual({ ok: true });
    expect([...room.state.callOrder].sort()).toEqual([...ids].sort());
    expect(room.state.turnIndex).toBe(0);
  });

  it('en callMode admin el sorteo es solo informativo: turnIndex queda null y no hay evento turn', () => {
    const { room, events } = makeRoom(); // callMode 'admin' (default)
    joinPlayer(room, 'Ana');
    joinPlayer(room, 'Beto');
    expect(room.drawOrder()).toEqual({ ok: true });
    expect(room.state.callOrder).toHaveLength(2);
    expect(room.state.turnIndex).toBeNull();
    expect(events.find((e) => e?.type === 'order_drawn')).toBeTruthy();
    expect(events.find((e) => e?.type === 'turn')).toBeUndefined();
  });

  it('no se sortea sin participantes, con subasta activa ni con el asta terminada', () => {
    const empty = makeRoom({ callMode: 'turns' });
    expect(empty.room.drawOrder()).toEqual({ ok: false, error: 'no_participants' });

    const { room } = turnsRoom(2);
    room.call(101, room.state.callOrder[room.state.turnIndex!]);
    expect(room.drawOrder()).toEqual({ ok: false, error: 'auction_in_progress' });
    room.cancel();

    room.finish();
    expect(room.drawOrder()).toEqual({ ok: false, error: 'finished' });
  });
});

describe('modo por turnos (callMode turns)', () => {
  it('el participante de turno puede llamar; fuera de turno no; el admin siempre', () => {
    const { room, order } = turnsRoom(3);
    const [holder, other] = [order[0]!, order[1]!];

    expect(room.call(101, other)).toEqual({ ok: false, error: 'not_your_turn' });
    expect(room.call(101, 'fantasma')).toEqual({ ok: false, error: 'unknown_participant' });
    expect(room.state.auction.phase).toBe('idle'); // los rechazos no llamaron nada

    expect(room.call(101, holder)).toEqual({ ok: true });
    room.cancel();

    // admin (sin callerParticipantId): override siempre, sea de quien sea el turno
    expect(room.call(102)).toEqual({ ok: true });
  });

  it("sin sorteo hecho, un participante que llama recibe 'no_order' con mensaje claro", () => {
    const { room } = makeRoom({ callMode: 'turns' });
    const ana = joinPlayer(room, 'Ana');
    expect(room.call(101, ana)).toEqual({ ok: false, error: 'no_order' });
    expect(ENGINE_ERROR_MESSAGES.no_order).toBe('Primero hay que sortear el orden');
  });

  it('en callMode admin un participante nunca puede llamar', () => {
    const { room } = makeRoom(); // admin mode
    const ana = joinPlayer(room, 'Ana');
    room.drawOrder();
    expect(room.call(101, ana)).toEqual({ ok: false, error: 'not_allowed_to_call' });
  });

  it('el turno avanza circularmente tras sold y tras unsold; cancel NO avanza', () => {
    const { room, clock, order, events } = turnsRoom(3);
    const [h0, h1, h2] = order as [string, string, string];

    // cancel mantiene el turno
    room.call(101, h0);
    room.cancel();
    expect(room.state.turnIndex).toBe(0);

    // sold → avanza a h1
    room.call(101, h0);
    room.bid(h1, 1);
    clock.advance(5_000);
    expect(room.state.auction.phase).toBe('sold');
    expect(room.state.turnIndex).toBe(1);
    expect(events.filter((e) => e?.type === 'turn').at(-1)).toEqual({ type: 'turn', participantId: h1 });

    // unsold → avanza a h2 (h1 llama durante la animación de sold: corta el timer)
    room.call(102, h1);
    clock.advance(20_000);
    expect(room.state.auction.phase).toBe('unsold');
    expect(room.state.turnIndex).toBe(2);

    // otro sold → vuelve circular al 0
    room.call(103, h2);
    room.bid(h0, 1);
    clock.advance(5_000);
    expect(room.state.turnIndex).toBe(0);
    expect(events.filter((e) => e?.type === 'turn').at(-1)).toEqual({ type: 'turn', participantId: h0 });
  });

  it('al avanzar saltea a los participantes con todos los cupos llenos', () => {
    const { room, clock, order } = turnsRoom(3, { slots: { P: 2, D: 0, C: 0, A: 0 }, budget: 20 });
    const [h0, h1, h2] = order as [string, string, string];

    // h1 se llena por asignación manual
    room.assign(102, h1, 1);
    room.assign(103, h1, 1);

    room.call(101, h0);
    room.bid(h2, 1);
    clock.advance(5_000); // sold a h2
    expect(room.state.turnIndex).toBe(2); // salteó a h1 (lleno)
  });

  it("turn:skip avanza sin subasta (salteando llenos); errores en admin mode y sin sorteo", () => {
    const { room, order, events } = turnsRoom(3, { slots: { P: 1, D: 0, C: 0, A: 0 } });
    const [, h1] = order as [string, string, string];

    expect(room.skipTurn()).toEqual({ ok: true });
    expect(room.state.turnIndex).toBe(1);
    expect(events.filter((e) => e?.type === 'turn').at(-1)).toEqual({ type: 'turn', participantId: h1 });

    // con h2 lleno, el skip desde 1 saltea al 0
    room.assign(102, order[2]!, 1);
    expect(room.skipTurn()).toEqual({ ok: true });
    expect(room.state.turnIndex).toBe(0);

    // no se saltea con subasta activa
    room.call(101, order[0]);
    expect(room.skipTurn()).toEqual({ ok: false, error: 'auction_in_progress' });
    room.cancel();

    const adminMode = makeRoom();
    joinPlayer(adminMode.room, 'Ana');
    expect(adminMode.room.skipTurn()).toEqual({ ok: false, error: 'not_turns_mode' });

    const undrawn = makeRoom({ callMode: 'turns' });
    joinPlayer(undrawn.room, 'Ana');
    expect(undrawn.room.skipTurn()).toEqual({ ok: false, error: 'no_order' });
  });

  it('quien se une después del sorteo va al FINAL de callOrder (sin re-sortear)', () => {
    const { room, order } = turnsRoom(2);
    const dani = joinPlayer(room, 'Dani');
    expect(room.state.callOrder).toEqual([...order, dani]);
    expect(room.state.turnIndex).toBe(0); // el turno no se mueve

    // sin sorteo previo, un join no inventa un orden
    const fresh = makeRoom({ callMode: 'turns' });
    joinPlayer(fresh.room, 'Ana');
    expect(fresh.room.state.callOrder).toEqual([]);
  });

  it('kick saca del callOrder y ajusta turnIndex (antes del turno, el de turno, y con wrap)', () => {
    const { room, order, events } = turnsRoom(4);
    const [o0, o1, o2, o3] = order as [string, string, string, string];

    room.skipTurn();
    room.skipTurn(); // turno en o2
    expect(room.state.turnIndex).toBe(2);

    // kick de uno ANTERIOR al turno: el índice se corre, el holder no cambia
    expect(room.kick(o0)).toEqual({ ok: true });
    expect(room.state.callOrder).toEqual([o1, o2, o3]);
    expect(room.state.turnIndex).toBe(1);
    expect(room.state.callOrder[room.state.turnIndex!]).toBe(o2);

    // kick DEL que tiene el turno: pasa al siguiente y emite 'turn'
    expect(room.kick(o2)).toEqual({ ok: true });
    expect(room.state.callOrder).toEqual([o1, o3]);
    expect(room.state.turnIndex).toBe(1); // mismo índice, ahora apunta a o3
    expect(events.filter((e) => e?.type === 'turn').at(-1)).toEqual({ type: 'turn', participantId: o3 });

    // kick del ÚLTIMO cuando tiene el turno: wrap al 0
    expect(room.kick(o3)).toEqual({ ok: true });
    expect(room.state.callOrder).toEqual([o1]);
    expect(room.state.turnIndex).toBe(0);
    expect(events.filter((e) => e?.type === 'turn').at(-1)).toEqual({ type: 'turn', participantId: o1 });
  });
});

describe('migración de snapshots pre-turnos', () => {
  it('completa callOrder [], turnIndex null y config.callMode admin', () => {
    const old = {
      code: 'VIEJA3',
      config: {
        leagueName: 'Liga Vieja',
        budget: 300,
        slots: { P: 3, D: 8, C: 8, A: 6 },
        bidTimerSeconds: 5,
        callTimerSeconds: 20,
        minIncrement: 1,
        baseBidMode: 'fixed',
        hideValues: false,
        // sin callMode
      },
      participants: [],
      auction: { phase: 'idle', playerId: null, bids: [], deadline: null, pausedRemainingMs: null, winnerId: null },
      unsoldPlayerIds: [],
      finishedAt: null,
      // sin callOrder ni turnIndex
      serverTime: 0,
    } as unknown as RoomState;

    const migrated = migrateState(old);
    expect(migrated.config.callMode).toBe(DEFAULT_CONFIG.callMode); // 'admin'
    expect(migrated.callOrder).toEqual([]);
    expect(migrated.turnIndex).toBeNull();
    expect(migrated.config.budget).toBe(300); // lo guardado sigue ganando
  });
});
