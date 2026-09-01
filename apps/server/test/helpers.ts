import { DEFAULT_CONFIG, type Player, type Role, type RoomConfig, type RoomEvent, type RoomState } from '@fanta/shared';
import type { Clock, TimerHandle } from '../src/engine/clock.js';
import { Room } from '../src/engine/room.js';

/** Reloj determinístico: los timeouts se disparan al avanzar el tiempo manualmente. */
export class FakeClock implements Clock {
  private t = 0;
  private nextId = 1;
  private timers = new Map<number, { at: number; fn: () => void }>();

  now(): number {
    return this.t;
  }

  setTimeout(fn: () => void, ms: number): TimerHandle {
    const id = this.nextId++;
    this.timers.set(id, { at: this.t + ms, fn });
    return id;
  }

  clearTimeout(handle: TimerHandle): void {
    this.timers.delete(handle as number);
  }

  /** Avanza el reloj disparando en orden los timers vencidos (incluidos los que se encadenan). */
  advance(ms: number): void {
    const target = this.t + ms;
    for (;;) {
      let dueId: number | null = null;
      let dueAt = Infinity;
      for (const [id, timer] of this.timers) {
        if (timer.at <= target && timer.at < dueAt) {
          dueAt = timer.at;
          dueId = id;
        }
      }
      if (dueId === null) break;
      const timer = this.timers.get(dueId)!;
      this.timers.delete(dueId);
      this.t = Math.max(this.t, timer.at);
      timer.fn();
    }
    this.t = target;
  }
}

/** Listone sintético chico: 4 P, 4 D, 4 C, 4 A. */
export function makePlayers(): Map<number, Player> {
  const players = new Map<number, Player>();
  const add = (id: number, role: Role, name: string) =>
    players.set(id, { id, name, team: 'Test FC', role, quotazione: 10 });
  add(101, 'P', 'Portiere1');
  add(102, 'P', 'Portiere2');
  add(103, 'P', 'Portiere3');
  add(104, 'P', 'Portiere4');
  add(201, 'D', 'Difensore1');
  add(202, 'D', 'Difensore2');
  add(203, 'D', 'Difensore3');
  add(204, 'D', 'Difensore4');
  add(301, 'C', 'Centro1');
  add(302, 'C', 'Centro2');
  add(303, 'C', 'Centro3');
  add(304, 'C', 'Centro4');
  add(401, 'A', 'Attaccante1');
  add(402, 'A', 'Attaccante2');
  add(403, 'A', 'Attaccante3');
  add(404, 'A', 'Attaccante4');
  return players;
}

export interface TestRoom {
  room: Room;
  clock: FakeClock;
  players: Map<number, Player>;
  events: Array<RoomEvent | undefined>;
  states: RoomState[];
  config: RoomConfig;
}

export function makeRoom(configPatch: Partial<RoomConfig> = {}): TestRoom {
  const clock = new FakeClock();
  const players = makePlayers();
  const config: RoomConfig = {
    ...DEFAULT_CONFIG,
    bidTimerSeconds: 5,
    callTimerSeconds: 20,
    ...configPatch,
    slots: { ...DEFAULT_CONFIG.slots, ...(configPatch.slots ?? {}) },
  };
  const events: Array<RoomEvent | undefined> = [];
  const states: RoomState[] = [];
  const room = new Room({
    code: 'TEST42',
    config,
    players,
    clock,
    onChange: (state, event) => {
      events.push(event);
      states.push(structuredClone(state));
    },
  });
  return { room, clock, players, events, states, config };
}

/** Da de alta un participante y devuelve su id. */
export function joinPlayer(room: Room, name: string, id?: string): string {
  const r = room.join(id, name);
  if (!r.ok) throw new Error(`join failed: ${r.error}`);
  return r.participantId;
}
