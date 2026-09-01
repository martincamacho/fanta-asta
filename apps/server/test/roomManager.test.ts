import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RoomManager } from '../src/engine/roomManager.js';
import { FakeClock, makePlayers } from './helpers.js';

describe('RoomManager', () => {
  it('genera códigos de 6 chars sin caracteres ambiguos y adminToken uuid', () => {
    const manager = new RoomManager({ players: makePlayers(), dbPath: ':memory:', clock: new FakeClock() });
    for (let i = 0; i < 20; i++) {
      const { code, adminToken } = manager.createRoom();
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
      expect(code).not.toMatch(/[01OIL]/);
      expect(adminToken).toMatch(/^[0-9a-f-]{36}$/);
      expect(manager.verifyAdmin(code, adminToken)).toBe(true);
      expect(manager.verifyAdmin(code, 'otro')).toBe(false);
    }
    manager.close();
  });

  it('persiste snapshots (con debounce) y restaura salas de <24h al bootear', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fanta-db-'));
    const dbPath = path.join(dir, 'fanta.sqlite');

    const clock = new FakeClock();
    const m1 = new RoomManager({ players: makePlayers(), dbPath, clock });
    const { code, room } = m1.createRoom({ leagueName: 'Liga Test', budget: 300 });

    const join = room.join(undefined, 'Ana');
    if (!join.ok) throw new Error('join failed');
    room.call(101);
    room.bid(join.participantId, 5);
    clock.advance(250); // dispara el debounce de guardado (~200ms)
    m1.close();

    // Reboot: mismo archivo, manager nuevo
    const clock2 = new FakeClock();
    const m2 = new RoomManager({ players: makePlayers(), dbPath, clock: clock2 });
    expect(m2.restore()).toBe(1);

    const restored = m2.getRoom(code)!;
    expect(restored.state.config).toMatchObject({ leagueName: 'Liga Test', budget: 300 });
    const ana = restored.state.participants.find((p) => p.name === 'Ana')!;
    expect(ana.id).toBe(join.participantId);
    expect(ana.connected).toBe(false); // tras el reboot nadie está conectado
    expect(restored.state.auction.phase).toBe('bidding');
    expect(restored.state.auction.bids).toHaveLength(1);

    // El timer de la puja restaurada se re-arma y la subasta se resuelve sola
    clock2.advance(restored.state.auction.deadline! + 1);
    expect(restored.state.auction.phase).toBe('sold');
    m2.close();
  });

  it('no restaura salas con más de 24h sin actividad', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fanta-db-'));
    const dbPath = path.join(dir, 'fanta.sqlite');

    const clock = new FakeClock();
    const m1 = new RoomManager({ players: makePlayers(), dbPath, clock });
    m1.createRoom();
    m1.close();

    const clock2 = new FakeClock();
    clock2.advance(25 * 60 * 60 * 1000); // "reboot" 25h después
    const m2 = new RoomManager({ players: makePlayers(), dbPath, clock: clock2 });
    expect(m2.restore()).toBe(0);
    m2.close();
  });
});
