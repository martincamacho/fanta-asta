import { describe, expect, it } from 'vitest';
import { budgetRemaining } from '@fanta/shared';
import { RESULT_DISPLAY_MS } from '../src/engine/room.js';
import { joinPlayer, makeRoom } from './helpers.js';

describe('Room engine (reloj falso)', () => {
  it('flujo completo: llamada → ofertas → sold con descuento de créditos', () => {
    const { room, clock, events } = makeRoom();
    const ana = joinPlayer(room, 'Ana');
    const beto = joinPlayer(room, 'Beto');

    expect(room.call(101)).toEqual({ ok: true });
    expect(room.state.auction.phase).toBe('called');
    expect(room.state.auction.playerId).toBe(101);
    expect(room.state.auction.deadline).toBe(clock.now() + 20_000);

    // Primera oferta sin amount = mínimo (1)
    const b1 = room.bid(ana);
    expect(b1.ok).toBe(true);
    expect(room.state.auction.phase).toBe('bidding');
    expect(room.state.auction.bids[0]?.amount).toBe(1);

    const b2 = room.bid(beto, 10);
    expect(b2.ok).toBe(true);

    clock.advance(5_000); // vence el countdown de puja
    expect(room.state.auction.phase).toBe('sold');
    expect(room.state.auction.winnerId).toBe(beto);

    const winner = room.state.participants.find((p) => p.id === beto)!;
    expect(winner.roster).toEqual([{ playerId: 101, price: 10 }]);
    expect(budgetRemaining(winner, room.state.config)).toBe(490);

    const sold = events.find((e) => e?.type === 'sold');
    expect(sold).toEqual({ type: 'sold', playerId: 101, participantId: beto, price: 10 });

    // Vuelve solo a idle a los 3s
    clock.advance(RESULT_DISPLAY_MS);
    expect(room.state.auction.phase).toBe('idle');
    expect(room.state.auction.playerId).toBeNull();
  });

  it('cada rilancio reinicia el countdown', () => {
    const { room, clock } = makeRoom({ bidTimerSeconds: 5 });
    const ana = joinPlayer(room, 'Ana');
    const beto = joinPlayer(room, 'Beto');
    room.call(101);

    room.bid(ana, 1);
    clock.advance(4_000); // faltando 1s...
    room.bid(beto, 2); // ...rilancio: deadline = now + 5s
    expect(room.state.auction.deadline).toBe(clock.now() + 5_000);

    clock.advance(4_000);
    expect(room.state.auction.phase).toBe('bidding'); // el timer viejo NO vendió

    clock.advance(1_000);
    expect(room.state.auction.phase).toBe('sold');
    expect(room.state.auction.winnerId).toBe(beto);
  });

  it('called expira sin ofertas → unsold, y richiama permite re-llamarlo', () => {
    const { room, clock, events } = makeRoom({ callTimerSeconds: 20 });
    joinPlayer(room, 'Ana');
    room.call(201);

    clock.advance(20_000);
    expect(room.state.auction.phase).toBe('unsold');
    expect(room.state.unsoldPlayerIds).toEqual([201]);
    expect(events.find((e) => e?.type === 'unsold')).toEqual({ type: 'unsold', playerId: 201 });

    clock.advance(RESULT_DISPLAY_MS);
    expect(room.state.auction.phase).toBe('idle');

    // richiama: se puede volver a llamar y sale de la lista
    expect(room.call(201)).toEqual({ ok: true });
    expect(room.state.unsoldPlayerIds).toEqual([]);
    expect(room.state.auction.playerId).toBe(201);
  });

  it('callTimerSeconds = 0 → sin deadline en called (solo cierre manual)', () => {
    const { room, clock } = makeRoom({ callTimerSeconds: 0 });
    joinPlayer(room, 'Ana');
    room.call(101);
    expect(room.state.auction.deadline).toBeNull();
    clock.advance(3_600_000);
    expect(room.state.auction.phase).toBe('called');
  });

  it('ofertas inválidas se rechazan sin alterar el estado', () => {
    const { room, clock } = makeRoom({ budget: 20, slots: { P: 1, D: 1, C: 1, A: 1 } });
    const ana = joinPlayer(room, 'Ana');
    const beto = joinPlayer(room, 'Beto');

    // no_auction
    expect(room.bid(ana, 5)).toEqual({ ok: false, reason: 'no_auction' });

    room.call(101);
    // unknown_participant
    expect(room.bid('nadie', 5)).toEqual({ ok: false, reason: 'unknown_participant' });

    expect(room.bid(ana, 5).ok).toBe(true);
    const frozen = structuredClone(room.state);

    // own_bid: Ana ya tiene la vigente
    expect(room.bid(ana, 6)).toEqual({ ok: false, reason: 'own_bid' });
    // too_low
    expect(room.bid(beto, 5)).toEqual({ ok: false, reason: 'too_low' });
    expect(room.bid(beto, 4)).toEqual({ ok: false, reason: 'too_low' });
    // exceeds_max: budget 20, 4 cupos vacíos → maxBid = 20 - 3 = 17
    expect(room.bid(beto, 18)).toEqual({ ok: false, reason: 'exceeds_max' });
    // no-enteros
    expect(room.bid(beto, 6.5)).toEqual({ ok: false, reason: 'too_low' });

    // Nada cambió: mismas ofertas, mismo deadline, misma fase
    expect(room.state.auction).toEqual(frozen.auction);
    expect(room.state.participants).toEqual(frozen.participants);

    // role_full: Beto compra el único cupo P; en la siguiente subasta de P no puede ofertar
    room.bid(beto, 6);
    clock.advance(5_000 + RESULT_DISPLAY_MS); // sold a Beto + vuelta a idle
    room.call(102);
    expect(room.bid(beto, 1)).toEqual({ ok: false, reason: 'role_full' });
  });

  it('dos ofertas "simultáneas": gana la primera procesada; la otra puede rilanciar', () => {
    const { room } = makeRoom();
    const ana = joinPlayer(room, 'Ana');
    const beto = joinPlayer(room, 'Beto');
    room.call(101);

    // Llegan "a la vez" con el mismo monto: el orden de procesamiento decide
    expect(room.bid(ana, 5).ok).toBe(true);
    expect(room.bid(beto, 5)).toEqual({ ok: false, reason: 'too_low' });

    // El perdedor puede rilanciar después
    expect(room.bid(beto, 6).ok).toBe(true);
    expect(room.state.auction.bids.map((b) => b.participantId)).toEqual([ana, beto]);
  });

  it('reconexión conserva roster y presupuesto', () => {
    const { room, clock } = makeRoom();
    const ana = joinPlayer(room, 'Ana');
    room.call(101);
    room.bid(ana, 7);
    clock.advance(5_000);

    room.disconnect(ana);
    expect(room.state.participants[0]?.connected).toBe(false);

    const rejoin = room.join(ana, undefined);
    expect(rejoin).toEqual({ ok: true, participantId: ana });
    const p = room.state.participants.find((x) => x.id === ana)!;
    expect(p.connected).toBe(true);
    expect(p.roster).toEqual([{ playerId: 101, price: 7 }]);
    expect(room.state.participants).toHaveLength(1); // no duplicó el asiento
  });

  it('player nuevo sin nombre es rechazado; disconnect nunca borra', () => {
    const { room } = makeRoom();
    expect(room.join(undefined, undefined)).toEqual({ ok: false, error: 'name_required' });
    expect(room.join(undefined, '   ')).toEqual({ ok: false, error: 'name_required' });
    const ana = joinPlayer(room, 'Ana');
    room.disconnect(ana);
    expect(room.state.participants).toHaveLength(1);
  });

  it('no se puede llamar a un jugador ya vendido; sí tras unassign', () => {
    const { room, clock } = makeRoom();
    const ana = joinPlayer(room, 'Ana');
    room.call(101);
    room.bid(ana, 3);
    clock.advance(5_000 + RESULT_DISPLAY_MS);

    expect(room.call(101)).toEqual({ ok: false, error: 'already_assigned' });
    expect(room.call(999)).toEqual({ ok: false, error: 'unknown_player' });

    room.unassign(101);
    expect(room.call(101)).toEqual({ ok: true });
  });

  it('no se puede llamar con una subasta en curso', () => {
    const { room } = makeRoom();
    joinPlayer(room, 'Ana');
    room.call(101);
    expect(room.call(102)).toEqual({ ok: false, error: 'auction_in_progress' });
  });

  it('close manual: adjudica ya con ofertas, desierto sin ofertas', () => {
    const { room, clock } = makeRoom();
    const ana = joinPlayer(room, 'Ana');

    room.call(101);
    room.bid(ana, 2);
    expect(room.close()).toEqual({ ok: true });
    expect(room.state.auction.phase).toBe('sold');
    expect(room.state.participants[0]?.roster).toEqual([{ playerId: 101, price: 2 }]);

    clock.advance(RESULT_DISPLAY_MS);
    room.call(102);
    expect(room.close()).toEqual({ ok: true }); // sin ofertas → desierto
    expect(room.state.auction.phase).toBe('unsold');
    expect(room.state.unsoldPlayerIds).toEqual([102]);

    clock.advance(RESULT_DISPLAY_MS);
    expect(room.close()).toEqual({ ok: false, error: 'no_auction' });
  });

  it('cancel devuelve el jugador sin pasar por richiama', () => {
    const { room, clock, events } = makeRoom();
    const ana = joinPlayer(room, 'Ana');
    room.call(101);
    room.bid(ana, 4);

    expect(room.cancel()).toEqual({ ok: true });
    expect(room.state.auction.phase).toBe('idle');
    expect(room.state.unsoldPlayerIds).toEqual([]);
    expect(room.state.participants[0]?.roster).toEqual([]);
    expect(events.find((e) => e?.type === 'cancelled')).toEqual({ type: 'cancelled', playerId: 101 });

    // el timer viejo quedó cortado y el jugador se puede volver a llamar
    clock.advance(60_000);
    expect(room.state.auction.phase).toBe('idle');
    expect(room.call(101)).toEqual({ ok: true });

    room.cancel();
    expect(room.cancel()).toEqual({ ok: false, error: 'no_auction' });
  });

  it('updateConfig funciona antes de la primera venta y se bloquea después', () => {
    const { room, clock } = makeRoom();
    const ana = joinPlayer(room, 'Ana');

    expect(room.updateConfig({ budget: 1000, slots: { P: 2 } as never })).toEqual({ ok: true });
    expect(room.state.config.budget).toBe(1000);
    expect(room.state.config.slots).toEqual({ P: 2, D: 8, C: 8, A: 6 }); // merge parcial de slots

    room.call(101);
    room.bid(ana, 1);
    clock.advance(5_000);
    expect(room.updateConfig({ budget: 200 })).toEqual({ ok: false, error: 'config_locked' });
    expect(room.state.config.budget).toBe(1000);
  });

  it('sold/unsold quedan visibles 3s; call() durante sold corta el timer', () => {
    const { room, clock } = makeRoom();
    const ana = joinPlayer(room, 'Ana');
    room.call(101);
    room.bid(ana, 2);
    clock.advance(5_000);
    expect(room.state.auction.phase).toBe('sold');

    // El admin llama al siguiente durante la animación de sold
    expect(room.call(201)).toEqual({ ok: true });
    expect(room.state.auction.phase).toBe('called');

    // El timer de vuelta-a-idle del sold anterior no pisa la nueva subasta
    clock.advance(RESULT_DISPLAY_MS);
    expect(room.state.auction.phase).toBe('called');
    expect(room.state.auction.playerId).toBe(201);
  });

  it('kick: solo con roster vacío y sin la oferta vigente', () => {
    const { room, clock } = makeRoom();
    const ana = joinPlayer(room, 'Ana');
    const beto = joinPlayer(room, 'Beto');

    room.call(101);
    room.bid(beto, 2);
    expect(room.kick(beto)).toEqual({ ok: false, error: 'standing_bidder' });
    clock.advance(5_000 + RESULT_DISPLAY_MS); // Beto compra

    expect(room.kick(beto)).toEqual({ ok: false, error: 'roster_not_empty' });
    expect(room.kick('nadie')).toEqual({ ok: false, error: 'unknown_participant' });
    expect(room.kick(ana)).toEqual({ ok: true });
    expect(room.state.participants.map((p) => p.id)).toEqual([beto]);
  });

  describe('ajustes manuales del admin', () => {
    it('assign asigna sin validar maxBid/cupos y saca de richiama', () => {
      const { room, clock, events } = makeRoom({ budget: 10, slots: { P: 1, D: 1, C: 1, A: 1 } });
      const ana = joinPlayer(room, 'Ana');

      // 201 quedó desierto → richiama
      room.call(201);
      clock.advance(20_000 + RESULT_DISPLAY_MS);
      expect(room.state.unsoldPlayerIds).toEqual([201]);

      // Asignación manual por encima del presupuesto (el admin manda)
      expect(room.assign(201, ana, 999)).toEqual({ ok: true });
      const p = room.state.participants[0]!;
      expect(p.roster).toEqual([{ playerId: 201, price: 999 }]);
      expect(room.state.unsoldPlayerIds).toEqual([]);
      expect(events.find((e) => e?.type === 'assigned')).toEqual({
        type: 'assigned',
        playerId: 201,
        participantId: ana,
        price: 999,
      });

      // También por encima del cupo del rol
      expect(room.assign(202, ana, 1)).toEqual({ ok: true });
      expect(p.roster).toHaveLength(2);
    });

    it('assign mueve un jugador de un roster a otro y corrige precio', () => {
      const { room } = makeRoom();
      const ana = joinPlayer(room, 'Ana');
      const beto = joinPlayer(room, 'Beto');

      room.assign(101, ana, 10);
      // mover de Ana a Beto
      expect(room.assign(101, beto, 15)).toEqual({ ok: true });
      expect(room.state.participants[0]?.roster).toEqual([]);
      expect(room.state.participants[1]?.roster).toEqual([{ playerId: 101, price: 15 }]);

      // corregir precio en el mismo roster
      expect(room.assign(101, beto, 20)).toEqual({ ok: true });
      expect(room.state.participants[1]?.roster).toEqual([{ playerId: 101, price: 20 }]);
    });

    it('assign rechaza subasta activa del mismo jugador, ids inexistentes y precio negativo', () => {
      const { room } = makeRoom();
      const ana = joinPlayer(room, 'Ana');

      room.call(101);
      expect(room.assign(101, ana, 5)).toEqual({ ok: false, error: 'auction_in_progress' });
      // otro jugador sí se puede ajustar durante una subasta ajena
      expect(room.assign(201, ana, 5)).toEqual({ ok: true });
      room.cancel();

      expect(room.assign(999, ana, 5)).toEqual({ ok: false, error: 'unknown_player' });
      expect(room.assign(102, 'nadie', 5)).toEqual({ ok: false, error: 'unknown_participant' });
      expect(room.assign(102, ana, -1)).toEqual({ ok: false, error: 'invalid_price' });
    });

    it('unassign devuelve créditos y el jugador vuelve a estar disponible', () => {
      const { room, events } = makeRoom();
      const ana = joinPlayer(room, 'Ana');
      room.assign(101, ana, 100);
      const p = room.state.participants[0]!;
      expect(budgetRemaining(p, room.state.config)).toBe(400);

      expect(room.unassign(101)).toEqual({ ok: true });
      expect(p.roster).toEqual([]);
      expect(budgetRemaining(p, room.state.config)).toBe(500);
      expect(events.find((e) => e?.type === 'unassigned')).toEqual({ type: 'unassigned', playerId: 101 });

      expect(room.unassign(101)).toEqual({ ok: false, error: 'not_assigned' });
      expect(room.call(101)).toEqual({ ok: true });
    });
  });
});
