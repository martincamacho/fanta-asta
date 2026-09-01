import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import { DEFAULT_CONFIG, type Player, type RoomConfig, type RoomEvent, type RoomState } from '@fanta/shared';
import { openDatabase } from '../db.js';
import { systemClock, type Clock, type TimerHandle } from './clock.js';
import { Room } from './room.js';

/**
 * Migra snapshots viejos: config guardada mergeada SOBRE DEFAULT_CONFIG
 * (campos nuevos como baseBidMode/hideValues toman el default) y completa
 * los campos nuevos de AuctionState/RoomState que el snapshot no tenga.
 */
export function migrateState(state: RoomState): RoomState {
  state.config = {
    ...DEFAULT_CONFIG,
    ...state.config,
    slots: { ...DEFAULT_CONFIG.slots, ...(state.config?.slots ?? {}) },
  };
  if (state.auction.pausedRemainingMs === undefined) state.auction.pausedRemainingMs = null;
  if (state.finishedAt === undefined) state.finishedAt = null;
  if (!Array.isArray(state.callOrder)) state.callOrder = [];
  if (state.turnIndex === undefined) state.turnIndex = null;
  for (const p of state.participants) {
    if (typeof p.budgetBonus !== 'number') p.budgetBonus = 0;
  }
  return state;
}

/** Merge de una config parcial sobre DEFAULT_CONFIG (slots con merge profundo). */
export function mergeRoomConfig(patch?: Partial<RoomConfig>): RoomConfig {
  return {
    ...DEFAULT_CONFIG,
    ...patch,
    slots: { ...DEFAULT_CONFIG.slots, ...(patch?.slots ?? {}) },
  };
}

/** Forma persistida en SQLite: el snapshot del estado + el listone propio (si hay). */
type PersistedRoom = RoomState & { customListone?: Player[] | null };

/** Sin caracteres ambiguos (0/O, 1/I/L). */
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const RESTORE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const SAVE_DEBOUNCE_MS = 200;

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const DEFAULT_DB_PATH = path.join(SERVER_ROOT, 'db', 'fanta.sqlite');

interface RoomRow {
  code: string;
  admin_token: string;
  state_json: string;
}

export interface RoomManagerOptions {
  players: ReadonlyMap<number, Player>;
  /** ':memory:' para tests sin disco. Ignorado si se pasa `db`. */
  dbPath?: string;
  /** Conexión SQLite compartida (p.ej. con LeagueStore); el manager NO la cierra. */
  db?: Database.Database;
  clock?: Clock;
}

export class RoomManager {
  /** Notificación de todo cambio en cualquier sala (la capa socket lo re-emite a la room). */
  onChange?: (code: string, state: RoomState, event?: RoomEvent) => void;

  private readonly rooms = new Map<string, { room: Room; adminToken: string }>();
  private readonly players: ReadonlyMap<number, Player>;
  private readonly clock: Clock;
  private readonly db: Database.Database;
  private readonly ownsDb: boolean;
  private readonly dbPath: string;
  private readonly pendingSaves = new Map<string, TimerHandle>();
  private backupTimer: TimerHandle | null = null;
  private backupSeq = 0;

  constructor(opts: RoomManagerOptions) {
    this.players = opts.players;
    this.clock = opts.clock ?? systemClock;
    this.dbPath = opts.dbPath ?? DEFAULT_DB_PATH;
    if (opts.db) {
      this.db = opts.db;
      this.ownsDb = false;
    } else {
      this.db = openDatabase(this.dbPath);
      this.ownsDb = true;
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rooms (
        code TEXT PRIMARY KEY,
        admin_token TEXT NOT NULL,
        state_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
  }

  /** Restaura del snapshot SQLite las salas con actividad en las últimas 24h. */
  restore(): number {
    const cutoff = this.clock.now() - RESTORE_MAX_AGE_MS;
    const rows = this.db
      .prepare('SELECT code, admin_token, state_json FROM rooms WHERE updated_at >= ?')
      .all(cutoff) as RoomRow[];
    let restored = 0;
    for (const row of rows) {
      if (this.rooms.has(row.code)) continue;
      try {
        const raw = JSON.parse(row.state_json) as PersistedRoom;
        const customListone = Array.isArray(raw.customListone) ? raw.customListone : null;
        delete raw.customListone;
        const state = migrateState(raw);
        const room = new Room({
          code: row.code,
          config: state.config,
          players: this.players,
          clock: this.clock,
          initialState: state,
          customListone,
        });
        this.register(row.code, room, row.admin_token);
        restored += 1;
      } catch {
        // snapshot corrupto: se ignora
      }
    }
    return restored;
  }

  createRoom(configPatch?: Partial<RoomConfig>): { code: string; adminToken: string; room: Room } {
    const config = mergeRoomConfig(configPatch);
    const code = this.generateCode();
    const adminToken = randomUUID();
    const room = new Room({ code, config, players: this.players, clock: this.clock });
    this.register(code, room, adminToken);
    this.saveNow(code);
    return { code, adminToken, room };
  }

  getRoom(code: string): Room | undefined {
    return this.rooms.get(code)?.room;
  }

  verifyAdmin(code: string, adminToken: string | undefined): boolean {
    const entry = this.rooms.get(code);
    return !!entry && !!adminToken && entry.adminToken === adminToken;
  }

  /** Persiste ya todo lo pendiente (apagado ordenado). */
  flush(): void {
    for (const [code, handle] of this.pendingSaves) {
      this.clock.clearTimeout(handle);
      this.pendingSaves.delete(code);
      this.saveNow(code);
    }
  }

  // ── Backups ──────────────────────────────────────────────────────────────

  /** Arranca los backups periódicos (no aplica a ':memory:'). */
  startBackups(intervalMs = 10 * 60 * 1000): void {
    if (this.dbPath === ':memory:' || this.backupTimer !== null) return;
    const schedule = () => {
      this.backupTimer = this.clock.setTimeout(() => {
        void this.backupNow().finally(() => {
          if (this.backupTimer !== null) schedule();
        });
      }, intervalMs);
    };
    schedule();
  }

  /**
   * Copia la base a <dirname(dbPath)>/backups/fanta-<timestamp>.sqlite y poda
   * dejando los últimos 20. Silencioso ante fallas (solo warn).
   */
  async backupNow(): Promise<string | null> {
    if (this.dbPath === ':memory:') return null;
    try {
      const dir = path.join(path.dirname(this.dbPath), 'backups');
      mkdirSync(dir, { recursive: true });
      const stamp = new Date(this.clock.now()).toISOString().replace(/[:.]/g, '-');
      const file = path.join(dir, `fanta-${stamp}-${String(++this.backupSeq).padStart(3, '0')}.sqlite`);
      await this.db.backup(file);
      // poda: conservar los 20 más recientes (el timestamp del nombre ordena)
      const backups = readdirSync(dir)
        .filter((f) => /^fanta-.*\.sqlite$/.test(f))
        .sort()
        .reverse();
      for (const old of backups.slice(20)) {
        try {
          unlinkSync(path.join(dir, old));
        } catch {
          /* ignorar */
        }
      }
      return file;
    } catch (err) {
      console.warn(`Backup de SQLite falló: ${String(err)}`);
      return null;
    }
  }

  async close(): Promise<void> {
    this.flush();
    if (this.backupTimer !== null) {
      this.clock.clearTimeout(this.backupTimer);
      this.backupTimer = null;
    }
    for (const { room } of this.rooms.values()) room.dispose();
    if (this.dbPath !== ':memory:' && existsSync(path.dirname(this.dbPath))) {
      await this.backupNow(); // backup de despedida en el shutdown ordenado
    }
    if (this.ownsDb) this.db.close();
  }

  // ── Interno ──────────────────────────────────────────────────────────────

  private register(code: string, room: Room, adminToken: string): void {
    room.onChange = (state, event) => {
      this.scheduleSave(code);
      this.onChange?.(code, state, event);
    };
    this.rooms.set(code, { room, adminToken });
  }

  private scheduleSave(code: string): void {
    if (this.pendingSaves.has(code)) return;
    this.pendingSaves.set(
      code,
      this.clock.setTimeout(() => {
        this.pendingSaves.delete(code);
        this.saveNow(code);
      }, SAVE_DEBOUNCE_MS),
    );
  }

  private saveNow(code: string): void {
    const entry = this.rooms.get(code);
    if (!entry) return;
    const persisted: PersistedRoom = { ...entry.room.state, customListone: entry.room.customListone };
    this.db
      .prepare(
        `INSERT INTO rooms (code, admin_token, state_json, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(code) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at`,
      )
      .run(code, entry.adminToken, JSON.stringify(persisted), this.clock.now());
  }

  private generateCode(): string {
    for (;;) {
      let code = '';
      for (let i = 0; i < CODE_LENGTH; i++) {
        code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
  }
}
